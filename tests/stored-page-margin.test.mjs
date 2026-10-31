import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {mapHwpxMember} from './engine-source-ownership/hwpx-fixture-utils.mjs';
import {zipEntries} from '../scripts/setup.mjs';

const skip = !process.env.PWH_CORE_JS || !process.env.PWH_CORE_WASM
  ? 'Requires explicit candidate core paths' : false;
const seed = await fs.readFile(new URL(
  './fixtures/rowbreak-table/synthetic-rowbreak-single-line-control.hwpx', import.meta.url,
));
const line = (vpos, height = 1100) => `<hp:linesegarray><hp:lineseg textpos="0" vertpos="${vpos}" vertsize="${height}" textheight="${height}" baseline="${Math.round(height * .85)}" spacing="500" horzpos="0" horzsize="30000" flags="393216"/></hp:linesegarray>`;
const paragraph = (id, text, pr, vpos, pageBreak = false, extra = '', height = 1100) =>
  `<hp:p id="${id}" paraPrIDRef="${pr}" styleIDRef="0" pageBreak="${Number(pageBreak)}" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${extra}<hp:t>${text}</hp:t></hp:run>${line(vpos, height)}</hp:p>`;

function fixture({pageBreak = true, before = 500, after = 300, nextBefore = 500, origin = before, gapError = 0, tailTable = false, headingTable = false, decoration = '', emptyFirst = false, memo = false} = {}) {
  let bytes = mapHwpxMember(seed, 'Contents/header.xml', xml => {
    const base = /<hh:paraPr\b[\s\S]*?<\/hh:paraPr>/.exec(xml)[0];
    const style = (id, leading, trailing) => base.replace('id="0"', `id="${id}"`)
      .replace('<hh:prev value="0"', `<hh:prev value="${leading}"`)
      .replace('<hh:next value="0"', `<hh:next value="${trailing}"`);
    return xml.replace('</hh:paraProperties>', style(1, before, after) + style(2, nextBefore, 0) + '</hh:paraProperties>')
      .replace('<hh:paraProperties itemCnt="1"', '<hh:paraProperties itemCnt="3"');
  });
  bytes = mapHwpxMember(bytes, 'Contents/section0.xml', xml => {
    const section = '<hp:secPr id="0"><hp:pagePr width="30000" height="30000" landscape="WIDELY"><hp:margin left="0" right="0" top="0" bottom="0" header="0" footer="0" gutter="0"/></hp:pagePr></hp:secPr>';
    const firstHeight = headingTable ? 4200 : 1100;
    const next = origin + firstHeight + 500 + after + nextBefore + gapError;
    const table = '<hp:tbl id="99" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" pageBreak="CELL" rowCnt="1" colCnt="1" cellSpacing="0" borderFillIDRef="1"><hp:sz width="15000" height="3000" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="0" right="0" top="0" bottom="0"/><hp:tr><hp:tc hasMargin="1" borderFillIDRef="1"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP">' + paragraph(0, 'CELL', 0, 0) + '</hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="15000" height="3000"/><hp:cellMargin left="0" right="0" top="0" bottom="0"/></hp:tc></hp:tr></hp:tbl>';
    const firstTable = table.replace('height="3000"', 'height="4000"').replace('height="3000"', 'height="4000"').replace('<hp:t>CELL</hp:t>', '<hp:t>FIRST</hp:t>')
      .replace('<hp:outMargin left="0" right="0" top="0" bottom="0"/>', '<hp:outMargin left="0" right="0" top="100" bottom="100"/>');
    const metadata = memo ? '<hp:ctrl><hp:fieldBegin id="7" type="MEMO" name="" editable="1" dirty="0" zorder="0" fieldid="7"><hp:parameters cnt="1" name=""><hp:stringParam name="Command">MEMO/0/0;</hp:stringParam></hp:parameters><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP">' + paragraph(0, 'NOTE', 0, 0) + '</hp:subList></hp:fieldBegin></hp:ctrl><hp:ctrl><hp:fieldEnd beginIDRef="7" fieldid="7"/></hp:ctrl>' : '';
    const body = (pageBreak ? paragraph(0, 'PREFACE', 0, 0, false, section) : '')
      + paragraph(1, headingTable || emptyFirst ? '' : 'FIRST', 1, origin, pageBreak, (pageBreak ? '' : section) + metadata + (headingTable ? firstTable : decoration), firstHeight)
      + paragraph(2, 'SECOND', 2, next)
      + paragraph(3, tailTable ? '' : 'THIRD', 0, next + 1600, false, tailTable ? table : '');
    return xml.replace(/(<hs:sec\b[^>]*>)[\s\S]*<\/hs:sec>/, '$1' + body + '</hs:sec>');
  });
  return bytes;
}

