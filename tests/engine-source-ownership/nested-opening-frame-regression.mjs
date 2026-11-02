import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {nestedOpeningFrameFixture} from './nested-opening-frame-fixture.mjs';

export const markers = ['WRAPPER_TITLE', 'WRAPPER_LEAD', 'HEAD_LABEL', 'HEAD_BODY',
  'FULL_LABEL', 'FULL_BODY', 'OPEN_LABEL', 'OPEN_LINE_A', 'OPEN_LINE_B',
  'NEXT_0', 'NEXT_1', 'NEXT_TAIL'];
export const variants = {
  stored: {}, nonstored: {stored: false}, oversized: {frameHeight: 22000},
  placeholderMismatch: {placeholderDelta: 100}, localSmallInline: {inlineHeight: 4000},
  asymmetricMargins: {outerTop: 150, outerBottom: 300},
  zeroMargins: {outerTop: 0, outerBottom: 0}, hostNoStoredLines: {hostStored: false},
  hostNoStoredLinesZeroMargins: {hostStored: false, outerTop: 0, outerBottom: 0},
};
const digest = value => createHash('sha256').update(value).digest('hex');
function* walk(node) {
  yield node;
  if (node.child) yield* walk(node.child);
  for (const child of node.children || []) yield* walk(child);
}
function tableBox(node) {
  const cells = (node.children || []).map(child => child.child || child)
    .filter(child => child.groupKind?.kind === 'tableCell').map(child => child.bounds);
  return {...node.bounds, physicalHeight: cells.length
    ? Math.max(...cells.map(cell => cell.y + cell.height)) - Math.min(...cells.map(cell => cell.y))
    : null};
}
const sourceText = doc => JSON.parse(doc.getScanItems()).filter(item => item.kind === 0 && item.text)
  .map(item => item.text).join('');
export const openingGrid = record => record.fragments[0].tables.find(table => Math.abs(table.width - 20000 / 75) < .01);
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < .01, `${message}: ${actual} != ${expected}`);

export async function loadCore(jsPath, wasmPath) {
  assert.ok(jsPath && wasmPath, 'Set both PWH_CORE_JS and PWH_CORE_WASM, or pass both core paths.');
  const core = await import(pathToFileURL(path.resolve(jsPath)));
  const bytes = await fs.readFile(path.resolve(wasmPath));
  await core.default({module_or_path: bytes});
  return {core, wasmSha256: digest(bytes)};
}

export function inspectFixture(core, options = {}) {
  const bytes = nestedOpeningFrameFixture(options), doc = new core.HwpDocument(bytes);
  try {
    const fragments = Array.from({length: doc.pageCount()}, (_, page) => ({
      page: page + 1, svgSha256: digest(doc.renderPageSvgWithProfile(page, 'print')),
      runs: JSON.parse(doc.getPageTextLayout(page)).runs,
      tables: [...walk(JSON.parse(doc.getPageLayerTree(page)).root)]
        .filter(node => node.groupKind?.kind === 'table').map(tableBox),
    }));
    for (const marker of markers) assert.equal(fragments.flatMap(fragment => fragment.runs)
      .filter(run => run.text === marker).length, 1, `One layout owner for ${marker}`);
    const original = sourceText(doc), reopened = new core.HwpDocument(doc.exportHwpx());
    let roundTripOpeningGridHeight;
    try {
      assert.equal(sourceText(reopened), original, 'Save/reopen retains every source character');
      assert.equal(reopened.pageCount(), doc.pageCount(), 'Save/reopen retains pagination');
      const node = [...walk(JSON.parse(reopened.getPageLayerTree(0)).root)]
        .find(node => node.groupKind?.kind === 'table' && Math.abs(node.bounds.width - 20000 / 75) < .01);
      roundTripOpeningGridHeight = node ? tableBox(node).physicalHeight : null;
    } finally { reopened.free(); }
    const hit = fragments.flatMap(fragment => fragment.runs).find(run => run.text === 'OPEN_LINE_A');
    assert.ok(hit.cellPath?.length >= 2, 'Target is genuinely inside nested cell owners');
    const cellPath = JSON.stringify(hit.cellPath);
    assert.equal(doc.getTextInCellByPath(hit.secIdx, hit.parentParaIdx, cellPath, hit.charStart, 11), 'OPEN_LINE_A');
    const snapshot = doc.saveSnapshot();
    let editedSource, editedSvgSha256, editedOpeningGrid;
    try {
      doc.insertTextInCellByPath(hit.secIdx, hit.parentParaIdx, cellPath, hit.charStart, 'EDIT');
      editedSource = sourceText(doc);
      assert.equal(editedSource, original.replace('OPEN_LINE_A', 'EDITOPEN_LINE_A'),
        'Only the exact target changes; all sibling source stays unchanged');
      assert.equal(doc.getTextInCellByPath(hit.secIdx, hit.parentParaIdx, cellPath, hit.charStart, 15), 'EDITOPEN_LINE_A');
      editedSvgSha256 = Array.from({length: doc.pageCount()}, (_, page) => digest(doc.renderPageSvgWithProfile(page, 'print')));
      const grid = [...walk(JSON.parse(doc.getPageLayerTree(0)).root)]
        .find(node => node.groupKind?.kind === 'table' && Math.abs(node.bounds.width - 20000 / 75) < .01);
      editedOpeningGrid = grid ? tableBox(grid) : null;
    } finally {
      doc.restoreSnapshot(snapshot);
      doc.discardSnapshot(snapshot);
    }
    assert.equal(sourceText(doc), original, 'Undo snapshot restores all source text');
    const snapshotGeometryRestored = doc.pageCount() === fragments.length && fragments.every((fragment, page) =>
      digest(doc.renderPageSvgWithProfile(page, 'print')) === fragment.svgSha256);
    assert.ok(snapshotGeometryRestored, 'Undo snapshot restores the entire original print geometry');
    return {fixtureSha256: digest(bytes), originalSourceSha256: digest(original),
      editedSourceSha256: digest(editedSource), pages: fragments.length,
      roundTripOpeningGridHeight, snapshotGeometryRestored, editedOpeningGrid, editedSvgSha256, fragments};
  } finally { doc.free(); }
}

