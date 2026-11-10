import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { mapHwpxMember } from './engine-source-ownership/hwpx-fixture-utils.mjs';

const skip = !process.env.PWH_CORE_JS || !process.env.PWH_CORE_WASM
  ? 'Requires explicit PWH_CORE_JS and PWH_CORE_WASM' : false;
const seed = await fs.readFile(new URL(
  './fixtures/rowbreak-table/synthetic-rowbreak-single-line-control.hwpx', import.meta.url,
));
const px = hu => hu * 96 / 7200;

function paragraph(contents, vpos, width = 25000) {
  return `<hp:p paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0"><hp:run charPrIDRef="0">${contents}</hp:run><hp:linesegarray><hp:lineseg textpos="0" vertpos="${vpos}" vertsize="1100" textheight="1100" baseline="935" spacing="300" horzpos="0" horzsize="${width}" flags="393216"/></hp:linesegarray></hp:p>`;
}
const text = (value, vpos) => paragraph(`<hp:t>${value}</hp:t>`, vpos);

function fixture(successorOrigin) {
  const width = 23800;
  const makeRow = (row, height, content) => `<hp:tr>${content.map((cell, col) =>
    `<hp:tc hasMargin="1" borderFillIDRef="1"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER">${cell}</hp:subList><hp:cellAddr colAddr="${col}" rowAddr="${row}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${col ? 17800 : 6000}" height="${height}"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/></hp:tc>`,
  ).join('')}</hp:tr>`;
  const rows = makeRow(0, 1800, [text('A', 0), text('B', 0)])
    + makeRow(1, 5500, [text('C', 0), text('ONE', 0) + text('TWO', 1400) + text('THREE', 0)]);
  const table = `<hp:tbl id="42" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" pageBreak="CELL" repeatHeader="0" noAdjust="0" rowCnt="2" colCnt="2" cellSpacing="0" borderFillIDRef="1"><hp:sz width="${width}" height="4800" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE"/><hp:pos treatAsChar="0" flowWithText="1" allowOverlap="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="RIGHT" vertOffset="0" horzOffset="0"/><hp:outMargin left="120" right="120" top="120" bottom="120"/><hp:inMargin left="100" right="100" top="100" bottom="100"/>${rows}</hp:tbl>`;
  const paper = '<hp:secPr id="0"><hp:pagePr width="30000" height="8260" landscape="WIDELY"><hp:margin left="2400" right="2600" top="200" bottom="200" header="0" footer="0" gutter="0"/></hp:pagePr></hp:secPr>';
  const body = paragraph(paper + '<hp:t>START</hp:t>', 0)
    + text('BEFORE', 1400)
    + paragraph(table + '<hp:t/>', 2800, 0)
    + paragraph('<hp:t/>', successorOrigin)
    + text('AFTER', successorOrigin + 1400);
  return mapHwpxMember(seed, 'Contents/section0.xml',
    xml => xml.replace(/(<hs:sec\b[^>]*>)[\s\S]*<\/hs:sec>/, '$1' + body + '</hs:sec>'));
}
function tables(node) {
  if (!node || typeof node !== 'object') return [];
  if (node.type === 'Table') return [node.bbox];
  return Object.values(node).flatMap(tables);
}

test('stored opening and closing table fragments preserve one physical row height', { skip }, async () => {
  const core = await import(pathToFileURL(process.env.PWH_CORE_JS));
  await core.default({ module_or_path: await fs.readFile(process.env.PWH_CORE_WASM) });
  const doc = new core.HwpDocument(fixture(2740));
  const unclosed = new core.HwpDocument(fixture(2741));
  try {
    assert.equal(doc.pageCount(), 2);
    const [first, second] = [0, 1].map(page => tables(JSON.parse(doc.getPageRenderTree(page))));
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.ok(Math.abs(first[0].h - px(4800)) < 0.3, JSON.stringify([first, second]));
    assert.ok(Math.abs(second[0].h - px(2500)) < 0.3, JSON.stringify([first, second]));
    const owner = marker => [0, 1].filter(page =>
      JSON.parse(doc.getPageTextLayout(page)).runs.some(run => run.text === marker));
    assert.deepEqual(owner('ONE'), [0]);
    assert.deepEqual(owner('TWO'), [0]);
    assert.deepEqual(owner('THREE'), [1]);

    const unclosedFirst = tables(JSON.parse(unclosed.getPageRenderTree(0)));
    assert.ok(unclosedFirst[0].h < first[0].h - 0.5,
      'A one-unit discrepancy must not authorize the declared opening height');
  } finally {
    unclosed.free();
    doc.free();
  }
});
