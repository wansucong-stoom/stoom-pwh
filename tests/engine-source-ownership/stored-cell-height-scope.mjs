import assert from 'node:assert/strict';
import {declaredNestedFixture} from './declared-nested-fixture.mjs';
import {mapHwpxMember} from './hwpx-fixture-utils.mjs';
import {zipEntries} from '../../scripts/setup.mjs';

// Compare two real engine instances using the same synthetic source. The first
// performs immediate edits; the second batches each identical edit to retain
// the ordinary measurement path. No cache counters or copied implementation
// values are used as the expected geometry.
const ok = value => { const result = JSON.parse(value); assert.equal(result.ok, true); return result; };

function fixture() {
  return mapHwpxMember(declaredNestedFixture({inlineInner: true, objectFirst: true}), 'Contents/section0.xml', xml => {
    const start = xml.indexOf('<hp:tbl ');
    let depth = 0, end;
    for (const token of xml.slice(start).matchAll(/<\/?hp:tbl\b[^>]*>/g)) {
      depth += token[0].startsWith('</') ? -1 : 1;
      if (depth === 0) { end = start + token.index + token[0].length; break; }
    }
    assert.ok(end, 'fixture has a real root table');
    const table = xml.slice(start, end);
    const siblings = [1, 2].map(index => {
      let sibling = table.replace(/\bid="(\d+)"/g, (_, id) => `id="${Number(id) + index * 1000}"`)
        .replace(/<hp:t>([^<]+)<\/hp:t>/g, (_, text) => `<hp:t>S${index}_${text}</hp:t>`);
      // One sibling is inline, the other remains a floating root. Each owns its
      // nested children; local child control indexes intentionally repeat.
      if (index === 1) sibling = sibling.replace(/treatAsChar="0"/, 'treatAsChar="1"');
      return sibling;
    }).join('');
    return xml.slice(0, end) + siblings + xml.slice(end);
  });
}

function state(doc) {
  return {
    pageCount: doc.pageCount(),
    scan: doc.getScanItems(),
    pages: Array.from({length: doc.pageCount()}, (_, page) => ({
      svg: doc.renderPageSvgWithProfile(page, 'print'),
      layout: doc.getPageTextLayout(page),
    })),
    xml: zipEntries(Buffer.from(doc.exportHwpx())).filter(entry => entry.name.endsWith('.xml'))
      .map(entry => [entry.name, entry.read().toString('utf8')]).sort(([a], [b]) => a.localeCompare(b)),
  };
}
const rootOwners = new WeakMap();
const resize = (doc, delta = 300, widthDelta = 0) => {
  const owner = rootOwners.get(doc);
  assert.ok(owner, 'the source root owner is captured before any mutation');
  return ok(doc.resizeTableCells(owner.secIdx, owner.parentParaIdx, owner.controlIndex,
    JSON.stringify([{cellIdx: 0, heightDelta: delta, widthDelta}])));
};
const pathJSON = path => JSON.stringify(path);
const locate = (doc, marker) => {
  const run = Array.from({length: doc.pageCount()}, (_, page) => JSON.parse(doc.getPageTextLayout(page)).runs)
    .flat().find(run => run.text === marker);
  assert.ok(run?.cellPath?.length >= 2, `fixture marker ${marker} has a nested model owner`);
  return run;
};
const insert = doc => {
  const run = locate(doc, 'INNER_0');
  ok(doc.insertTextInCellByPath(run.secIdx, run.parentParaIdx, pathJSON(run.cellPath), run.charStart, 'EDIT_'));
};