export function inspectVariants(core) {
  return Object.fromEntries(Object.entries(variants).map(([name, options]) => [name, inspectFixture(core, options)]));
}

export function verifyFrameAndMargins(records) {
  for (const [name, top, bottom] of [['stored', 100, 100], ['asymmetricMargins', 150, 300]]) {
    const record = records[name], grid = openingGrid(record), zero = openingGrid(records.zeroMargins);
    assert.ok(grid && zero, `${name} has a measurable child grid`);
    near(grid.physicalHeight, 10200 / 75, `${name} owns its declared first physical frame`);
    near(record.roundTripOpeningGridHeight, grid.physicalHeight, `${name} save/reopen retains the frame`);
    near(grid.y - zero.y, top / 75, `${name} top outer margin is counted exactly once`);
    const root = record.fragments[0].tables[0];
    near(root.y + root.physicalHeight - grid.y - grid.physicalHeight,
      (bottom + 100) / 75, `${name} closes its own bottom margin plus the parent's own inner padding`);
    for (const marker of ['OPEN_LABEL', 'OPEN_LINE_A', 'OPEN_LINE_B'])
      assert.ok(record.fragments[0].runs.some(run => run.text === marker), `${marker} stays in opening frame`);
    for (const marker of ['NEXT_0', 'NEXT_1', 'NEXT_TAIL'])
      assert.ok(record.fragments[1].runs.some(run => run.text === marker), `${marker} remains continuation-owned`);
  }
  near(openingGrid(records.zeroMargins).physicalHeight, 10200 / 75, 'Zero outer margins retain the child frame');
  const noStored = openingGrid(records.hostNoStoredLines), noStoredZero = openingGrid(records.hostNoStoredLinesZeroMargins);
  near(noStored.y - noStoredZero.y, 100 / 75, 'A recomposed host keeps its ordinary top-margin contract');
  assert.ok(Object.values(records).every(record => record.snapshotGeometryRestored));
}

export function verifyIndependentReflow(candidate, reference, candidateHash, referenceHash) {
  assert.notEqual(candidateHash, referenceHash, 'The ordinary-reflow oracle must be an independent pre-feature engine');
  assert.ok(Math.abs(openingGrid(reference.stored).physicalHeight - 10200 / 75) > .01,
    'The reference must predate the stored opening-frame feature');
  for (const name of ['stored', 'asymmetricMargins']) {
    assert.equal(candidate[name].fixtureSha256, reference[name].fixtureSha256, 'Both engines receive identical fixture bytes');
    assert.equal(candidate[name].originalSourceSha256, reference[name].originalSourceSha256);
    assert.equal(candidate[name].editedSourceSha256, reference[name].editedSourceSha256);
    assert.deepEqual(candidate[name].editedOpeningGrid, reference[name].editedOpeningGrid,
      `${name}: after a deep edit use independent ordinary reflow, not a stale source frame`);
    assert.deepEqual(candidate[name].editedSvgSha256, reference[name].editedSvgSha256,
      `${name}: the complete edited print output agrees with independent ordinary reflow`);
  }
  for (const name of ['nonstored', 'oversized', 'placeholderMismatch', 'localSmallInline'])
    assert.deepEqual(candidate[name].fragments.map(fragment => fragment.svgSha256),
      reference[name].fragments.map(fragment => fragment.svgSha256), `${name} does not enter the source-frame path`);
}

export async function runRegression({jsPath = process.env.PWH_CORE_JS, wasmPath = process.env.PWH_CORE_WASM,
  referenceJs = process.env.PWH_REFERENCE_CORE_JS, referenceWasm = process.env.PWH_REFERENCE_CORE_WASM,
  requireReference = false} = {}) {
  const candidate = await loadCore(jsPath, wasmPath), records = inspectVariants(candidate.core);
  verifyFrameAndMargins(records);
  let referenceHash;
  if (referenceJs || referenceWasm || requireReference) {
    assert.ok(referenceJs && referenceWasm, 'Set both PWH_REFERENCE_CORE_JS and PWH_REFERENCE_CORE_WASM for independent edited-reflow qualification');
    const reference = await loadCore(referenceJs, referenceWasm);
    verifyIndependentReflow(records, inspectVariants(reference.core), candidate.wasmSha256, reference.wasmSha256);
    referenceHash = reference.wasmSha256;
  }
  return {wasmSha256: candidate.wasmSha256, referenceWasmSha256: referenceHash,
    fixtureVariants: Object.keys(records).length, independentReflowChecked: Boolean(referenceHash), records};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const report = await runRegression({jsPath: process.argv[2] || process.env.PWH_CORE_JS,
    wasmPath: process.argv[3] || process.env.PWH_CORE_WASM, requireReference: true});
  console.log(JSON.stringify({wasmSha256: report.wasmSha256, referenceWasmSha256: report.referenceWasmSha256,
    fixtureVariants: report.fixtureVariants, independentReflowChecked: report.independentReflowChecked}));
}
