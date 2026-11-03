import {forwardTailInlineFixture} from './stored-nested-forward-tail-fixture.mjs';
import {mapHwpxMember} from './hwpx-fixture-utils.mjs';
export const followupMarkers=Array.from({length:90},(_,i)=>'FOLLOWUP_'+String(i).padStart(3,'0'));
export function multiPageTailFixture({align='TOP',declaredHeight=180000,...options}={}){
 return mapHwpxMember(forwardTailInlineFixture(options),'Contents/section0.xml',xml=>{
  const marker=xml.indexOf('<hp:t>AFTER_TABLE</hp:t>'),end=xml.indexOf('</hp:p>',marker)+7;
  const extra=followupMarkers.map((text,i)=>'<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:t>'+text+'</hp:t></hp:run><hp:linesegarray><hp:lineseg textpos="0" vertpos="'+(19000+i*1600)+'" vertsize="1000" textheight="1000" baseline="850" spacing="600" horzpos="0" horzsize="21800" flags="393216"/></hp:linesegarray></hp:p>').join('');
  xml=xml.slice(0,end)+extra+xml.slice(end);
  const outerClose=xml.indexOf('</hp:subList>',end+extra.length);
  const szStart=xml.indexOf('<hp:cellSz',outerClose),szEnd=xml.indexOf('/>',szStart)+2;
  xml=xml.slice(0,szStart)+xml.slice(szStart,szEnd).replace(/height="\d+"/,'height="'+declaredHeight+'"')+xml.slice(szEnd);
  const lead=xml.indexOf('<hp:t>LEAD_0</hp:t>'),subStart=xml.lastIndexOf('<hp:subList',lead),subEnd=xml.indexOf('>',subStart)+1;
  return xml.slice(0,subStart)+xml.slice(subStart,subEnd).replace('vertAlign="TOP"','vertAlign="'+align+'"')+xml.slice(subEnd);
 });
}

