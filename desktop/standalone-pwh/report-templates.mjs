import {promises as fs} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import config from '../release-source/src/config.mjs';
import {styleScanSources,prepareReportFill,applyTextEdits} from '../release-source/src/text-edit.mjs';
import {convertHwp} from './convert-hwp.mjs';
import {inspectBodyFlow,newBodyOverflows,reflowBody} from './desktop-body-style.mjs';
import {prepareOutlineLocations,outlineWritingLayout,applyOutlineDraft} from './report-outline.mjs';
import {copyReportFigure,fitReportPictureViewports,insertReportFigure,inventoryReportFigures,publicReportFigure,readReportFigure,replaceReportFigures,reportFigureById,verifyReportFigures} from './report-figures.mjs';

const limit=256*1024*1024;
const idPattern=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const escapeHtml=value=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',[String.fromCharCode(39)]:'&#39;'}[char]));
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const analysisVersion=6;
const borderSides=['borderLeft','borderRight','borderTop','borderBottom'];
const checked=value=>{const result=parse(value);if(result?.ok===false||result?.error)throw Error(result.error||'보고서 양식을 준비하지 못했습니다.');};
let loadedCore;
async function loadCore(){
 if(!loadedCore)loadedCore=(async()=>{
  const root=path.join(config.runtimeRoot,'core');
  const core=await import(pathToFileURL(path.join(root,'rhwp.js')).href);
  await core.default({module_or_path:await fs.readFile(path.join(root,'rhwp_bg.wasm'))});
  return core;
 })().catch(error=>{loadedCore=null;throw error;});
 return loadedCore;
}
function label(value,maximum){
 if(typeof value!=='string')return '';
 return value.normalize('NFC').trim().replace(/[\u0000-\u001f<>]/g,'').slice(0,maximum);
}
function paragraphText(doc,source){
 const {section,paragraph,cellPath}=source,p=cellPath&&JSON.stringify(cellPath);
 const length=p?doc.getCellParagraphLengthByPath(section,paragraph,p):doc.getParagraphLength(section,paragraph);
 return p?doc.getTextInCellByPath(section,paragraph,p,0,length):doc.getTextRange(section,paragraph,0,length);
}
function readFormatting(doc,source){
 const {section,paragraph,cellPath}=source,p=cellPath&&JSON.stringify(cellPath);
 const chars=parse(p?doc.getCellCharPropertiesAtByPath(section,paragraph,p,0):doc.getCharPropertiesAt(section,paragraph,0));
 const para=parse(p?doc.getCellParaPropertiesAtByPath(section,paragraph,p):doc.getParaPropertiesAt(section,paragraph));
 const named=p?null:parse(doc.getStyleAt(section,paragraph))?.name;
 const take=(value,keys)=>Object.fromEntries(keys.filter(key=>value?.[key]!==undefined).map(key=>[key,value[key]]));
 return {
  named,
  characters:take(chars,['fontFamily','fontFamilies','fontSize','textColor','bold','italic','underlineType','underlineShape','underlineColor','strikethrough','strikeShape','strikeColor','ratios','spacings','relativeSizes','charOffsets','kerning']),
  paragraph:take(para,['alignment','lineSpacing','lineSpacingType','marginLeft','marginRight','indent','spacingBefore','spacingAfter','headType','paraLevel','widowOrphan','keepWithNext','keepLines','fontLineHeight','englishBreakUnit','koreanBreakUnit']),
 };
}
function captureDecorativeTable(doc,source,dims){
 const {section,paragraph,cellPath}=source,controlIndex=cellPath[0].controlIndex;
 if(cellPath.length!==1||!(dims.rowCount===1&&dims.colCount>=2&&dims.colCount<=4||dims.rowCount===3&&dims.colCount===1))return null;
 const cells=Array.from({length:dims.cellCount},(_,cellIndex)=>{
  const pos={section,paragraph,cellPath:[{controlIndex,cellIndex,cellParaIndex:0}]};
  const props=parse(doc.getCellOwnProperties(section,paragraph,controlIndex,cellIndex));
  return {source:pos,text:paragraphText(doc,pos).trim(),format:readFormatting(doc,pos),width:props.width,height:props.height,
   fill:props.fillType==='solid'?props.fillColor:null,borders:Object.fromEntries(borderSides.map(side=>[side,props[side]])),
   padding:Object.fromEntries(['paddingLeft','paddingRight','paddingTop','paddingBottom'].map(key=>[key,props[key]]))};
 });
 const [first,...remaining]=cells,nonempty=remaining.filter(cell=>cell.text);
 if(dims.rowCount===1&&/^\d{1,3}$/.test(first.text)&&nonempty.length===1&&nonempty[0].text.length<=72&&nonempty[0].format.characters.bold&&
  (first.fill||nonempty[0].borders.borderBottom?.type)){
  return {kind:'heading',source:nonempty[0].source,text:nonempty[0].text,number:first.text,columns:dims.colCount,cells};
 }
 if(dims.colCount===1&&cells[1]?.text&&cells[1].format.characters.bold&&!first.text&&!cells[2]?.text&&first.fill&&cells[2]?.fill){
  return {kind:'cover',source:cells[1].source,text:cells[1].text,columns:1,cells};
 }
 return null;
}
function outlineAddress(source){return source.section+':'+source.paragraph;}

