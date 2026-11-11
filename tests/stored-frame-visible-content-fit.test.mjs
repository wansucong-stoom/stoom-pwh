import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {mapHwpxMember} from './engine-source-ownership/hwpx-fixture-utils.mjs';

const skip = !process.env.PWH_CORE_JS || !process.env.PWH_CORE_WASM
  ? 'Requires explicit PWH_CORE_JS and PWH_CORE_WASM' : false;
const seed = await fs.readFile(new URL('./fixtures/rowbreak-table/synthetic-rowbreak-single-line-control.hwpx', import.meta.url));
function line(v, h = 1000, spacing = 500, textpos = 0, width = 41196) {
  return `<hp:lineseg textpos="${textpos}" vertpos="${v}" vertsize="${h}" textheight="${h}" baseline="${Math.round(h * .85)}" spacing="${spacing}" horzpos="0" horzsize="${width}" flags="393216"/>`;
}
function para(text, segments, extra = '') {
  return `<hp:p paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0"><hp:run charPrIDRef="0">${extra}<hp:t>${text}</hp:t></hp:run><hp:linesegarray>${segments}</hp:linesegarray></hp:p>`;
}
export function fixture() {
  const heights = [2414, 6065, 10053, 7565, 6065, 7565, 7565, 10565];
  const opening = para('FIRST', line(0))
    + para('A'.repeat(80), line(1500, 900, 452) + line(2852, 900, 452, 57))
    + para('SECOND', line(4204, 900, 452)) + para('THIRD', line(5556, 900, 452))
    + para('CLOSING', line(6908)) + para('RESUMED', line(0));
  const rows = heights.map((height, row) => `<hp:tr>${[0, 1].map(col => {
    const contents = row === 2 && col === 1 ? opening
      : row === 1 && col === 1 ? [0, 1500, 3000, 4500].map((v, i) => para('BODY' + i, line(v))).join('')
        : para('CELL', line(0));
    return `<hp:tc hasMargin="0" borderFillIDRef="1"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER">${contents}</hp:subList><hp:cellAddr colAddr="${col}" rowAddr="${row}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${col ? 42219 : 5403}" height="${height}"/><hp:cellMargin left="510" right="510" top="141" bottom="141"/></hp:tc>`;
  }).join('')}</hp:tr>`).join('');
  const table = `<hp:tbl id="42" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" pageBreak="CELL" repeatHeader="1" noAdjust="0" rowCnt="8" colCnt="2" cellSpacing="0" borderFillIDRef="1"><hp:sz width="47622" height="16909" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE"/><hp:pos treatAsChar="0" flowWithText="1" allowOverlap="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="141" right="141" top="141" bottom="141"/><hp:inMargin left="510" right="510" top="141" bottom="141"/>${rows}</hp:tbl>`;
  const paper = '<hp:secPr id="0"><hp:pagePr width="59528" height="84188" landscape="WIDELY"><hp:margin left="5669" right="5669" top="4251" bottom="4251" header="2834" footer="2834" gutter="0"/></hp:pagePr></hp:secPr>';
  const prelude = Array.from({length: 28}, (_, i) =>
    para('PRELUDE', line(i * 1800, 1000, 800), i === 0 ? paper : '')).join('')
    + para('PRELUDE', line(50400, 1000, 1326));
  const body = prelude
    + para('', line(52726, 1000, 600, 0, 0), table)
    + para('AFTER', line(41230, 1000, 600));
  const input = mapHwpxMember(seed, 'Contents/header.xml', xml => {
    return xml.replace(/(<hh:charPr\b[^>]*\bid="0"[^>]*\bheight=")[^"]*"/, (_, prefix) => prefix + '1000"');
  });
  return mapHwpxMember(input, 'Contents/section0.xml', xml => xml.replace(/(<hs:sec\b[^>]*>)[\s\S]*<\/hs:sec>/, '$1' + body + '</hs:sec>'));
}

test('ordinary saved table continuation keeps its visible prefix and resumed text on separate pages', {skip}, async () => {
  const core = await import(pathToFileURL(process.env.PWH_CORE_JS));
  await core.default({module_or_path: await fs.readFile(process.env.PWH_CORE_WASM)});
  const doc = new core.HwpDocument(fixture());
  try {
    assert.equal(doc.pageCount(), 2);
    const pages = [0, 1].map(page => JSON.parse(doc.getPageTextLayout(page)).runs);
    assert.ok(pages[0].some(run => run.text === 'CLOSING'), 'the final visible prefix line fits');
    assert.ok(!pages[0].some(run => run.text === 'RESUMED'), 'the next source line is not painted into the footer');
    assert.ok(pages[1].some(run => run.text === 'RESUMED'), 'the omitted line belongs to the continuation');
    const bottom = JSON.parse(doc.getPageInfo(0)).footerArea.y;
    assert.ok(pages[0].filter(run => run.parentParaIdx !== undefined).every(run => run.y + run.h <= bottom + .2));
    const reopened = new core.HwpDocument(doc.exportHwpx());
    try {
      assert.equal(reopened.pageCount(), 2);
      assert.ok(JSON.parse(reopened.getPageTextLayout(1)).runs.some(run => run.text === 'RESUMED'));
    } finally { reopened.free(); }
  } finally { doc.free(); }
});
