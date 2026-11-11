import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {pathToFileURL} from 'node:url';
import {continuedFlowPictureFixture} from './engine-source-ownership/continued-flow-picture-fixture.mjs';

const skip = !process.env.PWH_CORE_JS || !process.env.PWH_CORE_WASM
  ? 'Requires explicit core paths' : false;
let loaded;
async function core() {
  loaded ??= (async () => {
    const module = await import(pathToFileURL(process.env.PWH_CORE_JS));
    await module.default({module_or_path: await fs.readFile(process.env.PWH_CORE_WASM)});
    return module;
  })();
  return loaded;
}
function inspect(doc) {
  return Array.from({length: doc.pageCount()}, (_, page) => {
    const svg = doc.renderPageSvgWithProfile(page, 'print');
    return {svg, layout: doc.getPageTextLayout(page),
      images: [...svg.matchAll(/<image\b[^>]*\by="([^"]+)"[^>]*\bheight="([^"]+)"/g)]
        .map(([, y, h]) => ({top: Number(y), bottom: Number(y) + Number(h)})),
      headings: JSON.parse(doc.getPageTextLayout(page)).runs.filter(run => run.text.startsWith('HEADING_')),
    };
  });
}
for (const headings of [1, 2, 3]) {
  test('continued flow picture preserves its preceding ' + headings + ' heading units', {skip}, async () => {
    const module = await core(), doc = new module.HwpDocument(continuedFlowPictureFixture(module, {headings}));
    try {
      const before = inspect(doc);
      assert.equal(before.length, 2);
      assert.deepEqual(before.map(page => page.images.length), [0, 1]);
      assert.equal(before[1].headings.length, headings);
      const image = before[1].images[0];
      for (const run of before[1].headings) {
        assert.ok(image.top >= run.y + run.h - 0.2, 'The picture follows every heading');
      }
      assert.ok(Math.abs(image.top - (100 + headings * 1600) * 96 / 7200) < 0.2,
        'The picture consumes the same fragment-local prefix as pagination');
      const reopened = new module.HwpDocument(doc.exportHwpx());
      try {
        const saved = inspect(reopened);
        assert.deepEqual(saved.map(page => page.svg), before.map(page => page.svg),
          'Reopening retains every painted page');
        assert.deepEqual(saved.map(page => page.images), before.map(page => page.images),
          'Reopening retains the same picture origin');
      }
      finally { reopened.free(); }
      const snapshot = doc.saveSnapshot(), run = before[1].headings[0];
      try {
        doc.insertTextInCellByPath(run.secIdx, run.parentParaIdx, JSON.stringify(run.cellPath), 0, 'EDIT');
        inspect(doc);
        doc.restoreSnapshot(snapshot);
        assert.deepEqual(inspect(doc), before, 'Undo restores the original fragment geometry');
      } finally { doc.discardSnapshot(snapshot); }
    } finally { doc.free(); }
  });
}
test('a paper-relative picture keeps its explicit overlapping placement', {skip}, async () => {
  const module = await core(), doc = new module.HwpDocument(continuedFlowPictureFixture(module, {relativeTo: 'PAPER'}));
  try {
    const layout = inspect(doc), imagePage = layout.find(page => page.images.length && page.headings.length);
    assert.ok(imagePage);
    assert.ok(imagePage.images[0].top < imagePage.headings.at(-1).y + imagePage.headings.at(-1).h,
      'The flow-owner correction does not move explicitly paper-relative pictures');
  } finally { doc.free(); }
});
