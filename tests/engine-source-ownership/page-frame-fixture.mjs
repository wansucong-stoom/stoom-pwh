import fs from 'node:fs/promises';
import {zipEntries} from '../../scripts/setup.mjs';
import {mapHwpxMember} from './hwpx-fixture-utils.mjs';
import {textLinePictureCaretFixture} from '../engine-cursor/text-line-caret-fixture.mjs';

// Exercise native XML import, independently of the HWP5-export compatibility marker.
const seed=mapHwpxMember(await fs.readFile(new URL('../fixtures/rowbreak-table/synthetic-rowbreak-single-line-control.hwpx',import.meta.url)),
 'META-INF/rhwp-hwp5-origin',()=>null);
const ns=' xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"';
export const segment=(y,pos=0,{width=48188,height=1100,spacing=880}={})=>`<hp:lineseg textpos="${pos}" vertpos="${y}" vertsize="${height}" textheight="${height}" baseline="${Math.round(height*.85)}" spacing="${spacing}" horzpos="0" horzsize="${width}" flags="393216"/>`;
export const paragraph=(text,y,control='',{lines,style=0}={})=>`<hp:p id="0" paraPrIDRef="${style}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${control}<hp:t>${text}</hp:t></hp:run>${y===null?'':`<hp:linesegarray>${lines??segment(y)}</hp:linesegarray>`}</hp:p>`;
const paper=(height=84186)=>`<hp:secPr id="0"><hp:pagePr width="59528" height="${height}" landscape="WIDELY"><hp:margin left="5670" right="5670" top="5670" bottom="5670" header="0" footer="0" gutter="0"/></hp:pagePr></hp:secPr>`;
const member=(bytes,name)=>zipEntries(bytes).find(e=>e.name===name).read().toString('utf8');
function section(bytes,body){return mapHwpxMember(bytes,'Contents/section0.xml',xml=>xml.replace(/(<hs:sec\b[^>]*>)[\s\S]*<\/hs:sec>/,'$1'+body+'</hs:sec>').replace(/<hs:sec\b[^>]*>/,tag=>tag.includes('xmlns:hc=')?tag:tag.slice(0,-1)+ns+'>'));}
function fontSize(bytes,height=1100){return mapHwpxMember(bytes,'Contents/header.xml',xml=>xml.replace(/(<hh:charPr\b[^>]*\bid="0"[^>]*\bheight=")[^"]+/,'$1'+height));}

