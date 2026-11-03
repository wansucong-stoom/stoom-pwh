import {forwardTailInlineFixture} from './stored-nested-forward-tail-fixture.mjs';
import {mapHwpxMember} from './hwpx-fixture-utils.mjs';
function span(xml,id){const start=xml.indexOf(`<hp:tbl id="${id}"`);if(start<0)throw Error('missing anonymous table');const tags=/<\/?hp:tbl\b[^>]*>/g;tags.lastIndex=start;let depth=0,m;while((m=tags.exec(xml))){depth+=m[0].startsWith('</')?-1:1;if(depth===0)return[start,tags.lastIndex];}throw Error('unclosed table');}
export function resumedMarginFixture({top=120,bottom=270,offset=0,mixedHost=false,successorDelta=0}={}){
 return mapHwpxMember(forwardTailInlineFixture({successorDelta}),'Contents/section0.xml',xml=>{
  let [start,end]=span(xml,100),child=xml.slice(start,end);
  // A complete large first row takes the first page. The next physical page
  // begins at row 1, whose nested source tail independently owns its last cut.
  const marker=child.indexOf('<hp:t>WRAPPER</hp:t>'),p0=child.lastIndexOf('<hp:p ',marker),p1=child.indexOf('</hp:p>',marker)+7;
  child=child.slice(0,p0)+child.slice(p0,p1).replace('vertsize="1000"','vertsize="19300"').replace('textheight="1000"','textheight="19300"').replace('baseline="850"','baseline="16405"')+child.slice(p1);
  const firstSz=child.indexOf('<hp:cellSz'),firstSzEnd=child.indexOf('/>',firstSz)+2;
  child=child.slice(0,firstSz)+child.slice(firstSz,firstSzEnd).replace(/height="\d+"/,'height="19500"')+child.slice(firstSzEnd);
  child=child.replace(/(<hp:outMargin[^>]*top=")[^"]*(" bottom=")[^"]*/,'$1'+top+'$2'+bottom)
    .replace('vertOffset="0"','vertOffset="'+offset+'"');
  const host=`<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${child}<hp:t>${mixedHost?'HOST':''}</hp:t></hp:run><hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000" textheight="1000" baseline="850" spacing="600" horzpos="0" horzsize="${mixedHost?21800:0}" flags="393216"/></hp:linesegarray></hp:p>`;
  const outer=`<hp:tbl id="900" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" pageBreak="CELL" repeatHeader="0" noAdjust="1" rowCnt="2" colCnt="1" cellSpacing="0" borderFillIDRef="1"><hp:sz width="24000" height="80000" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE"/><hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="100" right="100" top="100" bottom="100"/><hp:tr><hp:tc hasMargin="1" borderFillIDRef="1"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP"><hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:t>OUTER_HEADER</hp:t></hp:run><hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="800" textheight="800" baseline="680" spacing="0" horzpos="0" horzsize="23800" flags="393216"/></hp:linesegarray></hp:p></hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="24000" height="1000"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/></hp:tc></hp:tr><hp:tr><hp:tc hasMargin="1" borderFillIDRef="1"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP">${host}</hp:subList><hp:cellAddr colAddr="0" rowAddr="1"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="24000" height="80000"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/></hp:tc></hp:tr></hp:tbl>`;
  return xml.slice(0,start)+outer+xml.slice(end);
 });
}
