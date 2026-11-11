import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {pathToFileURL} from 'node:url';
import {nestedOpeningFrameFixture} from './engine-source-ownership/nested-opening-frame-fixture.mjs';
import {mapHwpxMember} from './engine-source-ownership/hwpx-fixture-utils.mjs';

const skip = !process.env.PWH_CORE_JS || !process.env.PWH_CORE_WASM
  ? 'Requires explicit PWH_CORE_JS and PWH_CORE_WASM paths'
  : false;
let loaded;
async function loadCore() {
  loaded ??= (async () => {
    const core = await import(pathToFileURL(process.env.PWH_CORE_JS));
    await core.default({module_or_path: await fs.readFile(process.env.PWH_CORE_WASM)});
    return core;
  })();
  return loaded;
}

function layout(doc) {
  return Array.from({length: doc.pageCount()}, (_, page) => ({
    text: doc.getPageTextLayout(page),
    print: doc.renderPageSvgWithProfile(page, 'print'),
  }));
}

function target(doc, marker) {
  const runs = Array.from({length: doc.pageCount()}, (_, page) =>
    JSON.parse(doc.getPageTextLayout(page)).runs).flat();
  const run = runs.find(candidate => candidate.text.includes(marker));
  assert.ok(run?.cellPath?.length >= 2, 'The target is in a nested cell');
  return run;
}

function apply(doc, run, kind, amount, depth = run.cellPath.length) {
  const cellPath = run.cellPath.slice(0, depth);
  const path = JSON.stringify(cellPath);
  switch (kind) {
    case 'height':
    case 'width':
      doc.resizeTableCellsByPath(run.secIdx, run.parentParaIdx, path,
        JSON.stringify([{cellIdx: cellPath.at(-1).cellIndex, [kind + 'Delta']: amount}]));
      break;
    case 'insert':
      doc.insertTextInCellByPath(run.secIdx, run.parentParaIdx, path, 0, amount);
      break;
    case 'delete':
      doc.deleteTextInCellByPath(run.secIdx, run.parentParaIdx, path, 0, amount);
      break;
    case 'split':
      doc.splitParagraphInCellByPath(run.secIdx, run.parentParaIdx, path, 0);
      break;
    default:
      throw Error('Unknown mutation');
  }
}

for (const [name, options] of Object.entries({
  stored: {},
  nonstored: {stored: false},
  oversized: {frameHeight: 22000},
  asymmetricMargins: {outerTop: 150, outerBottom: 300},
  hostNoStoredLines: {hostStored: false},
  independentSuffix: {suffix: true},
})) {
  test('local nested edits equal full calculation through undo and reopen — ' + name,
    {skip}, async () => {
      const core = await loadCore();
      let bytes = nestedOpeningFrameFixture(options);
      if (options.suffix) {
        const tail = [0, 1, 2].map(index =>
          '<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="1" columnBreak="0" merged="0">'
          + '<hp:run charPrIDRef="0"><hp:t>INDEPENDENT_SUFFIX_' + index + '</hp:t></hp:run>'
          + '<hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000" textheight="1000"'
          + ' baseline="850" spacing="600" horzpos="0" horzsize="18000" flags="393216"/>'
          + '</hp:linesegarray></hp:p>').join('');
        bytes = mapHwpxMember(bytes, 'Contents/section0.xml',
          xml => xml.replace('</hs:sec>', tail + '</hs:sec>'));
      }
      const local = new core.HwpDocument(bytes);
      const full = new core.HwpDocument(bytes);
      try {
        const before = layout(local);
        assert.deepEqual(before, layout(full));
        const snapshots = [local.saveSnapshot(), full.saveSnapshot()];
        const targets = new Map(['OPEN_LINE_A', 'NEXT_0'].map(marker => [marker, target(local, marker)]));
        for (const [kind, amount, marker, depth, batched] of [
          ['height', 200, 'OPEN_LINE_A'],
          ['width', -200, 'OPEN_LINE_A'],
          ['insert', 'EDIT', 'OPEN_LINE_A'],
          ['delete', 4, 'OPEN_LINE_A'],
          ['width', 400, 'OPEN_LINE_A'],
          ['width', -800, 'OPEN_LINE_A', 1],
          ['insert', 'PARENT_WIDTH', 'NEXT_0'],
          ['width', 1600, 'OPEN_LINE_A', 1],
          ['insert', 'BATCH', 'OPEN_LINE_A', undefined, true],
          ['insert', 'LOCAL_AGAIN', 'OPEN_LINE_A'],
          ['height', -200, 'OPEN_LINE_A'],
          ['insert', 'A long sentence changes the wrapping width of this nested cell. ', 'OPEN_LINE_A'],
          ['insert', 'SIBLING', 'NEXT_0'],
          ['split', 0, 'OPEN_LINE_A'],
        ]) {
          const run = targets.get(marker);
          if (batched) local.beginBatch();
          try { apply(local, run, kind, amount, depth); }
          finally { if (batched) local.endBatch(); }
          full.beginBatch();
          try { apply(full, run, kind, amount, depth); }
          finally { full.endBatch(); }
          assert.deepEqual(layout(local), layout(full), name + ' ' + kind);

          const reopenedLocal = new core.HwpDocument(local.exportHwpx());
          const reopenedFull = new core.HwpDocument(full.exportHwpx());
          try { assert.deepEqual(layout(reopenedLocal), layout(reopenedFull), 'Saved outputs agree'); }
          finally { reopenedLocal.free(); reopenedFull.free(); }
        }
        const splitRun = structuredClone(targets.get('OPEN_LINE_A'));
        splitRun.cellPath.at(-1).cellParaIndex++;
        apply(local, splitRun, 'insert', 'AFTER_SPLIT');
        full.beginBatch();
        try { apply(full, splitRun, 'insert', 'AFTER_SPLIT'); }
        finally { full.endBatch(); }
        assert.deepEqual(layout(local), layout(full), 'Reallocated paragraphs are recalculated');
        local.restoreSnapshot(snapshots[0]);
        full.restoreSnapshot(snapshots[1]);
        assert.deepEqual(layout(local), before, 'Undo restores every original page');
        assert.deepEqual(layout(full), before);
        const run = target(local, 'OPEN_LINE_A');
        apply(local, run, 'insert', 'AFTER_UNDO');
        full.beginBatch();
        try { apply(full, run, 'insert', 'AFTER_UNDO'); }
        finally { full.endBatch(); }
        assert.deepEqual(layout(local), layout(full), 'Replaced source allocations are recalculated');
        local.discardSnapshot(snapshots[0]);
        full.discardSnapshot(snapshots[1]);
      } finally {
        local.free();
        full.free();
      }
    });
}
