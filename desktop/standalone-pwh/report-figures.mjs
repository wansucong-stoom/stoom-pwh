import {zipEntries} from '../release-source/scripts/setup.mjs';
import {writeZipMembers} from '../release-source/scripts/zip-writer.mjs';

const parse = JSON.parse;
const pngSignature = Buffer.from('89504e470d0a1a0a','hex');
const extensions = {'image/png':'png','image/jpeg':'jpg'};
const huPerMm = 7200/25.4;
const huPerPixel = 75;
const cropKeys = ['cropLeft','cropTop','cropRight','cropBottom'];

function pictureArgs(figure) {
 return [figure.section,figure.paragraph,JSON.stringify(figure.cellPath||[]),figure.controlIndex];
}

function properties(doc,figure) {
 const [section,paragraph,cellPath,index]=pictureArgs(figure);
 return parse(figure.cellPath?.length
  ?doc.getCellPicturePropertiesByPath(section,paragraph,cellPath,index)
  :doc.getPictureProperties(section,paragraph,index));
}

export function inventoryReportFigures(doc) {
 if(!parse(doc.getControls()).some(control=>control.ctrlId==='gso'))return [];
 const figures=[],seen=new Set();
 for(let page=0,count=doc.pageCount();page<count;page++){
  for(const item of parse(doc.getPageControlLayout(page)).controls){
   if(item.type!=='image'||item.headerFooter||item.noteRef||!Number.isSafeInteger(item.controlIdx))continue;
   const cellPath=item.cellPath?.length?item.cellPath:item.cellIdx===undefined?undefined:
    [{controlIndex:item.outerTableControlIdx,cellIndex:item.cellIdx,cellParaIndex:item.cellParaIdx}];
   const position={section:item.secIdx,paragraph:cellPath?item.parentParaIdx:item.paraIdx,cellPath,controlIndex:item.controlIdx};
   const args=pictureArgs(position),key=JSON.stringify(args);
   if(seen.has(key))continue;
   try{
    const info=properties(doc,position),mimeType=doc.getControlImageMime(...args);
    if(!info.width||!info.height||!mimeType)continue;
    seen.add(key);
    const context=[];
    for(const offset of [-1,0,1]){
     const index=position.paragraph+offset;
     if(index<0||index>=doc.getParagraphCount(position.section))continue;
     const text=doc.getTextRange(position.section,index,0,Math.min(doc.getParagraphLength(position.section,index),180)).replace(/\ufffc/g,'').trim();
     if(text)context.push(text);
    }
    figures.push({...position,id:'figure-'+(figures.length+1),page:page+1,mimeType,
     widthMm:Math.round(info.width/huPerMm*10)/10,heightMm:Math.round(info.height/huPerMm*10)/10,
     description:info.description?.slice(0,180)||'',nearbyText:context});
   }catch{
    // A rendered preview can also contain figures without editable body anchors.
   }
  }
 }
 return figures;
}

export function publicReportFigure({id,page,widthMm,heightMm,description,nearbyText,mimeType}) {
 return {id,page,widthMm,heightMm,description,nearbyText,mimeType,previewSupported:!!extensions[mimeType]};
}

export function reportFigureById(figures,id) {
 const figure=figures.find(item=>item.id===id);
 if(!figure)throw Error('양식 그림 번호를 확인하세요.');
 return figure;
}

export function readReportFigure(doc,figure) {
 if(!extensions[figure.mimeType])throw Error('이 그림 형식은 AI 미리보기를 지원하지 않습니다.');
 const bytes=Buffer.from(doc.getControlImageData(...pictureArgs(figure)));
 if(!bytes.length)throw Error('양식의 그림 데이터를 읽지 못했습니다.');
 return bytes;
}

