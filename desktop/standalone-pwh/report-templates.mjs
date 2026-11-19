import {promises as fs} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import config from '../release-source/src/config.mjs';
import {styleScanSources} from '../release-source/src/text-edit.mjs';
import {convertHwp} from './convert-hwp.mjs';

const starterTemplates=[
 ['weekly','주간업무 보고','보고 기간','주요 추진 사항','추진 실적','다음 주 계획','협조 요청'],
 ['minutes','회의록','회의 일시·장소','참석자','안건 및 논의 내용','결정 사항','후속 조치'],
 ['project','사업계획서','사업명','추진 배경과 목적','세부 추진 계획','일정 및 예산','기대 효과'],
 ['result','사업 결과보고','사업명','추진 개요','주요 실적','성과와 개선 사항','후속 계획'],
 ['proposal','검토 보고서','검토 안건','배경 및 현황','검토 내용','대안 비교','검토 의견'],
 ['progress','업무 진행 보고','보고 기준일','진행 현황','주요 성과','이슈 및 대응','향후 일정'],
 ['event','행사 운영계획','행사명','일시·장소 및 대상','운영 계획','인력 및 예산','안전 및 비상 대응'],
 ['training','교육 운영보고','교육명','교육 개요','운영 내용','참여 및 성과','개선 계획'],
 ['visit','출장 결과보고','출장 기간·장소','출장 목적','주요 활동','결과 및 시사점','후속 조치'],
 ['incident','현안 보고','현안명','발생 경위','영향 및 현재 상태','조치 사항','향후 대응'],
];
const names=new Map(starterTemplates.map(([id,name,...fields])=>['builtin-'+id,{id:'builtin-'+id,name,organization:'Pwh 기본 양식',fields}]));
const limit=256*1024*1024;
const idPattern=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const escapeHtml=value=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',[String.fromCharCode(39)]:'&#39;'}[char]));
const parse=value=>typeof value==='string'?JSON.parse(value):value;
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
  characters:take(chars,['fontFamily','fontSize','textColor','bold','italic']),
  paragraph:take(para,['alignment','lineSpacing','lineSpacingType','marginLeft','marginRight','indent','spacingBefore','spacingAfter','headType','paraLevel']),
 };
}
function readReportStructure(doc,body,tables){
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
 const title=candidates.find(({source,format})=>source.section===0&&(source.paragraph===0||/제목|^title$/i.test(format.named||''))&&format.characters.fontSize>=base);
 const headings=candidates.filter(item=>item!==title).slice(0,32);
 return {pages,tables:[...tables.values()].slice(0,48),headings:headings.map(({text,source})=>({text,source})),
  title:title?{text:title.text,source:title.source}:null,
  styles:{title:title?.format||headings[0]?.format,heading:headings[0]?.format||title?.format,body:bodyFormat}};
}
function boundedFields(fields){
 return fields.slice(0,64).map(({name,marker,source})=>({name,marker,section:source?.section,paragraph:source?.paragraph,cell:source?.cellPath?.at(-1)?.cellIndex}));
}
export function analyzeReportTemplate(doc){
 const {sources,unsupported}=styleScanSources(doc,'document'),explicit=new Map(),tables=new Map(),tableSizes=new Map(),body=[];
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
 return {sections:doc.getSectionCount(),paragraphs:sources.length,fields:fields.slice(0,64).map(field=>({...field,format:readFormatting(doc,field.source)})),structure:readReportStructure(doc,body,tableSizes),limited:fields.length>64||unsupported.length>0||tableSizes.size>48||doc.getSectionCount()>32};
}
function addBlankMarkers(doc,fields){
 for(const {source,marker,explicit} of fields){
  if(!source||explicit)continue;
  if(paragraphText(doc,source)!=='')throw Error('등록한 양식의 빈 입력 칸이 변경되었습니다.');
  const {section,paragraph,cellPath}=source;
  checked(doc.insertTextInCellByPath(section,paragraph,JSON.stringify(cellPath),0,marker));
 }
}
function applyFormatting(doc,source,format){
 if(!format)return;
 const {fontFamily,...characters}=format.characters;
 const {headType,paraLevel,...paragraph}=format.paragraph,p=source.cellPath&&JSON.stringify(source.cellPath);
 const length=Array.from(paragraphText(doc,source)).length;
 if(fontFamily)characters.fontIds=Array.from({length:7},(_,lang)=>doc.findOrCreateFontIdForLang(lang,fontFamily));
 if(length&&Object.keys(characters).length)checked(p
  ?doc.applyCharFormatInCellByPath(source.section,source.paragraph,p,0,length,JSON.stringify(characters))
  :doc.applyCharFormat(source.section,source.paragraph,0,length,JSON.stringify(characters)));
 if(Object.keys(paragraph).length)checked(p
  ?doc.applyParaFormatInCellByPath(source.section,source.paragraph,p,JSON.stringify(paragraph))
  :doc.applyParaFormat(source.section,source.paragraph,JSON.stringify(paragraph)));
}
function adaptedDraft(HwpDocument,analysis){
 const doc=HwpDocument.createEmpty();
 try{
  doc.createBlankDocument();
  const {structure}=analysis,first=structure?.pages[0],styles=structure?.styles||{};
  if(first?.paper)checked(doc.setPageDef(0,JSON.stringify(first.paper)));
  if(first?.columns?.sameWidth&&first.columns.columnCount>1)checked(doc.setColumnDef(0,first.columns.columnCount,first.columns.columnType,1,first.columns.spacing));
  const overviewFields=analysis.fields.filter(field=>field.source?.cellPath&&field.name.length<=48&&!/[{}]/.test(field.name)).slice(0,4);
  const overviewNames=new Set(overviewFields.map(field=>field.name));
  const headings=[...new Set((structure?.headings.length?structure.headings.map(item=>item.text):analysis.fields.map(field=>field.name))
   .map(name=>label(name,48)).filter(name=>name&&name!=='보고서 제목'&&!overviewNames.has(name)&&!/[{}]/.test(name)))].slice(0,16);
  if(!headings.length)headings.push('개요','주요 내용','향후 계획');
  const titleMarker='{{보고서 제목}}';
  const overview=overviewFields.length?'<table>'+overviewFields.map(field=>{
   const name=escapeHtml(field.name);return '<tr><td><strong>'+name+'</strong></td><td>{{'+name+'}}</td></tr>';
  }).join('')+'</table>':'';
  const html='<p>'+titleMarker+'</p>'+overview+headings.map(text=>{
   const name=escapeHtml(text);return '<p>'+name+'</p><p>{{'+name+'}}</p>';
  }).join('');
  checked(doc.pasteHtml(0,0,0,html));
  for(let paragraph=0;paragraph<doc.getParagraphCount(0);paragraph++){
   const source={section:0,paragraph},text=paragraphText(doc,source);
   if(text)applyFormatting(doc,source,text===titleMarker?styles.title:text.startsWith('{{')?styles.body:styles.heading);
  }
  const fields=analyzeReportTemplate(doc).fields,byName=new Map(overviewFields.map(field=>[field.name,field.format]));
  for(const field of fields)if(field.source.cellPath)applyFormatting(doc,field.source,byName.get(field.name));
  return {bytes:Buffer.from(doc.exportHwpx()),fields};
 }finally{doc.free();}
}
function starterHtml(template){
 const [first,...sections]=template.fields;
 const title=escapeHtml(template.name),intro=escapeHtml(first);
 return '<p><span style="font-size:22pt;color:#17394c"><strong>'+title+'</strong></span></p>'
  +'<table><tr><td style="background:#eaf1f3"><strong>'+intro+'</strong></td><td>{{'+intro+'}}</td></tr></table>'
  +sections.map(section=>{
   const name=escapeHtml(section);
   return '<p><span style="font-size:13pt;color:#17394c"><strong>'+name+'</strong></span></p><p>{{'+name+'}}</p>';
  }).join('');
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
 const directory=path.join(dataRoot,'report-templates'),draftRoot=path.join(dataRoot,'documents'),starterCache=new Map();
 async function read(id){
  if(!idPattern.test(String(id)))throw Error('등록된 양식을 선택하세요.');
  const dir=path.join(directory,id);
  const stat=await fs.lstat(dir);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('등록한 양식을 읽을 수 없습니다.');
  const metadata=JSON.parse(await readRegular(path.join(dir,'template.json')));
  if(metadata.version!==1||metadata.id!==id||!metadata.name||!metadata.organization||!Array.isArray(metadata.analysis?.fields))throw Error('등록한 양식 정보가 올바르지 않습니다.');
  return {...metadata,source:path.join(dir,'template.hwpx')};
 }
 const overview=entry=>({id:entry.id,name:entry.name,organization:entry.organization,fields:entry.analysis?.fields.map(field=>field.name)||entry.fields,limited:entry.analysis?.limited||false,sections:entry.analysis?.sections??1,tables:entry.analysis?.structure?.tables.length??1});
 return {
  async list(){
   let entries=[];
   try{entries=await fs.readdir(directory);}catch(error){if(error.code!=='ENOENT')throw error;}
   const result=[...names.values()].map(overview);
   for(const id of entries.filter(name=>idPattern.test(name))){
    try{result.push(overview(await read(id)));}catch{}
   }
   return result;
  },
  async register(file,details={}){
   const ext=typeof file==='string'?path.extname(file).toLowerCase():'';
   if(!['.hwp','.hwpx'].includes(ext)||!path.isAbsolute(file))throw Error('HWP 또는 HWPX 양식을 선택하세요.');
   const organization=label(details.organization,80),name=label(details.name,80)||label(path.basename(file,ext),80);
   if(!organization||!name)throw Error('기관·회사 이름과 양식 이름을 확인하세요.');
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
    const id=randomUUID(),metadata={version:1,id,name,organization,sourceSha256:sha(bytes),analysis};
    await fs.writeFile(path.join(dir,'template.json'),JSON.stringify(metadata),{flag:'wx',mode:0o600});
    await fs.rename(dir,path.join(directory,id));
    return overview(metadata);
   }catch(error){await cleanFiles(dir,['original.hwp','template.hwpx','template.json']);throw error;}
  },
  async prepare(id,mode='exact'){
   if(!['exact','adapt'].includes(mode))throw Error('양식 활용 수준을 선택하세요.');
   const builtin=names.get(id),template=builtin||await read(id),{HwpDocument}=await loadCore();
   let bytes,fields,analysis;
   if(builtin){
    let ready=starterCache.get(id);
    if(!ready){
     const doc=HwpDocument.createEmpty();
     try{doc.createBlankDocument();checked(doc.pasteHtml(0,0,0,starterHtml(builtin)));ready={analysis:analyzeReportTemplate(doc),bytes:Buffer.from(doc.exportHwpx())};starterCache.set(id,ready);}finally{doc.free();}
    }
    ({analysis,bytes}=ready);fields=analysis.fields;
   }else{
    bytes=await readRegular(template.source);
    if(sha(bytes)!==template.sourceSha256)throw Error('등록된 원본 양식이 변경되었습니다. 다시 등록하세요.');
    analysis=template.analysis;fields=analysis.fields;
    if(mode==='exact'&&fields.some(field=>field.source&&!field.explicit)){
     const doc=new HwpDocument(bytes);
     try{addBlankMarkers(doc,fields);bytes=Buffer.from(doc.exportHwpx());}finally{doc.free();}
    }
   }
   if(mode==='adapt')({bytes,fields}=adaptedDraft(HwpDocument,analysis));
   await fs.mkdir(draftRoot,{recursive:true});
   const dir=await fs.mkdtemp(path.join(draftRoot,'report-')),file=path.join(dir,'report.hwpx');
   try{
    await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});
    await fs.writeFile(path.join(dir,'report.json'),JSON.stringify({...overview(template),mode,headings:analysis.structure?.headings.map(item=>item.text)||[],fields:boundedFields(fields)}),{flag:'wx',mode:0o600});
    return {file,discard:()=>cleanFiles(dir,['report.hwpx','report.json'])};
   }catch(error){await cleanFiles(dir,['report.hwpx','report.json']);throw error;}
  },
 };
}
export async function readDraftTemplate(file){
 if(path.basename(file)!=='report.hwpx')throw Error('보고서 작업 사본을 확인하지 못했습니다.');
 const entry=JSON.parse(await readRegular(path.join(path.dirname(file),'report.json')));
 if(typeof entry.name!=='string'||!Array.isArray(entry.fields)||entry.fields.length>64)throw Error('보고서 양식 정보를 확인하지 못했습니다.');
 return entry;
}
