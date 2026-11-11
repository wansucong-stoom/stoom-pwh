import {mapHwpxMember} from '../engine-source-ownership/hwpx-fixture-utils.mjs';

export function inlineShapeSpacingFixture(HwpDocument,{height=3000,spacing=900,advance=height+spacing}={}) {
 const d=HwpDocument.createEmpty();d.createBlankDocument();
 try{
  const made=JSON.parse(d.createShapeControl(JSON.stringify({sectionIdx:0,paraIdx:0,charOffset:0,shapeType:'rectangle',width:22000,height,horzOffset:0,vertOffset:0,treatAsChar:true,textWrap:'TopAndBottom'})));if(!made.ok)throw Error('Synthetic shape creation failed');
  return mapHwpxMember(d.exportHwpx(),'Contents/section0.xml',xml=>{
   const shape=xml.match(/<hp:rect\b[\s\S]*?<\/hp:rect>/)?.[0];if(!shape)throw Error('Synthetic rectangle missing');
   const line=(pos,h,gap)=>`<hp:linesegarray><hp:lineseg textpos="0" vertpos="${pos}" vertsize="${h}" textheight="${h}" baseline="${Math.round(h*.85)}" spacing="${gap}" horzpos="0" horzsize="40000" flags="393216"/></hp:linesegarray>`;
   const para=(content,pos,h,gap)=>`<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0"><hp:run charPrIDRef="0">${content}</hp:run>${line(pos,h,gap)}</hp:p>`;
   const section='<hp:secPr id="0"><hp:pagePr width="50000" height="70000" landscape="WIDELY"><hp:margin left="2000" right="2000" top="2000" bottom="2000" header="0" footer="0" gutter="0"/></hp:pagePr></hp:secPr>';
   return xml.replace(/(<hs:sec\b[^>]*>)[\s\S]*<\/hs:sec>/,'$1'+para(section+shape+'<hp:t/>',0,height,spacing)+para('<hp:t>FOLLOWING_TITLE</hp:t>',advance,1000,600)+'</hs:sec>');
  });
 }finally{d.free();}
}
