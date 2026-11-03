import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {repeatedNestedHeaderFixture} from './engine-source-ownership/repeated-nested-header-fixture.mjs';

const skip = !process.env.PWH_CORE_JS || !process.env.PWH_CORE_WASM
  ? 'Requires explicit PWH_CORE_JS and PWH_CORE_WASM' : false;
const referenceSkip = skip || (!process.env.PWH_REFERENCE_CORE_JS || !process.env.PWH_REFERENCE_CORE_WASM
  ? 'Requires an independent PWH_REFERENCE_CORE_JS and PWH_REFERENCE_CORE_WASM' : false);
async function load(js, wasm) {
  const core = await import(pathToFileURL(path.resolve(js)));
  await core.default({module_or_path: await fs.readFile(wasm)});
  return core;
}
let candidatePromise, referencePromise;
const candidate = () => candidatePromise ||= load(process.env.PWH_CORE_JS, process.env.PWH_CORE_WASM);
const reference = () => referencePromise ||= load(process.env.PWH_REFERENCE_CORE_JS, process.env.PWH_REFERENCE_CORE_WASM);
const hash = value => createHash('sha256').update(value).digest('hex');
const capture = doc => Array.from({length: doc.pageCount()}, (_, page) => ({
  svg: hash(doc.renderPageSvgWithProfile(page, 'print')),
  runs: JSON.parse(doc.getPageTextLayout(page)).runs.map(({text, x, y, w, h, charX}) => ({text, x, y, w, h, charX})),
}));
const sourceText = doc => JSON.parse(doc.getScanItems()).filter(item => item.kind === 0)
  .map(item => item.text || '').join('');
function assertPhysicalOwners(doc, pages, pageHeight) {
  const runs = pages.flatMap(page => page.runs);
  for (const marker of ['FOLLOWING_PARAGRAPH', 'NEXT_ROW_TEXT',
    ...Array.from({length: 5}, (_, index) => [0, 1].flatMap(col =>
      [0, 1, 2].map(line => `CHILD_${index + 1}_${col}_${line}`))).flat()]) {
    assert.equal(runs.filter(run => run.text === marker).length, 1,
      `${marker}: continuation never loses or duplicates a source owner`);
  }
  const following = [], next = [];
  for (let page = 0; page < pages.length; page++) {
    const tree = JSON.parse(doc.getPageRenderTree(page));
    function walk(node, ancestors = []) {
      if (node.text === 'FOLLOWING_PARAGRAPH' || node.text === 'NEXT_ROW_TEXT') {
        const owner = ancestors.findLast(ancestor => ancestor.type === 'Cell');
        assert.ok(owner);
        assert.ok(node.bbox.y + node.bbox.h <= owner.bbox.y + owner.bbox.h + 0.2,
          'Following text cannot paint below the cell whose ledger consumed it');
        const target = node.text === 'FOLLOWING_PARAGRAPH' ? following : next;
        target.push({page, bbox: node.bbox, owner: owner.bbox});
      }
      for (const child of node.children || []) walk(child, [...ancestors, node]);
    }
    walk(tree.root || tree);
    for (const run of pages[page].runs) {
      assert.ok(run.y >= -0.2 && run.y + run.h <= pageHeight * 96 / 7200 + 0.2,
        'The entire visible text box remains inside its physical page');
    }
  }
  assert.equal(following.length, 1); assert.equal(next.length, 1);
  if (following[0].page === next[0].page) {
    assert.ok(next[0].owner.y >= following[0].owner.y + following[0].owner.h - 0.2,
      'The next parent row starts after the preceding physical owner');
  } else assert.ok(next[0].page > following[0].page);
}
for (const pageHeight of [8000, 9000, 10000]) {
  for (const repeatHeader of [false, true]) {
    test(`nested repeated header: physical reservation ${repeatHeader ? 'enabled' : 'disabled'} (${pageHeight} HU)`, {skip}, async () => {
      const core = await candidate(), doc = new core.HwpDocument(repeatedNestedHeaderFixture({pageHeight, repeatHeader}));
      try {
        const source = sourceText(doc), before = capture(doc);
        assertPhysicalOwners(doc, before, pageHeight);
        for (let page = before.length - 1; page >= 0; page--) doc.getPageRenderTree(page);
        assert.deepEqual(capture(doc), before, 'Repeated header layout is independent of page access order');
        assert.equal(sourceText(doc), source, 'Physical headers add no source text');
        const reopened = new core.HwpDocument(doc.exportHwpx());
        try {
          assert.equal(sourceText(reopened), source);
          assert.deepEqual(capture(reopened), before, 'Save/reopen preserves source and repeated-header geometry');
        } finally { reopened.free(); }
      } finally { doc.free(); }
    });
  }
  test(`nested repeated header: disabled headers retain independent baseline (${pageHeight} HU)`, {skip: referenceSkip}, async () => {
    const core = await candidate(), baselineCore = await reference();
    const bytes = repeatedNestedHeaderFixture({pageHeight, repeatHeader: false});
    const doc = new core.HwpDocument(bytes), baseline = new baselineCore.HwpDocument(bytes);
    try { assert.deepEqual(capture(doc), capture(baseline)); }
    finally { doc.free(); baseline.free(); }
  });
}
