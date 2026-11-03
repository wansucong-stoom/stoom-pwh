import fs from 'node:fs/promises';
import {mapHwpxMember} from '../engine-source-ownership/hwpx-fixture-utils.mjs';
import {zipEntries} from '../../scripts/setup.mjs';
const seed=await fs.readFile(new URL('../fixtures/rowbreak-table/synthetic-rowbreak-single-line-control.hwpx',import.meta.url));

// Deliberately synthetic: a normal-size insertion run shares a tall stored
// line with an inline table. The line's object height is not its font height.
export function textLineCaretFixture({fontPoints=10,depth=0,text='  ',object=true,tall=true,vertical=false,objectXml}={}){
 const font=Math.round(fontPoints*100),tableHeight=6000, width=22000;
 const p=(text,pos=0,controls='',line=font,after='')=>`<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:t>${text}</hp:t>${controls}${after}</hp:run><hp:linesegarray><hp:lineseg textpos="0" vertpos="${pos}" vertsize="${line}" textheight="${line}" baseline="${Math.round(line*.85)}" spacing="600" horzpos="0" horzsize="${width}" flags="393216"/></hp:linesegarray></hp:p>`;
 const cell=(body,row=0,cols=1,h=tableHeight,col=0)=>`<hp:tc hasMargin="1" borderFillIDRef="1"><hp:subList textDirection="${vertical?'VERTICAL':'HORIZONTAL'}" lineWrap="BREAK" vertAlign="TOP">${body}</hp:subList><hp:cellAddr colAddr="${col}" rowAddr="${row}"/><hp:cellSpan colSpan="${cols}" rowSpan="1"/><hp:cellSz width="${width}" height="${h}"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/></hp:tc>`;
 const table=(body,id,rows=1,tac=false,h=tableHeight)=>`<hp:tbl id="${id}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" pageBreak="CELL" repeatHeader="0" noAdjust="1" rowCnt="${rows}" colCnt="1" cellSpacing="0" borderFillIDRef="1"><hp:sz width="${width}" height="${h}" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE"/><hp:pos treatAsChar="${tac?1:0}" affectLSpacing="0" flowWithText="1" allowOverlap="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="0" right="0" top="0" bottom="0"/>${body}</hp:tbl>`;
 const child=objectXml||table([0,1,2].map(i=>`<hp:tr>${cell(p('CHILD_'+i),i,1,2000)}</hp:tr>`).join(''),1,3,true);
 let host=p(text,0,object?child:'',tall?tableHeight:font);
 if(object){
  host=host.replace(`<hp:t>${text}</hp:t>`,`<hp:t>HOST<hp:lineBreak/>${text}</hp:t>`)
   .replace('<hp:linesegarray>','<hp:linesegarray>'+`<hp:lineseg textpos="0" vertpos="0" vertsize="${font}" textheight="${font}" baseline="${Math.round(font*.85)}" spacing="600" horzpos="0" horzsize="${width}" flags="393216"/>`)
   .replace(/(<hp:lineseg\b[^>]*textpos="0" vertpos="0" vertsize="6000")/,`<hp:lineseg textpos="5" vertpos="${font+600}" vertsize="6000"`);
 }
 for(let i=0;i<depth;i++){
  let wrapper=table(`<hp:tr>${cell(host,0,1,tableHeight+2000)}${cell(p('SIBLING_'+i),0,1,tableHeight+2000,1)}</hp:tr>`,i+2,1,false,tableHeight+2000)
   .replace('colCnt="1"','colCnt="2"').replace(`<hp:sz width="${width}"`,`<hp:sz width="${width*2}"`);
  host=p('',0,wrapper);
 }
 const section='<hp:secPr id="0"><hp:pagePr width="60000" height="40000" landscape="WIDELY"><hp:margin left="1000" right="1000" top="1000" bottom="1000" header="0" footer="0" gutter="0"/></hp:pagePr></hp:secPr>';
 let bytes=mapHwpxMember(seed,'Contents/section0.xml',xml=>xml.replace(/(<hs:sec\b[^>]*>)[\s\S]*<\/hs:sec>/,'$1'+p('',0,section)+host+'</hs:sec>'));
 bytes=mapHwpxMember(bytes,'Contents/header.xml',xml=>xml.replace(/(<hh:charPr\b[^>]*\bheight=")[^"]+/,`$1${font}`));
 return bytes;
}

export function textLinePictureCaretFixture(core,options={}){
 const base=textLineCaretFixture({...options,depth:0,object:false});
 const d=new core.HwpDocument(base);let material;
 try{
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=','base64');
  const result=JSON.parse(d.insertPicture(0,1,0,'[]',png,6000,6000,1,1,'png','Synthetic inline picture'));
  if(!result.ok)throw Error('picture fixture failed');material=d.exportHwpx();
 }finally{d.free()}
 const member=(bytes,name)=>zipEntries(Buffer.from(bytes)).find(e=>e.name===name).read().toString('utf8');
 const picture=member(material,'Contents/section0.xml').match(/<hp:pic\b[\s\S]*?<\/hp:pic>/)?.[0];
 if(!picture)throw Error('picture fixture control missing');
 const target=textLineCaretFixture({...options,object:true,objectXml:picture});
 return mapHwpxMember(material,'Contents/section0.xml',()=>member(target,'Contents/section0.xml'));
}