function readReportStructure(doc,body,tables,tableLabel,decorativeTables){
 const pages=Array.from({length:Math.min(32,doc.getSectionCount())},(_,section)=>({
  paper:parse(doc.getPageDef(section)),columns:parse(doc.getColumnDef(section)),
 }));
 const bodyFormats=new Map();
 for(const {text,format,source} of body){
  if(source.cellPath||format.characters.bold&&text.length<72&&!text.startsWith('{{'))continue;
  const key=JSON.stringify(format),sample=bodyFormats.get(key)||{format,weight:0};
  sample.weight+=Math.min(text.length,100);
  bodyFormats.set(key,sample);
 }
 const bodyFormat=[...bodyFormats.values()].sort((a,b)=>b.weight-a.weight)[0]?.format||body.at(-1)?.format;
 const base=bodyFormat?.characters.fontSize||1000;
 const candidates=body.filter(({text,format})=>{
  const {named,characters,paragraph}=format;
  return text.length<=70&&!text.includes('{{')&&(/제목|개요\s*\d|heading|^title$/i.test(named||'')||
   paragraph.headType==='Outline'||characters.bold&&characters.fontSize>=base+150);
 });
 const title=candidates.find(({source,format})=>source.section===0&&(source.paragraph===0||/제목|^title$/i.test(format.named||''))&&format.characters.fontSize>=base)
  ||candidates.find(({source,format})=>source.section===0&&format.characters.fontSize>=base+150);
 const headings=candidates.filter(item=>item!==title).slice(0,32);
 const sizes=[...new Set(headings.map(item=>item.format.characters.fontSize))].sort((left,right)=>right-left);
 const headingsByLevel={};
 const outline=headings.map(({text,source,format})=>{
  const named=/(?:heading|제목|개요)\s*([1-9])/i.exec(format.named||'');
  const level=Math.min(3,format.paragraph.headType==='Outline'?1+(format.paragraph.paraLevel||0)
   :named?Number(named[1]):1+sizes.indexOf(format.characters.fontSize));
  headingsByLevel[level]??=format;
  return {text,source,level};
 });
 const decorative=[...decorativeTables.values()].filter(Boolean);
 const cover=decorative.find(item=>item.kind==='cover'&&item.source.section===0);
 const banners=decorative.filter(item=>item.kind==='heading');
 const banner=banners[0];
 let coverMetrics;
 if(cover){
  const page=parse(doc.getPageRenderTree(0)).children.find(node=>node.type==='Body');
  const blocks=page?.children.flatMap(column=>column.children||[])||[];
  const frame=blocks.find(block=>block.type==='Table'&&block.pi===cover.source.paragraph);
  if(frame){
   const separatePage=doc.pageCount()>1&&!!banner&&!blocks.some(block=>block.type==='Table'&&block.pi===banner.source.paragraph);
   // Paragraph spacing uses twice the geometry units of a table position.
   coverMetrics={topInset:Math.max(0,Math.round((frame.bbox.y-page.bbox.y)*150)),separatePage};
  }
 }
 const seenHeadings=new Set(outline.map(item=>outlineAddress(item.source)));
 for(const {source,text} of banners)if(!seenHeadings.has(outlineAddress(source)))outline.push({source,text,level:1});
 outline.sort((a,b)=>a.source.section-b.source.section||a.source.paragraph-b.source.paragraph);
 const note=body.find(item=>/캡션|주석|각주|caption|note/i.test(item.format.named||''));
 return {pages,tables:[...tables.values()].slice(0,48),headings:outline,
  title:cover?{text:cover.text,source:cover.source}:title?{text:title.text,source:title.source}:null,
  styles:{title:cover?.cells[1].format||title?.format,heading:banner?.cells.find(cell=>cell.text===banner.text)?.format||headingsByLevel[1],headingsByLevel,body:bodyFormat,note:note?.format},
  decorations:{cover:cover?{columns:cover.columns,...coverMetrics,cells:cover.cells.map(({source,text,...style})=>style)}:null,heading:banner?{columns:banner.columns,headingColumn:banner.cells.findIndex(cell=>cell.text===banner.text),cells:banner.cells.map(({source,text,...style})=>style)}:null},formTable:tableLabel||null,
  figures:inventoryReportFigures(doc)};
}
function boundedFields(fields){
 return fields.slice(0,64).map(({name,marker,source})=>({name,marker,section:source?.section,paragraph:source?.paragraph,cell:source?.cellPath?.at(-1)?.cellIndex}));
}
function formTableStyle(doc,source,info,dims){
 const p=source.cellPath,last=p.at(-1);
 const own=(index)=>parse(doc.getCellOwnPropertiesByPath(source.section,source.paragraph,JSON.stringify(p),index));
 const label=own(last.cellIndex);
 const capture=props=>({
  sides:Object.fromEntries(borderSides.filter(side=>props?.[side]).map(side=>[side,props[side]])),
  ...(props?.fillType==='solid'&&/^#[0-9a-f]{6}$/i.test(props.fillColor)?{fill:props.fillColor}:{}),
 });
 const style={label:capture(label),format:readFormatting(doc,source),pairsPerRow:1};
 if(p.length!==1)return style;
 const row=[];
 for(let index=last.cellIndex;index<Math.min(dims.cellCount,last.cellIndex+4);index++){
  const cell=parse(doc.getCellInfo(source.section,source.paragraph,last.controlIndex,index));
  if(cell.row!==info.row||cell.colSpan!==1||cell.rowSpan!==1)break;
  row.push(own(index));
 }
 if(row.length>=2){
  style.value=capture(row[1]);
  const valuePath=[{...last,cellIndex:last.cellIndex+1}];
  style.value.format=readFormatting(doc,{...source,cellPath:valuePath});
 }
 if(row.length===dims.colCount&&row.every(cell=>cell?.width>0)){
  const shade=cell=>cell?.fillType==='solid'?cell.fillColor:null;
  const paired=row.length===4&&shade(row[0])!==shade(row[1])&&shade(row[0])===shade(row[2])&&shade(row[1])===shade(row[3]);
  if(paired)style.pairsPerRow=2;
  if(paired||row.length===2)style.widths=row.map(cell=>cell.width);
 }
 return style;
}
export function analyzeReportTemplate(doc){
 const {sources,unsupported}=styleScanSources(doc,'document'),explicit=new Map(),tables=new Map(),tableSizes=new Map(),decorativeTables=new Map(),body=[];
 let tableLabel;
 const controls=new Set(parse(doc.getControls()).map(control=>JSON.stringify([control.list,control.para])));
 const hostKey=(list,section,paragraph,control,cell)=>JSON.stringify([list,section,paragraph,control,cell]);
 const hosts=new Map(parse(doc.getCursorModel()).lists.filter(list=>list.isCell).map(list=>[hostKey(list.hostListId,list.sectionIndex,list.hostPara,list.controlIndex,list.cellIndex),list.listId]));
 function containsCellControl(source){
  let list=0,paragraph=source.paragraph;
  for(const part of source.cellPath){
   list=hosts.get(hostKey(list,source.section,paragraph,part.controlIndex,part.cellIndex));
   if(list===undefined)return true;
   paragraph=part.cellParaIndex;
  }
  return controls.has(JSON.stringify([list,paragraph]));
 }
 for(const source of sources){
  const value=paragraphText(doc,source);
  if(!source.cellPath&&value.trim()&&body.length<256)body.push({text:value.trim(),source,format:readFormatting(doc,source)});
  for(const match of value.matchAll(/\{\{([^{}\r\n]{1,64})\}\}/g)){
   if(!explicit.has(match[0]))explicit.set(match[0],{name:label(match[1],64),marker:match[0],source,explicit:true});
  }
  const p=source.cellPath,last=p?.at(-1);
  if(!last||last.cellParaIndex!==0)continue;
  const tableKey=JSON.stringify([source.section,source.paragraph,p.slice(0,-1),last.controlIndex]);
  let dims=tableSizes.get(tableKey);
  if(!dims){dims=parse(doc.getTableDimensionsByPath(source.section,source.paragraph,JSON.stringify(p)));tableSizes.set(tableKey,{rows:dims.rowCount,columns:dims.colCount,depth:p.length});}
  else dims={colCount:dims.columns,rowCount:dims.rows};
  const info=parse(doc.getCellInfoByPath(source.section,source.paragraph,JSON.stringify(p)));
  if(!decorativeTables.has(tableKey))decorativeTables.set(tableKey,captureDecorativeTable(doc,source,dims));
  if(!tableLabel&&!decorativeTables.get(tableKey)&&info&&dims.colCount>=2&&info.col===0&&label(value,64)&&value.trim().length<=40&&!containsCellControl(source)){
   tableLabel=formTableStyle(doc,source,info,dims);
  }
  if(!info||info.rowSpan!==1||info.colSpan!==1||![0,1].includes(info.col))continue;
  if(dims.colCount===1&&dims.rowCount===1&&value.trim()&&value.trim().length<=70&&body.length<256)body.push({text:value.trim(),source,format:readFormatting(doc,source)});
  if(dims.colCount!==2||containsCellControl(source)||doc.getCellParagraphCountByPath(source.section,source.paragraph,JSON.stringify(p))!==1)continue;
  const row=JSON.stringify([source.section,source.paragraph,p.slice(0,-1),last.controlIndex,info.row]);
  const cells=tables.get(row)||[];
  cells[info.col]={value,source};
  tables.set(row,cells);
 }
 const blanks=[],used=new Set(explicit.keys());
 for(const [left,right] of tables.values()){
  const caption=label(left?.value,64);
  if(right?.value!==''||!caption||caption.length>48||/[{}]/.test(caption))continue;
  let name=caption,next=2;
  while(used.has('{{'+name+'}}')){name=caption+' ('+next+')';next++;}
  const marker='{{'+name+'}}';
  used.add(marker);blanks.push({name,marker,source:right.source});
 }
 const fields=[...explicit.values(),...blanks];
 return {version:analysisVersion,sections:doc.getSectionCount(),paragraphs:sources.length,fields:fields.slice(0,64).map(field=>({...field,format:readFormatting(doc,field.source)})),structure:readReportStructure(doc,body,tableSizes,tableLabel,decorativeTables),limited:fields.length>64||unsupported.length>0||tableSizes.size>48||doc.getSectionCount()>32};
}
function addBlankMarkers(doc,fields){
 for(const {source,marker,explicit} of fields){
  if(!source||explicit)continue;
  if(paragraphText(doc,source)!=='')throw Error('등록한 양식의 빈 입력 칸이 변경되었습니다.');
  const {section,paragraph,cellPath}=source;
  checked(doc.insertTextInCellByPath(section,paragraph,JSON.stringify(cellPath),0,marker));
 }
}
function applyFormatting(doc,source,format,includeEmptyCell=false){
 if(!format)return;
 const {fontFamily,fontFamilies,...characters}=format.characters;
 const {headType,paraLevel,...paragraph}=format.paragraph,p=source.cellPath&&JSON.stringify(source.cellPath);
 const length=Array.from(paragraphText(doc,source)).length;
 if(fontFamily||fontFamilies?.length===7)characters.fontIds=Array.from({length:7},(_,lang)=>doc.findOrCreateFontIdForLang(lang,fontFamilies?.[lang]||fontFamily));
 if((length||includeEmptyCell&&p)&&Object.keys(characters).length)checked(p
  ?doc.applyCharFormatInCellByPath(source.section,source.paragraph,p,0,length,JSON.stringify(characters))
  :doc.applyCharFormat(source.section,source.paragraph,0,length,JSON.stringify(characters)));
 if(Object.keys(paragraph).length)checked(p
  ?doc.applyParaFormatInCellByPath(source.section,source.paragraph,p,JSON.stringify(paragraph))
  :doc.applyParaFormat(source.section,source.paragraph,JSON.stringify(paragraph)));
}
function createStyledDraft(HwpDocument,structure,compose){
 const doc=HwpDocument.createEmpty();
 try{
  doc.createBlankDocument();
  const first=structure?.pages[0];
  if(first?.paper)checked(doc.setPageDef(0,JSON.stringify(first.paper)));
  if(first?.columns?.sameWidth&&first.columns.columnCount>1)checked(doc.setColumnDef(0,first.columns.columnCount,first.columns.columnType,1,first.columns.spacing));
  return compose(doc,structure?.styles||{});
 }finally{doc.free();}
}
async function readRegular(file){
 const stat=await fs.lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size<8||stat.size>limit)throw Error('256MiB 이하의 일반 HWP·HWPX 양식을 선택하세요.');
 return fs.readFile(file);
}
async function cleanFiles(directory,files){
 for(const name of files)await fs.unlink(path.join(directory,name)).catch(()=>{});
 await fs.rmdir(directory).catch(()=>{});
}

