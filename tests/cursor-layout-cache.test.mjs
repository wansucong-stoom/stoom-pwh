import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {pathToFileURL} from 'node:url';
import {emptyCellCaretFixture} from './engine-cursor/empty-cell-fixture.mjs';
import {nestedOpeningFrameFixture} from './engine-source-ownership/nested-opening-frame-fixture.mjs';

const skip = !process.env.PWH_CORE_JS || !process.env.PWH_CORE_WASM
  ? 'Requires explicit candidate WASM paths'
  : false;
const hasReference = !!process.env.PWH_RENDER_CACHE_BASE_JS && !!process.env.PWH_RENDER_CACHE_BASE_WASM;
if (!!process.env.PWH_RENDER_CACHE_BASE_JS !== !!process.env.PWH_RENDER_CACHE_BASE_WASM) {
  throw Error('Set both PWH_RENDER_CACHE_BASE_JS and PWH_RENDER_CACHE_BASE_WASM');
}
let loaded;
async function cores() {
  loaded ??= Promise.all([
    [process.env.PWH_CORE_JS, process.env.PWH_CORE_WASM],
    [
      process.env.PWH_RENDER_CACHE_BASE_JS || process.env.PWH_CORE_JS,
      process.env.PWH_RENDER_CACHE_BASE_WASM || process.env.PWH_CORE_WASM,
    ],
  ].map(async ([js, wasm]) => {
    const core = await import(pathToFileURL(js));
    await core.default({module_or_path: await fs.readFile(wasm)});
    return core;
  }));
  return loaded;
}

function clearReferenceCache(doc) {
  if (!hasReference) {
    // Reapplying the display setting clears derived layout caches while
    // keeping the document, font, page plan and display setting identical.
    doc.setShowControlCodes(doc.getShowControlCodes());
  }
}

function inspectReference(doc) {
  clearReferenceCache(doc);
  return inspect(doc);
}

function inspect(doc) {
  return Array.from({length: doc.pageCount()}, (_, page) => ({
    layout: doc.getPageTextLayout(page),
    print: doc.renderPageSvgWithProfile(page, 'print'),
  }));
}

for (const [name, fixture] of [
  ['nested frame', () => nestedOpeningFrameFixture()],
  ['three nested levels', () => nestedOpeningFrameFixture({projectedInline: true})],
  ['continued cells', () => emptyCellCaretFixture({paragraphs: 30, rightParagraphs: 23, nested: false})],
  ['centered continued cells', () => emptyCellCaretFixture({
    paragraphs: 30, rightParagraphs: 23, nested: false, verticalAlign: 'CENTER',
  })],
  ['vertical continued cells', () => emptyCellCaretFixture({
    paragraphs: 15, rightParagraphs: 10, nested: false, textDirection: 'VERTICAL',
  })],
]) {
  test('cold cursor queries retain reference geometry through edits and ownership changes — ' + name,
    {skip}, async () => {
      const [candidate, reference] = await cores();
      const bytes = fixture();
      const docs = [new candidate.HwpDocument(bytes), new reference.HwpDocument(bytes)];
      try {
        const initial = inspect(docs[0]);
        assert.deepEqual(initial, inspectReference(docs[1]));
        const runs = initial.flatMap((page, index) =>
          JSON.parse(page.layout).runs.map(run => ({...run, page: index})));
        const target = runs.find(run => run.cellPath?.length >= 2 && run.text.trim())
          ?? runs.find(run => run.cellPath?.length && run.text.trim());
        assert.ok(target, 'The query resolves to a cell owned by the source');
        if (name.includes('nested')) assert.ok(target.cellPath.length >= 2);
        const path = JSON.stringify(target.cellPath);
        const snapshots = docs.map(doc => doc.saveSnapshot());
        for (const operation of ['insert', 'narrow', 'grow', 'delete', 'restore', 'reinsert']) {
          for (const [index, doc] of docs.entries()) {
            switch (operation) {
              case 'insert':
              case 'reinsert':
                doc.insertTextInCellByPath(target.secIdx, target.parentParaIdx, path, 0, 'EDIT');
                break;
              case 'delete':
                doc.deleteTextInCellByPath(target.secIdx, target.parentParaIdx, path, 0, 4);
                break;
              case 'narrow':
              case 'grow':
                doc.resizeTableCellsByPath(target.secIdx, target.parentParaIdx, path,
                  JSON.stringify([{cellIdx: target.cellPath.at(-1).cellIndex,
                    [operation === 'narrow' ? 'widthDelta' : 'heightDelta']: operation === 'narrow' ? -200 : 300}]));
                break;
              case 'restore':
                doc.restoreSnapshot(snapshots[index]);
                break;
              default:
                throw Error('Unknown operation');
            }
          }
          clearReferenceCache(docs[1]);
          const cursors = docs.map(doc => JSON.parse(doc.getCursorRectByPathNear(
            target.secIdx, target.parentParaIdx, path, 0, target.page)));
          assert.deepEqual(cursors[0], cursors[1], 'Cold query matches reference after ' + operation);
          assert.deepEqual(inspect(docs[0]), inspectReference(docs[1]), 'Page plans and print geometry match');
          for (const run of runs.filter(run => run.cellPath?.length).slice(-6)) {
            clearReferenceCache(docs[1]);
            const rects = docs.map(doc => JSON.parse(doc.getCursorRectByPathNear(
              run.secIdx, run.parentParaIdx, JSON.stringify(run.cellPath), 0, run.page)));
            assert.deepEqual(rects[0], rects[1], 'Other page frames retain their geometry');
          }
        }
      } finally {
        docs.forEach(doc => doc.free());
      }
    });
}
for (const [name, text] of [
  ['short input', 'EDIT'],
  ['wrapping input', ' A long deferred sentence '.repeat(18)],
  ['Korean input', '한글😀𐐀'],
]) {
  test('deferred painting and subsequent local resize retain reference geometry — ' + name,
    {skip}, async () => {
      const [candidate, reference] = await cores();
      const bytes = emptyCellCaretFixture({paragraphs: 30, rightParagraphs: 4});
      const docs = [new candidate.HwpDocument(bytes), new reference.HwpDocument(bytes)];
      try {
        const before = inspect(docs[0]);
        assert.deepEqual(before, inspectReference(docs[1]));
        const target = before.flatMap(page => JSON.parse(page.layout).runs)
          .find(run => run.text === 'RIGHT_0_END');
        assert.equal(target.cellPath.length, 1);
        const cell = target.cellPath[0];
        const args = [target.secIdx, target.parentParaIdx, cell.controlIndex,
          cell.cellIndex, cell.cellParaIndex];
        for (const doc of docs) doc.insertTextInCellDeferredPagination(...args, 0, text);
        assert.deepEqual(inspect(docs[0]), inspectReference(docs[1]), 'Paint reads the latest source before pagination');
        docs.forEach(doc => doc.flushDeferredPagination());
        assert.deepEqual(inspect(docs[0]), inspectReference(docs[1]), 'Pagination commits the same source');
        for (const doc of docs) {
          doc.resizeTableCellsByPath(target.secIdx, target.parentParaIdx, JSON.stringify(target.cellPath),
            JSON.stringify([{cellIdx: cell.cellIndex, heightDelta: 200}]));
        }
        assert.deepEqual(inspect(docs[0]), inspectReference(docs[1]), 'The next scoped resize reads the updated rows');
      } finally {
        docs.forEach(doc => doc.free());
      }
    });
}
