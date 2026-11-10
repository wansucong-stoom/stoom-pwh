import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadCore, inspectVariants, verifyFrameAndMargins, verifyIndependentReflow}
  from './engine-source-ownership/nested-opening-frame-regression.mjs';

const hasCore = Boolean(process.env.PWH_CORE_JS && process.env.PWH_CORE_WASM);
const coreSkip = !hasCore ? 'Requires PWH_CORE_JS and PWH_CORE_WASM paths' : false;
let candidate;
async function candidateRecords() {
  if (!candidate) {
    const loaded = await loadCore(process.env.PWH_CORE_JS, process.env.PWH_CORE_WASM);
    candidate = {...loaded, records: inspectVariants(loaded.core)};
  }
  return candidate;
}

test('nested opening frame: original physical frame, exact margins, save and Undo', {skip: coreSkip}, async () => {
  verifyFrameAndMargins((await candidateRecords()).records);
});

test('nested opening frame: deep edits and ineligible source shapes use an independent ordinary-reflow oracle',
  {skip: coreSkip || !process.env.PWH_REFERENCE_CORE_JS || !process.env.PWH_REFERENCE_CORE_WASM}, async () => {
    const value = await candidateRecords();
    const reference = await loadCore(process.env.PWH_REFERENCE_CORE_JS, process.env.PWH_REFERENCE_CORE_WASM);
    verifyIndependentReflow(value.records, inspectVariants(reference.core), value.wasmSha256, reference.wasmSha256);
  });

test('nested opening frame: extracted source rejects unowned or recomposed hosts (18 Rust cases)',
  {skip: !process.env.PWH_ENGINE_SOURCE}, () => {
    execFileSync(process.execPath, [fileURLToPath(new URL('./engine-source-ownership/nested-opening-frame-source.mjs', import.meta.url))],
      {stdio: 'inherit', windowsHide: true, env: process.env});
  });

test('a projected inline table preserves its saved next-page owner and opening border',
  {skip: coreSkip}, async () => {
    const {nestedOpeningFrameFixture} = await import('./engine-source-ownership/nested-opening-frame-fixture.mjs');
    const {core, wasmSha256} = await loadCore(process.env.PWH_CORE_JS, process.env.PWH_CORE_WASM);
    const beforeProjectedOwner = new Set([
      'a56124fc94e47baa90650f5aea8c4bb211e6a7e86b76c5c70a75b6685a3ea45f',
      'ec2b87e19b44eb59c9881b41e193b89fb46ff0a993f794ea73e18e9c1a1fa736',
    ]).has(wasmSha256);
    function inspect(doc) {
      const pages = Array.from({length:doc.pageCount()}, (_, page) =>
        JSON.parse(doc.getPageTextLayout(page)).runs.map(run => run.text));
      const {controls} = JSON.parse(doc.getPageControlLayout(0));
      const table = controls.find(control => control.type === 'table' && Math.abs(control.w - 20000 / 75) < 0.1);
      assert.ok(table, 'opening grid is present');
      return {pages, table};
    }
    function pageOf(layout, label) {
      const matches = layout.pages.flatMap((runs, page) => runs.filter(run => run === label).map(() => page));
      assert.equal(matches.length, 1, label + ' is rendered once');
      return matches[0];
    }
    const doc = new core.HwpDocument(nestedOpeningFrameFixture({projectedInline:true}));
    try {
      const layout = inspect(doc);
      assert.equal(pageOf(layout, 'OPEN_LINE_B'), 0);
      assert.equal(pageOf(layout, 'NEXT_0'), beforeProjectedOwner ? 0 : 1);
      for (const marker of ['NEXT_1', 'DEEP_0', 'DEEP_1', 'DEEP_2', 'NEXT_TAIL']) {
        assert.equal(pageOf(layout, marker), 1);
      }
      if (!beforeProjectedOwner) {
        assert.ok(Math.abs(layout.table.h - 10200 / 75) < 0.3,
          'the painted opening height follows the saved table frame');
      }
      const reopened = new core.HwpDocument(doc.exportHwpx());
      try {
        assert.equal(pageOf(inspect(reopened), 'NEXT_0'), beforeProjectedOwner ? 0 : 1);
      } finally { reopened.free(); }
    } finally { doc.free(); }
    const invalid = new core.HwpDocument(nestedOpeningFrameFixture({projectedInline:true, placeholderDelta:100}));
    try {
      assert.equal(pageOf(inspect(invalid), 'NEXT_0'), 0, 'a mismatched stored object band keeps normal capacity flow');
    } finally { invalid.free(); }
  });

