import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {mapHwpxMember} from './engine-source-ownership/hwpx-fixture-utils.mjs';

const skip = !process.env.PWH_CORE_JS || !process.env.PWH_CORE_WASM
  ? 'Requires explicit PWH_CORE_JS and PWH_CORE_WASM' : false;
const seed = await fs.readFile(new URL(
  './fixtures/rowbreak-table/synthetic-rowbreak-single-line-control.hwpx', import.meta.url,
));
const px = hu => hu * 96 / 7200;

function line(textpos, vertpos, height, spacing = 0) {
  return `<hp:lineseg textpos="${textpos}" vertpos="${vertpos}" vertsize="${height}" textheight="${height}" baseline="${Math.round(height * .85)}" spacing="${spacing}" horzpos="0" horzsize="25000" flags="393216"/>`;
}

function paragraph(contents, ...lines) {
  return `<hp:p paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0"><hp:run charPrIDRef="0">${contents}</hp:run><hp:linesegarray>${lines.join('')}</hp:linesegarray></hp:p>`;
}

function table(id, height, marker) {
  return `<hp:tbl id="${id}" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" pageBreak="CELL" repeatHeader="0" rowCnt="1" colCnt="1" cellSpacing="0" borderFillIDRef="1">
  <hp:sz width="24900" height="${height}" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE"/>
  <hp:pos treatAsChar="1" flowWithText="1" allowOverlap="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>
  <hp:outMargin left="0" right="0" top="100" bottom="100"/><hp:inMargin left="100" right="100" top="100" bottom="100"/>
  <hp:tr><hp:tc hasMargin="1" borderFillIDRef="1"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP">${paragraph(`<hp:t>${marker}</hp:t>`, line(0, 0, 1000))}</hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="24900" height="${height}"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/></hp:tc></hp:tr></hp:tbl>`;
}

function fixture() {
  const paper = '<hp:secPr id="0"><hp:pagePr width="30000" height="12000" landscape="WIDELY"><hp:margin left="2400" right="2600" top="200" bottom="200" header="0" footer="0" gutter="0"/></hp:pagePr></hp:secPr>';
  const body = paragraph(paper + '<hp:t>START</hp:t>', line(0, 0, 1400))
    + paragraph(table(40, 4000, 'PREVIOUS') + '<hp:t/>', line(0, 1400, 4200))
    + paragraph(table(41, 5000, 'FIRST') + table(42, 9200, 'SECOND') + '<hp:t>SUFFIX</hp:t>',
      line(0, 5600, 5200, 300), line(8, 0, 9400, 300), line(16, 9700, 1200, 1200));
  return mapHwpxMember(seed, 'Contents/section0.xml',
    xml => xml.replace(/(<hs:sec\b[^>]*>)[\s\S]*<\/hs:sec>/, '$1' + body + '</hs:sec>'));
}

test('a saved inline-table page reset keeps its separate suffix on the owning page', {skip}, async () => {
  const core = await import(pathToFileURL(process.env.PWH_CORE_JS));
  await core.default({module_or_path: await fs.readFile(process.env.PWH_CORE_WASM)});
  const doc = new core.HwpDocument(fixture());
  try {
    assert.equal(doc.pageCount(), 2);
    const runs = [0, 1].map(page => JSON.parse(doc.getPageTextLayout(page)).runs);
    assert.ok(runs[0].some(run => run.text === 'FIRST'));
    assert.ok(runs[1].some(run => run.text === 'SECOND'));
    const suffix = runs[1].filter(run => run.text === 'SUFFIX');
    assert.equal(suffix.length, 1);
    assert.ok(Math.abs(suffix[0].y - px(9900)) < .2, JSON.stringify(suffix));
    assert.ok(!runs[0].some(run => run.text === 'SUFFIX'));
  } finally {
    doc.free();
  }
});
