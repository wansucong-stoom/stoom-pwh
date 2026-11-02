import fs from 'node:fs/promises';
import {mapHwpxMember} from './hwpx-fixture-utils.mjs';

const seed=await fs.readFile(new URL('../fixtures/rowbreak-table/synthetic-rowbreak-single-line-control.hwpx',import.meta.url));
const paragraph=(text,vpos,before='',after='')=>
 `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${before}<hp:t>${text}</hp:t>${after}</hp:run><hp:linesegarray><hp:lineseg textpos="0" vertpos="${vpos}" vertsize="1100" textheight="1100" baseline="935" spacing="0" horzpos="0" horzsize="18000" flags="393216"/></hp:linesegarray></hp:p>`;
const cell=(row,body,height)=>
 `<hp:tc hasMargin="1" borderFillIDRef="1"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP">${body}</hp:subList><hp:cellAddr colAddr="0" rowAddr="${row}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="20000" height="${height}"/><hp:cellMargin left="0" right="0" top="0" bottom="0"/></hp:tc>`;
const table=(id,rows,height)=>
 `<hp:tbl id="${id}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" pageBreak="CELL" repeatHeader="0" noAdjust="1" rowCnt="${rows.length}" colCnt="1" cellSpacing="0" borderFillIDRef="1"><hp:sz width="20000" height="${height}" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE"/><hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="0" right="0" top="0" bottom="0"/>${rows.map(row=>`<hp:tr>${row}</hp:tr>`).join('')}</hp:tbl>`;

// No institutional source data. A saved text line follows (or precedes) a
// block table in the same paragraph; its vpos must not count that table twice.
export function mixedBlockFixture({tableFirst=true,pageHeight=9300,hostText='HOST_TEXT',rows=3}={}){
 const height=rows*1600;
 const child=table(20,Array.from({length:rows},(_,i)=>cell(i,paragraph('CHILD_'+i,0),1600)),height);
 const body=paragraph('PRELUDE',0)
  +paragraph(hostText,tableFirst?1100+height:1100,tableFirst?child:'',tableFirst?'':child)
  +paragraph('TAIL',height+2200);
 const outer=table(10,[cell(0,body,height+3300)],height+3300);
 const section=`<hp:secPr id="0"><hp:pagePr width="30000" height="${pageHeight}" landscape="WIDELY"><hp:margin left="0" right="0" top="0" bottom="0" header="0" footer="0" gutter="0"/></hp:pagePr></hp:secPr>`;
 return mapHwpxMember(seed,'Contents/section0.xml',xml=>xml.replace(/(<hs:sec\b[^>]*>)[\s\S]*<\/hs:sec>/,'$1'+paragraph('',0,section+outer)+'</hs:sec>'));
}