export const cellHeightScopeCases = [
  {name: 'same paragraph mixed root siblings', resize: doc => resize(doc)},
  {name: 'deep nested root owner', resize: doc => {
    const hit = locate(doc, 'INNER_0');
    assert.equal(hit.cellPath.length, 3, 'fixture targets the third-level table');
    ok(doc.resizeTableCellsByPath(hit.secIdx, hit.parentParaIdx, pathJSON(hit.cellPath),
      JSON.stringify([{cellIdx: 0, heightDelta: 300}])));
  }},
  {name: 'native HWP5 first edit and subsequent height', hwp: true, resize: doc => resize(doc)},
  {name: 'mixed width and height forces ordinary path', resize: doc => resize(doc, 200, 60)},
  {name: 'earlier dirty cell text remains dirty', dirty: insert, resize: doc => resize(doc)},
  {name: 'earlier dirty character style remains dirty', dirty: doc => {
    const hit = locate(doc, 'INNER_0');
    ok(doc.applyCharFormatInCellByPath(hit.secIdx, hit.parentParaIdx, pathJSON(hit.cellPath), 0, 7,
      JSON.stringify({bold: true, fontSize: 16})));
  }, resize: doc => resize(doc)},
  {name: 'earlier dirty paper geometry remains dirty', dirty: doc =>
    ok(doc.setPageDef(0, JSON.stringify({height: 28000}))), resize: doc => resize(doc)},
  {name: 'snapshot restore then height edit', undoFirst: true, resize: doc => resize(doc)},
];

export function verifyCellHeightScope(core, definition) {
  const source = fixture();
  const result = {name: definition.name, phases: [], ok: false};
  let material = source;
  if (definition.hwp) {
    const generator = new core.HwpDocument(source);
    try { material = Buffer.from(generator.exportHwp()); } finally { generator.free(); }
    assert.equal(material.subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1', 'the native fixture is an actual HWP5 compound container');
    result.container = 'HWP5';
  }
  const fast = new core.HwpDocument(material), full = new core.HwpDocument(material);
  const compare = label => {
    const left = state(fast), right = state(full);
    assert.deepEqual(left, right, `${definition.name}/${label}: complete geometry, scan and source XML must match`);
    result.phases.push({label, pageCount: left.pageCount});
    return left;
  };
  const change = operation => {
    operation(fast);
    ok(full.beginBatch());
    try { operation(full); } finally { ok(full.endBatch()); }
  };
  let snapshots;
  try {
    const initial = compare('loaded');
    for (const doc of [fast, full]) {
      const header = Array.from({length: doc.pageCount()}, (_, page) => JSON.parse(doc.getPageTextLayout(page)).runs)
        .flat().find(run => run.text === 'HEADER');
      assert.ok(header?.cellPath?.[0]);
      rootOwners.set(doc, {secIdx: header.secIdx, parentParaIdx: header.parentParaIdx,
        controlIndex: header.cellPath[0].controlIndex});
    }
    assert.ok(initial.pageCount >= 2, 'synthetic source exercises multipage tables');
    assert.ok(initial.scan.includes('S1_') && initial.scan.includes('S2_'), 'distinct sibling owners exist');
    snapshots = [fast.saveSnapshot(), full.saveSnapshot()];
    if (definition.undoFirst) {
      change(doc => resize(doc, 400));
      compare('first modification');
      fast.restoreSnapshot(snapshots[0]); full.restoreSnapshot(snapshots[1]);
      compare('restored before second modification');
    }
    if (definition.dirty) {
      // Both instances retain the earlier edit's dirty state. No rendering or
      // export is allowed between that edit and the resize under test.
      for (const doc of [fast, full]) { ok(doc.beginBatch()); definition.dirty(doc); definition.resize(doc); ok(doc.endBatch()); }
    } else change(definition.resize);
    compare('first resize');
    change(doc => resize(doc, -100));
    const changed = compare('next clean height resize');
    const reopened = [fast, full].map(doc => new core.HwpDocument(doc.exportHwpx()));
    try {
      assert.deepEqual(state(reopened[0]), state(reopened[1]), `${definition.name}: saved/reopened geometry and source remain equal`);
      result.phases.push({label: 'saved/reopened', pageCount: reopened[0].pageCount()});
    } finally { reopened.forEach(doc => doc.free()); }
    assert.notDeepEqual(changed.xml, initial.xml, 'the requested mutation changed real source data');
    fast.restoreSnapshot(snapshots[0]); full.restoreSnapshot(snapshots[1]);
    const undone = compare('undo snapshot');
    assert.deepEqual(undone, initial, 'undo restores exact initial geometry and source');
    result.ok = true;
  } finally {
    if (snapshots) { fast.discardSnapshot(snapshots[0]); full.discardSnapshot(snapshots[1]); }
    fast.free(); full.free();
  }
  return result;
}
