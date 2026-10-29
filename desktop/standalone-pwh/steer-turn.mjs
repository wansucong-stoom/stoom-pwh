// Do not retry: an uncertain acknowledgement could already have been accepted.
export async function steerTurn(client,threadId,turnId,note){
 if(!turnId)throw Error('Codex 작업이 아직 시작되지 않았거나 이미 끝났습니다. 잠시 후 확인해 주세요.');
 if(typeof note!=='string'||!note.trim()||note.length>4000)throw Error('추가 지시를 4000자 이내로 입력하세요.');
 const result=await client.request('turn/steer',{threadId,expectedTurnId:turnId,input:[{type:'text',text:note,text_elements:[]}]});
 if(result?.turnId!==turnId)throw Error('추가 지시의 접수 여부를 확인하지 못했습니다. 작업 상태를 확인해 주세요.');
 return {accepted:true};
}