export function createReportTemplateLibrary(dataRoot){
 const directory=path.join(dataRoot,'report-templates'),draftRoot=path.join(dataRoot,'documents');
 async function read(id){
  if(typeof id!=='string'||!idPattern.test(id))throw Error('등록된 양식을 선택하세요.');
  const dir=path.join(directory,id);
  const stat=await fs.lstat(dir);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('등록한 양식을 읽을 수 없습니다.');
  const metadata=JSON.parse(await readRegular(path.join(dir,'template.json')));
  if(metadata.version!==1||metadata.id!==id||!metadata.name||!metadata.organization||!Array.isArray(metadata.analysis?.fields))throw Error('등록한 양식 정보가 올바르지 않습니다.');
  return {...metadata,source:path.join(dir,'template.hwpx')};
 }
 const overview=entry=>({id:entry.id,name:entry.name,organization:entry.organization,fields:entry.analysis.fields.map(field=>field.name),limited:entry.analysis?.limited||false,sections:entry.analysis?.sections??1,tables:entry.analysis?.structure?.tables.length??1});
 return {
  async list(){
   let entries=[];
   try{entries=await fs.readdir(directory);}catch(error){if(error.code!=='ENOENT')throw error;}
   const result=[];
   for(const id of entries.filter(name=>idPattern.test(name))){
    try{result.push(overview(await read(id)));}catch{}
   }
   return result.sort((left,right)=>left.name.localeCompare(right.name,'ko'));
  },
  async register(file,details={}){
   const ext=typeof file==='string'?path.extname(file).toLowerCase():'';
   if(!['.hwp','.hwpx'].includes(ext)||!path.isAbsolute(file))throw Error('HWP 또는 HWPX 양식을 선택하세요.');
   const organization=label(details.organization,80),name=label(details.name,80)||label(path.basename(file,ext),80);
   if(!organization||!name)throw Error('기관·회사 이름과 양식 이름을 확인하세요.');
   const rules=typeof details.rules==='string'?details.rules.trim():'';
   if(rules.length>4000)throw Error('작성 기준을 4,000자 이내로 입력하세요.');
   const source=await readRegular(file);
   await fs.mkdir(directory,{recursive:true});
   const dir=await fs.mkdtemp(path.join(directory,'.register-')),target=path.join(dir,'template.hwpx');
   try{
    if(ext==='.hwp'){
     const legacy=path.join(dir,'original.hwp');
     await fs.writeFile(legacy,source,{flag:'wx',mode:0o600});
     await convertHwp({executable:config.rhwpPath,source:legacy,output:target});
     await fs.unlink(legacy);
    }else await fs.writeFile(target,source,{flag:'wx',mode:0o600});
    const bytes=await readRegular(target),{HwpDocument}=await loadCore(),doc=new HwpDocument(bytes);
    let analysis;
    try{analysis=analyzeReportTemplate(doc);}finally{doc.free();}
    const id=randomUUID(),metadata={version:1,id,name,organization,rules,sourceSha256:sha(bytes),analysis};
    await fs.writeFile(path.join(dir,'template.json'),JSON.stringify(metadata),{flag:'wx',mode:0o600});
    await fs.rename(dir,path.join(directory,id));
    return overview(metadata);
   }catch(error){await cleanFiles(dir,['original.hwp','template.hwpx','template.json']);throw error;}
  },
  async remove(id){
   const template=await read(id);
   const removed=path.join(directory,'.removed-'+randomUUID());
   await fs.rename(path.dirname(template.source),removed);
   await cleanFiles(removed,['template.hwpx','template.json']);
  },
  async prepare(id,mode='exact'){
   if(!['exact','adapt'].includes(mode))throw Error('양식 활용 수준을 선택하세요.');
   const template=await read(id),{HwpDocument}=await loadCore();
   const originalBytes=await readRegular(template.source);
   let bytes=originalBytes,analysis=template.analysis;
   if(sha(bytes)!==template.sourceSha256)throw Error('등록된 원본 양식이 변경되었습니다. 다시 등록하세요.');
   if(analysis.version!==analysisVersion){
    const doc=new HwpDocument(bytes);
    try{analysis=analyzeReportTemplate(doc);}finally{doc.free();}
   }
   const fields=mode==='exact'?analysis.fields:[];
   let writingLayout;
   if(mode==='exact'&&!fields.length){
    const doc=new HwpDocument(originalBytes);
    try{writingLayout=outlineWritingLayout(prepareOutlineLocations(doc,analysis.structure));}finally{doc.free();}
   }
   if(fields.some(field=>field.source&&!field.explicit)){
    const doc=new HwpDocument(bytes);
    try{addBlankMarkers(doc,fields);bytes=Buffer.from(doc.exportHwpx());}finally{doc.free();}
   }
   const paper=analysis.structure?.pages[0]?.paper;
   const mm=value=>Math.round(value*25.4/72)/100;
   const page=paper?{widthMm:mm(paper.width),heightMm:mm(paper.height),marginsMm:{top:mm(paper.marginTop),bottom:mm(paper.marginBottom),left:mm(paper.marginLeft),right:mm(paper.marginRight)}}:null;
   const {styles,formTable,tables,decorations,figures=[]}=analysis.structure||{};
   const reference={name:template.name,page,roles:styles,formTable,tables,decorations:{cover:!!decorations?.cover,numberedHeadings:!!decorations?.heading}};
   return {bytes,originalBytes,analysis,template:{...overview({...template,analysis}),reference,mode,rules:template.rules||'',figures:figures.map(publicReportFigure),
    ...(mode==='exact'?{outline:analysis.structure?.headings.map(({text,level})=>({text,level}))||[],...(writingLayout?{writingLayout}:{})}:{}),fields:boundedFields(fields)}};
  },
  async saveResult(generated,conversation=[]){
   const id=randomUUID();
   await fs.mkdir(draftRoot,{recursive:true});
   const dir=await fs.mkdtemp(path.join(draftRoot,'.report-')),destination=path.join(draftRoot,id);
   try{
    await fs.writeFile(path.join(dir,'report.hwpx'),generated.bytes,{flag:'wx',mode:0o600});
    await fs.writeFile(path.join(dir,'report.json'),JSON.stringify({name:generated.template.name,organization:generated.template.organization,mode:generated.template.mode,reference:generated.template.reference,fields:[],completed:true,conversation}),{flag:'wx',mode:0o600});
    await fs.rename(dir,destination);
    return id;
   }catch(error){await cleanFiles(dir,['report.hwpx','report.json']);throw error;}
  },
  async openResult(id){
   if(typeof id!=='string'||!idPattern.test(id))throw Error('완성된 양식 문서를 확인할 수 없습니다.');
   const directory=path.join(draftRoot,id),file=path.join(directory,'report.hwpx');
   const folder=await fs.lstat(directory),stat=await fs.lstat(file);
   if(!folder.isDirectory()||folder.isSymbolicLink()||!stat.isFile()||stat.isSymbolicLink()||(await readDraftTemplate(file)).completed!==true)throw Error('완성된 양식 문서를 확인할 수 없습니다.');
   return file;
  },
 };
}
function layoutIdentity(doc,ignoreBodyOffsets=false){
 const sections=Array.from({length:doc.getSectionCount()},(_,index)=>[parse(doc.getPageDef(index)),parse(doc.getColumnDef(index))]);
 const tables=parse(doc.getCursorModel()).lists.filter(cell=>cell.isCell).map(cell=>[cell.sectionIndex,cell.hostListId,ignoreBodyOffsets&&cell.hostListId===0?null:cell.hostPara,cell.controlIndex,cell.cellIndex,cell.row,cell.col,cell.rowSpan,cell.colSpan]);
 const objects=parse(doc.getControls()).map(control=>[control.ctrlId,control.list,ignoreBodyOffsets&&control.list===0?null:control.para,control.controlIndex]);
 return JSON.stringify({sections,tables,objects});
}
function fitGeneratedTables(doc,overflows){
 const sized=new Set();
 for(const {section,paragraph,controlIndex,kind,outside,rect,frame} of overflows){
  if(kind!=='table'||!outside.right)continue;
  const key=section+':'+paragraph+':'+controlIndex;
  if(sized.has(key))continue;
  sized.add(key);
  const available=frame.x+frame.w-rect.x-0.6;
  if(available<=0||rect.w<=available)continue;
  const dims=parse(doc.getTableDimensions(section,paragraph,controlIndex));
  const factor=available/rect.w;
  const changes=Array.from({length:dims.cellCount},(_,cellIdx)=>{
   const {width}=parse(doc.getCellOwnProperties(section,paragraph,controlIndex,cellIdx));
   return {cellIdx,widthDelta:Math.floor(width*factor)-width};
  });
  checked(doc.resizeTableCells(section,paragraph,controlIndex,JSON.stringify(changes)));
 }
 if(sized.size)doc.flushDeferredPagination();
 return sized.size;
}
function verifyReportFlow(HwpDocument,doc,{validate,identity,preferredBreaks,originalOverflows,splitTables,fitTables=false,fullFramePictures=[]}={}){
 const exportHwpx=target=>fitReportPictureViewports(Buffer.from(target.exportHwpx()),fullFramePictures);
 let bytes=exportHwpx(doc),reopened=new HwpDocument(bytes);
 try{
  const fitted=splitTables||fitTables?fitGeneratedTables(reopened,inspectBodyFlow(reopened).overflows):0;
  const splitParts=splitTables?.(inspectBodyFlow(reopened,{measureRows:true}).overflows);
  if(splitParts)return {splitParts};
  const {breaks}=reflowBody(reopened,{preferredBreaks,originalOverflows});
  if(fitted||breaks.length){
   bytes=exportHwpx(reopened);
   const verified=new HwpDocument(bytes);
   reopened.free();
   reopened=verified;
  }
  validate?.(reopened);
  const audit=inspectBodyFlow(reopened);
  if(!audit.pageCount||layoutIdentity(reopened)!==identity)throw Error('초안의 용지와 표를 확인하지 못했습니다.');
  const outside=newBodyOverflows(originalOverflows||[],audit.overflows)[0];
  if(outside){
   const edges={left:'왼쪽',right:'오른쪽',top:'위쪽',bottom:'아래쪽'};
   const side=Object.keys(outside.outside)[0];
   throw Error(outside.page+'쪽에서 '+(outside.kind==='table'?'표가':'문단이')+' '+edges[side]+' 본문 경계를 '+(outside.outside[side]*25.4/96).toFixed(1)+'mm 벗어납니다. 용지 배치나 표 구성을 조정하세요.');
  }
  return {bytes,pages:audit.pageCount,pageBreaks:breaks.length,fittedTables:fitted};
 }finally{reopened.free();}
}
function draftText(value,{optional=false,multiline=false}={}){
 if(value==null&&optional)return '';
 if(typeof value!=='string'||/[\u0000-\u0008\u000b-\u001f\ufffc]/.test(value.replace(/\r\n?/g,'\n'))||!optional&&!value.trim())
  throw Error('초안의 제목, 안내문, 항목명을 확인하세요.');
 const text=value.trim().replace(/\r\n?/g,'\n');
 return multiline?text:text.replace(/\s*\n\s*/g,' ');
}
function draftParagraphStyle(styles,part){
 const {role,level=1}=part;
 const body=styles.body||{characters:{fontSize:1000},paragraph:{lineSpacing:155,lineSpacingType:'Percent'}};
 const bodySize=body.characters.fontSize||1000;
 if(role==='title'){
  const title=styles.title||{...body,characters:{...body.characters,fontSize:Math.max(1600,Math.round(bodySize*1.5)),bold:true},
   paragraph:{...body.paragraph,spacingAfter:600}};
  return {...title,paragraph:{...title.paragraph,keepWithNext:true}};
 }
 if(role==='heading'){
  const base=styles.headingsByLevel?.[1]||styles.heading||body;
  const inherited=styles.headingsByLevel?.[level];
  const fontSize=Math.max(bodySize,Math.round((base.characters.fontSize||bodySize)*(level===1?1:level===2?0.9:0.85)));
  const format=inherited||{...base,characters:{...base.characters,fontSize:level===1&&base===body?Math.round(bodySize*1.18):fontSize,bold:true},
   paragraph:{...base.paragraph,spacingBefore:base.paragraph.spacingBefore||450,spacingAfter:base.paragraph.spacingAfter||200}};
  return {...format,paragraph:{...format.paragraph,keepWithNext:true}};
 }
 if(role==='note'||role==='caption'){
  const note=styles.note||{...body,characters:{...body.characters,fontSize:Math.max(800,Math.round(bodySize*0.88))},paragraph:{...body.paragraph,spacingBefore:200}};
  return role==='caption'?{...note,paragraph:{...note.paragraph,keepWithNext:true}}:note;
 }
 return body;
}
function pushParagraphs(parts,value,role,level){
 const text=draftText(value,{optional:true,multiline:role!=='heading'});
 for(const line of text.split('\n')){
  if(line.trim())parts.push({text:line.trim(),role,...(level?{level}:{})});
 }
}
function splitTallTables(parts,groups,controls,overflows){
 const chunksByPart=new Map();
 for(const block of overflows){
  if(block.kind!=='table'||block.rect.h<=block.frame.h||!block.outside.bottom)continue;
  const index=controls.findIndex(control=>control.para===block.paragraph&&control.controlIndex===block.controlIndex);
  const group=groups[index];
  if(!group||group.design||group.rows.length<2||chunksByPart.has(group))continue;
  const heights=group.rows.map((_,row)=>block.rowHeights[row]);
  if(!heights.every(height=>height>0))continue;
  // Keep a small allowance for the table's inline anchor at the top of each page.
  const capacity=block.frame.h-8,chunks=[];
  let rows=[],height=0;
  for(const [row,value] of group.rows.entries()){
   if(rows.length>(group.header?1:0)&&height+heights[row]>capacity){
    chunks.push(rows);
    rows=group.header?[group.rows[0]]:[];
    height=group.header?heights[0]:0;
   }
   rows.push(value);
   height+=heights[row];
  }
  if(rows.length)chunks.push(rows);
  if(chunks.length>1)chunksByPart.set(group,chunks);
 }
 if(!chunksByPart.size)return null;
 return parts.flatMap(part=>{
  const chunks=chunksByPart.get(part);
  return chunks?chunks.map((rows,index)=>index?{rows,columns:part.columns,header:part.header,startsPage:true}:{...part,rows}):[part];
 });
}
function decorateDraft(parts,structure){
 const {cover,heading}=structure?.decorations||{};
 const decorated=new Map();
 let number=0,startsPage=false;
 return parts.map((part,index)=>{
  if(index===0&&part.role==='title'&&cover){
   const group={columns:1,design:cover,rows:cover.cells.map((_,row)=>({lines:1,cells:[{span:1,text:row===1?part.text:''}]}))};
   startsPage=cover.separatePage;
   decorated.set(part,group);
   return group;
  }
  let result;
  if(part.role==='heading'&&(part.level??1)===1&&heading){
   const name=part.text.replace(/^\s*\d+[.)]\s+/,'').trim()||part.text;
   result={columns:heading.columns,design:heading,rows:[{lines:1,cells:heading.cells.map((_,column)=>({
    span:1,text:column===0?String(++number):column===heading.headingColumn?name:' ',
   }))}]};
  }else result={...part,...(part.lead&&decorated.get(part.lead)?{lead:decorated.get(part.lead)}:{})};
  if(startsPage){result.startsPage=true;startsPage=false;}
  decorated.set(part,result);
  return result;
 });
}

