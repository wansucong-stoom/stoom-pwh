import {randomUUID} from 'node:crypto';
import {sameRequestValue,sameRequestContext,normalizeRequestContext,queuedRequestContext} from './request-state.mjs';
const sessions=new Map(),tickets=new Map();
const requests=new Map();
const ttl=45000;
export function editorPoll(args){
 if(typeof args.sessionId!=='string'||!/^[a-f0-9-]{36}$/i.test(args.sessionId))throw Error('Invalid editor session');
 if(!args.context||JSON.stringify(args.context).length>160000)throw Error('Invalid editor context');
 const old=sessions.get(args.sessionId),session={...old,context:args.context,source:args.source,capabilities:args.capabilities||old?.capabilities||{},seen:Date.now(),commands:old?.commands||[]};
 sessions.set(args.sessionId,session);if(sessions.size>32)sessions.delete(sessions.keys().next().value);
 if(args.receipt){const ticket=tickets.get(args.receipt.ticketId);if(ticket?.sessionId===args.sessionId){Object.assign(ticket,{status:args.receipt.ok?'applied':'rejected',result:args.receipt,completedAt:Date.now()});const request=requests.get(ticket.requestId);if(request)request.status=ticket.status;}}
 if(args.receipt?.ok&&args.receipt.openedDocument)for(const r of requests.values())if(r.sessionId===args.sessionId&&r.context.documentState?.documentEpoch!==args.context.documentState?.documentEpoch&&r.status==='requested')r.status='expired';
 const commands=session.commands.splice(0,1);return {sessionId:args.sessionId,commands,tasks:[...requests.values()].filter(r=>r.sessionId===args.sessionId&&['requested','queued'].includes(r.status)).slice(-8).map(r=>({requestId:r.requestId,status:r.status,note:r.note.slice(0,80),kind:r.context.target?.kind||r.context.requestScope}))};
}
export function editorState(args={}){
 const active=[...sessions].filter(([,s])=>Date.now()-s.seen<ttl);
 const item=args.sessionId?active.find(([id])=>id===args.sessionId):active.length===1?active[0]:null;
 if(!item)throw Error(active.length>1?'여러 편집기가 열려 있습니다. sessionId를 지정하세요: '+JSON.stringify(active.map(([sessionId,s])=>({sessionId,source:s.source,selectedText:s.context?.selectedText?.text||''}))):'현재 연결된 편집기가 없습니다. HWPX 편집기를 열어 주세요.');
 return {sessionId:item[0],source:item[1].source,context:item[1].context,capabilities:item[1].capabilities||{},untrustedContent:true};
}
export async function editorOpen(args,register){
 const current=editorState({sessionId:args.sessionId});
 if(!current.capabilities.documentOpen)throw Error('The open editor predates direct document loading; reopen the editor once after updating');
 if(!args.expected||!sameRequestValue(current.context.documentState,args.expected.documentState))throw Error('Document changed; read current state before opening another document');
 if(current.context.documentState?.dirty)throw Error('Save the current document before opening another document');
 if(sessions.get(current.sessionId).commands.length)throw Error('Finish pending editor commands before opening another document');
 const document=await register(args.input);
 const latest=editorState({sessionId:current.sessionId});
 if(!sameRequestValue(latest.context.documentState,args.expected.documentState)||latest.context.documentState.dirty)throw Error('Document changed while preparing the new file');
 const ticketId=randomUUID(),ticket={ticketId,sessionId:current.sessionId,status:'pending',createdAt:Date.now()};
 tickets.set(ticketId,ticket);if(tickets.size>128)tickets.delete(tickets.keys().next().value);
 sessions.get(current.sessionId).commands.push({ticketId,type:'openDocument',expected:queuedRequestContext(args.expected).documentState,document});return {...ticket,document};
}
export function editorRewrite(args){
 args={...args,expected:queuedRequestContext(args.expected)};
 const current=editorState({sessionId:args.sessionId});
 if(!args.expected||(!args.expected.target&&!sameRequestContext(args.expected,current.context))||(args.expected.target&&args.expected.target.epoch!==current.context.documentState?.documentEpoch))throw Error('편집 상태가 바뀌었습니다. 최신 선택을 다시 읽으세요.');
 if(!args.expected.selection||!args.expected.selectedText?.text)throw Error('편집기에서 다시 쓸 텍스트를 드래그하세요.');
 if(typeof args.replacement!=='string'||args.replacement.length>12000)throw Error('Replacement too large');
 const ticketId=randomUUID(),ticket={ticketId,sessionId:args.sessionId,status:'pending',createdAt:Date.now()};
 if(args.expected?.target?.requestId){ticket.requestId=args.expected.target.requestId;const request=requests.get(ticket.requestId);if(request)request.status='queued';}
 tickets.set(ticketId,ticket);if(tickets.size>128)tickets.delete(tickets.keys().next().value);
 sessions.get(args.sessionId).commands.push({ticketId,expected:args.expected,replacement:args.replacement});
 return ticket;
}
export function editorCompose(args){
 args={...args,expected:queuedRequestContext(args.expected)};
 const current=editorState({sessionId:args.sessionId});
 if(!current.context.blankDocument||!sameRequestContext(current.context,args.expected))throw Error('빈 문서 상태가 바뀌었습니다. 최신 상태를 읽으세요.');
 const paragraphs=args.paragraphs;
 if(!Array.isArray(paragraphs)||!paragraphs.length||paragraphs.length>128||paragraphs.some(p=>!p||typeof p.text!=='string'||/[\r\n\u0000-\u0008\ufffc]/.test(p.text)||!['title','heading','body'].includes(p.role))||paragraphs.reduce((n,p)=>n+p.text.length,0)>24000||!paragraphs.some(p=>p.text.trim()))throw Error('초안 문단은 title/heading/body 역할과 텍스트를 가진 1~128개, 총 24000자 이내여야 합니다.');
 const ticketId=randomUUID(),ticket={ticketId,sessionId:args.sessionId,status:'pending',createdAt:Date.now()};
 if(args.expected?.target?.requestId){ticket.requestId=args.expected.target.requestId;const request=requests.get(ticket.requestId);if(request)request.status='queued';}
 tickets.set(ticketId,ticket);if(tickets.size>128)tickets.delete(tickets.keys().next().value);
 sessions.get(args.sessionId).commands.push({ticketId,type:'compose',expected:structuredClone(args.expected),paragraphs:structuredClone(paragraphs)});return ticket;
}
export function editorLayout(args){
 const current=editorState({sessionId:args.sessionId});
 if(!current.context.ready||!args.expected||current.context.documentState?.documentEpoch!==args.expected.documentState?.documentEpoch)throw Error('문서 상태가 바뀌었습니다. 최신 상태를 읽으세요.');
 const p=args.patch,keys=['paper','orientation','marginsMm'];
 if(!p||typeof p!=='object'||!Object.keys(p).length||Object.keys(p).some(k=>!keys.includes(k))||p.paper!==undefined&&!['A4','A3','B4','B5','Letter','Legal'].includes(p.paper)||p.orientation!==undefined&&!['portrait','landscape'].includes(p.orientation))throw Error('용지 설정을 확인하세요.');
 if(p.marginsMm!==undefined&&(!p.marginsMm||typeof p.marginsMm!=='object'||!Object.keys(p.marginsMm).length||Object.entries(p.marginsMm).some(([k,v])=>!['left','right','top','bottom','header','footer','gutter'].includes(k)||typeof v!=='number'||!Number.isFinite(v)||v<0||v>150)))throw Error('여백은 0~150mm 범위의 숫자여야 합니다.');
 if(args.sectionIndex!==undefined&&(!Number.isSafeInteger(args.sectionIndex)||args.sectionIndex<0))throw Error('구역 번호를 확인하세요.');
 const ticketId=randomUUID(),ticket={ticketId,sessionId:args.sessionId,status:'pending',createdAt:Date.now()};if(args.expected?.target?.requestId){ticket.requestId=args.expected.target.requestId;const request=requests.get(ticket.requestId);if(request)request.status='queued';}
 tickets.set(ticketId,ticket);if(tickets.size>128)tickets.delete(tickets.keys().next().value);
 sessions.get(args.sessionId).commands.push({ticketId,type:'layout',expected:structuredClone(args.expected),patch:structuredClone(p),...(args.sectionIndex===undefined?{}:{sectionIndex:args.sectionIndex})});return ticket;
}
export function editorTables(args){
 const current=editorState({sessionId:args.sessionId});
 if(!args.expected||args.expected.documentState?.documentEpoch!==current.context.documentState?.documentEpoch)throw Error('Document changed; inspect the current editor');
 return queueTableCommand(args,{type:'tables'});
}
export function editorTextSearch(args){
 const current=editorState({sessionId:args.sessionId});
 if(!current.capabilities.textEdit)throw Error('텍스트 검색·수정을 지원하는 새 편집기를 열어 주세요.');
 if(!args.expected||args.expected.documentState?.documentEpoch!==current.context.documentState?.documentEpoch)throw Error('문서가 다시 열렸습니다. 최신 상태를 읽으세요.');
 if(typeof args.query!=='string'||!args.query.length||args.query.length>12000||/[\r\n\u0000-\u0008\u000b-\u001f\ufffc]/.test(args.query)||args.cursor!==undefined&&(!Number.isSafeInteger(args.cursor)||args.cursor<0)||args.limit!==undefined&&(!Number.isSafeInteger(args.limit)||args.limit<1||args.limit>100))throw Error('텍스트 검색어와 범위를 확인하세요.');
 return queueTableCommand(args,{type:'textSearch',query:args.query,...(args.cursor===undefined?{}:{cursor:args.cursor}),...(args.limit===undefined?{}:{limit:args.limit})});
}
export function editorTextEdit(args){
 const current=editorState({sessionId:args.sessionId});
 if(!current.capabilities.textEdit)throw Error('텍스트 검색·수정을 지원하는 새 편집기를 열어 주세요.');
 if(!args.expected||args.expected.documentState?.documentEpoch!==current.context.documentState?.documentEpoch)throw Error('문서가 다시 열렸습니다. 최신 상태를 읽으세요.');
 if(!Array.isArray(args.edits)||!args.edits.length||args.edits.length>100||JSON.stringify(args.edits).length>160000||args.edits.some(e=>!e||typeof e.searchId!=='string'||typeof e.matchId!=='string'||typeof e.replacement!=='string'||e.replacement.length>12000||/[\r\n\u0000-\u0008\u000b-\u001f\ufffc]/.test(e.replacement)))throw Error('수정할 검색 결과와 텍스트를 확인하세요.');
 return queueTableCommand(args,{type:'textEdit',edits:structuredClone(args.edits)});
}
export async function editorTableFill(args){
 const current=editorState({sessionId:args.sessionId});
 if(!current.capabilities.tableContent)throw Error('Reopen the updated editor to enable table content editing');
 if(!args.expected||args.expected.documentState?.documentEpoch!==current.context.documentState?.documentEpoch)throw Error('Table request expired');
 const {validateCellEdits}=await import('./table-content.mjs');
 validateCellEdits(args.edits,args.expected.target?.kind==='table_cells'?args.expected.target.cells:undefined);
 if(args.expected.target?.kind!=='table_cells'&&(typeof args.planId!=='string'||!Number.isSafeInteger(args.tableIndex)||args.tableIndex<0))throw Error('Inspect the table first and supply planId/tableIndex');
 return queueTableCommand(args,{type:'tableFill',planId:args.planId,tableIndex:args.tableIndex,edits:structuredClone(args.edits)});
}
export async function editorTableInsert(args){
 const current=editorState({sessionId:args.sessionId});
 if(!current.capabilities.tableContent)throw Error('Reopen the updated editor to enable table insertion');
 if(!sameRequestContext(current.context,args.expected)||!current.context.ready||current.context.selection||current.context.cursor?.parentParaIndex!=null||current.context.cursor?.cellPath?.length||current.context.kind!=='body_text')throw Error('Read the current body cursor outside a table before inserting');
 const {validateTableSpec}=await import('./table-content.mjs');validateTableSpec(args.table);
 return queueTableCommand(args,{type:'tableInsert',table:structuredClone(args.table)});
}
export async function editorTableTitle(args){
 const current=editorState({sessionId:args.sessionId});
 if(!current.capabilities.tableTitle)throw Error('제목 행 기능이 있는 새 편집기를 열어 주세요.');
 if(!args.expected||args.expected.documentState?.documentEpoch!==current.context.documentState?.documentEpoch)throw Error('표 요청이 만료됐습니다.');
 if(typeof args.title!=='string'||!args.title.trim()||args.title.length>500||/[\r\n\u0000-\u001f\ufffc]/.test(args.title))throw Error('제목은 줄바꿈 없는 1~500자여야 합니다.');
 if(args.borders!==undefined)(await import('./table-style.mjs')).validateTableStyles([{cellIndex:0,borders:args.borders}],[0]);
 if(args.expected.target?.kind!=='table_cells'&&(typeof args.planId!=='string'||!Number.isSafeInteger(args.tableIndex)||args.tableIndex<0))throw Error('표를 먼저 분석하세요.');
 return queueTableCommand(args,{type:'tableTitle',planId:args.planId,tableIndex:args.tableIndex,title:args.title,...(args.borders?{borders:structuredClone(args.borders)}:{})});
}
export async function editorTableStyle(args){
 const current=editorState({sessionId:args.sessionId});
 if(!args.expected||args.expected.documentState?.documentEpoch!==current.context.documentState?.documentEpoch)throw Error('Document changed; inspect the current editor');
 const module=await import('./table-style.mjs');
 if(args.styles){
  if(args.expected.target?.kind!=='table_cells'&&(typeof args.planId!=='string'||!Number.isSafeInteger(args.tableIndex)||args.tableIndex<0))throw Error('Select cells or inspect the target table first');
  module.validateTableStyles(args.styles,args.expected.target?.kind==='table_cells'?args.expected.target.cells:args.styles.map(s=>s.cellIndex));
 }else{
  if(typeof args.planId!=='string'||!['table','document'].includes(args.scope)||args.scope==='table'&&(!Number.isInteger(args.tableIndex)||args.tableIndex<0))throw Error('Inspect the tables and provide a plan and scope');
  module.validateTheme(args.theme);
  if(args.headerRowsByTable&&Object.entries(args.headerRowsByTable).some(([k,v])=>!/^\d+$/.test(k)||!Number.isInteger(v)||v<0||v>10))throw Error('Invalid header row overrides');
 }
 return queueTableCommand(args,{type:'tableStyle',...(args.styles?{styles:structuredClone(args.styles),planId:args.planId,tableIndex:args.tableIndex}:{planId:args.planId,scope:args.scope,tableIndex:args.tableIndex,theme:structuredClone(args.theme),headerRowsByTable:structuredClone(args.headerRowsByTable||{})})});
}
function queueTableCommand(args,command){
 const ticketId=randomUUID(),ticket={ticketId,sessionId:args.sessionId,status:'pending',createdAt:Date.now()};
 const requestId=args.requestId||args.expected.target?.requestId;
 if(requestId){const request=requests.get(requestId);if(!request||request.sessionId!==args.sessionId)throw Error('Unknown request for this editor');if(['tableStyle','tableFill','tableInsert','tableTitle','textEdit'].includes(command.type)){ticket.requestId=requestId;request.status='queued';}}
 tickets.set(ticketId,ticket);if(tickets.size>128)tickets.delete(tickets.keys().next().value);
 sessions.get(args.sessionId).commands.push({ticketId,expected:structuredClone(args.expected),...command});return ticket;
}
export async function editorReplacePicture(args){
 args={...args,expected:queuedRequestContext(args.expected)};
 const current=editorState({sessionId:args.sessionId});
 if(!args.expected||(!args.expected.target&&!sameRequestContext(current.context,args.expected))||(args.expected.target&&args.expected.target.epoch!==current.context.documentState?.documentEpoch))throw Error('문서·선택 상태가 바뀌었습니다. 다시 읽으세요.');
 const objects=args.expected.objects,ref=objects?.[0]?.source;
 if(args.expected.kind!=='object'||objects?.length!==1||ref?.type!=='image'||ref.headerFooter||ref.noteRef||!objects[0].properties)throw Error('본문 또는 표 셀의 그림 하나를 선택하세요.');
 const image=await (await import('./replacement-image.mjs')).registerReplacementImage(args.image,args.sessionId);
 if(!args.expected.target&&!sameRequestContext(editorState({sessionId:args.sessionId}).context,args.expected))throw Error('이미지 검사 중 문서·선택이 바뀌었습니다.');
 const ticketId=randomUUID(),ticket={ticketId,sessionId:args.sessionId,status:'pending',createdAt:Date.now()};if(args.expected?.target?.requestId){ticket.requestId=args.expected.target.requestId;const request=requests.get(ticket.requestId);if(request)request.status='queued';}
 tickets.set(ticketId,ticket);if(tickets.size>128)tickets.delete(tickets.keys().next().value);
 sessions.get(args.sessionId).commands.push({ticketId,type:'replacePicture',expected:structuredClone(args.expected),image});return {...ticket,image,limitations:['기존 틀·자르기를 유지하고 비율이 다르면 contain 투명 여백을 추가합니다. 기존 crop에 의한 잘림은 시각적으로 확인하세요.']};
}
export function editorResult(args){const result=tickets.get(args.ticketId);if(!result)throw Error('Unknown editor ticket');return result;}
export function editorCapture(args){
 if(typeof args.note!=='string'||!args.note.trim()||args.note.length>4000)throw Error('수정 요청 내용을 작성하세요.');
 const c=normalizeRequestContext(structuredClone(args.context));
 // Older clients list at most 32 cells. A full-table rectangle still identifies
 // every cell by the native cell count, without guessing merged coordinates.
 const table=c?.table,range=table?.selectedRange,dim=table?.dimensions;
 if(c?.kind==='cell_block'&&!table?.selectedCellsComplete&&Array.isArray(table?.selectedCells)&&table.source?.cellPath?.length<=1&&Number.isSafeInteger(dim?.cellCount)&&dim.cellCount>0&&dim.cellCount<=256&&Number.isSafeInteger(dim.rowCount)&&Number.isSafeInteger(dim.colCount)&&range?.startRow===0&&range.startCol===0&&range.endRow===dim.rowCount-1&&range.endCol===dim.colCount-1){
  const known=new Map(table.selectedCells.map(cell=>[cell.cellIndex,cell]));
  table.selectedCells=Array.from({length:dim.cellCount},(_,cellIndex)=>known.get(cellIndex)||{cellIndex,source:{sec:table.source.sec,ppi:table.source.ppi,ci:table.source.ci,cellPath:[{controlIndex:table.source.ci,cellIndex,cellParaIndex:0}]}});
  table.selectedCellsComplete=true;table.selectionResolvedFrom='full_table_dimensions';
 }
 const text=!!c?.selection&&c.selectedText?.known&&!!c.selectedText.text&&!c.selectedText.truncated;
 const object=c?.ready&&c.kind==='object'&&Array.isArray(c.objects)&&c.objects.length>0&&c.objects.length<=16&&c.objects.every(o=>o?.source&&['image','shape','equation'].includes(o.source.type)&&['sec','ppi','ci'].every(k=>Number.isSafeInteger(o.source[k])&&o.source[k]>=0));
 const blank=c?.ready&&c.blankDocument===true;
 const cells=c?.ready&&c.kind==='cell_block'&&c.table?.selectedCellsComplete&&c.table?.selectedCells?.length>0;
 if(!text&&!object&&!blank&&!cells&&!(c?.ready&&c.requestScope==='document'&&c.documentState?.documentSha256))throw Error('텍스트를 드래그하거나 그림·도형을 선택하세요.');
 editorPoll({sessionId:args.sessionId,source:args.source,context:c});
 const requestId=randomUUID(),record=structuredClone({requestId,sessionId:args.sessionId,source:args.source,context:c,note:args.note,createdAt:Date.now(),untrustedContent:true});
 record.status='requested';if(record.context.target)record.context.target.requestId=requestId;
 requests.set(requestId,record);if(requests.size>128)requests.delete(requests.keys().next().value);return {requestId,sessionId:args.sessionId};
}
export function editorRequest(args){const record=requests.get(args.requestId);if(!record)throw Error('수정 요청이 만료됐습니다. 선택 영역에서 다시 요청하세요.');return structuredClone(record);}
