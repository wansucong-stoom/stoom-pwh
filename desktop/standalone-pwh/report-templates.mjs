import {promises as fs} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import config from '../release-source/src/config.mjs';
import {styleScanSources,prepareReportFill,applyTextEdits} from '../release-source/src/text-edit.mjs';
import {convertHwp} from './convert-hwp.mjs';

const limit=256*1024*1024;
const idPattern=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const escapeHtml=value=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',[String.fromCharCode(39)]:'&#39;'}[char]));
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const analysisVersion=2;
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
  characters:take(chars,['fontFamily','fontSize','textColor','bold','italic']),
  paragraph:take(para,['alignment','lineSpacing','lineSpacingType','marginLeft','marginRight','indent','spacingBefore','spacingAfter','headType','paraLevel']),
 };
}
function readReportStructure(doc,body,tables,tableLabel){
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
 return {pages,tables:[...tables.values()].slice(0,48),headings:headings.map(({text,source})=>({text,source})),
  title:title?{text:title.text,source:title.source}:null,
  styles:{title:title?.format||headings[0]?.format,heading:headings[0]?.format||title?.format,body:bodyFormat},formTable:tableLabel||null};
}
function boundedFields(fields){
 return fields.slice(0,64).map(({name,marker,source})=>({name,marker,section:source?.section,paragraph:source?.paragraph,cell:source?.cellPath?.at(-1)?.cellIndex}));
}
export function analyzeReportTemplate(doc){
 const {sources,unsupported}=styleScanSources(doc,'document'),explicit=new Map(),tables=new Map(),tableSizes=new Map(),body=[];
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
  if(!tableLabel&&info&&dims.colCount>=2&&info.col===0&&label(value,64)&&value.trim().length<=40&&!containsCellControl(source)){
   const props=parse(doc.getCellOwnPropertiesByPath(source.section,source.paragraph,JSON.stringify(p),last.cellIndex));
   tableLabel={format:readFormatting(doc,source),fill:props?.fillType==='solid'&&/^#[0-9a-f]{6}$/i.test(props.fillColor)?props.fillColor:null,
    border:borderSides.map(side=>props?.[side]).find(border=>border?.type>0)||null};
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
 return {version:analysisVersion,sections:doc.getSectionCount(),paragraphs:sources.length,fields:fields.slice(0,64).map(field=>({...field,format:readFormatting(doc,field.source)})),structure:readReportStructure(doc,body,tableSizes,tableLabel),limited:fields.length>64||unsupported.length>0||tableSizes.size>48||doc.getSectionCount()>32};
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
function adaptedDraft(HwpDocument,analysis,additionalHeadings=[]){
 const {structure}=analysis;
 return createStyledDraft(HwpDocument,structure,(doc,styles)=>{
  const overviewFields=analysis.fields.filter(field=>field.source?.cellPath&&field.name.length<=48&&!/[{}]/.test(field.name)).slice(0,4);
  const overviewNames=new Set(overviewFields.map(field=>field.name));
  const headings=[...new Set((structure?.headings.length?structure.headings.map(item=>item.text):analysis.fields.map(field=>field.name))
   .map(name=>label(name,48)).filter(name=>name&&name!=='보고서 제목'&&!overviewNames.has(name)&&!/[{}]/.test(name)))].slice(0,16);
  if(!headings.length)headings.push('개요','주요 내용','향후 계획');
  for(const heading of additionalHeadings)headings.push(heading);
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
 });
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
   let bytes=await readRegular(template.source),analysis=template.analysis;
   if(sha(bytes)!==template.sourceSha256)throw Error('등록된 원본 양식이 변경되었습니다. 다시 등록하세요.');
   if(analysis.version!==analysisVersion){
    const doc=new HwpDocument(bytes);
    try{analysis=analyzeReportTemplate(doc);}finally{doc.free();}
   }
   let fields=analysis.fields;
   if(mode==='exact'&&fields.some(field=>field.source&&!field.explicit)){
    const doc=new HwpDocument(bytes);
    try{addBlankMarkers(doc,fields);bytes=Buffer.from(doc.exportHwpx());}finally{doc.free();}
   }
   if(mode==='adapt')({bytes,fields}=adaptedDraft(HwpDocument,analysis));
   return {bytes,analysis,template:{...overview({...template,analysis}),mode,rules:template.rules||'',headings:analysis.structure?.headings.map(item=>item.text)||[],fields:boundedFields(fields)}};
  },
  async saveResult(generated,conversation=[]){
   const id=randomUUID();
   await fs.mkdir(draftRoot,{recursive:true});
   const dir=await fs.mkdtemp(path.join(draftRoot,'.report-')),destination=path.join(draftRoot,id);
   try{
    await fs.writeFile(path.join(dir,'report.hwpx'),generated.bytes,{flag:'wx',mode:0o600});
    await fs.writeFile(path.join(dir,'report.json'),JSON.stringify({name:generated.template.name,organization:generated.template.organization,mode:generated.template.mode,fields:[],completed:true,conversation}),{flag:'wx',mode:0o600});
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
function layoutIdentity(doc){
 const sections=Array.from({length:doc.getSectionCount()},(_,index)=>[parse(doc.getPageDef(index)),parse(doc.getColumnDef(index))]);
 const tables=parse(doc.getCursorModel()).lists.filter(cell=>cell.isCell).map(cell=>[cell.sectionIndex,cell.hostListId,cell.hostPara,cell.controlIndex,cell.cellIndex,cell.row,cell.col,cell.rowSpan,cell.colSpan]);
 const objects=parse(doc.getControls()).map(control=>[control.ctrlId,control.list,control.para,control.controlIndex]);
 return JSON.stringify({sections,tables,objects});
}
function draftText(value,{optional=false,multiline=false}={}){
 if(value==null&&optional)return '';
 if(typeof value!=='string'||/[\u0000-\u0008\u000b-\u001f\ufffc]/.test(value.replace(/\r\n?/g,'\n'))||!optional&&!value.trim())
  throw Error('초안의 제목, 안내문, 항목명을 확인하세요.');
 const text=value.trim().replace(/\r\n?/g,'\n');
 return multiline?text:text.replace(/\s*\n\s*/g,' ');
}
function pushParagraphs(parts,value,role){
 const text=draftText(value,{optional:true,multiline:role==='body'});
 for(const line of text.split('\n')){
  if(line.trim())parts.push({text:line.trim(),role});
 }
}
async function composeStyledReport(prepared,title,parts,kind){
 const {HwpDocument}=await loadCore(),structure=prepared.analysis.structure;
 const paragraphs=parts.filter(part=>!part.rows),tables=parts.filter(part=>part.rows).map(part=>part.rows);
 const html=parts.map(part=>part.rows
  ?'<table>'+part.rows.map(({label})=>'<tr><td><strong>'+escapeHtml(label)+'</strong></td><td></td></tr>').join('')+'</table>'
  :'<p>'+escapeHtml(part.text)+'</p>').join('');
 return createStyledDraft(HwpDocument,structure,(doc,styles)=>{
  const tableStyle=structure?.formTable,border=tableStyle?.border||{type:1,width:2,color:'#8c949b'};
  const borders=Object.fromEntries(borderSides.map(side=>[side,border]));
  const paper=parse(doc.getPageDef(0)),maxRowHeight=Math.max(1600,Math.floor((paper.height-paper.marginTop-paper.marginBottom-paper.marginHeader-paper.marginFooter)*0.8));
  let adjustedFields=0,tableControls;
  function checkCells(target,format=false){
   for(const [index,rows] of tables.entries()){
    const {para,controlIndex}=tableControls[index],dimensions=parse(target.getTableDimensions(0,para,controlIndex));
    if(dimensions.rowCount!==rows.length||dimensions.colCount!==2)throw Error('새 양식의 입력 표를 확인하지 못했습니다.');
    if(format)checked(target.setTableProperties(0,para,controlIndex,JSON.stringify({pageBreak:1})));
    for(const [row,{label,lines}] of rows.entries()){
     const requestedHeight=1600+(lines-1)*1000;
     if(format&&requestedHeight>maxRowHeight)adjustedFields++;
     for(const column of [0,1]){
      const cellIndex=row*2+column,source={section:0,paragraph:para,cellPath:[{controlIndex,cellIndex,cellParaIndex:0}]};
      if(paragraphText(target,source)!==(column?'':label))throw Error('새 양식의 입력 칸을 확인하지 못했습니다.');
      if(!format)continue;
      const current=parse(target.getCellOwnProperties(0,para,controlIndex,cellIndex));
      const fill=!column&&tableStyle?.fill?{fillType:'solid',fillColor:tableStyle.fill}:{};
      const height=Math.max(current.height,Math.min(maxRowHeight,requestedHeight));
      checked(target.setCellProperties(0,para,controlIndex,cellIndex,JSON.stringify({...borders,...fill,height})));
      if(!column)applyFormatting(target,source,tableStyle?.format);
     }
    }
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
    if(text!==expected?.text)throw Error('초안의 본문을 조판하지 못했습니다.');
    applyFormatting(doc,source,styles[expected.role]);
   }
   if(paragraphIndex!==paragraphs.length)throw Error('초안의 본문을 조판하지 못했습니다.');
   tableControls=parse(doc.getControls()).filter(control=>control.ctrlId==='tbl'&&control.list===0);
   if(tableControls.length!==tables.length)throw Error('새 양식의 입력 표를 조판하지 못했습니다.');
   checkCells(doc,true);
  }finally{doc.endBatch();}
  const bytes=Buffer.from(doc.exportHwpx()),reopened=new HwpDocument(bytes);
  try{
   checkCells(reopened);
   const pages=reopened.pageCount();
   if(!pages||layoutIdentity(reopened)!==layoutIdentity(doc))throw Error('초안의 용지와 표를 확인하지 못했습니다.');
   const fields=tables.reduce((count,rows)=>count+rows.length,0);
   return {bytes,template:{...prepared.template,name:title,mode:'adapt'},changes:{kind,fields,pages,adjustedFields}};
  }finally{reopened.free();}
 });
}
export async function createPreparedForm(prepared,form){
 if(!form||!Array.isArray(form.sections)||!form.sections.length)throw Error('새 양식의 구성을 확인하세요.');
 const title=draftText(form.title),parts=[{text:title,role:'title'}];
 pushParagraphs(parts,form.introduction,'body');
 for(const section of form.sections){
  if(!section||!Array.isArray(section.fields)||!section.fields.length)throw Error('구역별 새 양식 항목을 확인하세요.');
  pushParagraphs(parts,section.heading,'heading');
  pushParagraphs(parts,section.guidance,'body');
  const rows=section.fields.map(field=>{
   const label=draftText(field?.label),lines=field.lines??1;
   if(!Number.isSafeInteger(lines)||lines<1)throw Error('입력 칸의 줄 수는 양의 정수로 지정하세요.');
   return {label,lines};
  });
  parts.push({rows});
 }
 return composeStyledReport(prepared,title,parts,'blank_form');
}
export async function createPreparedDraft(prepared,draft,kind='styled_draft'){
 if(!draft||!Array.isArray(draft.paragraphs))throw Error('초안의 본문을 확인하세요.');
 const title=draftText(draft.title),parts=[{text:title,role:'title'}];
 for(const paragraph of draft.paragraphs){
  if(!['heading','body'].includes(paragraph?.role))throw Error('초안의 문단 종류를 확인하세요.');
  pushParagraphs(parts,paragraph.text,paragraph.role);
 }
 if(parts.length===1)throw Error('초안에 담을 본문을 작성하세요.');
 return composeStyledReport(prepared,title,parts,kind);
}
export async function fillPreparedTemplate(prepared,answers,sections=[]){
 if(!prepared.template.fields.length)throw Error('기존 양식에 채울 항목을 찾지 못했습니다. 새 빈 양식을 만들려면 양식을 참고해 새 서식을 만들어 달라고 요청하세요.');
 if(!Array.isArray(answers)||answers.length>64||!Array.isArray(sections)||sections.length>8||!answers.length&&!sections.length)throw Error('작성할 양식 항목을 지정하세요.');
 if(sections.length&&prepared.template.mode!=='adapt')throw Error('새 소제목은 형식 준용에서만 추가할 수 있습니다.');
 const {HwpDocument}=await loadCore();
 let bytes=prepared.bytes;
 const fields=new Set(prepared.template.fields.map(field=>field.marker)),seen=new Set(),additions=[];
 for(const section of sections){
  const heading=label(section?.title,48),marker='{{'+heading+'}}';
  if(!heading||heading!==section.title||/[{}]/.test(heading)||fields.has(marker))throw Error('추가할 소제목과 기존 양식의 항목을 확인하세요.');
  fields.add(marker);additions.push({heading,marker,text:section.text});
 }
 if(additions.length)bytes=adaptedDraft(HwpDocument,prepared.analysis,additions.map(addition=>addition.heading)).bytes;
 let length=0;
 const accepted=[...answers,...additions].map(answer=>{
  if(!answer||!fields.has(answer.marker)||seen.has(answer.marker)||typeof answer.text!=='string'||answer.text.length>12000||(length+=answer.text.length)>48000||/[\r\n\u0000-\u0008\u000b-\u001f\ufffc]/.test(answer.text))throw Error('작성 항목과 문단 내용을 확인하세요.');
  seen.add(answer.marker);return {marker:answer.marker,text:answer.text};
 });
 const missing=[...fields].filter(marker=>!seen.has(marker));
 for(const marker of missing)accepted.push({marker,text:'확인 필요'});
 const doc=new HwpDocument(bytes);
 try{
  const context={documentState:{documentEpoch:1,changeSeq:0,documentSha256:sha(bytes)}};
  const originalLayout=layoutIdentity(doc),initialPages=doc.pageCount();
  const changes=applyTextEdits(doc,prepareReportFill(doc,accepted,context));
  const written=Buffer.from(doc.exportHwpx()),reopened=new HwpDocument(written);
  try{
   const pages=reopened.pageCount();
   if(!pages||layoutIdentity(reopened)!==originalLayout)throw Error('작성 후 양식의 용지·표·개체 구조를 확인하지 못했습니다.');
   return {bytes:written,template:prepared.template,changes:{...changes,initialPages,pages,missing:missing.length}};
  }finally{reopened.free();}
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
