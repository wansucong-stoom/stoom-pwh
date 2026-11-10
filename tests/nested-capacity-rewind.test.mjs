import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {declaredNestedFixture} from './engine-source-ownership/declared-nested-fixture.mjs';
import {mapHwpxMember} from './engine-source-ownership/hwpx-fixture-utils.mjs';

const skip = !process.env.PWH_CORE_JS || !process.env.PWH_CORE_WASM
  ? 'Requires explicit PWH_CORE_JS and PWH_CORE_WASM paths'
  : false;
const firstMarkers = Array.from({length: 7}, (_, index) => 'FIRST_' + index);
const secondMarkers = [...Array.from({length: 5}, (_, index) => 'SECOND_' + index), 'TAIL_MARKER'];

function layout(doc) {
  return Array.from({length: doc.pageCount()}, (_, page) =>
    JSON.parse(doc.getPageTextLayout(page)).runs.filter(run =>
      firstMarkers.includes(run.text) || secondMarkers.includes(run.text)));
}
const texts = pages => pages.map(runs => runs.map(run => run.text));

async function loadCore() {
  const core = await import(pathToFileURL(process.env.PWH_CORE_JS));
  await core.default({module_or_path: await fs.readFile(process.env.PWH_CORE_WASM)});
  return core;
}

function growFirstRow(doc, pages) {
  const target = pages.flat().find(run => run.text === firstMarkers[0]);
  const cell = target.cellPath.at(-1);
  doc.resizeTableCellsByPath(target.secIdx, target.parentParaIdx, JSON.stringify(target.cellPath),
    JSON.stringify([{cellIdx: cell.cellIndex, heightDelta: 2500}]));
}

for (const singleColumn of [false, true]) {
  test('a capacity continuation fills the available page through a saved plain-text rewind' +
    (singleColumn ? ' with single-column metadata' : ''), {skip}, async () => {
    const core = await loadCore();
    let fixture = declaredNestedFixture({pageHeight: 24000, inner: false});
    if (singleColumn) {
      const column = '<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>';
      fixture = mapHwpxMember(fixture, 'Contents/section0.xml',
        xml => xml.replace('<hp:t>SECOND_0</hp:t>', column + '<hp:t>SECOND_0</hp:t>'));
    }
    const doc = new core.HwpDocument(fixture);
    try {
      const original = layout(doc);
      const before = [[...firstMarkers, ...secondMarkers.slice(0, 3)], secondMarkers.slice(3)];
      assert.deepEqual(texts(original), before);
      const snapshot = doc.saveSnapshot();

      growFirstRow(doc, original);
      const edited = layout(doc);
      const after = [[...firstMarkers, ...secondMarkers.slice(0, 2)], secondMarkers.slice(2)];
      assert.deepEqual(texts(edited), after);

      const continuation = edited[1];
      for (const [index, line] of continuation.entries()) {
        assert.ok(line.y >= 0 && line.y + line.h <= 320.5, 'the line stays within the page');
        if (index > 0) assert.ok(line.y >= continuation[index - 1].y + continuation[index - 1].h - 0.2,
          'the lines on either side of the saved rewind remain disjoint');
      }

      const reopened = new core.HwpDocument(doc.exportHwpx());
      try { assert.deepEqual(texts(layout(reopened)), after); }
      finally { reopened.free(); }
      doc.restoreSnapshot(snapshot);
      assert.deepEqual(layout(doc), original);
    } finally {
      doc.free();
    }
  });
}

for (const kind of ['pageBreak', 'columnBreak']) {
  test('an authored '+kind+' still stops the projected nested row', {skip}, async () => {
    const core = await loadCore();
    const fixture = mapHwpxMember(
      declaredNestedFixture({pageHeight: 24000, inner: false}), 'Contents/section0.xml',
      xml => xml.replace(/<hp:p ([^>]+)><hp:run charPrIDRef="0"><hp:t>SECOND_3<\/hp:t>/,
        (_, attributes) => '<hp:p ' + attributes.replace(kind+'="0"', kind+'="1"')
          + '><hp:run charPrIDRef="0"><hp:t>SECOND_3</hp:t>'));
    const doc = new core.HwpDocument(fixture);
    try {
      growFirstRow(doc, layout(doc));
      assert.deepEqual(texts(layout(doc)), [
        [...firstMarkers, ...secondMarkers.slice(0, 2)], [secondMarkers[2]], secondMarkers.slice(3),
      ]);
    } finally {
      doc.free();
    }
  });
}

test('a cell-unit table keeps the entire fitting row together on the next page', {skip}, async () => {
  const core = await loadCore();
  const doc = new core.HwpDocument(
    declaredNestedFixture({pageHeight: 24000, inner: false, pageBreak: 'TABLE'}));
  try {
    growFirstRow(doc, layout(doc));
    assert.deepEqual(texts(layout(doc)), [firstMarkers, secondMarkers]);
  } finally {
    doc.free();
  }
});
