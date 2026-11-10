import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {mapHwpxMember} from './engine-source-ownership/hwpx-fixture-utils.mjs';

const seed = await fs.readFile(new URL('./fixtures/rowbreak-table/synthetic-rowbreak-single-line-control.hwpx', import.meta.url));
const paragraph = (text, y, spacing = 700, control = '') =>
  '<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">' +
  '<hp:run charPrIDRef="0">' + control + '<hp:t>' + text + '</hp:t></hp:run>' +
  '<hp:linesegarray><hp:lineseg textpos="0" vertpos="' + y + '" vertsize="1000" textheight="1000" ' +
  'baseline="850" spacing="' + spacing + '" horzpos="0" horzsize="17600" flags="393216"/></hp:linesegarray></hp:p>';

function cell(row, col, height, body) {
  return '<hp:tc header="' + Number(row === 0) + '" hasMargin="1" borderFillIDRef="1">' +
    '<hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP">' + body + '</hp:subList>' +
    '<hp:cellAddr colAddr="' + col + '" rowAddr="' + row + '"/><hp:cellSpan colSpan="1" rowSpan="1"/>' +
    '<hp:cellSz width="18000" height="' + height + '"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/></hp:tc>';
}

function fixture({
  leftRestart = 0, bottom = 1300, continuation = false, leftSecondRestart = 0,
  leftEndsInContinuation = false, swapColumns = false,
} = {}) {
  const second = (marker, closing, restart) => !continuation ? '' :
    Array.from({length: 25}, (_, i) => paragraph(marker + i, (i + 1) * 1700)).join('') +
    paragraph(closing, 44200) + paragraph(marker + 'END', restart);
  const left = Array.from({length: 26}, (_, i) => paragraph('LEFT' + i, i * 1700)).join('') +
    paragraph('LEFTNEXT', leftRestart) +
    (leftEndsInContinuation ? '' : second('LEFTSECOND', 'LEFTCLOSE', leftSecondRestart));
  const right = Array.from({length: 26}, (_, i) => paragraph('RIGHT' + i, i * 1700)).join('') +
    paragraph('CLOSING', 44200) + paragraph('RIGHTNEXT', 0) + second('RIGHTSECOND', 'RIGHTCLOSE', 0);
  const table = '<hp:tbl id="17" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" ' +
    'pageBreak="CELL" repeatHeader="1" rowCnt="2" colCnt="2" cellSpacing="0" borderFillIDRef="1">' +
    '<hp:sz width="36000" height="47850" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE"/>' +
    '<hp:pos treatAsChar="0" flowWithText="1" allowOverlap="0" vertRelTo="PARA" horzRelTo="COLUMN" ' +
    'vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
    '<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="100" right="100" top="100" bottom="100"/>' +
    '<hp:tr>' + cell(0, 0, 2400, paragraph('HEADLEFT', 0, 0)) +
    cell(0, 1, 2400, paragraph('HEADRIGHT', 0, 0)) + '</hp:tr>' +
    '<hp:tr>' + cell(1, 0, 52000, swapColumns ? right : left) +
    cell(1, 1, 52000, swapColumns ? left : right) + '</hp:tr></hp:tbl>';
  const page = '<hp:secPr id="0"><hp:pagePr width="40000" height="50100" landscape="WIDELY">' +
    '<hp:margin left="100" right="100" top="100" bottom="' + bottom + '" header="0" footer="700" gutter="0"/>' +
    '</hp:pagePr></hp:secPr>';
  return mapHwpxMember(seed, 'Contents/section0.xml', xml =>
    xml.replace(/(<hs:sec\b[^>]*>)[\s\S]*<\/hs:sec>/, '$1' + paragraph('', 0, 0, page + table) + '</hs:sec>'));
}

const corePath = process.env.PWH_CORE_JS;
const wasmPath = process.env.PWH_CORE_WASM;

