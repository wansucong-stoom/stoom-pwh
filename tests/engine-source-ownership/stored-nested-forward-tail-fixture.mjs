import {terminalRowLongTailFixture} from './stored-nested-tail-long-tail-fixture.mjs';
import {mapHwpxMember} from './hwpx-fixture-utils.mjs';

// Independent synthetic geometry. Four full rows close an opening 7200-HU
// frame. A one-column metadata declaration accompanies the next inline owner;
// its 4800+200 host band and cell padding expand a raw 2200-HU row to 5200.
// Together with the final 3000-HU row, the new tail closes at 8400, beyond its
// outer host's local 4800 origin. No institutional text or document IDs enter.
const paragraph=(text,height,control='',{columns=1,pageBreak=0}={})=>
 `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="${pageBreak}" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${control}<hp:t>${text}</hp:t></hp:run><hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="${height}" textheight="${height}" baseline="${Math.round(height*.85)}" spacing="600" horzpos="0" horzsize="9800" flags="393216"/></hp:linesegarray></hp:p>`;
const inlineTable=()=>`<hp:tbl id="930" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" pageBreak="CELL" repeatHeader="0" noAdjust="1" rowCnt="2" colCnt="1" cellSpacing="0" borderFillIDRef="1"><hp:sz width="9000" height="4800" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="100" right="100" top="100" bottom="100"/><hp:inMargin left="100" right="100" top="100" bottom="100"/>${['INLINE_A','INLINE_B'].map((text,row)=>`<hp:tr><hp:tc hasMargin="1" borderFillIDRef="1"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP">${paragraph(text,2200).replace('horzsize="9800"','horzsize="8800"')}</hp:subList><hp:cellAddr colAddr="0" rowAddr="${row}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="9000" height="2400"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/></hp:tc></hp:tr>`).join('')}</hp:tbl>`;
export function forwardTailInlineFixture({columns=1,pageBreak=0,successorDelta=0,ordinaryFlow=false,inlineBandDelta=0,stored=true}={}){
 const bytes=terminalRowLongTailFixture({frameHeight:7200,hostVpos:4800,tailHeight:3000,successorDelta:5200+successorDelta+(ordinaryFlow?12000:0),stored});
 return mapHwpxMember(bytes,'Contents/section0.xml',xml=>{
  const marker=xml.indexOf('<hp:t>ROW_4_0</hp:t>');if(marker<0)throw Error('Synthetic row marker missing');
  const start=xml.lastIndexOf('<hp:p ',marker),end=xml.indexOf('</hp:p>',marker)+7;
  const metadata=`<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="${columns}" sameSz="1" sameGap="0"/></hp:ctrl>`;
  const replacement=paragraph('',5000+inlineBandDelta,metadata+inlineTable(),{columns,pageBreak});
  return xml.slice(0,start)+replacement+xml.slice(end);
 });
}
