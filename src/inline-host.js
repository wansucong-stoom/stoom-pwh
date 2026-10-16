(()=>{
 const state={origin:null,id:0,documentId:null,source:null,sourceSha256:null,loading:false,loaded:false,sessionId:crypto.randomUUID(),receipt:null,host:{},checkpointSha:null};
 const pending=new Map(),status=text=>{const e=document.getElementById('pwh-status');if(e){e.textContent=text;e.title=text;}};
 const installed=new Promise(resolve=>window.addEventListener('pwh-editor-installed',resolve,{once:true}));
 const post=m=>parent.postMessage(m,state.origin&&state.origin!=='null'?state.origin:'*');
 const rpc=(method,params,timeout=45000)=>new Promise((resolve,reject)=>{const id=`pwh-inline-${++state.id}`,timer=setTimeout(()=>{pending.delete(id);reject(Error('편집기 연결 응답 시간이 초과되었습니다.'));},timeout);pending.set(id,{resolve,reject,timer});post({jsonrpc:'2.0',id,method,params});});
 const tool=async(name,args,timeout)=>{let r=await rpc('tools/call',{name,arguments:args},timeout);if(r?.isError)throw Error(r.content?.map(c=>c.text||'').join('\n')||'도구 실행 실패');return r;};
 const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
 async function asset(kind,documentId=state.documentId,updateState=true){let offset=0,hash,buffer;do{const r=await tool('pwh_client_asset',{kind,offset,...(hash?{expectedSha256:hash}:{}),...(documentId?{documentId}:{})}),m=r.structuredContent;
 if(!m||m.offset!==offset||!Number.isSafeInteger(m.totalBytes)||m.totalBytes<1||m.totalBytes>(kind==='document'?64:32)*1024*1024)throw Error('문서 자산 전송 오류');
 if(!buffer){hash=m.sha256;buffer=new Uint8Array(m.totalBytes);}if(hash!==m.sha256||buffer.length!==m.totalBytes)throw Error('문서가 전송 중 변경되었습니다.');
 if(kind==='document'&&updateState){state.source=m.source;state.sourceSha256=m.sha256;document.getElementById('pwh-title').textContent=m.name;}
 const bytes=Uint8Array.from(atob(r._meta?.['pwh/client-bytes']||''),x=>x.charCodeAt(0));if(!bytes.length||bytes.length>512*1024||offset+bytes.length>buffer.length)throw Error('문서 청크 오류');buffer.set(bytes,offset);offset+=bytes.length;
 }while(offset<buffer.length);if(await sha(buffer)!==hash)throw Error('문서 지문 검증 실패');return buffer;}
 let fontInstall;
 async function installSystemFonts(){
  await installed;const listeners=new Set();let snapshot=(await tool('pwh_client_fonts',{})).structuredContent;
  const provider={getSnapshot:async()=>snapshot,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},readFace:async(id,revision,signal)=>{
   let offset=0,bytes,hash,faceIndex;
   do{if(signal.aborted)throw Error('글꼴 요청 취소');const r=await tool('pwh_client_font_asset',{id,revision,offset}),m=r.structuredContent;
    if(m.offset!==offset||m.totalBytes>64*1024*1024)throw Error('글꼴 전송 오류');if(!bytes){bytes=new Uint8Array(m.totalBytes);hash=m.sha256;faceIndex=m.faceIndex;}
    if(hash!==m.sha256||bytes.length!==m.totalBytes)throw Error('글꼴 변경 감지');const part=Uint8Array.from(atob(r._meta?.['pwh/font-bytes']||''),x=>x.charCodeAt(0));if(!part.length||part.length>512*1024||offset+part.length>bytes.length)throw Error('글꼴 청크 오류');bytes.set(part,offset);offset+=part.length;
   }while(offset<bytes.length);if(await sha(bytes)!==hash)throw Error('글꼴 SHA 오류');return {bytes:bytes.buffer,faceIndex};
  }};
  await window.rhwpStudio.fonts.setProvider(provider);

 }
 const recoveryKey=()=>state.source+'|'+state.sourceSha256;
 async function checkpoint(context){
  if(!context.documentState.dirty||state.checkpointSha===context.documentState.documentSha256)return;
  const artifact=window.pwhEditor.export();if(artifact.contentLoss.count||artifact.bytes.length>8*1024*1024)return;
  await recoveryStore('put',recoveryKey(),{bytes:artifact.bytes.buffer.slice(artifact.bytes.byteOffset,artifact.bytes.byteOffset+artifact.bytes.byteLength),sha256:await sha(artifact.bytes),savedAt:Date.now(),source:state.source});state.checkpointSha=context.documentState.documentSha256;
 }
 async function offerRecovery(){
  try{let draft=await recoveryStore('get',recoveryKey());let legacy=false;if(!draft?.bytes){const candidates=(await window.pwhEditor.legacyDrafts()).filter(x=>x.fileName===state.source.split(/[\\/]/).pop()&&x.sourceFormat==='hwpx').sort((a,b)=>b.savedAt-a.savedAt);if(candidates.length){const old=candidates[0];draft={bytes:old.data,sha256:await sha(old.data),savedAt:old.savedAt};legacy=true;}}if(!draft?.bytes)return;
   const bytes=new Uint8Array(draft.bytes);if(bytes.length>8*1024*1024||await sha(bytes)!==draft.sha256||draft.sha256===await sha(window.pwhEditor.export().bytes))return;
   const recover=await new Promise(resolve=>{const dialog=document.createElement('dialog');dialog.innerHTML='<h2>미저장 편집 내용 복구</h2><p>이 문서의 임시 저장본이 있습니다. 복구할까요?</p><button class="restore">복구하기</button> <button class="source">저장본 열기</button>';if(legacy)dialog.querySelector('p').textContent='이전 편집기의 같은 파일명 임시본이 있습니다. 원본 경로는 확인할 수 없으므로 내용을 확인해 복구해 주세요.';document.body.appendChild(dialog);const done=value=>{dialog.close();dialog.remove();resolve(value);};dialog.querySelector('.restore').onclick=()=>done(true);dialog.querySelector('.source').onclick=()=>done(false);dialog.oncancel=e=>{e.preventDefault();done(false);};dialog.showModal();});
   if(recover){await window.pwhEditor.load(bytes,state.source.split(/[\\/]/).pop());window.pwhEditor.recovered();status('미저장 임시본을 복구했습니다. 새 수정본으로 저장해 주세요.');}
  }catch(error){console.warn('[pwh recovery]',error.message);}
 }
 async function consume(result){const d=result?._meta?.['pwh/client-document']||result?.structuredContent;if(d?.documentId)state.documentId=d.documentId;if(d?.source)state.source=d.source;
 if(state.loaded||state.loading)return;state.loading=true;try{const bytes=await asset('document');await installed;await window.pwhEditor.ready();try{fontInstall??=installSystemFonts();await fontInstall;}catch(error){console.warn('[pwh fonts]',error.message);}await window.pwhEditor.load(bytes,state.source.split(/[\\/]/).pop());await offerRecovery();state.loaded=true;status('본문에서 직접 편집하세요. 다시 쓸 부분을 드래그하고 채팅으로 요청할 수 있습니다.');void poll();}catch(e){state.loading=false;status(e.message);const retry=document.getElementById('pwh-retry');if(retry){retry.hidden=false;retry.onclick=()=>{retry.hidden=true;void consume({});};}}}
 window.addEventListener('message',event=>{if(event.source!==parent||event.data?.jsonrpc!=='2.0')return;if(state.origin!==null&&event.origin!==state.origin)return;const m=event.data,p=pending.get(m.id);if(p&&!m.method){state.origin=event.origin;clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);return;}if(m.method==='ui/notifications/tool-result')void consume(m.params);if(m.method==='ui/notifications/tool-input'&&m.params?.arguments?.file)void consume({});if(m.id!==undefined&&m.method==='ping')post({jsonrpc:'2.0',id:m.id,result:{}});});
 window.pwhWasmBytes=(async()=>{const init=await rpc('ui/initialize',{appInfo:{name:'pwh-inline-studio',version:'0.6.8'},appCapabilities:{availableDisplayModes:['inline','fullscreen']},protocolVersion:'2026-01-26'});state.host=init.hostCapabilities||{};post({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}});return asset('wasm');})();
 window.pwhWasmBytes.catch(e=>status(e.message));
 window.addEventListener('pwh-ai-request',event=>{
  if(!state.loaded||document.getElementById('pwh-ai-dialog'))return;
  const frozen=structuredClone(event.detail),dialog=document.createElement('dialog');dialog.id='pwh-ai-dialog';dialog.setAttribute('aria-label','AI 수정 요청');dialog.style.cssText='max-width:480px;width:90%;padding:20px;border:1px solid #bbb;border-radius:10px;background:white;color:#222';
  dialog.innerHTML='<form><h2>AI 수정 요청</h2><p class="selection" style="white-space:pre-wrap;max-height:100px;overflow:auto;background:#f4f4f4;padding:10px"></p><label>어떻게 수정할까요?<textarea aria-label="수정 요청 내용" maxlength="4000" required style="display:block;width:100%;min-height:100px;margin:10px 0"></textarea></label><p class="notice" role="status"></p><div style="display:flex;justify-content:flex-end;gap:8px"><button type="button" class="cancel">취소</button><button type="submit">요청 보내기</button></div></form>';
  dialog.querySelector('.selection').textContent=frozen.blankDocument?'빈 문서 — 어떤 문서를 작성할지 요청하세요.':frozen.requestScope==='document'?'문서 전체 — 용지 크기·방향·여백 등의 변경을 요청하세요.':frozen.kind==='cell_block'?'선택한 표 셀 '+(frozen.table?.selectedCells?.length||0)+'개':frozen.kind==='object'?'선택한 객체 '+frozen.objects.map(o=>({image:'그림',shape:'도형',equation:'수식'}[o.source.type]||o.source.type)).join(', '):(frozen.selectedText?.text||'').slice(0,500);document.body.appendChild(dialog);
  const note=dialog.querySelector('textarea'),notice=dialog.querySelector('.notice'),submit=dialog.querySelector('[type=submit]');
  submit.setAttribute('aria-keyshortcuts','Control+Enter');submit.title='요청 보내기 (Ctrl+Enter)';
  const shortcut=document.createElement('small');shortcut.textContent='Ctrl+Enter로 요청 보내기';note.after(shortcut);
  note.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.ctrlKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();event.stopPropagation();if(!event.repeat&&!submit.disabled)dialog.querySelector('form').requestSubmit(submit);}});
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.querySelector('.cancel').onclick=()=>dialog.close();
  dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();if(submit.disabled||!note.value.trim())return;submit.disabled=true;try{
   const current=window.pwhEditor.context();
   if(!frozen.target&&(JSON.stringify(current.objects)!==JSON.stringify(frozen.objects)||current.kind!==frozen.kind||JSON.stringify(current.selection)!==JSON.stringify(frozen.selection)||JSON.stringify(current.documentState)!==JSON.stringify(frozen.documentState)))throw Error('문서나 선택 영역이 바뀌었습니다. 다시 선택해 주세요.');
   if(!state.host.message?.text)throw Error('현재 호스트가 채팅 요청 전달 기능을 제공하지 않습니다.');
   if(current.documentState.documentEpoch!==frozen.documentState.documentEpoch)throw Error('문서가 다시 열렸습니다. 다시 요청하세요.');
   const capture=await tool('pwh_editor_capture',{sessionId:state.sessionId,source:state.source,context:frozen,note:note.value.trim()});
   const requestId=capture.structuredContent.requestId;
   const params={role:'user',content:[{type:'text',text:(frozen.blankDocument?'빈 편집기에 문서를 작성해 주세요. pwh_editor_request로 요청을 읽고 최신 pwh_editor_state와 대조한 뒤 pwh_editor_compose로 제목·소제목·본문 문단을 같은 편집기에 작성하고 결과를 확인하세요.\n\n':frozen.kind==='cell_block'?'선택한 표 셀의 수정 요청입니다. pwh_editor_request의 table.selectedCells와 최신 상태를 대조하세요. 문서 전체 요청으로 확대하지 마세요.\n\n':frozen.kind==='object'?'편집기에서 선택한 객체의 수정 요청입니다. pwh_editor_request로 객체 주소와 속성을 확인하고 지원되는 객체 편집 경로를 사용하세요. 텍스트 다시 쓰기로 처리하지 마세요.\n\n':frozen.requestScope==='document'?'문서 전체 수정 요청입니다. pwh_editor_request와 최신 pwh_editor_state를 확인하세요. 용지·방향·여백은 pwh_editor_layout으로 같은 문서에 적용하고 결과를 확인하세요.\n\n':'편집기에서 선택한 부분을 기존 서식에 맞춰 수정해 주세요.\n\n')+note.value.trim()+'\n\n편집기 요청 ID: '+requestId}]};
   if(state.host.experimental?.['openai/message']||state.host.extensions?.['openai/message'])params._meta={'openai/message':{target:'active',send:true}};
   const sent=await rpc('ui/message',params);if(sent?.isError)throw Error('호스트가 수정 요청을 받지 못했습니다.');dialog.close();status('선택 영역의 AI 수정 요청을 채팅으로 전달했습니다.');
  }catch(error){notice.textContent=error.message;}finally{submit.disabled=false;}};
  dialog.showModal();note.focus();
 });
 async function replacementBytes(image){
  let offset=0;const bytes=new Uint8Array(image.totalBytes);if(bytes.length>8*1024*1024)throw Error('교체 이미지가 너무 큽니다.');
  while(offset<bytes.length){const r=await tool('pwh_client_image_asset',{assetId:image.assetId,sessionId:state.sessionId,offset}),m=r.structuredContent;
   if(m.offset!==offset||m.sha256!==image.sha256||m.totalBytes!==bytes.length)throw Error('이미지 전송 정보 오류');
   const part=Uint8Array.from(atob(r._meta?.['pwh/image-bytes']||''),x=>x.charCodeAt(0));if(!part.length||part.length>512*1024||offset+part.length>bytes.length)throw Error('이미지 청크 오류');bytes.set(part,offset);offset+=part.length;
  }
  if(await sha(bytes)!==image.sha256)throw Error('이미지 SHA 검증 실패');
  const bitmap=await createImageBitmap(new Blob([bytes],{type:image.mediaType}));try{if(bitmap.width!==image.width||bitmap.height!==image.height)throw Error('이미지 실제 크기 불일치');}finally{bitmap.close();}return bytes;
 }
 async function openDocument(command){
  const before=window.pwhEditor.context().documentState;
  if(before.dirty||JSON.stringify(before)!==JSON.stringify(command.expected))throw Error('현재 문서가 바뀌었거나 미저장 변경이 있어 열지 않았습니다.');
  status('요청한 문서를 불러오고 있습니다.');
  const doc=command.document,bytes=await asset('document',doc.documentId,false);
  const latest=window.pwhEditor.context().documentState;
  if(latest.dirty||JSON.stringify(latest)!==JSON.stringify(command.expected))throw Error('전송 중 현재 문서가 수정되어 열지 않았습니다.');
  await window.pwhEditor.openClean(bytes,doc.name,command.expected,state.source.split(/[\\/]/).pop());
  state.documentId=doc.documentId;state.source=doc.source;state.sourceSha256=doc.sourceSha256;state.checkpointSha=null;
  document.getElementById('pwh-title').textContent=doc.name;document.getElementById('pwh-title').title=doc.source;
  return {ok:true,openedDocument:{source:doc.source,name:doc.name,pageCount:window.pwhEditor.context().documentState.pageCount}};
 }
 async function poll(){if(!state.loaded)return;try{const context=window.pwhEditor.context();try{await checkpoint(context);}catch(error){console.warn('[pwh checkpoint]',error.message);}const r=await tool('pwh_editor_poll',{sessionId:state.sessionId,source:state.source,context,capabilities:{documentOpen:true},...(state.receipt?{receipt:state.receipt}:{})});state.receipt=null;const taskLabel=document.getElementById('pwh-task');if(taskLabel){const tasks=r.structuredContent?.tasks||[];taskLabel.textContent=tasks.length?'AI 요청 '+tasks.length+'건 · '+tasks[tasks.length-1].note:'';taskLabel.title=tasks.map(t=>t.note).join('\n');}for(const command of r.structuredContent?.commands||[]){try{const result=await (command.type==='openDocument'?await openDocument(command):command.type==='tables'?window.pwhEditor.tables(command):command.type==='tableStyle'?window.pwhEditor.tableStyle(command):command.type==='replacePicture'?window.pwhEditor.replacePicture(command,await replacementBytes(command.image)):command.type==='layout'?window.pwhEditor.layout(command):command.type==='compose'?window.pwhEditor.compose(command):window.pwhEditor.rewrite(command));state.receipt={ticketId:command.ticketId,ok:true,undoSteps:result.undoSteps,...(result.openedDocument?{openedDocument:result.openedDocument}:{}),...(result.tablePlan?{tablePlan:result.tablePlan}:{}),...(result.changes?{changes:result.changes}:{}),...(result.replacement?{replacement:result.replacement}:{})};status(command.type==='openDocument'?'요청한 문서를 편집기에 열었습니다.':command.type==='tables'?'표 서식 분석을 완료했습니다.':'선택한 영역에 GPT 수정을 반영했습니다. 실행 취소로 되돌릴 수 있습니다.');}catch(e){state.receipt={ticketId:command.ticketId,ok:false,error:e.message};status(e.message);}}}catch(e){status(e.message);}finally{setTimeout(poll,1500);}}
 document.addEventListener('DOMContentLoaded',()=>{document.getElementById('pwh-save').onclick=async()=>{
  const button=document.getElementById('pwh-save');if(button.disabled)return;button.disabled=true;let transferId=null;
  try{
   status('저장할 폴더와 파일명을 선택하세요.');
   const choice=(await tool('pwh_client_save_dialog',{documentId:state.documentId,expectedSourceSha256:state.sourceSha256},310000)).structuredContent;
   if(choice.cancelled){status('저장을 취소했습니다.');return;}
   const artifact=window.pwhEditor.export(),exportSeq=window.pwhEditor.context().documentState.changeSeq;
   if(artifact.contentLoss.count)throw Error('내용 손실이 보고되어 저장하지 않았습니다.');
   const bytes=artifact.bytes;if(bytes.length>64*1024*1024)throw Error('현재 문서 저장 한도는 64 MiB입니다.');
   const started=(await tool('pwh_client_save_begin',{documentId:state.documentId,saveTicket:choice.saveTicket,totalBytes:bytes.length,expectedSourceSha256:state.sourceSha256,documentSha256:await sha(bytes)})).structuredContent;
   transferId=started.transferId;
   for(let offset=0;offset<bytes.length;){
    const part=bytes.subarray(offset,Math.min(offset+started.chunkBytes,bytes.length));let encoded='';for(let i=0;i<part.length;i+=8192)encoded+=String.fromCharCode(...part.subarray(i,i+8192));
    const result=(await tool('pwh_client_save_chunk',{transferId,offset,base64:btoa(encoded)})).structuredContent;
    if(result.nextOffset!==offset+part.length)throw Error('저장 전송 순서가 일치하지 않습니다.');offset=result.nextOffset;
    status('문서 저장 중 '+Math.round(offset/bytes.length*100)+'%');
   }
   status('문서를 다시 열어 검증하고 있습니다.');
   const d=(await tool('pwh_client_save_commit',{transferId},120000)).structuredContent;transferId=null;
   await recoveryStore('delete',recoveryKey()).catch(()=>{});state.checkpointSha=null;state.documentId=d.documentId;state.source=d.path;state.sourceSha256=d.sourceSha256;
   const same=window.pwhEditor.context().documentState.changeSeq===exportSeq;
   if(same)await window.pwhEditor.saved(d.path.split(/[\\/]/).pop());
   status(`저장 완료: ${d.path}`+(same?'':' — 저장 중 추가한 변경은 아직 미저장 상태입니다.'));
  }catch(e){if(transferId)await tool('pwh_client_save_abort',{transferId}).catch(()=>{});status(e.message);}finally{button.disabled=false;}
 };});
})();
