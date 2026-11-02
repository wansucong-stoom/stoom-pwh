import fs from 'node:fs/promises';
import {mapHwpxMember} from './hwpx-fixture-utils.mjs';

const seed = await fs.readFile(new URL('../fixtures/rowbreak-table/synthetic-rowbreak-single-line-control.hwpx', import.meta.url));
const text = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
function paragraph(value, {vpos=0, height=1000, spacing=600, width=18000, control='', stored=true}={}) {
  return `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${control}<hp:t>${text(value)}</hp:t></hp:run>${stored ? `<hp:linesegarray><hp:lineseg textpos="0" vertpos="${vpos}" vertsize="${height}" textheight="${height}" baseline="${Math.round(height*.85)}" spacing="${spacing}" horzpos="0" horzsize="${width}" flags="393216"/></hp:linesegarray>` : ''}</hp:p>`;
}
function cell(row, col, content, height, {width=10000, align='CENTER'}={}) {
  return `<hp:tc hasMargin="1" borderFillIDRef="1"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${align}">${content}</hp:subList><hp:cellAddr colAddr="${col}" rowAddr="${row}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${width}" height="${height}"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/></hp:tc>`;
}
function table(id, rows, columns, content, height, {inline=false, width=20000, margin=100, outerTop=margin, outerBottom=margin}={}) {
  return `<hp:tbl id="${id}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" pageBreak="CELL" repeatHeader="0" noAdjust="1" rowCnt="${rows}" colCnt="${columns}" cellSpacing="0" borderFillIDRef="1"><hp:sz width="${width}" height="${height}" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE"/><hp:pos treatAsChar="${inline?1:0}" affectLSpacing="0" flowWithText="1" allowOverlap="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="${margin}" right="${margin}" top="${outerTop}" bottom="${outerBottom}"/><hp:inMargin left="100" right="100" top="100" bottom="100"/>${content}</hp:tbl>`;
}

// Geometry and ASCII markers are wholly synthetic. The source-owned opening
// frame ends before an exact inline-table placeholder reset. That later table
// stays a distinct content owner; its height is not a remaining-row ledger.
export function nestedOpeningFrameFixture({frameHeight=10200, stored=true, placeholderDelta=0, inlineHeight=6000, outerTop=100, outerBottom=100, hostStored=stored}={}) {
  const nextTable = table(300, 2, 1, [0,1].map(row => `<hp:tr>${cell(row,0,paragraph('NEXT_'+row,{stored}),inlineHeight/2,{width:18000})}</hp:tr>`).join(''), inlineHeight, {inline:true,width:18000});
  const mainRows = [
    `<hp:tr>${cell(0,0,paragraph('HEAD_LABEL',{stored}),1200)}${cell(0,1,paragraph('HEAD_BODY',{stored}),1200)}</hp:tr>`,
    `<hp:tr>${cell(1,0,paragraph('FULL_LABEL',{stored}),4000)}${cell(1,1,paragraph('FULL_BODY',{stored}),4000)}</hp:tr>`,
    `<hp:tr>${cell(2,0,paragraph('OPEN_LABEL',{stored}),10000)}${cell(2,1,paragraph('OPEN_LINE_A',{stored})+paragraph('OPEN_LINE_B',{vpos:1600,stored})+paragraph('',{height:inlineHeight+200+placeholderDelta,control:nextTable,stored})+paragraph('NEXT_TAIL',{vpos:inlineHeight+800,stored}),10000)}</hp:tr>`,
  ].join('');
  const grid = table(200,3,2,mainRows,frameHeight,{outerTop,outerBottom});
  const body = paragraph('WRAPPER_LEAD',{stored})+paragraph('',{vpos:1600,width:0,control:grid,stored:hostStored});
  const wrapper = table(100,2,1,`<hp:tr>${cell(0,0,paragraph('WRAPPER_TITLE',{stored}),1200,{width:22000,align:'TOP'})}</hp:tr><hp:tr>${cell(1,0,body,23000,{width:22000,align:'TOP'})}</hp:tr>`,13400,{width:22000,margin:0});
  const section = '<hp:secPr id="0"><hp:pagePr width="26000" height="15000" landscape="WIDELY"><hp:margin left="0" right="0" top="0" bottom="0" header="0" footer="0" gutter="0"/></hp:pagePr></hp:secPr>';
  return mapHwpxMember(seed,'Contents/section0.xml',xml => xml.replace(/(<hs:sec\b[^>]*>)[\s\S]*<\/hs:sec>/,'$1'+paragraph('',{height:600,control:section+wrapper,stored})+'</hs:sec>'));
}