function applyDraftMargins(doc,marginsMm){
 if(marginsMm===undefined)return;
 const keys={top:'marginTop',bottom:'marginBottom',left:'marginLeft',right:'marginRight'};
 if(!marginsMm||Array.isArray(marginsMm)||typeof marginsMm!=='object'||!Object.keys(marginsMm).length)throw Error('조정할 용지 여백을 지정하세요.');
 const paper=parse(doc.getPageDef(0));
 for(const [side,mm] of Object.entries(marginsMm)){
  if(!Object.hasOwn(keys,side)||!Number.isFinite(mm)||mm<0)throw Error('용지 여백을 밀리미터로 지정하세요.');
  paper[keys[side]]=Math.round(mm*7200/25.4);
 }
 if(paper.width<=paper.marginLeft+paper.marginRight+paper.marginGutter||paper.height<=paper.marginTop+paper.marginBottom+paper.marginHeader+paper.marginFooter)
  throw Error('용지 여백을 줄여 본문 영역을 확보하세요.');
 checked(doc.setPageDef(0,JSON.stringify(paper)));
}
async function composeStyledReport(prepared,title,parts,kind,marginsMm){
 const {HwpDocument}=await loadCore(),structure=prepared.analysis.structure;
 const paragraphs=parts.filter(part=>!part.rows),groups=parts.filter(part=>part.rows),tables=groups.map(part=>part.rows);
 const anchorText='\u25a1';
 const html=parts.map(part=>part.rows
  ?'<table>'+part.rows.map(({cells})=>'<tr>'+cells.map(({label,text,header,span})=>{
   const tag=header?'th':'td';
   const value=escapeHtml(label??text??'');
   return '<'+tag+(span>1?' colspan="'+span+'"':'')+'>'+(label?'<strong>'+value+'</strong>':value)+'</'+tag+'>';
  }).join('')+'</tr>').join('')+'</table>'
  :'<p>'+escapeHtml(part.image?anchorText:part.text)+'</p>').join('');
 const result=createStyledDraft(HwpDocument,structure,(doc,styles)=>{
  applyDraftMargins(doc,marginsMm);
  const tableStyle=structure?.formTable;
  const defaultBorders=Object.fromEntries(borderSides.map(side=>[side,{type:1,width:2,color:'#8c949b'}]));
  const referenceBorders=borderSides.map(side=>tableStyle?.label?.sides?.[side]).find(side=>side?.type>0);
  const paper=parse(doc.getPageDef(0)),maxRowHeight=Math.max(1600,Math.floor((paper.height-paper.marginTop-paper.marginBottom-paper.marginHeader-paper.marginFooter)*0.8));
  let adjustedFields=0,tableControls;
  const bodyAddresses=new Map(),insertedFigures=[];
  function checkCells(target,format=false){
   for(const [index,rows] of tables.entries()){
    const {para,controlIndex}=tableControls[index],dimensions=parse(target.getTableDimensions(0,para,controlIndex));
    const group=groups[index];
    if(dimensions.rowCount!==rows.length||dimensions.colCount!==group.columns)throw Error('새 양식의 입력 표를 확인하지 못했습니다.');
    if(format){
     checked(target.setTableProperties(0,para,controlIndex,JSON.stringify({pageBreak:1,repeatHeader:!!group.header})));
     if(group.startsPage||group.design?.topInset||group.design?.headingColumn!==undefined)checked(target.applyParaFormat(0,para,JSON.stringify({
      ...(group.startsPage?{pageBreakBefore:true}:{}),...(group.design?.topInset?{spacingBefore:group.design.topInset}:{}),
      ...(group.design?.headingColumn!==undefined?{keepWithNext:true}:{}),
     })));
    }
    const widths=group.design?group.design.cells.slice(0,group.columns).map(cell=>cell.width):tableStyle?.widths;
    const weights=widths?.length===group.columns?widths:widths?.length===4&&group.columns===2?[widths[0]+widths[2],widths[1]+widths[3]]:null;
    const totalWidth=format&&weights?(group.design?weights.reduce((sum,value)=>sum+value,0):parse(target.getTableProperties(0,para,controlIndex)).tableWidth):0;
    const totalWeight=weights?.reduce((sum,value)=>sum+value,0),resize=[];
    let cellIndex=0;
    for(const [row,{cells,lines}] of rows.entries()){
     const requestedHeight=1600+(lines-1)*1000;
     if(format&&requestedHeight>maxRowHeight)adjustedFields+=cells.filter(cell=>cell.label).length;
     let column=0;
     for(const {label,text,header,span} of cells){
      const source={section:0,paragraph:para,cellPath:[{controlIndex,cellIndex,cellParaIndex:0}]};
      const info=parse(target.getCellInfo(0,para,controlIndex,cellIndex));
      if(info.row!==row||info.col!==column||info.colSpan!==span||paragraphText(target,source).trim()!==(label??text??'').trim())throw Error('새 양식의 입력 칸을 확인하지 못했습니다.');
      if(format){
       const current=parse(target.getCellOwnProperties(0,para,controlIndex,cellIndex));
       const decorative=group.design?.cells[cellIndex];
       if(decorative){
        checked(target.setCellProperties(0,para,controlIndex,cellIndex,JSON.stringify({...decorative.borders,...decorative.padding,
         height:decorative.height,...(decorative.fill?{fillType:'solid',fillColor:decorative.fill}:{fillType:'none'}),
        })));
        applyFormatting(target,source,decorative.format,true);
        resize.push({cellIdx:cellIndex,widthDelta:decorative.width-current.width});
        column+=span;
        cellIndex++;
        continue;
       }
       const skin=label||header?tableStyle?.label:tableStyle?.value;
       const fillColor=skin?.fill||(header&&!tableStyle?'#e8edf3':null);
       const fill=fillColor?{fillType:'solid',fillColor}:{};
       const height=Math.max(current.height,Math.min(maxRowHeight,requestedHeight));
       const fallback=referenceBorders?Object.fromEntries(borderSides.map(side=>[side,referenceBorders])):defaultBorders;
       const borders=borderSides.some(side=>skin?.sides?.[side]?.type>0)?skin.sides:fallback;
       checked(target.setCellProperties(0,para,controlIndex,cellIndex,JSON.stringify({...borders,...fill,height,...(header?{isHeader:true}:{})})));
       if(label||header){
        const base=tableStyle?.format||draftParagraphStyle(styles,{role:'body'});
        const font=header?{...base,characters:{...base.characters,bold:true}}:tableStyle?.format;
        applyFormatting(target,source,font);
       }else if(text)applyFormatting(target,source,tableStyle?.value?.format||draftParagraphStyle(styles,{role:'body'}));
       if(totalWidth){
        const weight=weights.slice(column,column+span).reduce((sum,width)=>sum+width,0);
        resize.push({cellIdx:cellIndex,widthDelta:Math.floor(totalWidth*weight/totalWeight)-current.width});
       }
      }
      column+=span;
      cellIndex++;
     }
    }
    if(resize.length)checked(target.resizeTableCells(0,para,controlIndex,JSON.stringify(resize)));
   }
  }
  doc.beginBatch();
  try{
   checked(doc.pasteHtml(0,0,0,html));
   let paragraphIndex=0;
   for(let paragraph=0;paragraph<doc.getParagraphCount(0);paragraph++){
    const source={section:0,paragraph},text=paragraphText(doc,source).trim();
    if(!text)continue;
    const expected=paragraphs[paragraphIndex++];
    if(text!==(expected?.image?anchorText:expected?.text))throw Error('초안의 본문을 조판하지 못했습니다.');
    bodyAddresses.set(expected,paragraph);
    applyFormatting(doc,source,draftParagraphStyle(styles,expected));
    if(expected.image){
     checked(doc.deleteText(0,paragraph,0,anchorText.length));
     // Keep a text run so the engine restores the inline object's line on reopen.
     checked(doc.insertText(0,paragraph,0,' '));
     insertedFigures.push(insertReportFigure(doc,paragraph,expected));
    }
    if(expected.startsPage)checked(doc.applyParaFormat(0,paragraph,JSON.stringify({pageBreakBefore:true})));
   }
   if(paragraphIndex!==paragraphs.length)throw Error('초안의 본문을 조판하지 못했습니다.');
   tableControls=parse(doc.getControls()).filter(control=>control.ctrlId==='tbl'&&control.list===0);
   if(tableControls.length!==tables.length)throw Error('새 양식의 입력 표를 조판하지 못했습니다.');
   checkCells(doc,true);
  }finally{doc.endBatch();}
  for(const [index,part] of groups.entries())if(part.design)bodyAddresses.set(part,tableControls[index].para);
  const preferredBreaks=new Map(groups.map((part,index)=>['0:'+tableControls[index].para,bodyAddresses.get(part.lead)]));
  const validate=target=>{
   checkCells(target);
   verifyReportFigures(target,insertedFigures);
   for(const [part,paragraph] of bodyAddresses)
    if(!part.design&&paragraphText(target,{section:0,paragraph}).trim()!==(part.image?'':part.text))throw Error('저장 후 본문 또는 목차 항목을 확인하지 못했습니다.');
  };
  const layout=verifyReportFlow(HwpDocument,doc,{validate,identity:layoutIdentity(doc),preferredBreaks,
   splitTables:overflows=>splitTallTables(parts,groups,tableControls,overflows)});
  if(layout.splitParts)return layout;
  const {bytes,pages,pageBreaks,fittedTables}=layout,fields=tables.flat().reduce((count,row)=>count+row.cells.filter(cell=>cell.label).length,0);
  return {bytes,template:{...prepared.template,name:title,mode:'adapt'},changes:{kind,fields,pages,
   pageBreaks:pageBreaks+groups.filter(part=>part.startsPage).length,fittedTables,adjustedFields,figuresInserted:insertedFigures.length}};
 });
 return result.splitParts?composeStyledReport(prepared,title,result.splitParts,kind,marginsMm):result;
}
async function addPreparedFigure(parts,prepared,spec,resolveImage){
 const reference=spec.referenceId?reportFigureById(prepared.analysis.structure?.figures||[],spec.referenceId):null;
 if(!spec.assetId&&!reference)throw Error('넣을 그림 또는 참고 그림 번호를 확인하세요.');
 let image;
 if(spec.assetId)image=resolveImage(spec.assetId);
 else{
  const {HwpDocument}=await loadCore(),source=new HwpDocument(prepared.originalBytes);
  try{image=copyReportFigure(source,reference);}finally{source.free();}
 }
 parts.push({role:'figure',image,reference,description:draftText(spec.description||reference?.description||'그림')});
}
export async function createPreparedForm(prepared,form,resolveImage){
 if(!form||!Array.isArray(form.sections)||!form.sections.length)throw Error('새 양식의 구성을 확인하세요.');
 const title=draftText(form.title),parts=[{text:title,role:'title'}];
 pushParagraphs(parts,form.introduction,'body');
 for(const figure of form.figures||[])await addPreparedFigure(parts,prepared,figure,resolveImage);
 for(const section of form.sections){
  if(!section||!Array.isArray(section.fields)||!section.fields.length)throw Error('구역별 새 양식 항목을 확인하세요.');
  const start=parts.length;
  pushParagraphs(parts,section.heading,'heading');
  pushParagraphs(parts,section.guidance,'body');
  for(const figure of section.figures||[])await addPreparedFigure(parts,prepared,figure,resolveImage);
  const pairs=section.pairsPerRow??prepared.analysis.structure?.formTable?.pairsPerRow??1;
  if(![1,2].includes(pairs))throw Error('한 줄에 한 쌍 또는 두 쌍의 작성 항목을 배치할 수 있습니다.');
  const fields=section.fields.map(field=>{
   const label=draftText(field?.label),lines=field.lines??1;
   if(!Number.isSafeInteger(lines)||lines<1)throw Error('입력 칸의 줄 수는 양의 정수로 지정하세요.');
   return {label,lines,wide:field.wide===true||lines>2};
  });
  const columns=pairs*2,rows=[];
  for(let i=0;i<fields.length;i++){
   const field=fields[i],next=fields[i+1];
   const cells=[{label:field.label,span:1}];
   let lines=field.lines;
   if(pairs===2&&!field.wide&&next&&!next.wide){
    i++;
    cells.push({span:1},{label:next.label,span:1},{span:1});
    lines=Math.max(lines,next.lines);
   }else cells.push({span:columns-1});
   rows.push({lines,cells});
  }
  parts.push({rows,columns,lead:parts[start]});
 }
 return composeStyledReport(prepared,title,parts,'blank_form',form.marginsMm);
}
export async function getPreparedReportFigure(prepared,id){
 const figure=reportFigureById(prepared.analysis.structure?.figures||[],id);
 const {HwpDocument}=await loadCore(),doc=new HwpDocument(prepared.originalBytes);
 try{return {figure:publicReportFigure(figure),bytes:readReportFigure(doc,figure)};}finally{doc.free();}
}
export async function getDraftReportFigures(bytes,id){
 const {HwpDocument}=await loadCore(),doc=new HwpDocument(bytes);
 try{
  const figures=inventoryReportFigures(doc);
  if(!id)return {figures:figures.map(publicReportFigure)};
  const figure=reportFigureById(figures,id);
  return {figure:publicReportFigure(figure),bytes:readReportFigure(doc,figure)};
 }finally{doc.free();}
}
function figureReplacements(prepared,{figures=[],resolveImage}={}){
 if(!Array.isArray(figures))throw Error('교체할 양식 그림을 확인하세요.');
 const seen=new Set();
 return figures.map(({referenceId,assetId,description})=>{
  if(seen.has(referenceId))throw Error('각 그림에는 교체할 이미지 하나를 지정하세요.');
  seen.add(referenceId);
  return {figure:reportFigureById(prepared.analysis.structure?.figures||[],referenceId),image:resolveImage(assetId),
   description:description===undefined?undefined:draftText(description)};
 });
}
export async function createPreparedDraft(prepared,draft,kind='styled_draft',resolveImage){
 if(!draft||!Array.isArray(draft.paragraphs))throw Error('초안의 본문을 확인하세요.');
 const title=draftText(draft.title),parts=[{text:title,role:'title'}];
 for(const paragraph of draft.paragraphs){
  const role=paragraph?.role;
  if(role==='figure'){
   await addPreparedFigure(parts,prepared,paragraph,resolveImage);
   continue;
  }
  if(role==='table'){
   const {headers,rows}=paragraph;
   if(!Array.isArray(headers)||!headers.length||!Array.isArray(rows)||!rows.length||rows.some(row=>!Array.isArray(row)||row.length!==headers.length))
    throw Error('표의 제목 행과 각 데이터 행의 열 수를 맞춰 주세요.');
   const rendered=[headers,...rows].map((row,index)=>({lines:1,cells:row.map(text=>({text:draftText(text,{optional:index>0}),span:1,header:index===0}))}));
   const lead=parts.at(-1);
   parts.push({rows:rendered,columns:headers.length,header:true,lead:['heading','caption'].includes(lead?.role)?lead:undefined});
   continue;
  }
  if(!['heading','body','note','caption'].includes(role))throw Error('초안의 문단 종류를 확인하세요.');
  if(paragraph.level!==undefined&&(role!=='heading'||![1,2,3].includes(paragraph.level)))throw Error('소제목의 단계는 1~3으로 지정하세요.');
  pushParagraphs(parts,paragraph.text,role,paragraph.level);
 }
 if(parts.length===1)throw Error('초안에 담을 본문을 작성하세요.');
 return composeStyledReport(prepared,title,decorateDraft(parts,prepared.analysis.structure),kind,draft.marginsMm);
}
export async function applyPreparedReportStyle(prepared,sourceBytes,{pageSetup=false}={}){
 if(typeof pageSetup!=='boolean')throw Error('용지 설정 적용 여부를 확인하세요.');
 const {HwpDocument}=await loadCore(),doc=new HwpDocument(sourceBytes);
 try{
  const originalFlow=inspectBodyFlow(doc).overflows,analysis=analyzeReportTemplate(doc);
  const {sources,unsupported}=styleScanSources(doc,'document');
  const originalText=new Map(sources.map(source=>[JSON.stringify(source),paragraphText(doc,source)]));
  if(![...originalText.values()].some(value=>value.trim()))throw Error('현재 문서에 서식을 적용할 내용이 없습니다. 새 양식 또는 본문으로 작성하세요.');
  const {structure}=prepared.analysis,styles=structure?.styles||{},tableStyle=structure?.formTable;
  const firstBody=sources.find(source=>!source.cellPath&&originalText.get(JSON.stringify(source)).trim());
  const title=JSON.stringify(analysis.structure.title?.source||firstBody);
  const headings=new Set(analysis.structure.headings.map(item=>JSON.stringify(item.source)));
  const dimensions=new Map();
  const bodyFace=format=>format&&{
   ...format,characters:Object.fromEntries(Object.entries(format.characters).filter(([key])=>!['bold','italic','underlineType','underlineShape','underlineColor','strikethrough','strikeShape','strikeColor'].includes(key))),
  };
  let paragraphs=0,styledCells=0;
  doc.beginBatch();
  try{
   const referencePaper=structure?.pages[0]?.paper;
   if(pageSetup&&referencePaper)for(let section=0;section<doc.getSectionCount();section++){
    const page=parse(doc.getPageDef(section));
    if(page.landscape!==referencePaper.landscape)continue;
    const margins=['marginLeft','marginRight','marginTop','marginBottom','marginHeader','marginFooter','marginGutter'];
    for(const key of margins)page[key]=referencePaper[key];
    if(page.width>page.marginLeft+page.marginRight+page.marginGutter&&page.height>page.marginTop+page.marginBottom+page.marginHeader+page.marginFooter)
     checked(doc.setPageDef(section,JSON.stringify(page)));
   }
   for(const source of sources){
    const key=JSON.stringify(source),value=originalText.get(key),last=source.cellPath?.at(-1);
    if(!last){
     if(!value.trim())continue;
     const positions=parse(doc.getControlTextPositions(source.section,source.paragraph));
     if(positions.length&&(source.paragraph!==0||positions.some(offset=>offset!==0)))continue;
     const format=key===title?styles.title||styles.body:headings.has(key)?styles.heading||styles.body:bodyFace(styles.body);
     if(format){applyFormatting(doc,source,format);paragraphs++;}
     continue;
    }
    if(!tableStyle||source.cellPath.length!==1)continue;
    const {section,paragraph}=source,{controlIndex,cellIndex,cellParaIndex}=last,tableKey=[section,paragraph,controlIndex].join(':');
    if(!dimensions.has(tableKey))dimensions.set(tableKey,parse(doc.getTableDimensions(section,paragraph,controlIndex)));
    const cols=dimensions.get(tableKey).colCount,info=parse(doc.getCellInfo(section,paragraph,controlIndex,cellIndex));
    const own=parse(doc.getCellOwnProperties(section,paragraph,controlIndex,cellIndex));
    const isLabel=own.isHeader||cols===tableStyle.pairsPerRow*2&&info.col%2===0&&info.colSpan===1;
    const role=isLabel?tableStyle.label:tableStyle.value;
    if(cellParaIndex===0&&role){
     checked(doc.setCellProperties(section,paragraph,controlIndex,cellIndex,JSON.stringify({...role.sides,
      ...(role.fill?{fillType:'solid',fillColor:role.fill}:{fillType:'none'}),
     })));
     styledCells++;
    }
    const format=isLabel?tableStyle.format:bodyFace(role?.format);
    if(value.trim()&&format){
     const path=JSON.stringify(source.cellPath);
     const cellCount=doc.getCellParagraphCountByPath(section,paragraph,path);
     if(cellCount===1||!value.includes('\ufffc')){applyFormatting(doc,source,format);paragraphs++;}
    }
   }
  }finally{doc.endBatch();}
  const verify=target=>{
   for(const {section,paragraph,cellPath} of sources){
    const source={section,paragraph,...(cellPath?{cellPath}:{})};
    if(paragraphText(target,source)!==originalText.get(JSON.stringify(source)))throw Error('서식 적용 후 원래 문장과 작성란을 보존하지 못했습니다.');
   }
  };
  const layout=verifyReportFlow(HwpDocument,doc,{validate:verify,identity:layoutIdentity(doc),originalOverflows:originalFlow,fitTables:true});
  const name=firstBody?originalText.get(JSON.stringify(firstBody)).trim().slice(0,100):prepared.template.name;
  return {bytes:layout.bytes,template:{...prepared.template,name,mode:'adapt'},
   changes:{kind:'applied_style',paragraphs,styledCells,pages:layout.pages,pageBreaks:layout.pageBreaks,unsupportedCells:unsupported.length}};
 }finally{doc.free();}
}

