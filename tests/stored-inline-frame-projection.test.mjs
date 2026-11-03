import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {storedInlineFrameFixture} from './engine-source-ownership/stored-inline-frame-fixture.mjs';

const coreSkip = !process.env.PWH_CORE_JS || !process.env.PWH_CORE_WASM
  ? 'Requires explicit PWH_CORE_JS and PWH_CORE_WASM' : false;
const referenceSkip = coreSkip || (!process.env.PWH_REFERENCE_CORE_JS || !process.env.PWH_REFERENCE_CORE_WASM
  ? 'Requires an independent PWH_REFERENCE_CORE_JS and PWH_REFERENCE_CORE_WASM' : false);
const hash = value => createHash('sha256').update(value).digest('hex');
async function load(js, wasm) {
  const core = await import(pathToFileURL(path.resolve(js)));
  await core.default({module_or_path: await fs.readFile(wasm)});
  return core;
}
let candidatePromise, referencePromise;
const candidate = () => candidatePromise ||= load(process.env.PWH_CORE_JS, process.env.PWH_CORE_WASM);
const reference = () => referencePromise ||= load(process.env.PWH_REFERENCE_CORE_JS, process.env.PWH_REFERENCE_CORE_WASM);
const markers = ['TITLE', ...Array.from({length: 8}, (_, i) => `DATA_${Math.floor(i / 2)}_${i % 2}`)];
const capture = doc => Array.from({length: doc.pageCount()}, (_, page) => ({
  svg: hash(doc.renderPageSvgWithProfile(page, 'print')),
  runs: JSON.parse(doc.getPageTextLayout(page)).runs,
}));
const appearance = pages => pages.map(page => ({svg: page.svg,
  runs: page.runs.map(({text, x, y, w, h, charX}) => ({text, x, y, w, h, charX})),
}));
function verifyOwnedFrames(doc, pages, paper) {
  for (const marker of markers) {
    assert.equal(pages.flatMap(page => page.runs).filter(run => run.text === marker).length, 1,
      `${marker}: exactly one visible owner`);
  }
  const title = pages.findIndex(page => page.runs.some(run => run.text === 'TITLE'));
  for (const marker of markers.slice(1)) {
    assert.equal(pages.findIndex(page => page.runs.some(run => run.text === marker)), title + 1,
      'The complete inline object belongs to the following stored frame');
  }
  for (const [page, value] of pages.entries()) {
    for (const run of value.runs) {
      assert.ok(run.y >= -0.2 && run.y + run.h <= paper * 96 / 7200 + 0.2,
        'The complete glyph box remains inside its paper');
    }
    const tree = JSON.parse(doc.getPageRenderTree(page));
    function walk(node, ancestors = []) {
      if (node.type === 'Table' && node.rows === 4 && node.cols === 2) {
        const owner = ancestors.findLast(ancestor => ancestor.type === 'Cell');
        assert.ok(owner, 'The inline table retains its direct cell owner');
        assert.ok(node.bbox.y >= owner.bbox.y - 0.2);
        assert.ok(node.bbox.y + node.bbox.h <= owner.bbox.y + owner.bbox.h + 0.2,
          'The entire inline table fits its direct parent cell');
      }
      for (const child of node.children || []) walk(child, [...ancestors, node]);
    }
    walk(tree.root || tree);
  }
}
for (const paper of [16000, 18000, 22000]) {
  test(`stored inline frame: title and complete object retain distinct owners (${paper} HU)`, {skip: coreSkip}, async () => {
    const core = await candidate(), doc = new core.HwpDocument(storedInlineFrameFixture({paper}));
    try {
      const text = doc.getScanItems(), before = capture(doc);
      assert.equal(before.length, 2, 'Two original source frames remain two physical pages');
      verifyOwnedFrames(doc, before, paper);
      for (let page = doc.pageCount() - 1; page >= 0; page--) doc.getPageRenderTree(page);
      assert.deepEqual(capture(doc), before, 'Reverse access does not change cached geometry');
      assert.equal(doc.getScanItems(), text, 'Layout does not rewrite source content');
      const reopened = new core.HwpDocument(doc.exportHwpx());
      try { assert.deepEqual(appearance(capture(reopened)), appearance(before)); }
      finally { reopened.free(); }
      const snapshot = doc.saveSnapshot();
      try {
        const run = before.flatMap(page => page.runs).find(item => item.text === 'DATA_1_0');
        assert.ok(run.cellPath.length >= 3, 'This is a genuine nested-cell edit');
        doc.insertTextInCellByPath(run.secIdx, run.parentParaIdx, JSON.stringify(run.cellPath), run.charStart, 'EDIT');
        const edited = capture(doc), editedReopened = new core.HwpDocument(doc.exportHwpx());
        try { assert.deepEqual(appearance(capture(editedReopened)), appearance(edited),
          'Edited source does not regain stale frame authority on reopen'); }
        finally { editedReopened.free(); }
      } finally { doc.restoreSnapshot(snapshot); doc.discardSnapshot(snapshot); }
      assert.deepEqual(capture(doc), before, 'Undo restores source frame ownership and geometry');
    } finally { doc.free(); }
  });
}
for (const [name, options] of [
  ['ordinary forward source', {rewind: false}],
  ['inexact inline band', {bandDelta: 200}],
  ['non-inline object', {inline: false}],
  ['caption-bearing parent', {parentCaption: true}],
]) {
  test(`stored inline frame: unsupported ${name} retains independent baseline`, {skip: referenceSkip}, async () => {
    const actualCore = await candidate(), baselineCore = await reference(), bytes = storedInlineFrameFixture(options);
    const actual = new actualCore.HwpDocument(bytes), baseline = new baselineCore.HwpDocument(bytes);
    try { assert.deepEqual(capture(actual), capture(baseline)); }
    finally { actual.free(); baseline.free(); }
  });
}
