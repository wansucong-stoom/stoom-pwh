// Run inside the editor, with one undoable snapshot and a revision guard.
export async function applyDesktopBodyStyles({document,read,command}){
 const before=read(),expected=command.expected,keys=['documentEpoch','changeSeq','documentSha256'];
 if(!before?.ready||keys.some(k=>before.documentState?.[k]!==expected?.[k]))throw Error('문서가 변경되어 서식을 적용하지 않았습니다.');
 const edits=command.edits;if(!Array.isArray(edits)||edits.length<1||edits.length>100)throw Error('서식을 적용할 문단을 확인하세요.');
 const wasm=document.wasm,seen=new Set();
 for(const e of edits){
  if(!Number.isSafeInteger(e.section)||!Number.isSafeInteger(e.paragraph)||e.section<0||e.paragraph<0||typeof e.text!=='string'||e.text.length>18000)throw Error('문단 위치가 올바르지 않습니다.');
  const key=e.section+':'+e.paragraph;if(seen.has(key))throw Error('같은 문단이 중복되었습니다.');seen.add(key);
  const len=wasm.getParagraphLength(e.section,e.paragraph),actual=wasm.getTextRange(e.section,e.paragraph,0,len);if(actual!==e.text)throw Error('문단 내용이 바뀌어 서식을 적용하지 않았습니다.');
  const raw=wasm.getControlTextPositions(e.section,e.paragraph),controls=typeof raw==='string'?JSON.parse(raw):raw,all=wasm.getControls();const local=Array.isArray(all)?all.filter(c=>c.para===e.paragraph):[];if(!Array.isArray(controls)||!Array.isArray(all)||local.some(c=>!['secd','cold'].includes(c.ctrlId))||controls.length>local.length)throw Error('표·그림 등 객체를 포함한 문단은 본문 서식 변경에서 제외합니다.');
  const style=e.style;if(!style||typeof style!=='object'||Object.keys(style).some(k=>!['bold','fontSize','textColor','alignment'].includes(k))||!Object.keys(style).length)throw Error('문단 서식이 올바르지 않습니다.');
  if(style.bold!==undefined&&typeof style.bold!=='boolean'||style.fontSize!==undefined&&(!Number.isInteger(style.fontSize)||style.fontSize<600||style.fontSize>7200)||style.textColor!==undefined&&!/^#[0-9a-f]{6}$/i.test(style.textColor)||style.alignment!==undefined&&!['left','center','right','justify'].includes(style.alignment))throw Error('문단 서식 값이 올바르지 않습니다.');
 }
 const checked=value=>{const result=typeof value==='string'?JSON.parse(value):value;if(result?.error)throw Error(String(result.error));};
 const input=document.getInputHandler(),cursor=input.getCursorPosition();
 await input.executeDocumentAgentOperation({kind:'snapshot',operationType:'pwh-desktop-body-style',operation:w=>{for(const e of edits){const len=w.getParagraphLength(e.section,e.paragraph),char={};for(const k of ['bold','fontSize','textColor'])if(e.style[k]!==undefined)char[k]=e.style[k];if(len&&Object.keys(char).length)checked(w.applyCharFormat(e.section,e.paragraph,0,len,JSON.stringify(char)));if(e.style.alignment)checked(w.applyParaFormat(e.section,e.paragraph,JSON.stringify({alignment:e.style.alignment})));}return cursor;}},()=>document.getCanvasView().refreshDocumentAgentMutation());
 return {ok:true,undoSteps:1,changes:{paragraphs:edits.length}};
}

export async function applyDesktopColumns({document,read,command}){
 const before=read(),expected=command.expected,keys=['documentEpoch','changeSeq','documentSha256'];
 if(!before?.ready||keys.some(k=>before.documentState?.[k]!==expected?.[k]))throw Error('문서가 변경되어 단 설정을 적용하지 않았습니다.');
 const {section,columns}=command;if(!Number.isSafeInteger(section)||section<0||section>=document.wasm.getSectionCount()||![1,2,3].includes(columns))throw Error('구역 또는 단 수가 올바르지 않습니다.');
 if(document.wasm.getColumnDef(section).columnCount===columns)return {ok:true,undoSteps:0,changes:{section,columns,unchanged:true}};
 const input=document.getInputHandler(),cursor=input.getCursorPosition();
 await input.executeDocumentAgentOperation({kind:'snapshot',operationType:'pwh-desktop-columns',operation:w=>{const value=w.setColumnDef(section,columns,0,1,2268),result=typeof value==='string'?JSON.parse(value):value;if(result?.error||w.getColumnDef(section).columnCount!==columns)throw Error('단 설정 결과를 확인하지 못했습니다.');return cursor;}},()=>document.getCanvasView().refreshDocumentAgentMutation());
 return {ok:true,undoSteps:1,changes:{section,columns}};
}

export async function insertDesktopImage({document,read,command,bytes,sameContext}){
 const before=read();if(!before?.ready||!sameContext(before,command.expected)||before.selection||before.kind!=='body_text'||before.cursor?.parentParaIndex!=null||before.cursor?.cellPath?.length)throw Error('본문 커서나 문서가 바뀌었습니다. 다시 요청하세요.');
 const image=command.image,widthMm=command.widthMm;if(!image||!['png','jpg'].includes(image.extension)||!Number.isFinite(widthMm)||widthMm<20||widthMm>160)throw Error('그림 정보가 올바르지 않습니다.');
 const wasm=document.wasm,input=document.getInputHandler(),cursor=input.getCursorPosition(),page=wasm.getPageDef(cursor.sectionIndex),column=wasm.getColumnDef(cursor.sectionIndex);let available=page.width-page.marginLeft-page.marginRight;if(column?.sameWidth&&column.columnCount>1)available=Math.floor((available-(column.columnCount-1)*column.spacing)/column.columnCount);if(!Number.isFinite(available)||available<=0)throw Error('그림을 넣을 단의 너비를 확인하지 못했습니다.');
 let width=Math.min(Math.round(widthMm*7200/25.4),available),height=Math.round(width*image.height/image.width);if(height>Math.round(120*7200/25.4)){width=Math.round(width*Math.round(120*7200/25.4)/height);height=Math.round(120*7200/25.4);}
 await input.executeDocumentAgentOperation({kind:'snapshot',operationType:'pwh-desktop-insert-image',operation:w=>{const result=w.insertPicture(cursor.sectionIndex,cursor.paragraphIndex,cursor.charOffset,'',bytes,width,height,image.width,image.height,image.extension,'그림',undefined,undefined);if(!result?.ok)throw Error(result?.error||'그림을 삽입하지 못했습니다.');return {...cursor,paragraphIndex:result.paraIdx??cursor.paragraphIndex,charOffset:result.logicalOffset??cursor.charOffset+1};}},()=>document.getCanvasView().refreshDocumentAgentMutation());
 return {ok:true,undoSteps:1,changes:{imageInserted:true,widthMm:Math.round(width*25.4/7200)}};
}

const parsePageFlow=value=>typeof value==='string'?JSON.parse(value):value;
const flowTolerance=0.5; // Render-tree bounds are exposed in rounded CSS pixels.
function readBodyFlow(wasm,{page=1,count=Infinity,measureRows=false}={}){
 // Desktop's bridge exposes the underlying engine for read-only render geometry.
 const renderer=typeof wasm.getPageRenderTree==='function'?wasm:wasm.doc;
 if(!renderer?.getPageRenderTree)throw Error('편집기의 쪽 조판 정보를 읽지 못했습니다.');
 const pageCount=renderer.pageCount(),lastPage=Math.min(pageCount,page-1+count),blocks=[],overflows=[];
 for(let number=page;number<=lastPage;number++){
  const tree=parsePageFlow(renderer.getPageRenderTree(number-1));
  const body=tree.children?.find(node=>node.type==='Body');
  if(!body)continue;
  const {sectionIndex:section}=parsePageFlow(renderer.getPageInfo(number-1));
  for(const column of body.children.filter(node=>node.type==='Column')){
   const frame=column.bbox,right=frame.x+frame.w,bottom=frame.y+frame.h;
   for(const node of column.children){
    if(!['Table','TextLine'].includes(node.type)||!Number.isSafeInteger(node.pi))continue;
    if(node.type==='Table'){
     if(!Number.isSafeInteger(node.ci))continue;
     const props=parsePageFlow(renderer.getTableProperties(section,node.pi,node.ci));
     // Floating objects can deliberately use the margins.
     if(!props?.treatAsChar)continue;
    }
    const rect=node.bbox,block={page:number,section,paragraph:node.pi,kind:node.type==='Table'?'table':'paragraph',
     ...(node.type==='Table'?{controlIndex:node.ci}:{}),column:column.col,rect,frame};
    blocks.push(block);
    const edges={left:frame.x-rect.x,top:frame.y-rect.y,right:rect.x+rect.w-right,bottom:rect.y+rect.h-bottom};
    const outside=Object.fromEntries(Object.entries(edges).filter(([,distance])=>distance>flowTolerance)
     .map(([edge,distance])=>[edge,Math.round(distance*10)/10]));
    if(Object.keys(outside).length){
     const rowHeights={};
     if(measureRows&&node.type==='Table')for(const cell of node.children.filter(child=>child.type==='Cell')){
      rowHeights[cell.row]=Math.max(rowHeights[cell.row]||0,cell.bbox.h);
     }
     overflows.push({...block,outside,...(measureRows?{rowHeights}:{})});
    }
   }
  }
 }
 return {pageCount,nextPage:lastPage<pageCount?lastPage+1:null,blocks,overflows};
}
export function inspectBodyFlow(wasm,options){
 const {pageCount,nextPage,overflows}=readBodyFlow(wasm,options);
 return {pageCount,nextPage,overflows};
}
const flowAddress=(section,paragraph)=>section+':'+paragraph;
const flowExtent=block=>Math.max(...Object.values(block.outside));
const flowLocation=block=>[block.section,block.paragraph,block.kind,block.controlIndex??'',Object.keys(block.outside).join()].join(':');
export function newBodyOverflows(original,current){
 const previous=new Map();
 for(const block of original)previous.set(flowLocation(block),Math.max(previous.get(flowLocation(block))||0,flowExtent(block)));
 return current.filter(block=>flowExtent(block)>(previous.get(flowLocation(block))||0)+flowTolerance/10);
}
export function reflowBody(wasm,{preferredBreaks,originalOverflows=[],target, ...options}={}){
 const attempted=new Set(),breaks=[];
 let audit=readBodyFlow(wasm,options);
 while(audit.overflows.length){
  const candidates=newBodyOverflows(originalOverflows,audit.overflows);
  let placement;
  for(const block of candidates){
   if(target&&(block.section!==target.section||block.paragraph!==target.paragraph))continue;
   if(!block.outside.bottom||block.outside.top||block.rect.h>block.frame.h+flowTolerance||block.rect.y<=block.frame.y+flowTolerance)continue;
   const sameFlow=item=>item.page===block.page&&item.column===block.column&&item.section===block.section;
   const paragraph=block.paragraph,preferred=preferredBreaks?.get(flowAddress(block.section,paragraph));
   for(const before of new Set([preferred,paragraph])){
    if(!Number.isSafeInteger(before)||attempted.has(flowAddress(block.section,before)))continue;
    const anchor=audit.blocks.find(item=>sameFlow(item)&&item.paragraph===before);
    if(!anchor||anchor.rect.y<=block.frame.y+flowTolerance||block.rect.y+block.rect.h-anchor.rect.y>block.frame.h+flowTolerance)continue;
    if(parsePageFlow(wasm.getParaPropertiesAt(block.section,before))?.pageBreakBefore)continue;
    placement={section:block.section,paragraph:before};
    break;
   }
   if(placement)break;
  }
  if(!placement)break;
  attempted.add(flowAddress(placement.section,placement.paragraph));
  const result=parsePageFlow(wasm.applyParaFormat(placement.section,placement.paragraph,JSON.stringify({pageBreakBefore:true})));
  if(result?.ok===false||result?.error)throw Error(result.error||'쪽 나누기를 적용하지 못했습니다.');
  wasm.flushDeferredPagination();
  breaks.push(placement);
  audit=readBodyFlow(wasm,options);
 }
 const {pageCount,nextPage,overflows}=audit;
 return {pageCount,nextPage,overflows:newBodyOverflows(originalOverflows,overflows),breaks};
}

export async function applyDesktopPageFlow({document,read,command}){
 const before=read(),expected=command.expected,keys=['documentEpoch','changeSeq','documentSha256'];
 if(!before?.ready||keys.some(key=>before.documentState?.[key]!==expected?.[key]))throw Error('문서가 변경되었습니다. 최신 상태에서 여백을 확인하세요.');
 const {page,count,target}=command,wasm=document.wasm;
 const options={page,count};
 if(page>wasm.pageCount)throw Error('확인할 쪽 번호를 다시 지정하세요.');
 if(!target)return {ok:true,undoSteps:0,changes:inspectBodyFlow(wasm,options)};
 const input=document.getInputHandler(),cursor=input.getCursorPosition();
 let changes;
 await input.executeDocumentAgentOperation({kind:'snapshot',operationType:'pwh-desktop-page-flow',operation:w=>{
  const preferredBreaks=new Map([[flowAddress(target.section,target.paragraph),target.beforeParagraph]]);
  changes=reflowBody(w,{...options,target,preferredBreaks});
  if(!changes.breaks.length)throw Error('지정한 문단은 쪽 나눔으로 이동할 수 없습니다. 여백이나 표 크기를 조정하고 다시 확인하세요.');
  const moved=changes.breaks.at(-1);
  const followup=inspectBodyFlow(w,{page,count:count+changes.breaks.length});
  if(followup.overflows.some(block=>block.section===moved.section&&block.paragraph===target.paragraph))
   throw Error('쪽 나누기 후에도 해당 내용이 여백을 넘습니다. 표 너비나 문단 배치를 조정하세요.');
  changes={...followup,breaks:changes.breaks};
  return cursor;
 }},()=>document.getCanvasView().refreshDocumentAgentMutation());
 return {ok:true,undoSteps:1,changes};
}
