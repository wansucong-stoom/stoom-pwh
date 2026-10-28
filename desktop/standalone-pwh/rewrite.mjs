import {randomUUID} from 'node:crypto';

// The document is data; the model returns text only. The editor independently
// validates the captured target immediately before applying the result.
export async function rewriteSelection({request,session,generate,queue,readResult,notify=()=>{},wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 const c=request?.context,original=c?.selectedText?.text;
 if(!c?.selection||!c.selectedText?.known||c.selectedText.truncated||typeof original!=='string'||!original.trim())throw Error('먼저 수정할 글을 드래그해 선택해 주세요. 현재 시험판은 선택한 글 다시 쓰기를 지원합니다.');
 if(original.length>12000||typeof request.note!=='string'||!request.note.trim())throw Error('선택 내용 또는 요청이 허용 범위를 벗어났습니다.');
 notify('선택한 AI에 글과 요청을 보내고 있습니다.');
 const prompt=JSON.stringify({userInstruction:request.note,selectedDocumentText:original,requirements:'선택한 글만 고쳐서 결과 문장만 반환하세요. 문단 수와 순서를 유지하고 설명이나 코드 블록을 덧붙이지 마세요.'});
 const result=await generate({id:randomUUID(),action:'generate',usageConsent:true,accountId:session?.accountId,prompt});
 if(typeof result?.text!=='string'||!result.text.trim()||result.text.length>12000)throw Error('AI 결과를 적용할 수 없습니다.');
 if(result.text.split(/\r\n|\r|\n/).length!==original.split(/\r\n|\r|\n/).length)throw Error('Codex 결과의 문단 수가 달라 원문을 유지했습니다.');
 notify('수정할 위치가 그대로인지 확인하고 있습니다.');
 const ticket=await queue({sessionId:request.sessionId,expected:c,replacement:result.text});
 for(let n=0;n<90;n++){const receipt=await readResult({ticketId:ticket.ticketId});if(receipt.status==='applied'){notify('선택한 글을 수정했습니다. 실행 취소로 되돌릴 수 있습니다.');return receipt;}if(receipt.status==='rejected')throw Error(receipt.result?.error||'편집기에서 수정을 거절했습니다.');await wait(1000);}
 throw Error('편집기 응답을 확인하지 못했습니다. 문서를 확인하고 다시 요청하세요.');
}
