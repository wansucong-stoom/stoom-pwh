import fs from 'node:fs/promises';
import {mapHwpxMember} from './hwpx-fixture-utils.mjs';

const seed = await fs.readFile(new URL('../fixtures/rowbreak-table/synthetic-rowbreak-single-line-control.hwpx', import.meta.url));
const paragraph = (text, vpos, extra = '', height = 1100) =>
  `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${extra}<hp:t>${text}</hp:t></hp:run><hp:linesegarray><hp:lineseg textpos="0" vertpos="${vpos}" vertsize="${height}" textheight="${height}" baseline="935" spacing="500" horzpos="0" horzsize="18000" flags="393216"/></hp:linesegarray></hp:p>`;
const cell = (row, col, width, height, body, span = 1) =>
  `<hp:tc hasMargin="1" borderFillIDRef="1"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP">${body}</hp:subList><hp:cellAddr colAddr="${col}" rowAddr="${row}"/><hp:cellSpan colSpan="1" rowSpan="${span}"/><hp:cellSz width="${width}" height="${height}"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/></hp:tc>`;
const table = (id, width, height, columns, rows, pageBreak = 'CELL', inline = false) =>
  `<hp:tbl id="${id}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" pageBreak="${pageBreak}" repeatHeader="0" noAdjust="1" rowCnt="${rows.length}" colCnt="${columns}" cellSpacing="0" borderFillIDRef="1"><hp:sz width="${width}" height="${height}" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE"/><hp:pos treatAsChar="${Number(inline)}" affectLSpacing="0" flowWithText="1" allowOverlap="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="100" right="100" top="100" bottom="100"/>${rows.map(row => `<hp:tr>${row}</hp:tr>`).join('')}</hp:tbl>`;

// Entirely synthetic: declared-height rows, a stored page rewind, ordinary
// paragraphs and a third-level table inside one empty table host paragraph.
export function declaredNestedFixture({savedFrame = true, pageBreak = 'CELL', inner = true, pageHeight = 24000, mixedHost = false, inlineInner = false, objectFirst = false, innerFrame = 6400, innerRows = 4} = {}) {
  const innerHeight=innerRows*1600,secondHeight=objectFirst?innerHeight+7600:22000;
  const nested = table(30, 18000, innerHeight, 1, Array.from({length:innerRows},(_,row) => cell(row, 0, 18000, 1600, paragraph(`INNER_${row}`, 0))), 'CELL', inlineInner);
  const first = Array.from({length: 7}, (_, i) => paragraph(`FIRST_${i}`, i * 1600)).join('');
  const second = objectFirst ? paragraph('SECOND_0',0) + paragraph('SECOND_1',1600) + paragraph('',0,nested,innerFrame)
    + [innerHeight+500,innerHeight+2100,innerHeight+3700].map((vpos,i)=>paragraph(`SECOND_${i+2}`,vpos)).join('') + paragraph('TAIL_MARKER',innerHeight+5300)
    : [0, 1600, 3200, savedFrame ? 0 : 4800, savedFrame ? 1600 : 6400]
    .map((vpos, i) => paragraph(`SECOND_${i}`, vpos)).join('')
    + (inner ? paragraph('', savedFrame ? 3200 : 8000, nested, innerFrame) : '')
    + paragraph('TAIL_MARKER', savedFrame ? 10100 : 14900);
  const child = table(20, 24000, 15000+secondHeight, 2, [
    cell(0, 0, 4000, 15000, paragraph('A', 0)) + cell(0, 1, 20000, 15000, first),
    cell(1, 0, 4000, secondHeight, paragraph('B', 0)) + cell(1, 1, 20000, secondHeight, second),
  ], pageBreak);
  const outer = table(10, 25000, 17000+secondHeight, 1, [
    cell(0, 0, 25000, 2000, paragraph('HEADER', 0)),
    cell(1, 0, 25000, 15000+secondHeight, paragraph(mixedHost ? 'HOST_TEXT' : '', 0, child, 15000+secondHeight)),
  ]);
  return mapHwpxMember(seed, 'Contents/section0.xml', xml => {
    const section = `<hp:secPr id="0"><hp:pagePr width="30000" height="${pageHeight}" landscape="WIDELY"><hp:margin left="0" right="0" top="0" bottom="0" header="0" footer="0" gutter="0"/></hp:pagePr></hp:secPr>`;
    return xml.replace(/(<hs:sec\b[^>]*>)[\s\S]*<\/hs:sec>/, '$1' + paragraph('', 0, section + outer, 39000) + '</hs:sec>');
  });
}
