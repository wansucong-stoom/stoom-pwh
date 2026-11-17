import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCore} from './engine-source-ownership/shape-transparency-fixture.mjs';
import {tableResizeGridFixture, resizeGridOwner} from './engine-source-ownership/table-resize-grid-fixture.mjs';
import {mapHwpxMember} from './engine-source-ownership/hwpx-fixture-utils.mjs';
const skip = !process.env.PWH_CORE_JS || !process.env.PWH_CORE_WASM ? 'Requires actual core paths' : false;
const ok = value => assert.equal(JSON.parse(value).ok, true);
const pages = doc => Array.from({length: doc.pageCount()}, (_, p) => doc.renderPageSvgWithProfile(p, 'print'));

for (const nested of [false, true]) for (const native of [false, true]) {
  test(`relative height starts at visible cell: nested=${nested}, HWP5=${native}`, {skip}, async () => {
    const core = await loadCore(); let bytes = tableResizeGridFixture({nested});
    if (native) { const seed = new core.HwpDocument(bytes); try { bytes = seed.exportHwp(); } finally { seed.free(); } }
    const doc = new core.HwpDocument(bytes), owner = resizeGridOwner(doc), index = JSON.parse(owner[2]).at(-1).cellIndex;
    const properties = d => JSON.parse(d.getCellPropertiesByPath(...owner, index));
    const boxes = d => JSON.parse(d.getTableCellBboxesByPath(...(d === doc ? owner : resizeGridOwner(d)))).filter(b => b.cellIdx === index);
    const change = delta => ok(doc.resizeTableCellsByPath(...owner, JSON.stringify([{cellIdx: index, heightDelta: delta}])));
    const snapshot = doc.saveSnapshot(), before = pages(doc), start = boxes(doc)[0].h;
    try {
      assert.equal(properties(doc).height, 282);
      change(300);
      assert.ok(Math.abs(boxes(doc)[0].h - start - 4) < .2, 'a 300 HWPUNIT gesture immediately grows the displayed cell by 4px');
      assert.ok(Math.abs(properties(doc).resizeHeight - properties(doc).height) <= 2, 'logical allocation and stored edited height agree');
      change(300); change(-300);
      assert.ok(Math.abs(boxes(doc)[0].h - start - 4) < .2, 'repeated growth and shrink have no stored-minimum dead zone');
      const saved = new core.HwpDocument(doc.exportHwpx());
      try { assert.ok(Math.abs(boxes(saved)[0].h - boxes(doc)[0].h) < .2, 'height survives save/reopen'); } finally { saved.free(); }
      change(-100000);
      assert.ok(boxes(doc)[0].h > 100, 'content remains visible below an excessive shrink request');
      doc.restoreSnapshot(snapshot);
      assert.deepEqual(pages(doc), before, 'undo restores exact geometry');
      assert.equal(properties(doc).height, 282, 'undo restores authored minimum too');
    } finally { doc.discardSnapshot(snapshot); doc.free(); }
  });
}

for (const merged of [false, true]) test(`logical grid height is independent of page fragments: merged=${merged}`, {skip}, async () => {
  const core = await loadCore();
  const full = new core.HwpDocument(tableResizeGridFixture({rows: 3, merged}));
  const split = new core.HwpDocument(tableResizeGridFixture({rows: 3, merged, pageHeight: 11000}));
  try {
    assert.ok(split.pageCount() > full.pageCount());
    const a = resizeGridOwner(full), b = resizeGridOwner(split), index = JSON.parse(a[2]).at(-1).cellIndex;
    const props = (doc, owner, cell) => JSON.parse(doc.getCellPropertiesByPath(...owner, cell));
    assert.ok(Number.isFinite(props(full, a, index).resizeHeight));
    assert.equal(props(full, a, index).resizeHeight, props(split, b, index).resizeHeight, 'full logical height, not a page fragment');
    const updates = [{cellIdx: index, heightDelta: 300}, ...(merged ? [{cellIdx: 0, heightDelta: 300}] : [])];
    for (const [doc, owner] of [[full, a], [split, b]]) ok(doc.resizeTableCellsByPath(...owner, JSON.stringify(updates)));
    assert.equal(props(full, a, index).height, props(split, b, index).height, 'same edit on split and unsplit table');
    assert.equal(full.getScanItems(), split.getScanItems(), 'all table text retained');
  } finally { full.free(); split.free(); }
});

test('explicit height reduction can remove authored whitespace in HWP5', {skip}, async () => {
  const core = await loadCore();
  const bytes = mapHwpxMember(tableResizeGridFixture(), 'Contents/section0.xml', xml =>
    xml.replace('height="8482"', 'height="20000"').replace('height="282"', 'height="20000"'));
  const seed = new core.HwpDocument(bytes); let hwp;
  try { hwp = seed.exportHwp(); } finally { seed.free(); }
  const doc = new core.HwpDocument(hwp), owner = resizeGridOwner(doc);
  try {
    const height = () => JSON.parse(doc.getTableCellBboxesByPath(...owner))[0].h;
    const before = height();
    ok(doc.resizeTableCellsByPath(...owner, JSON.stringify([{cellIdx: 0, heightDelta: -300}])));
    assert.ok(Math.abs(height() - before + 4) < .2, 'explicit shrink is not blocked by the old load-time row floor');
  } finally { doc.free(); }
});

for (const mode of ['spacing', 'all-merged', 'ordinary']) test(`height edit preserves the remaining grid: ${mode}`, {skip}, async () => {
  const core = await loadCore(); let bytes = tableResizeGridFixture({rows: 2, merged: mode === 'all-merged'});
  if (mode === 'spacing') bytes = mapHwpxMember(bytes, 'Contents/section0.xml', xml => xml.replace('cellSpacing="0"', 'cellSpacing="150"'));
  if (mode === 'all-merged') bytes = mapHwpxMember(bytes, 'Contents/section0.xml', xml => {
    let row = 0;
    return xml.replace(/<hp:tr>[\s\S]*?<\/hp:tr>/g, text => ++row === 1 ? text.replace('rowSpan="1"', 'rowSpan="2"') : '<hp:tr/>');
  });
  const doc = new core.HwpDocument(bytes), owner = resizeGridOwner(doc);
  const boxes = d => JSON.parse(d.getTableCellBboxesByPath(...resizeGridOwner(d)));
  try {
    const before = boxes(doc), index = mode === 'all-merged' ? 1 : 0;
    ok(doc.resizeTableCellsByPath(...owner, JSON.stringify([{cellIdx: index, heightDelta: 300}, ...(mode === 'all-merged' ? [{cellIdx: 0, heightDelta: 300}] : [])])));
    const after = boxes(doc);
    assert.ok(Math.abs(after[index].h - before[index].h - 4) < .2);
    if (mode !== 'all-merged') assert.equal(after[1].h, before[1].h, 'unselected row keeps its visible height');
    const reopened = new core.HwpDocument(doc.exportHwpx());
    try { assert.deepEqual(boxes(reopened), after, 'logical grid survives serialization'); } finally { reopened.free(); }
  } finally { doc.free(); }
});