test('a zero-width memo does not hide a first table leading band', {skip}, async () => {
  const core = await loadCore(), doc = new core.HwpDocument(fixture({headingTable: true, memo: true}));
  try {
    const table = [...walk(JSON.parse(doc.getPageLayerTree(1)).root)].find(n => n.groupKind?.kind === 'table');
    assert.ok(table);
    assert.ok(Math.abs(table.bounds.y - 600 / 75) < .05);
    assert.ok(Math.abs(positions(doc, 1).SECOND - 6000 / 75) < .05);
    assert.ok(zipEntries(Buffer.from(doc.exportHwpx())).find(e => e.name === 'Contents/section0.xml').read().toString('utf8').includes('NOTE'));
  } finally { doc.free(); }
});

for (const pageBreak of [false, true]) {
  test(`a first inline table owns its complete stored leading band: break=${pageBreak}`, {skip}, async () => {
    const core = await loadCore(), doc = new core.HwpDocument(fixture({pageBreak, headingTable: true}));
    try {
      const page = pageBreak ? 1 : 0, p = positions(doc, page);
      const table = [...walk(JSON.parse(doc.getPageLayerTree(page)).root)].find(n => n.groupKind?.kind === 'table');
      assert.ok(table);
      assert.ok(Math.abs(table.bounds.y - 600 / 75) < .05, `First table top: ${table.bounds.y}`);
      assert.ok(Math.abs(p.SECOND - 6000 / 75) < .05, `After first table: ${p.SECOND}`);
      assert.ok(Math.abs(p.THIRD - 7600 / 75) < .05);
    } finally { doc.free(); }
  });
}

for (const wrap of ['Square', 'InFrontOfText']) {
  test(`a first host shape preserves only a proven stored origin: ${wrap}`, {skip}, async () => {
    const core = await loadCore(), shapeDoc = core.HwpDocument.createEmpty();
    let decoration;
    try {
      shapeDoc.createBlankDocument();
      shapeDoc.createShapeControl(JSON.stringify({shapeType: 'rectangle', width: 3000, height: 1000, horzOffset: 0, vertOffset: 0, treatAsChar: false, textWrap: wrap}));
      const xml = zipEntries(Buffer.from(shapeDoc.exportHwpx())).find(e => e.name === 'Contents/section0.xml').read().toString('utf8');
      decoration = /<hp:rect\b[\s\S]*?<\/hp:rect>/.exec(xml)?.[0];
      assert.ok(decoration);
    } finally { shapeDoc.free(); }
    const doc = new core.HwpDocument(fixture({decoration, emptyFirst: true, after: 0, nextBefore: 0}));
    try {
      const p = positions(doc, 1, ['SECOND', 'THIRD']), expected = (wrap === 'Square' ? 2100 : 1600) / 75;
      assert.ok(Math.abs(p.SECOND - expected) < .1, `After host shape: ${p.SECOND}`);
    } finally { doc.free(); }
  });
}

test('the rule derives arbitrary leading margins from the source', {skip}, async () => {
  const core = await loadCore(), doc = new core.HwpDocument(fixture({before: 1250}));
  try {
    const p = positions(doc, 1);
    assert.ok(Math.abs(p.FIRST - 1250 / 75) < .05);
    assert.ok(Math.abs(p.SECOND - 3650 / 75) < .05);
    assert.ok(Math.abs(p.THIRD - 5250 / 75) < .05);
  } finally { doc.free(); }
});

test('a following inline table consumes the same stored page origin', {skip}, async () => {
  const core = await loadCore(), doc = new core.HwpDocument(fixture({tailTable: true}));
  try {
    const nodes = [...walk(JSON.parse(doc.getPageLayerTree(1)).root)];
    const table = nodes.find(n => n.groupKind?.kind === 'table');
    assert.ok(table);
    assert.equal(doc.pageCount(), 2);
    assert.ok(Math.abs(table.bounds.y - 4500 / 75) < .05, `Table origin: ${table.bounds.y}`);
    assert.ok(Math.abs(table.bounds.height - 3000 / 75) < .05);
    assert.ok(nodes.flatMap(n => n.ops || []).some(op => op.text === 'CELL'));
  } finally { doc.free(); }
});