function rasterDimensions(bytes,mimeType) {
 if(mimeType==='image/png'&&bytes.length>=24&&bytes.subarray(0,8).equals(pngSignature))
  return [bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
 if(mimeType==='image/jpeg'&&bytes.length>=2&&bytes.readUInt16BE(0)===0xffd8){
  const startsFrame=new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
  for(let at=2;at+4<bytes.length&&bytes[at++]===0xff;){
   while(bytes[at]===0xff)at++;
   const marker=bytes[at++];
   if(marker===0xda||marker===0xd9||at+2>bytes.length)break;
   const length=bytes.readUInt16BE(at);
   if(length<2||at+length>bytes.length)break;
   if(startsFrame.has(marker)&&length>=8)return [bytes.readUInt16BE(at+5),bytes.readUInt16BE(at+3)];
   at+=length;
  }
 }
 throw Error('참고 그림의 픽셀 크기를 확인하지 못했습니다.');
}

export function copyReportFigure(doc,figure) {
 const bytes=readReportFigure(doc,figure);
 const [width,height]=rasterDimensions(bytes,figure.mimeType);
 return {bytes,metadata:{width,height,extension:extensions[figure.mimeType]}};
}

export function replaceReportFigures(doc,replacements) {
 const updated=[];
 for(const {figure,image,description} of replacements){
  const args=pictureArgs(figure),[section,paragraph,cellPath,index]=args;
  const expected=properties(doc,figure);
  const {bytes,metadata:{width,height,extension}}=image;
  const result=parse(doc.assignPictureImage(...args,bytes,width,height,extension));
  if(!result.ok)throw Error('기존 그림을 교체하지 못했습니다.');
  const frameFitted=image.frameReferenceId===figure.id;
  const updates=frameFitted?{}:Object.fromEntries(cropKeys.map(key=>[key,expected[key]]));
  if(description!==undefined)updates.description=description;
  const change=JSON.stringify(updates);
  const applied=parse(figure.cellPath?.length?doc.setCellPicturePropertiesByPath(section,paragraph,cellPath,index,change)
   :doc.setPictureProperties(section,paragraph,index,change));
  if(!applied.ok)throw Error('교체한 그림의 자르기와 설명을 적용하지 못했습니다.');
  Object.assign(expected,updates);
  const readback=properties(doc,figure);
  if(frameFitted)for(const key of cropKeys){delete expected[key];delete readback[key];}
  if(JSON.stringify(readback)!==JSON.stringify(expected))throw Error('기존 그림의 틀을 보존하지 못했습니다.');
  updated.push({figure,bytes,properties:JSON.stringify(expected),
   ...(frameFitted?{fullFrame:{binDataId:result.binDataId,width,height}}:{})});
 }
 return updated;
}

export function verifyReportFigures(doc,figures) {
 if(!figures.length)return;
 const visible=new Set(inventoryReportFigures(doc).map(figure=>JSON.stringify(pictureArgs(figure))));
 for(const {figure,bytes,properties:expected,fullFrame} of figures){
  if(!visible.has(JSON.stringify(pictureArgs(figure))))throw Error('저장 후 페이지에 표시되는 그림을 확인하지 못했습니다.');
  if(expected){
   const readback=properties(doc,figure);
   if(fullFrame)for(const key of cropKeys)delete readback[key];
   if(JSON.stringify(readback)!==expected)throw Error('저장 후 그림의 틀을 확인하지 못했습니다.');
  }
  if(!Buffer.from(doc.getControlImageData(...pictureArgs(figure))).equals(bytes))throw Error('저장 후 조판된 그림을 확인하지 못했습니다.');
 }
}

export function fitReportPictureViewports(hwpx,frames) {
 if(!frames.length)return hwpx;
 const remaining=new Map(frames.map(({binDataId,width,height})=>{
  if(![binDataId,width,height].every(value=>Number.isSafeInteger(value)&&value>0&&value*huPerPixel<=0x7fffffff))
   throw Error('도식 그림의 저장 크기를 확인하지 못했습니다.');
  return ['image'+binDataId,[width*huPerPixel,height*huPerPixel]];
 }));
 if(remaining.size!==frames.length)throw Error('도식 그림의 저장 주소가 중복되었습니다.');
 // The HWPX writer emits these picture children consecutively. Identify the
 // newly assigned image by its manifest ID, even inside nested tables.
 const viewport=/<hp:imgClip\b[^>]*\/>(\s*<hp:inMargin\b[^>]*\/>\s*)<hp:imgDim\b[^>]*\/>(\s*<hc:img\b[^>]*\bbinaryItemIDRef="(image\d+)"[^>]*\/>)/g;
 let changed=false;
 const members=zipEntries(hwpx).map(entry=>{
  if(entry.name==='mimetype')return {name:entry.name,stored:true,bytes:entry.read()};
  const raw=entry.raw();
  if(!/^Contents\/section\d+\.xml$/.test(entry.name))return {name:entry.name,raw};
  const xml=entry.read().toString('utf8');
  const fitted=xml.replace(viewport,(unchanged,margin,image,id)=>{
   const size=remaining.get(id);
   if(!size)return unchanged;
   remaining.delete(id);
   const [width,height]=size;
   return '<hp:imgClip left="0" right="'+width+'" top="0" bottom="'+height+'"/>'+margin+
    '<hp:imgDim dimwidth="'+width+'" dimheight="'+height+'"/>'+image;
  });
  if(fitted===xml)return {name:entry.name,raw};
  changed=true;
  return {name:entry.name,bytes:Buffer.from(fitted,'utf8')};
 });
 if(remaining.size)throw Error('저장된 문서에서 새 도식의 그림 창을 확인하지 못했습니다.');
 if(!changed)return hwpx;
 return writeZipMembers(members);
}

export function insertReportFigure(doc,paragraph,part) {
 const {image,reference,description}=part;
 const {bytes,metadata:{width,height,extension}}=image;
 if(!width||!height)throw Error('그림 크기를 확인하세요.');
 const paper=parse(doc.getPageDef(0)),columns=parse(doc.getColumnDef(0));
 const columnCount=columns.columnCount||1;
 const widthLimit=Math.floor((paper.width-paper.marginLeft-paper.marginRight-(paper.marginGutter||0))/columnCount*0.88);
 const heightLimit=Math.floor((paper.height-paper.marginTop-paper.marginBottom-paper.marginHeader-paper.marginFooter)*0.82);
 const targetWidth=Math.min(reference?Math.round(reference.widthMm*huPerMm):widthLimit,widthLimit,Math.floor(heightLimit*width/height));
 const targetHeight=Math.max(1,Math.round(targetWidth*height/width));
 if(targetWidth<1)throw Error('그림을 배치할 본문 여백을 확인하세요.');
 const result=parse(doc.insertPicture(0,paragraph,0,'[]',bytes,targetWidth,targetHeight,width,height,extension,description));
 if(!result.ok)throw Error('초안에 그림을 삽입하지 못했습니다.');
 const {controlIdx:controlIndex}=result;
 const placed=parse(doc.setPictureProperties(0,paragraph,controlIndex,JSON.stringify({treatAsChar:true})));
 if(!placed.ok)throw Error('본문에 맞춰 그림을 배치하지 못했습니다.');
 return {figure:{section:0,paragraph,controlIndex},bytes};
}
