import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {terminalRowSourceWidthFixture, terminalRowSourceWidthPictureFixture}
  from './engine-source-ownership/stored-nested-tail-source-width-fixture.mjs';
import {terminalRowLongTailFixture} from './engine-source-ownership/stored-nested-tail-long-tail-fixture.mjs';

const coreSkip = !process.env.PWH_CORE_JS || !process.env.PWH_CORE_WASM
  ? 'Requires explicit PWH_CORE_JS and PWH_CORE_WASM paths' : false;
const hash = value => createHash('sha256').update(value).digest('hex');
async function load(js, wasm) {
  const module = await import(pathToFileURL(path.resolve(js)));
  await module.default({module_or_path: await fs.readFile(wasm)});
  return module;
}
let loaded;
const candidate = () => loaded ||= load(process.env.PWH_CORE_JS, process.env.PWH_CORE_WASM);
function capture(doc) {
  return Array.from({length: doc.pageCount()}, (_, page) => ({
    text: JSON.parse(doc.getPageTextLayout(page)).runs.map(run => run.text),
    svgSha256: hash(doc.renderPageSvgWithProfile(page, 'print')),
  }));
}
const owner = (pages, marker) => pages.findIndex(page => page.text.includes(marker));
const sourceText = doc => JSON.parse(doc.getScanItems()).filter(item => item.kind === 0 && item.text).map(item => item.text).join('');
function verifyOwners(pages) {
  const first = owner(pages, 'ROW_0_0'), tail = owner(pages, 'ROW_5_0');
  assert.ok(first >= 0);
  assert.equal(tail, first + 1, 'The saved terminal row belongs to the next physical frame');
  assert.equal(owner(pages, 'AFTER_TABLE'), tail, 'The successor stays with its terminal frame');
  const markers = ['WRAPPER', 'LEAD_0', 'LEAD_1', 'LEAD_2', 'AFTER_TABLE',
    ...Array.from({length: 6}, (_, row) => [0, 1].map(col => `ROW_${row}_${col}`)).flat()];
  const text = pages.map(page => page.text.join('')).join('');
  for (const marker of markers) assert.equal(text.split(marker).length - 1, 1, `${marker} appears exactly once`);
}

for (const [name, fixture] of [['whole-row capacity shortcut', terminalRowSourceWidthFixture],
  ['ordinary row-cut scanner', terminalRowLongTailFixture]]) {
  test(`stored nested tail: ${name} preserves source owners and read order`, {skip: coreSkip}, async () => {
    const core = await candidate(), doc = new core.HwpDocument(fixture());
    try {
      const initial = capture(doc), snapshot = doc.saveSnapshot();
      verifyOwners(initial);
      for (let page = doc.pageCount() - 1; page >= 0; page--) {
        doc.getPageTextLayout(page);
        doc.renderPageSvgWithProfile(page, 'print');
      }
      assert.deepEqual(capture(doc), initial, 'Warmed caches cannot depend on render order');
      const pageDef = JSON.parse(doc.getPageDef(0));
      assert.equal(JSON.parse(doc.setPageDef(0, JSON.stringify({height: 12000}))).ok, true);
      const changed = capture(doc), reopened = new core.HwpDocument(doc.exportHwpx());
      try { assert.deepEqual(capture(reopened), changed, 'Changed body authority matches a fresh document'); }
      finally { reopened.free(); }
      assert.equal(JSON.parse(doc.setPageDef(0, JSON.stringify(pageDef))).ok, true);
      assert.deepEqual(capture(doc), initial, 'Restoring paper geometry restores eligibility');
      doc.restoreSnapshot(snapshot);
      doc.discardSnapshot(snapshot);
      assert.deepEqual(capture(doc), initial, 'Undo restores source geometry and ownership');
    } finally { doc.free(); }
  });
}

for (const [name, marker, properties] of [
  ['deep image shrink', 'ROW_4_1', {width: 400, height: 400}],
  ['deep image growth', 'ROW_4_1', {width: 400, height: 2400}],
  ['deep image width', 'ROW_4_1', {width: 9000, height: 400}],
  ['containing image', 'LEAD_0', {width: 400, height: 400}],
]) {
  test(`stored nested tail: ${name} invalidates stale source through save and Undo`, {skip: coreSkip}, async () => {
    const core = await candidate(), doc = new core.HwpDocument(terminalRowSourceWidthPictureFixture(core, marker));
    try {
      const before = capture(doc), snapshot = doc.saveSnapshot(), source = sourceText(doc);
      verifyOwners(before);
      const hit = Array.from({length: doc.pageCount()}, (_, page) => JSON.parse(doc.getPageTextLayout(page)).runs)
        .flat().find(run => run.text === marker);
      const cellPath = JSON.stringify(hit.cellPath);
      assert.equal(JSON.parse(doc.setCellPicturePropertiesByPath(hit.secIdx, hit.parentParaIdx, cellPath, 0, JSON.stringify(properties))).ok, true);
      const current = JSON.parse(doc.getCellPicturePropertiesByPath(hit.secIdx, hit.parentParaIdx, cellPath, 0));
      assert.equal(current.width, properties.width);
      assert.equal(current.height, properties.height);
      assert.equal(sourceText(doc), source, 'Picture geometry does not change source text');
      const after = capture(doc), reopened = new core.HwpDocument(doc.exportHwpx());
      try {
        const restored = capture(reopened);
        for (const token of ['ROW_0_0', 'ROW_5_0', 'AFTER_TABLE']) {
          assert.equal(owner(restored, token), owner(after, token), 'Reopen cannot resurrect the stale imported tail frame');
        }
      } finally { reopened.free(); }
      doc.restoreSnapshot(snapshot);
      doc.discardSnapshot(snapshot);
      assert.deepEqual(capture(doc), before, 'Undo restores the original physical frames');
    } finally { doc.free(); }
  });
}

const referenceSkip = coreSkip || (!process.env.PWH_REFERENCE_CORE_JS || !process.env.PWH_REFERENCE_CORE_WASM
  ? 'Requires an independent ordinary-reflow reference engine' : false);
for (const [name, options] of [
  ['inexact closure', {successorDelta: 1}],
  ['reflowed source', {stored: false}],
  ['positioned child', {offset: 100}],
  ['cross-boundary merged cell', {mergeCrossing: true}],
  ['source frame exceeds current body', {paperHeight: 12000}],
]) {
  test(`stored nested tail: ${name} retains independent ordinary reflow`, {skip: referenceSkip}, async () => {
    const core = await candidate();
    const reference = await load(process.env.PWH_REFERENCE_CORE_JS, process.env.PWH_REFERENCE_CORE_WASM);
    const bytes = terminalRowSourceWidthFixture(options);
    const actual = new core.HwpDocument(bytes), expected = new reference.HwpDocument(bytes);
    try { assert.deepEqual(capture(actual), capture(expected)); }
    finally { actual.free(); expected.free(); }
  });
}

test('stored nested tail: extracted original source and ambient-state contract (87 Rust cases)',
  {skip: !process.env.PWH_ENGINE_SOURCE ? 'Requires explicit source root' : false, timeout: 120000}, async () => {
    const script = fileURLToPath(new URL('./engine-source-ownership/stored-nested-tail-source.mjs', import.meta.url));
    const {stdout} = await promisify(execFile)(process.execPath, [script, process.env.PWH_ENGINE_SOURCE],
      {windowsHide: true, env: process.env, maxBuffer: 2 * 1024 * 1024});
    assert.match(stdout, /test result: ok\. 87 passed; 0 failed;/);
  });