export function centeredWrapFixture({spaces=1,alignment='CENTER',underline=false}={}){
 const first='CENTERED SAMPLE'+' '.repeat(spaces),second='SECOND LINE';
 let bytes=fontSize(seed,2400);
 bytes=mapHwpxMember(bytes,'Contents/header.xml',xml=>xml.replace(/<hh:paraPr\b[^>]*\bid="0"[\s\S]*?<\/hh:paraPr>/,p=>p.replace(/horizontal="[^"]+"/,'horizontal="'+alignment+'"')));
 if(underline)bytes=mapHwpxMember(bytes,'Contents/header.xml',xml=>xml.replace(/<hh:charPr\b[^>]*\bid="0"[\s\S]*?<\/hh:charPr>/,p=>{
  const tag='<hh:underline type="BOTTOM" shape="SOLID" color="#000000"/>';
  return p.includes('<hh:underline')?p.replace(/<hh:underline\b[^>]*(?:\/>|>[\s\S]*?<\/hh:underline>)/,tag):p.replace('</hh:charPr>',tag+'</hh:charPr>');
 }));
 return section(bytes,paragraph('',0,paper())+paragraph(first+second,1980,'',{lines:segment(1980,0,{height:2400,spacing:1440})+segment(5820,first.length,{height:2400,spacing:1440})}));
}

export function resetBlockTableFixture({hostWidth=0,reset=0,flow=true,relativeTo='PARA',guide=false}={}){
 const rows=6,height=15213;
 const table=`<hp:tbl id="7" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" pageBreak="CELL" repeatHeader="1" rowCnt="${rows}" colCnt="1" cellSpacing="0" borderFillIDRef="1"><hp:sz width="47000" height="${height}" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE"/><hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="${Number(flow)}" allowOverlap="0" vertRelTo="${relativeTo}" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="141" right="141" top="141" bottom="141"/><hp:inMargin left="100" right="100" top="100" bottom="100"/>${Array.from({length:rows},(_,row)=>`<hp:tr><hp:tc hasMargin="1" borderFillIDRef="1"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP">${paragraph('CELL_'+row,0)}</hp:subList><hp:cellAddr colAddr="0" rowAddr="${row}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="47000" height="${Math.floor(height/rows)}"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/></hp:tc></hp:tr>`).join('')}</hp:tbl>`;
 const lead=Array.from({length:36},(_,i)=>paragraph(i>=34?'':'BEFORE_'+i,i===0?null:i*1980,i===0?paper():'')).join('');
 const host=reset+(guide?2080:0);
 return section(fontSize(seed),lead+(guide?paragraph('HEADING',reset):'')+paragraph('',host,table,{lines:segment(host,0,{width:hostWidth})})+paragraph('',host+15495)+paragraph('AFTER_TABLE',host+17475));
}

export function deferredBodyPictureFixture(core,{caption=true,offset=0,relativeTo='PARA',overlap=false,closed=true}={}){
 let bytes=textLinePictureCaretFixture(core);
 let picture=member(bytes,'Contents/section0.xml').match(/<hp:pic\b[\s\S]*?<\/hp:pic>/)[0]
  .replace(/treatAsChar="\d"/,'treatAsChar="0"').replace(/flowWithText="\d"/,'flowWithText="1"')
  .replace(/allowOverlap="\d"/,'allowOverlap="'+Number(overlap)+'"').replace(/textWrap="[^"]+"/,'textWrap="TOP_AND_BOTTOM"')
  .replace(/vertRelTo="[^"]+"/,'vertRelTo="'+relativeTo+'"').replace(/horzRelTo="[^"]+"/,'horzRelTo="COLUMN"')
  .replace(/vertOffset="[^"]+"/,'vertOffset="'+offset+'"').replace(/(<hp:sz\b[^>]*\bheight=")[^"]+/,(_,prefix)=>prefix+'32155')
  .replace(/<hp:outMargin\b[^>]*\/>/,'<hp:outMargin left="1133" right="1133" top="1133" bottom="1133"/>');
 if(caption)picture=picture.replace('</hp:pic>','<hp:caption side="BOTTOM" fullSz="0" width="48190" gap="850" lastWidth="48190"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP">'+paragraph('CAPTION',0)+'</hp:subList></hp:caption></hp:pic>');
 const bodyOrigin=32155+2266+(caption?1950:0)+(closed?0:500);
 const lead=Array.from({length:22},(_,i)=>paragraph('BEFORE_'+i,i*1980,i===0?paper():'')).join('');
 const hostText='HOST FIRST HOST LAST',host=paragraph(hostText,43560,picture,{lines:segment(43560,0)+segment(45540,11)});
 const bridge=paragraph('HEADING',47520);
 const prefix='SPLIT A SPLIT B SPLIT C SPLIT D ';
 const lines=[49500,51480,53460,55440,bodyOrigin,bodyOrigin+1980].map((y,i)=>segment(y,[0,8,16,24,prefix.length,prefix.length+8][i])).join('');
 return section(fontSize(mapHwpxMember(bytes,'META-INF/rhwp-hwp5-origin',()=>null)),lead+host+bridge+paragraph(prefix+'RESUMED TEXT END',49500,'',{lines})+paragraph('AFTER_PICTURE',bodyOrigin+3960));
}

export function leadingTableTextFixture({overlap=false,closed=true,pageBreak=true,height=11994,margin=1133,hostLines=2}={}){
 const source=member(resetBlockTableFixture(),'Contents/section0.xml');
 const table=source.match(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/)[0]
  .replace('height="15213"','height="'+height+'"').replaceAll('height="2535"','height="'+Math.floor(height/6)+'"')
  .replace('<hp:outMargin left="141" right="141" top="141" bottom="141"/>',`<hp:outMargin left="${margin}" right="${margin}" top="${margin}" bottom="${margin}"/>`)
  .replace('allowOverlap="0"','allowOverlap="'+Number(overlap)+'"');
 const origin=height+2*margin,texts=Array.from({length:hostLines},(_,i)=>'HOST_LINE_'+i+' ');
 const host=paragraph(texts.join(''),origin,table,{lines:texts.map((_,i)=>segment(origin+i*1980,texts.slice(0,i).join('').length)).join('')}).replace('pageBreak="0"','pageBreak="'+Number(pageBreak)+'"');
 const lead=paragraph('BEFORE_TABLE',null,paper());
 const next=origin+1980*hostLines+(closed?0:500);
 const tail=Array.from({length:Math.floor((71000-next)/1980)+1},(_,i)=>paragraph('AFTER_'+i,next+i*1980)).join('');
 return section(fontSize(seed),lead+host+tail);
}

export function standalonePicturePageFixture(core,{overlap=false,nextBreak=true,continuous=true}={}){
 let bytes=textLinePictureCaretFixture(core);
 const pic=member(bytes,'Contents/section0.xml').match(/<hp:pic\b[\s\S]*?<\/hp:pic>/)[0]
  .replace(/treatAsChar="\d"/,'treatAsChar="0"').replace(/flowWithText="\d"/,'flowWithText="1"')
  .replace(/allowOverlap="\d"/,'allowOverlap="'+Number(overlap)+'"').replace(/textWrap="[^"]+"/,'textWrap="TOP_AND_BOTTOM"')
  .replace(/vertRelTo="[^"]+"/,'vertRelTo="PARA"').replace(/horzRelTo="[^"]+"/,'horzRelTo="COLUMN"')
  .replace(/vertOffset="[^"]+"/,'vertOffset="0"').replace(/(<hp:sz\b[^>]*\bheight=")[^"]+/,(_,p)=>p+'32153')
  .replace(/(<hp:sz\b[^>]*\bwidth=")[^"]+/,(_,p)=>p+'48190')
  .replace(/<hp:outMargin\b[^>]*\/>/,'<hp:outMargin left="0" right="0" top="0" bottom="0"/>');
 const lead=Array.from({length:22},(_,i)=>paragraph('BEFORE_'+i,i===0?null:i*1980,i===0?paper():'')).join('');
 const host=paragraph('',43560+(continuous?0:500),pic);
 const next=paragraph('AFTER_EXPLICIT_BREAK',0).replace('pageBreak="0"','pageBreak="'+Number(nextBreak)+'"');
 return section(fontSize(mapHwpxMember(bytes,'META-INF/rhwp-hwp5-origin',()=>null)),lead+host+next);
}
