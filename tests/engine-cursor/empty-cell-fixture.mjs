import fs from 'node:fs/promises';
import {mapHwpxMember} from '../engine-source-ownership/hwpx-fixture-utils.mjs';
import {zipEntries} from '../../scripts/setup.mjs';
const seed=await fs.readFile(new URL('../fixtures/rowbreak-table/synthetic-rowbreak-single-line-control.hwpx',import.meta.url));

export function emptyCellCaretFixture({fontPoints=10,empty=false,paragraphs=20,verticalAlign='TOP',nested=false,textDirection='HORIZONTAL',rightParagraphs=1}={}) {
 const font=Math.round(fontPoints*100),line=font+200,width=14000,height=paragraphs*line;
 const paragraph=(text,pos,controls='')=>`<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${controls}<hp:t>${text}</hp:t></hp:run><hp:linesegarray><hp:lineseg textpos="0" vertpos="${pos}" vertsize="${line}" textheight="${font}" baseline="${Math.round(font*.85)}" spacing="0" horzpos="0" horzsize="${width}" flags="393216"/></hp:linesegarray></hp:p>`;
 const cell=(col,body,w=width)=>`<hp:tc hasMargin="1" borderFillIDRef="1"><hp:subList textDirection="${textDirection}" lineWrap="BREAK" vertAlign="${verticalAlign}">${body}</hp:subList><hp:cellAddr colAddr="${col}" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${w}" height="${height}"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/></hp:tc>`;
 const table=(id,body,cols,w)=>`<hp:tbl id="${id}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" pageBreak="CELL" repeatHeader="0" noAdjust="1" rowCnt="1" colCnt="${cols}" cellSpacing="0" borderFillIDRef="1"><hp:sz width="${w}" height="${height}" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE"/><hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="0" right="0" top="0" bottom="0"/><hp:tr>${body}</hp:tr></hp:tbl>`;
 const left=Array.from({length:paragraphs},(_,i)=>paragraph(`LEFT_${i}`,i*line)).join('');
 const right=Array.from({length:rightParagraphs},(_,i)=>paragraph(empty?'':`RIGHT_${i}_END`,i*line)).join('');
 let object=table(10,cell(0,left)+cell(1,right),2,width*2);
 if(nested)object=table(20,cell(0,paragraph('',0,object),width*2),1,width*2);
 const section='<hp:secPr id="0"><hp:pagePr width="32000" height="9000" landscape="WIDELY"><hp:margin left="0" right="0" top="0" bottom="0" header="0" footer="0" gutter="0"/></hp:pagePr></hp:secPr>';
 let bytes=mapHwpxMember(seed,'Contents/section0.xml',xml=>xml.replace(/(<hs:sec\b[^>]*>)[\s\S]*<\/hs:sec>/,'$1'+paragraph('',0,section+object)+'</hs:sec>'));
 return mapHwpxMember(bytes,'Contents/header.xml',xml=>xml.replace(/(<hh:charPr\b[^>]*\bheight=")[^"]+/,`$1${font}`));
}

// Add a second, structurally identical section to prove that a page hint cannot
// borrow a same-index cell owned by another section. All contents are synthetic.
export function emptyCellCaretTwoSectionFixture() {
 const members = new Map(zipEntries(emptyCellCaretFixture({empty:true,paragraphs:3}))
   .map(entry => [entry.name,entry.read()]));
 const packageXml = members.get('Contents/content.hpf').toString('utf8')
   .replace('</opf:manifest>','<opf:item id="section1" href="Contents/section1.xml" media-type="application/xml"/></opf:manifest>')
   .replace('</opf:spine>','<opf:itemref idref="section1"/></opf:spine>');
 members.set('Contents/content.hpf',Buffer.from(packageXml));
 members.set('Contents/section1.xml',Buffer.from(members.get('Contents/section0.xml').toString('utf8').replace('height="9000"','height="18000"')));
 return storedZip(members);
}

function storedZip(members) {
 const chunks = [], central = [];
 let offset = 0, centralSize = 0;
 for (const [name,data] of members) {
  const file = Buffer.from(name), local = Buffer.alloc(30), record = Buffer.alloc(46);
  let crc = 0xffffffff;
  for (const byte of data) {
   crc ^= byte;
   for (let bit=0;bit<8;bit++) crc = (crc&1) ? 0xedb88320^(crc>>>1) : crc>>>1;
  }
  crc = (crc^0xffffffff)>>>0;
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt16LE(0x800,6);
  local.writeUInt32LE(crc,14); local.writeUInt32LE(data.length,18); local.writeUInt32LE(data.length,22); local.writeUInt16LE(file.length,26);
  record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20,4); record.writeUInt16LE(20,6); record.writeUInt16LE(0x800,8);
  record.writeUInt32LE(crc,16); record.writeUInt32LE(data.length,20); record.writeUInt32LE(data.length,24); record.writeUInt16LE(file.length,28); record.writeUInt32LE(offset,42);
  chunks.push(local,file,data); central.push(record,file);
  offset += local.length+file.length+data.length; centralSize += record.length+file.length;
 }
 const end = Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50); end.writeUInt16LE(members.size,8); end.writeUInt16LE(members.size,10); end.writeUInt32LE(centralSize,12); end.writeUInt32LE(offset,16);
 return Buffer.concat([...chunks,...central,end]);
}
