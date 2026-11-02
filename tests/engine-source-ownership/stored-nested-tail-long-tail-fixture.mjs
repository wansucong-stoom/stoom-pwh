import {terminalRowSourceWidthFixture} from './stored-nested-tail-source-width-fixture.mjs';
import {mapHwpxMember} from './hwpx-fixture-utils.mjs';
// The continuation owner fits a fresh page but makes the whole containing row
// too tall to bypass its source cuts. This is independent of the child frame.
export function terminalRowLongTailFixture(options={}){
 return mapHwpxMember(terminalRowSourceWidthFixture(options),'Contents/section0.xml',xml=>{
  const marker=xml.indexOf('<hp:t>AFTER_TABLE</hp:t>'),start=xml.lastIndexOf('<hp:p ',marker),end=xml.indexOf('</hp:p>',marker)+7;
  const para=xml.slice(start,end).replace(/vertsize="\d+"/,'vertsize="10000"').replace(/textheight="\d+"/,'textheight="10000"').replace(/baseline="\d+"/,'baseline="8500"');
  return xml.slice(0,start)+para+xml.slice(end);
 });
}
