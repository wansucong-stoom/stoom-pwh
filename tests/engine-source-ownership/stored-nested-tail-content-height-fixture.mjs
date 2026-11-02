import {terminalRowFixture} from './stored-nested-tail-fixture.mjs';
import {mapHwpxMember} from './hwpx-fixture-utils.mjs';

// Independent declared row boxes and source line boxes agree. The original
// fixture's taller raw boxes alone were not sufficient to pin measured rows.
export function terminalRowContentHeightFixture(options={}){
 return mapHwpxMember(terminalRowFixture(options),'Contents/section0.xml',xml=>{
  const heights=[1000,1800,2300,1300,2000];
  for(let row=0;row<5;row++)for(let col=0;col<2;col++){
   const marker=xml.indexOf(`<hp:t>ROW_${row}_${col}</hp:t>`);if(marker<0)continue;
   const start=xml.lastIndexOf('<hp:p ',marker),end=xml.indexOf('</hp:p>',marker)+7;
   const paragraph=xml.slice(start,end).replace(/vertsize="\d+"/,`vertsize="${heights[row]}"`)
    .replace(/textheight="\d+"/,`textheight="${heights[row]}"`)
    .replace(/baseline="\d+"/,`baseline="${Math.round(heights[row]*.85)}"`);
   xml=xml.slice(0,start)+paragraph+xml.slice(end);
  }
  return xml;
 });
}