test('a stored cell line after a nested table follows its grid and leaves room for the next row',
  {skip: coreSkip}, async () => {
    const {displacedNestedTableLineFixture} = await import('./engine-source-ownership/nested-opening-frame-fixture.mjs');
    const {core, wasmSha256} = await loadCore(process.env.PWH_CORE_JS, process.env.PWH_CORE_WASM);
    const previousCore = new Set([
      'a56124fc94e47baa90650f5aea8c4bb211e6a7e86b76c5c70a75b6685a3ea45f',
      'ec2b87e19b44eb59c9881b41e193b89fb46ff0a993f794ea73e18e9c1a1fa736',
      '797548369e69e9e2fcd1de14d2ef9a8aab4e795e4ea855d1b78bb3f445e55945',
    ]).has(wasmSha256);
    function inspect(doc) {
      assert.equal(doc.pageCount(), 1);
      const {runs} = JSON.parse(doc.getPageTextLayout(0));
      const {controls} = JSON.parse(doc.getPageControlLayout(0));
      const findTable = width => controls.find(control =>
        control.type === 'table' && Math.abs(control.w - width / 75) < 0.1);
      const nested = findTable(16000);
      const inline = findTable(18500);
      const notes = runs.filter(run => run.text === 'DISPLACED_NOTE');
      assert.ok(nested && inline);
      assert.equal(notes.length, 1);
      return {nested,inline,note:notes[0],runs};
    }
    function verify(doc) {
      const {nested,inline,note,runs} = inspect(doc);
      if (previousCore) {
        assert.ok(note.y < nested.y, 'the older core placed the note before the grid');
        return;
      }
      assert.ok(note.y >= nested.y + nested.h, 'the note starts after the nested table');
      assert.ok(Math.abs(inline.h - 11000 / 75) < 0.2, 'the inline frame retains its declared height');
      const tail = runs.filter(run => run.text === 'INLINE_TAIL');
      assert.equal(tail.length, 1);
      assert.ok(tail[0].y > note.y, 'the next row follows the note');
    }
    const original = new core.HwpDocument(displacedNestedTableLineFixture());
    try {
      verify(original);
      const reopened = new core.HwpDocument(original.exportHwpx());
      try { verify(reopened); } finally { reopened.free(); }
    } finally { original.free(); }
    const mismatched = new core.HwpDocument(displacedNestedTableLineFixture({savedStartDelta:200}));
    try {
      const {nested,note} = inspect(mismatched);
      assert.ok(note.y < nested.y, 'a mismatched stored start keeps the existing flow path');
    } finally { mismatched.free(); }
  });

test('a saved side-by-side photo band is kept together across projected nested-table cuts',
  {skip: coreSkip}, async () => {
    const {parallelPictureBandFixture} = await import('./engine-source-ownership/nested-opening-frame-fixture.mjs');
    const {core, wasmSha256} = await loadCore(process.env.PWH_CORE_JS, process.env.PWH_CORE_WASM);
    const oldCore = new Set([
      'a56124fc94e47baa90650f5aea8c4bb211e6a7e86b76c5c70a75b6685a3ea45f',
      'ec2b87e19b44eb59c9881b41e193b89fb46ff0a993f794ea73e18e9c1a1fa736',
      '797548369e69e9e2fcd1de14d2ef9a8aab4e795e4ea855d1b78bb3f445e55945',
      '47a364121a533ab64825a09dca5a5ee108f723e97037705a5e0e1910df00745a',
    ]).has(wasmSha256);
    function inspect(doc) {
      return Array.from({length:doc.pageCount()}, (_, index) => {
        const {controls} = JSON.parse(doc.getPageControlLayout(index));
        const {runs} = JSON.parse(doc.getPageTextLayout(index));
        return {
          images:controls.filter(control => control.type === 'image'),
          outer:controls.find(control => control.type === 'table' && Math.abs(control.w - 22000 / 75) < 0.1),
          runs,
        };
      });
    }
    function verify(doc) {
      const pages = inspect(doc);
      assert.equal(pages[0].runs.filter(run => run.text === 'PICTURE_LEAD').length, 1);
      assert.equal(pages.flatMap(page => page.images).length, 2, 'each photo is painted once');
      if (oldCore) return;
      assert.equal(pages.length, 2, 'the parallel band consumes the height of one group');
      assert.equal(pages[0].images.length, 0, 'the two photos do not fit the first page');
      assert.equal(pages[1].images.length, 2);
      const {outer,images,runs} = pages[1];
      assert.ok(outer && images.every(pic => pic.y + pic.h <= outer.y + outer.h + 0.2));
      assert.ok(Math.abs(images[0].y - images[1].y) <= 0.2, 'the photos share their saved top');
      const tail = runs.filter(run => run.text === 'PICTURE_TAIL');
      assert.equal(tail.length, 1);
      assert.ok(images.every(pic => pic.y + pic.h <= tail[0].y + 0.2),
        'the photo band ends before the next row');
    }
    const original = new core.HwpDocument(parallelPictureBandFixture(core));
    try {
      verify(original);
      const reopened = new core.HwpDocument(original.exportHwpx());
      try { verify(reopened); } finally { reopened.free(); }
    } finally { original.free(); }
    const overlapping = new core.HwpDocument(parallelPictureBandFixture(core,{overlapping:true}));
    try {
      const pages = inspect(overlapping);
      assert.equal(pages.flatMap(page => page.images).length, 2);
      assert.ok(pages[0].images.length > 0, 'intersecting horizontal bounds keep ordinary flow');
    } finally { overlapping.free(); }
  });