export async function createPreparedExactDraft(prepared,draft,images){
 if(prepared.template.mode!=='exact'||prepared.template.fields.length)throw Error('지정된 입력 표시가 있는 양식에는 answers를 사용하세요.');
 if(draft?.marginsMm)throw Error('원본 양식의 여백을 유지해야 합니다.');
 const {HwpDocument}=await loadCore(),doc=new HwpDocument(prepared.originalBytes);
 try{
  const places=prepareOutlineLocations(doc,prepared.analysis.structure),styles=prepared.analysis.structure?.styles||{};
  const before=inspectBodyFlow(doc),structure=layoutIdentity(doc,true);
  const updated=replaceReportFigures(doc,figureReplacements(prepared,images));
  const {changes,validate,translateSource}=applyOutlineDraft(doc,places,draft,(source,part)=>applyFormatting(doc,source,draftParagraphStyle(styles,part)));
  if(layoutIdentity(doc,true)!==structure)throw Error('작성 중 원본의 표 또는 개체 구조가 변경되었습니다.');
  const originalOverflows=before.overflows.map(block=>({...block,paragraph:translateSource(block).paragraph}));
  const validateAll=target=>{
   validate(target);
   verifyReportFigures(target,updated.map(item=>({...item,figure:translateSource(item.figure)})));
  };
  const layout=verifyReportFlow(HwpDocument,doc,{validate:validateAll,identity:layoutIdentity(doc),originalOverflows,fullFramePictures:updated.flatMap(item=>item.fullFrame||[])});
  return {bytes:layout.bytes,template:{...prepared.template,name:draft.title.trim()},changes:{...changes,pages:layout.pages,pageBreaks:layout.pageBreaks,figuresReplaced:updated.length}};
 }finally{doc.free();}
}
export async function fillPreparedTemplate(prepared,answers=[],sections=[],images){
 if(!Array.isArray(answers)||!Array.isArray(sections)||!answers.length&&!sections.length)throw Error('작성할 양식 항목을 지정하세요.');
 if(prepared.template.mode==='adapt'){
  if(answers.length>1||answers.some(answer=>answer?.marker!=='{{보고서 제목}}')||!sections.length)
   throw Error('형식 준용에서는 새 제목과 목차를 정해 draft 또는 form으로 제출하세요.');
  const paragraphs=sections.flatMap(section=>[{role:'heading',text:draftText(section?.title)},{role:'body',text:section.text}]);
  return createPreparedDraft(prepared,{title:answers[0]?.text||'작성 초안',paragraphs});
 }
 if(sections.length)throw Error('새 소제목은 형식 준용에서만 추가할 수 있습니다.');
 if(!prepared.template.fields.length)throw Error('표시된 입력 위치가 없는 양식입니다. draft로 원본의 목차 아래에 넣을 본문과 표 내용을 전달하세요.');
 if(answers.length>64)throw Error('작성할 양식 항목을 확인하세요.');
 const {HwpDocument}=await loadCore(),{bytes}=prepared;
 const fields=new Set(prepared.template.fields.map(field=>field.marker)),seen=new Set();
 let length=0;
 const accepted=answers.map(answer=>{
  if(!answer||!fields.has(answer.marker)||seen.has(answer.marker)||typeof answer.text!=='string'||answer.text.length>12000||(length+=answer.text.length)>48000||/[\r\n\u0000-\u0008\u000b-\u001f\ufffc]/.test(answer.text))throw Error('작성 항목과 문단 내용을 확인하세요.');
  seen.add(answer.marker);return {marker:answer.marker,text:answer.text};
 });
 const missing=[...fields].filter(marker=>!seen.has(marker));
 for(const marker of missing)accepted.push({marker,text:'확인 필요'});
 const doc=new HwpDocument(bytes);
 try{
  const context={documentState:{documentEpoch:1,changeSeq:0,documentSha256:sha(bytes)}};
  const originalLayout=layoutIdentity(doc),before=inspectBodyFlow(doc);
  const updated=replaceReportFigures(doc,figureReplacements(prepared,images));
  const changes=applyTextEdits(doc,prepareReportFill(doc,accepted,context));
  const written=verifyReportFlow(HwpDocument,doc,{identity:originalLayout,originalOverflows:before.overflows,fullFramePictures:updated.flatMap(item=>item.fullFrame||[]),validate:target=>verifyReportFigures(target,updated)});
  return {bytes:written.bytes,template:prepared.template,changes:{...changes,initialPages:before.pageCount,pages:written.pages,pageBreaks:written.pageBreaks,missing:missing.length,figuresReplaced:updated.length}};
 }finally{doc.free();}
}
export async function readDraftTemplate(file){
 if(path.basename(file)!=='report.hwpx')throw Error('보고서 작업 사본을 확인하지 못했습니다.');
 const entry=JSON.parse(await readRegular(path.join(path.dirname(file),'report.json')));
 if(typeof entry.name!=='string'||!Array.isArray(entry.fields)||entry.fields.length>64)throw Error('보고서 양식 정보를 확인하지 못했습니다.');
 if(!Array.isArray(entry.conversation))entry.conversation=[];
 entry.conversation=entry.conversation.slice(-2).filter(item=>['user','assistant'].includes(item?.role)&&typeof item.text==='string').map(item=>({role:item.role,text:item.text.slice(0,6000)}));
 return entry;
}
