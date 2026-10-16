import {randomUUID} from 'node:crypto';
const sessions=new Map(),tickets=new Map();
const requests=new Map();
const ttl=45000;
export function editorPoll(args){
 if(typeof args.sessionId!=='string'||!/^[a-f0-9-]{36}$/i.test(args.sessionId))throw Error('Invalid editor session');
 if(!args.context||JSON.stringify(args.context).length>160000)throw Error('Invalid editor context');
 const old=sessions.get(args.sessionId),session={...old,context:args.context,source:args.source,seen:Date.now(),commands:old?.commands||[]};
 sessions.set(args.sessionId,session);if(sessions.size>32)sessions.delete(sessions.keys().next().value);
 if(args.receipt){const ticket=tickets.get(args.receipt.ticketId);if(ticket?.sessionId===args.sessionId)Object.assign(ticket,{status:args.receipt.ok?'applied':'rejected',result:args.receipt,completedAt:Date.now()});}
 const commands=session.commands.splice(0,1);return {sessionId:args.sessionId,commands};
}
export function editorState(args={}){
 const active=[...sessions].filter(([,s])=>Date.now()-s.seen<ttl);
 const item=args.sessionId?active.find(([id])=>id===args.sessionId):active.length===1?active[0]:null;
 if(!item)throw Error(active.length>1?'여러 편집기가 열려 있습니다. sessionId를 지정하세요: '+JSON.stringify(active.map(([sessionId,s])=>({sessionId,source:s.source,selectedText:s.context?.selectedText?.text||''}))):'현재 연결된 편집기가 없습니다. HWPX 편집기를 열어 주세요.');
 return {sessionId:item[0],source:item[1].source,context:item[1].context,untrustedContent:true};
}
export function editorRewrite(args){
 const current=editorState({sessionId:args.sessionId});
 if(!args.expected||JSON.stringify(args.expected)!==JSON.stringify(current.context))throw Error('편집 상태가 바뀌었습니다. 최신 선택을 다시 읽으세요.');
 if(!current.context.selection||!current.context.selectedText?.text)throw Error('편집기에서 다시 쓸 텍스트를 드래그하세요.');
 if(typeof args.replacement!=='string'||args.replacement.length>12000)throw Error('Replacement too large');
 const ticketId=randomUUID(),ticket={ticketId,sessionId:args.sessionId,status:'pending',createdAt:Date.now()};
 tickets.set(ticketId,ticket);if(tickets.size>128)tickets.delete(tickets.keys().next().value);
 sessions.get(args.sessionId).commands.push({ticketId,expected:args.expected,replacement:args.replacement});
 return ticket;
}
export function editorResult(args){const result=tickets.get(args.ticketId);if(!result)throw Error('Unknown editor ticket');return result;}
export function editorCapture(args){
 if(typeof args.note!=='string'||!args.note.trim()||args.note.length>4000)throw Error('수정 요청 내용을 작성하세요.');
 if(!args.context?.selection||!args.context.selectedText?.known||!args.context.selectedText.text||args.context.selectedText.truncated)throw Error('텍스트를 드래그해 선택하세요.');
 editorPoll({sessionId:args.sessionId,source:args.source,context:args.context});
 const requestId=randomUUID(),record=structuredClone({requestId,sessionId:args.sessionId,source:args.source,context:args.context,note:args.note,createdAt:Date.now(),untrustedContent:true});
 requests.set(requestId,record);if(requests.size>128)requests.delete(requests.keys().next().value);return {requestId,sessionId:args.sessionId};
}
export function editorRequest(args){const record=requests.get(args.requestId);if(!record)throw Error('수정 요청이 만료됐습니다. 선택 영역에서 다시 요청하세요.');return structuredClone(record);}