test('a saved parallel row uses the visible closing line at the page edge', {
  skip: !(corePath && wasmPath) && 'Set PWH_CORE_JS and PWH_CORE_WASM to test the actual core',
}, async () => {
  const core = await import(pathToFileURL(corePath));
  const wasm = await fs.readFile(wasmPath);
  await core.default({module_or_path: wasm});
  // CI also exercises the pinned r18 release until the candidate is published.
  const digest = createHash('sha256').update(wasm).digest('hex');
  const releasedR18 = digest === '9fef2eb76f0f98d271b3e3205247b57c3164c8730e17cfe4ae3d1c1616a6ab8a';
  const firstFrameOnly = digest === 'acd654d86053f89f3bbd788f710a1ade314bd41cbc06a27a7114bbd418581eb2';
  const simultaneousRestartsOnly = digest === 'a56124fc94e47baa90650f5aea8c4bb211e6a7e86b76c5c70a75b6685a3ea45f';
  function pages(options) {
    const doc = new core.HwpDocument(fixture(options));
    try {
      const layout = Array.from({length: doc.pageCount()}, (_, page) => JSON.parse(doc.getPageTextLayout(page)).runs);
      const {height, marginBottom, marginFooter} = JSON.parse(doc.getPageInfo(0));
      const tables = layout.map((_, page) =>
        JSON.parse(doc.getPageControlLayout(page)).controls.find(control => control.type === 'table'));
      return {layout, bodyBottom: height - marginBottom - marginFooter, table: tables[0], tables};
    } finally {
      doc.free();
    }
  }
  function pageOf({layout}, marker) {
    const hits = layout.flatMap((runs, page) => runs.filter(run => run.text === marker).map(() => page));
    assert.equal(hits.length, 1, marker + ' should appear exactly once');
    return hits[0];
  }
  const confirmed = pages();
  assert.equal(pageOf(confirmed, 'CLOSING'), releasedR18 ? 1 : 0);
  assert.equal(pageOf(confirmed, 'RIGHTNEXT'), 1);
  assert.equal(pageOf(confirmed, 'LEFTNEXT'), 1);
  assert.ok(confirmed.layout[1].some(run => run.text === 'HEADRIGHT'), 'continuation repeats the header');
  assert.ok(confirmed.table, 'page 1 contains the table');
  const edge = confirmed.table.y + confirmed.table.h;
  assert.ok(edge <= confirmed.bodyBottom + 0.2, 'the table ends within the body');
  if (!releasedR18) {
    const closing = confirmed.layout[0].find(run => run.text === 'CLOSING');
    assert.ok(closing.y + closing.h <= edge + 0.2, 'the painted table contains the closing line');
  }

  assert.equal(pageOf(pages({leftRestart: 44100}), 'CLOSING'), 1, 'a sibling must confirm the restart');
  assert.equal(pageOf(pages({bottom: 1900}), 'CLOSING'), 1, 'the visible line cannot cross the body boundary');
  const continued = pages({continuation: true});
  const expectedClosingPage = releasedR18 || firstFrameOnly ? 2 : 1;
  assert.equal(pageOf(continued, 'RIGHTCLOSE'), expectedClosingPage);
  assert.equal(pageOf(continued, 'RIGHTSECONDEND'), 2);
  assert.equal(pageOf(pages({continuation: true, leftSecondRestart: 44100}), 'RIGHTCLOSE'), 2);

  const finished = {continuation: true, leftEndsInContinuation: true};
  const expectedWithFinishedCell = releasedR18 || firstFrameOnly || simultaneousRestartsOnly ? 2 : 1;
  for (const swapColumns of [false, true]) {
    const result = pages({...finished, swapColumns});
    assert.equal(pageOf(result, 'LEFTNEXT'), 1, 'the short cell is consumed once');
    assert.equal(pageOf(result, 'RIGHTCLOSE'), expectedWithFinishedCell);
    assert.equal(pageOf(result, 'RIGHTSECONDEND'), 2);
    const continuing = result.tables[1];
    const edge = continuing.y + continuing.h;
    assert.ok(edge <= result.bodyBottom + 0.2, 'continuation stays within the body boundary');
    if (expectedWithFinishedCell === 1) {
      const closing = result.layout[1].find(run => run.text === 'RIGHTCLOSE');
      assert.ok(closing.y + closing.h <= edge + 0.2, 'the continuation border encloses the closing line');
      const terminal = result.tables[2];
      assert.ok(terminal.y + terminal.h < edge, 'the final fragment closes at its content');
    }
  }
  assert.equal(pageOf(pages({...finished, leftRestart: 44100}), 'RIGHTCLOSE'), 2,
    'a short cell without a corroborating source boundary does not authenticate the row');

});