test('a saved opening row restores peer height and alignment before a deferred picture band',
  {skip: coreSkip}, async () => {
    const {parallelPictureBandFixture} = await import('./engine-source-ownership/nested-opening-frame-fixture.mjs');
    const {core, wasmSha256} = await loadCore(process.env.PWH_CORE_JS, process.env.PWH_CORE_WASM);
    const olderCore = new Set([
      'a56124fc94e47baa90650f5aea8c4bb211e6a7e86b76c5c70a75b6685a3ea45f',
      'ec2b87e19b44eb59c9881b41e193b89fb46ff0a993f794ea73e18e9c1a1fa736',
      '797548369e69e9e2fcd1de14d2ef9a8aab4e795e4ea855d1b78bb3f445e55945',
      '6def6e263ec85f2834669f753de74178552b22dff77ae88c6cad3fb7ea969f56',
    ]).has(wasmSha256);
    function read(doc) {
      const opening = JSON.parse(doc.getPageControlLayout(0)).controls;
      const continued = JSON.parse(doc.getPageControlLayout(1)).controls;
      const photoGrid = opening.find(c => c.type === 'table' && Math.abs(c.w - 18000 / 75) < 0.1);
      const grid = opening.find(c => c.type === 'table' && Math.abs(c.w - 28000 / 75) < 0.1);
      const {runs} = JSON.parse(doc.getPageTextLayout(0));
      const lead = runs.find(r => r.text === 'FRAME_LEAD');
      const header = runs.find(r => r.text === 'GRID_HEAD_B');
      assert.ok(photoGrid && grid && lead && header);
      return {opening,continued,photoGrid,grid,lead,header};
    }
    function verify(doc) {
      const {opening,continued,photoGrid,grid,lead,header} = read(doc);
      if (olderCore) {
        if (wasmSha256 === '6def6e263ec85f2834669f753de74178552b22dff77ae88c6cad3fb7ea969f56') {
          assert.ok(grid.h < (2400 + 9100) / 75 - 1);
        }
        return;
      }
      assert.equal(opening.filter(c => c.type === 'image').length, 0);
      assert.equal(continued.filter(c => c.type === 'image').length, 2);
      assert.ok(Math.abs(photoGrid.h - 4000 / 75) < 0.5);
      assert.ok(Math.abs(grid.h - (2400 + 9100) / 75) < 0.5);
      assert.ok(lead.y > header.y + 30, 'the source content is centered in the opening box');
    }
    const original = new core.HwpDocument(parallelPictureBandFixture(core,{savedOpening:true}));
    try {
      verify(original);
      const reopened = new core.HwpDocument(original.exportHwpx());
      try { verify(reopened); } finally { reopened.free(); }
    } finally { original.free(); }
    const mismatched = new core.HwpDocument(parallelPictureBandFixture(core,{savedOpening:true,peerHeightDelta:150}));
    try {
      const {grid} = read(mismatched);
      if (!olderCore) {
        assert.ok(grid.h < (2400 + 9100) / 75 - 1, 'disagreeing sibling heights keep content-led layout');
      }
    } finally { mismatched.free(); }
  });