async function loadCore() {
  const core = await import(pathToFileURL(process.env.PWH_CORE_JS));
  await core.default({module_or_path: await fs.readFile(process.env.PWH_CORE_WASM)});
  return core;
}
function* walk(node) {
  yield node;
  for (const child of node.children || []) yield* walk(child);
  if (node.child) yield* walk(node.child);
}
function positions(doc, page, texts = ['FIRST', 'SECOND', 'THIRD']) {
  const nodes = [...walk(JSON.parse(doc.getPageLayerTree(page)).root)];
  return Object.fromEntries(texts.map(text => {
    const line = nodes.find(n => n.groupKind?.kind === 'textLine'
      && [...walk(n)].flatMap(c => c.ops || []).some(op => op.text === text));
    assert.ok(line, `${text} must be painted on page ${page}`);
    return [text, line.bounds.y];
  }));
}

for (const pageBreak of [false, true]) {
  for (const after of [0, 300, 700]) {
    test(`stored leading margin retains the page origin: break=${pageBreak}, after=${after}`, {skip}, async () => {
      const core = await loadCore(), doc = new core.HwpDocument(fixture({pageBreak, after}));
      try {
        const p = positions(doc, pageBreak ? 1 : 0);
        assert.equal(doc.pageCount(), pageBreak ? 2 : 1);
        assert.ok(Math.abs(p.FIRST - 500 / 75) < .05, `First margin: ${p.FIRST}`);
        assert.ok(Math.abs(p.SECOND - (2600 + after) / 75) < .05, `Second origin: ${p.SECOND}`);
        assert.ok(Math.abs(p.THIRD - (4200 + after) / 75) < .05, `Third origin: ${p.THIRD}`);
        const exported = new core.HwpDocument(doc.exportHwpx());
        try {
          assert.equal(exported.pageCount(), doc.pageCount());
          assert.deepEqual(positions(exported, pageBreak ? 1 : 0), p);
        } finally { exported.free(); }
      } finally { doc.free(); }
    });
  }
}

test('the stored origin also survives HWP export and reopening', {skip}, async () => {
  const core = await loadCore(), doc = new core.HwpDocument(fixture());
  let reopened;
  try {
    reopened = new core.HwpDocument(doc.exportHwp());
    assert.equal(reopened.pageCount(), 2);
    const p = positions(reopened, 1);
    assert.ok(Math.abs(p.SECOND - 2900 / 75) < .05, `HWP second origin: ${p.SECOND}`);
    assert.ok(Math.abs(p.THIRD - 4500 / 75) < .05, `HWP third origin: ${p.THIRD}`);
  } finally { reopened?.free(); doc.free(); }
});

for (const pageBreak of [false, true]) {
  test(`a zero successor leading margin still closes the stored frame: break=${pageBreak}`, {skip}, async () => {
    const core = await loadCore(), doc = new core.HwpDocument(fixture({pageBreak, nextBefore: 0}));
    try {
      const p = positions(doc, pageBreak ? 1 : 0);
      assert.ok(Math.abs(p.SECOND - 2400 / 75) < .05, `Zero-margin origin: ${p.SECOND}`);
      assert.ok(Math.abs(p.THIRD - 4000 / 75) < .05);
      assert.equal(doc.pageCount(), pageBreak ? 2 : 1);
    } finally { doc.free(); }
  });
}

for (const options of [{origin: 900}, {gapError: 600}, {before: 0, origin: 500}]) {
  test(`unproven first-page margin keeps relative origin: ${JSON.stringify(options)}`, {skip}, async () => {
    const core = await loadCore(), doc = new core.HwpDocument(fixture(options));
    try {
      const p = positions(doc, 1);
      const origin = options.origin ?? options.before ?? 500;
      const next = origin + 2400 + (options.gapError ?? 0);
      assert.ok(Math.abs(p.SECOND - (next - origin) / 75) < .05,
        `Fallback must retain its source origin: ${p.SECOND}`);
    } finally { doc.free(); }
  });
}
