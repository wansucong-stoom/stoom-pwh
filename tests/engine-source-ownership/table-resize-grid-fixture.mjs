import fs from 'node:fs/promises';
import {mapHwpxMember} from './hwpx-fixture-utils.mjs';
const seed = await fs.readFile(new URL('../fixtures/rowbreak-table/synthetic-rowbreak-single-line-control.hwpx', import.meta.url));

export function tableResizeGridFixture({nested = false, merged = false, rows = 1, pageHeight = 50000} = {}) {
  const paragraph = (text, pos = 0, controls = '') => `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${controls}<hp:t>${text}</hp:t></hp:run><hp:linesegarray><hp:lineseg textpos="0" vertpos="${pos}" vertsize="1000" textheight="1000" baseline="850" spacing="800" horzpos="0" horzsize="28000" flags="393216"/></hp:linesegarray></hp:p>`;
  const cell = (row, col, body, span = 1, height = 282, width = 28000) => `<hp:tc hasMargin="1" borderFillIDRef="1"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP">${body}</hp:subList><hp:cellAddr colAddr="${col}" rowAddr="${row}"/><hp:cellSpan colSpan="1" rowSpan="${span}"/><hp:cellSz width="${width}" height="${height}"/><hp:cellMargin left="141" right="141" top="141" bottom="141"/></hp:tc>`;
  const table = (id, contents, rowCount, colCount, width, height) => `<hp:tbl id="${id}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" pageBreak="CELL" repeatHeader="0" noAdjust="0" rowCnt="${rowCount}" colCnt="${colCount}" cellSpacing="0" borderFillIDRef="1"><hp:sz width="${width}" height="${height}" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="0" right="0" top="0" bottom="0"/>${contents}</hp:tbl>`;
  let contents = '';
  for (let row = 0; row < rows; row++) {
    const body = Array.from({length: 5}, (_, n) => paragraph(`CELL_${row}_${n}`, n * 1800)).join('');
    contents += '<hp:tr>' + (merged && row === 0 ? cell(0, 0, paragraph('MERGED'), Math.min(rows, 2), 282, 4000) : merged && row >= 2 ? cell(row, 0, paragraph('TAIL'), 1, 282, 4000) : '')
      + cell(row, merged ? 1 : 0, body) + '</hp:tr>';
  }
  const width = merged ? 32000 : 28000;
  let object = table(10, contents, rows, merged ? 2 : 1, width, rows * 8482);
  if (nested) object = table(20, '<hp:tr>' + cell(0, 0, paragraph('WRAPPER') + paragraph('', 2000, object), 1, rows * 8482 + 4000, width + 500) + '</hp:tr>', 1, 1, width + 500, rows * 8482 + 4000);
  const section = `<hp:secPr id="0"><hp:pagePr width="40000" height="${pageHeight}" landscape="WIDELY"><hp:margin left="1000" right="1000" top="1000" bottom="1000" header="0" footer="0" gutter="0"/></hp:pagePr></hp:secPr>`;
  return mapHwpxMember(seed, 'Contents/section0.xml', xml => xml.replace(/(<hs:sec\b[^>]*>)[\s\S]*<\/hs:sec>/, '$1' + paragraph('', 0, section + object) + '</hs:sec>'));
}

export function resizeGridOwner(doc) {
  const run = Array.from({length: doc.pageCount()}, (_, page) => JSON.parse(doc.getPageTextLayout(page)).runs).flat().find(run => run.text === 'CELL_0_0');
  if (!run?.cellPath?.length) throw Error('Synthetic table owner not found');
  return [run.secIdx, run.parentParaIdx, JSON.stringify(run.cellPath)];
}
