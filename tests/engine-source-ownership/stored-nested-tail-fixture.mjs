import fs from 'node:fs/promises';
import {mapHwpxMember} from './hwpx-fixture-utils.mjs';
const seed = await fs.readFile(new URL('../fixtures/rowbreak-table/synthetic-rowbreak-single-line-control.hwpx', import.meta.url));
const xmlText = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const paragraph = (value, {vpos=0,height=1000,spacing=600,width=18000,control='',stored=true}={}) =>
  `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${control}<hp:t>${xmlText(value)}</hp:t></hp:run>${stored ? `<hp:linesegarray><hp:lineseg textpos="0" vertpos="${vpos}" vertsize="${height}" textheight="${height}" baseline="${Math.round(height*.85)}" spacing="${spacing}" horzpos="0" horzsize="${width}" flags="393216"/></hp:linesegarray>` : ''}</hp:p>`;
const cell = (row,col,content,height,width=10000,span=1) => `<hp:tc hasMargin="1" borderFillIDRef="1"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP">${content}</hp:subList><hp:cellAddr colAddr="${col}" rowAddr="${row}"/><hp:cellSpan colSpan="1" rowSpan="${span}"/><hp:cellSz width="${width}" height="${height}"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/></hp:tc>`;
const table = (id,rows,cols,content,height,width=20000,{top=100,bottom=100,offset=0,inline=false}={}) =>
  `<hp:tbl id="${id}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" pageBreak="CELL" repeatHeader="0" noAdjust="1" rowCnt="${rows}" colCnt="${cols}" cellSpacing="0" borderFillIDRef="1"><hp:sz width="${width}" height="${height}" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE"/><hp:pos treatAsChar="${inline?1:0}" affectLSpacing="0" flowWithText="1" allowOverlap="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="${offset}" horzOffset="0"/><hp:outMargin left="100" right="100" top="${top}" bottom="${bottom}"/><hp:inMargin left="100" right="100" top="100" bottom="100"/>${content}</hp:tbl>`;

// Anonymous synthetic shape. Source common.height is deliberately NOT a sum of
// raw row prefixes; a closing successor identifies the separate terminal owner.
export function terminalRowFixture({stored=true,hostStored=stored,nextStored=stored,successorDelta=0,
  frameHeight=10000,paperHeight=22000,tailHeight=3000,top=100,bottom=100,
  hostVpos=4800,successorControl='',mergeCrossing=false,offset=0,inline=false,tailLineHeight=tailHeight-200}={}) {
  const heights=[1200,2000,2500,1500,2200,tailHeight];
  const rows=heights.map((height,row)=>`<hp:tr>${[0,1].map(col=> {
    if(mergeCrossing && row===5 && col===0)return '';
    const span=mergeCrossing && row===4 && col===0 ? 2 : 1;
    const lineHeight=row===5 ? tailLineHeight : 1000;
    return cell(row,col,paragraph(`ROW_${row}_${col}`,{stored,height:lineHeight}),height,10000,span);
  }).join('')}</hp:tr>`).join('');
  const child=table(200,6,2,rows,frameHeight,20000,{top,bottom,offset,inline});
  const content=[0,1,2].map(index=>paragraph('LEAD_'+index,{stored,vpos:index*1600})).join('')
    +paragraph('',{stored:hostStored,vpos:hostVpos,width:0,control:child})
    +paragraph('AFTER_TABLE',{stored:nextStored,vpos:tailHeight+top+bottom+successorDelta,control:successorControl});
  const wrapper=table(100,2,1,`<hp:tr>${cell(0,0,paragraph('WRAPPER',{stored}),1200,22000)}</hp:tr><hp:tr>${cell(1,0,content,40000,22000)}</hp:tr>`,41200,22000,{top:0,bottom:0});
  const section=`<hp:secPr id="0"><hp:pagePr width="26000" height="${paperHeight}" landscape="WIDELY"><hp:margin left="0" right="0" top="0" bottom="0" header="0" footer="0" gutter="0"/></hp:pagePr></hp:secPr>`;
  return mapHwpxMember(seed,'Contents/section0.xml',xml=>xml.replace(/(<hs:sec\b[^>]*>)[\s\S]*<\/hs:sec>/,'$1'+paragraph('',{stored,height:600,control:section+wrapper})+'</hs:sec>'));
}
