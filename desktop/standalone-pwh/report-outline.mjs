import {prepareTextEdits,applyTextEdits,textRevision} from '../release-source/src/text-edit.mjs';

const parse=value=>typeof value==='string'?JSON.parse(value):value;
const checked=value=>{const result=parse(value);if(result?.ok===false||result?.error)throw Error(result.error||'양식 본문을 작성하지 못했습니다.');};
const address=(section,paragraph)=>section+':'+paragraph;
const headingKey=value=>value.normalize('NFC').replace(/^\s*(?:\d+(?:[.-]\d+)*[.)]?|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+[.)]?)\s*/u,'').replace(/[\s.:·]/gu,'');
const cleanInline=value=>value.trim().replace(/\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`/g,(_,bold,underline,code)=>bold||underline||code);
function plain(value){
 if(typeof value!=='string'||/[\u0000-\u0008\u000a-\u001f\ufffc]/.test(value))throw Error('양식에 넣을 문단 또는 표 문구를 확인하세요.');
 return value.trim();
}
function paragraphText(doc,source){
 const {section,paragraph,cellPath}=source;
 if(!cellPath)return doc.getTextRange(section,paragraph,0,doc.getParagraphLength(section,paragraph));
 const path=JSON.stringify(cellPath);
 return doc.getTextInCellByPath(section,paragraph,path,0,doc.getCellParagraphLengthByPath(section,paragraph,path));
}
function fieldSource(section,paragraph,controlIndex,cellIndex){
 return {section,paragraph,cellPath:[{controlIndex,cellIndex,cellParaIndex:0}]};
}
export function prepareOutlineLocations(doc,structure){
 const recognized=structure?.headings||[],marked=new Map(recognized.map(item=>[address(item.source.section,item.source.paragraph),item]));
 const primary=structure?.title?.source,title=primary||null;
 const catalogs=new Map();
 const controls=parse(doc.getControls());
 const rootTables=new Map();
 for(const cell of parse(doc.getCursorModel()).lists){
  if(!cell.isCell||cell.hostListId!==0)continue;
  const key=address(cell.sectionIndex,cell.hostPara),tables=rootTables.get(key)||new Map();
  const members=tables.get(cell.controlIndex)||[];
  members.push(cell);tables.set(cell.controlIndex,members);rootTables.set(key,tables);
 }
 const cellControls=new Set(controls.map(control=>control.list+':'+control.para));
 for(let section=0;section<doc.getSectionCount();section++){
  const count=doc.getParagraphCount(section);
  let current={id:'intro:'+section,section,start:0,end:count,body:[],tables:[],heading:null};
  catalogs.set(current.id,current);
  for(let paragraph=0;paragraph<count;paragraph++){
   const key=address(section,paragraph),heading=marked.get(key);
   if(heading){
    current.end=paragraph;
    current={id:key,section,start:paragraph+1,end:count,body:[],tables:[],heading};
    catalogs.set(key,current);
    continue;
   }
   const positions=parse(doc.getControlTextPositions(section,paragraph));
   if(!positions.length&&key!==address(title?.section,title?.paragraph))current.body.push({section,paragraph});
   for(const [controlIndex,cells] of rootTables.get(key)||[]){
    if(title?.cellPath&&address(title.section,title.paragraph)===key&&title.cellPath[0].controlIndex===controlIndex)continue;
    const dims=parse(doc.getTableDimensions(section,paragraph,controlIndex));
    if(!dims||dims.rowCount*dims.colCount!==cells.length||cells.some(cell=>cell.rowSpan!==1||cell.colSpan!==1||cell.paraCount!==1||cellControls.has(cell.listId+':0')))continue;
    const grid=Array.from({length:dims.rowCount},()=>Array(dims.colCount));
    for(const cell of cells)grid[cell.row][cell.col]=fieldSource(section,paragraph,controlIndex,cell.cellIndex);
    if(grid.some(row=>row.filter(Boolean).length!==dims.colCount))continue;
    const headers=grid[0].map(source=>paragraphText(doc,source));
    const data=grid.slice(1);
    if(data.length)current.tables.push({paragraph,headers,data});
   }
  }
 }
 return {title,catalogs};
}
export function outlineWritingLayout(locations){
 return [...locations.catalogs.values()].map(group=>({id:group.id,heading:group.heading?.text,level:group.heading?.level,
  tables:group.tables.map(table=>({headers:table.headers,rows:table.data.length})),
 }));
}
function tableToParagraphs(table){
 return table.rows.map(row=>row.map((cell,index)=>cell?table.headers[index]+': '+cell:'').filter(Boolean).join(' · ')).filter(Boolean);
}
function groupDraft(locations,draft){
 const start=locations.catalogs.keys().next().value,items=new Map();
 const ids=new Map();
 for(const group of locations.catalogs.values())if(group.heading){
  const key=headingKey(group.heading.text),matches=ids.get(key)||[];
  matches.push(group.id);ids.set(key,matches);
 }
 let active=start;
 for(const paragraph of draft.paragraphs){
  if(paragraph?.role==='heading'){
   const text=plain(paragraph.text),match=ids.get(headingKey(text));
   const target=locations.catalogs.get(paragraph.targetId);
   if(target?.heading||match?.length===1){active=target?.heading?target.id:match[0];continue;}
   if(text){const list=items.get(active)||[];list.push({text,role:'caption'});items.set(active,list);}
   continue;
  }
  const list=items.get(active)||[];
  if(paragraph?.role==='table'){
   const {headers,rows}=paragraph;
   if(!Array.isArray(headers)||!headers.length||!Array.isArray(rows)||rows.some(row=>!Array.isArray(row)||row.length!==headers.length))throw Error('표의 제목 행과 데이터 행의 열 수가 다릅니다.');
   list.push({table:{headers:headers.map(plain),rows:rows.map(row=>row.map(plain))}});
  }else if(['body','note','caption'].includes(paragraph?.role)){
   if(typeof paragraph.text!=='string')throw Error('목차 아래에 넣을 문단을 확인하세요.');
   for(const line of paragraph.text.split(/\r?\n/))if(line.trim())list.push({text:plain(line),role:paragraph.role});
  }else throw Error('양식에 넣을 문단의 역할을 확인하세요.');
  items.set(active,list);
 }
 return items;
}

export function applyOutlineDraft(doc,locations,draft,applyStyle){
 if(!draft||!Array.isArray(draft.paragraphs)||!draft.paragraphs.length)throw Error('목차 아래에 넣을 작성 내용을 확인하세요.');
 const title=plain(draft.title),drafted=groupDraft(locations,draft),edits=[],newParagraphs=new Map();
 if(![...drafted.values()].some(parts=>parts.some(part=>part.table?.rows.length||part.text)))throw Error('목차 아래에 넣을 본문을 작성하세요.');
 if(!title)throw Error('문서 제목을 입력하세요.');
 if(locations.title)edits.push({source:locations.title,text:title});
 for(const [id,items] of drafted){
  const group=locations.catalogs.get(id);
  if(!items.length)continue;
  let start=group.start,tableIndex=0,pending=[];
  const writeBody=(end)=>{
   const slots=group.body.filter(source=>source.paragraph>=start&&source.paragraph<end);
   for(const [i,source] of slots.entries()){
    const item=pending[i];
    edits.push({source,text:item?.text||''});
   }
   if(pending.length>slots.length){
    const key=address(group.section,end),existing=newParagraphs.get(key)||{section:group.section,paragraph:end,parts:[]};
    existing.parts.push(...pending.slice(slots.length));newParagraphs.set(key,existing);
   }
   pending=[];
  };
  for(const [index,item] of items.entries()){
   if(!item.table){pending.push(item);continue;}
   const table=item.table,target=group.tables[tableIndex];
   if(!target||target.headers.length!==table.headers.length){pending.push(...tableToParagraphs(table).map(text=>({text,role:'body'})));continue;}
   writeBody(target.paragraph);
   const remainingInput=items.slice(index+1).filter(part=>part.table).length;
   let row=0;
   while(tableIndex<group.tables.length){
    const location=group.tables[tableIndex];
    if(location.headers.length!==table.headers.length)break;
    const capacity=location.data.length;
    const matchingTables=group.tables.slice(tableIndex).filter(item=>item.headers.length===table.headers.length).length;
    const available=remainingInput?capacity:Math.min(capacity,Math.ceil((table.rows.length-row)/matchingTables));
    for(const [r,cells] of location.data.entries())for(const [c,source] of cells.entries())
     edits.push({source,text:r<available?table.rows[row+r]?.[c]||'':''});
    row+=available;
    tableIndex++;
    start=location.paragraph+1;
    if(remainingInput||row>=table.rows.length)break;
   }
   if(row<table.rows.length)pending.push(...tableToParagraphs({...table,rows:table.rows.slice(row)}).map(text=>({text,role:'body'})));
  }
  writeBody(group.end);
  for(const table of group.tables.slice(tableIndex))for(const row of table.data)for(const source of row)edits.push({source,text:''});
 }
 if(title&&!locations.title){
  const first=locations.catalogs.values().next().value;
  const point=first.body[0]?.paragraph??first.end;
  const key=address(first.section,point),entry=newParagraphs.get(key)||{section:first.section,paragraph:point,parts:[]};
  entry.parts.unshift({text:title,role:'title'});newParagraphs.set(key,entry);
 }
 const mutations=edits.map(edit=>({...edit,old:paragraphText(doc,edit.source)})).filter(item=>item.old!==item.text);
 const context={documentEpoch:1,changeSeq:0,documentSha256:'outline-template-work-copy'};
 const revision=textRevision(context);
 const existing=mutations.filter(item=>item.old);
 // The common text engine preserves run formatting and requires a bounded edit batch.
 for(let index=0;index<existing.length;){
  const plans=new Map(),batch=[];
  let chars=0;
  while(index<existing.length&&batch.length<100){
   const {source,old,text}=existing[index],size=text.length;
   if(batch.length&&chars+size>48000)break;
   const id=String(index++);
   plans.set(id,{revision,refs:[{id,source,start:0,length:Array.from(old).length,original:old,paragraphText:old}]});
   batch.push({searchId:id,matchId:id,replacement:text});chars+=size;
  }
  applyTextEdits(doc,prepareTextEdits(doc,plans,batch,context));
 }
 for(const {source,text,old} of mutations){
  if(old)continue;
  const {section,paragraph,cellPath}=source;
  checked(cellPath?doc.insertTextInCellByPath(section,paragraph,JSON.stringify(cellPath),0,text):doc.insertText(section,paragraph,0,text));
 }
 const inserted=[...newParagraphs.values()].sort((a,b)=>b.section-a.section||b.paragraph-a.paragraph);
 for(const {section,paragraph,parts} of inserted)for(let index=0;index<parts.length;index++){
  const position=paragraph+index,part=parts[index];
  checked(doc.insertParagraph(section,position));
  checked(doc.insertText(section,position,0,part.text));
  applyStyle({section,paragraph:position},part);
 }
 doc.flushDeferredPagination();
 const translated=source=>({...source,paragraph:source.paragraph+inserted.filter(item=>item.section===source.section&&item.paragraph<=source.paragraph).reduce((n,item)=>n+item.parts.length,0)});
 const protectedText=[...locations.catalogs.values()].flatMap(group=>group.heading?[{source:group.heading.source,text:group.heading.text}]:[]);
 const expected=[...protectedText,...edits].map(item=>({...item,source:translated(item.source)}));
 for(const item of inserted){
  const offset=inserted.filter(other=>other.section===item.section&&other.paragraph<item.paragraph).reduce((n,other)=>n+other.parts.length,0);
  for(const [index,part] of item.parts.entries())expected.push({source:{section:item.section,paragraph:item.paragraph+offset+index},text:part.text});
 }
 return {
  translateSource:translated,
  changes:{kind:'exact_outline',paragraphs:mutations.length+inserted.reduce((n,item)=>n+item.parts.length,0),sections:[...drafted.values()].filter(items=>items.length).length},
  validate(target){
   for(const {source,text} of expected)if(paragraphText(target,source).trim()!==text.trim())throw Error('작성 후 원본 목차나 본문을 다시 확인하지 못했습니다.');
  },
 };
}

export function outlineDraftFromText(response){
 const lines=response.split(/\r?\n/),at=lines.findIndex(line=>/^#\s+\S/.test(line.trim()));
 if(at<0)return null;
 const title=cleanInline(lines[at].trim().replace(/^#\s+/,'')),paragraphs=[];
 const cells=line=>line.trim().replace(/^\||\|$/g,'').split(/(?<!\\)\|/).map(cell=>cleanInline(cell.replace(/\\\|/g,'|')));
 for(let i=at+1;i<lines.length;i++){
  const line=lines[i].trim();
  if(!line)continue;
  const heading=/^(#{2,})\s+(.+)/.exec(line);
  if(heading){paragraphs.push({role:'heading',text:cleanInline(heading[2]),level:Math.min(3,heading[1].length-1)});continue;}
  if(line.startsWith('|')&&lines[i+1]?.trim().startsWith('|')){
   const headers=cells(line),rule=cells(lines[i+1]);
   if(headers.length===rule.length&&rule.every(cell=>/^:?-{3,}:?$/.test(cell))){
    const rows=[];
    i++;
    while(lines[i+1]?.trim().startsWith('|'))rows.push(cells(lines[++i]));
    if(rows.length&&rows.every(row=>row.length===headers.length)){paragraphs.push({role:'table',headers,rows});continue;}
    for(const text of [line,...rows.map(row=>row.join(' · '))])paragraphs.push({role:'body',text});
    continue;
   }
  }
  const caption=/^\*\*(.+)\*\*$/.exec(line);
  paragraphs.push({role:caption?'caption':'body',text:cleanInline(line.replace(/^[-*]\s+/,'• '))});
 }
 return paragraphs.length?{title,paragraphs}:null;
}
