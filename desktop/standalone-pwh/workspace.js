(()=>{
 const $=id=>document.getElementById(id),tabs=new Map(),pending=new Map();
 let active=null,starting=false,closingTabs=0,updateLocked=false,closeLocked=false,closingWindow=false,allowUnload=false;
 window.__pwhWorkspaceCloseProtocol=true;
 window.__pwhDropFiles=new Map();
 function publishWorkspace(){
  const view={type:'pwh-workspace-view',tabs:[...tabs.values()].map(t=>({id:t.id,name:t.title||'새 문서',dirty:t.dirty,active:t.id===active})),locked:updateLocked||closeLocked||starting,status:$('workspace-status').textContent,update:{hidden:$('workspace-update').hidden,disabled:$('workspace-update').disabled,text:$('workspace-update').textContent},codex:{hidden:$('codex-plugin-retry').hidden,disabled:$('codex-plugin-retry').disabled}};
  for(const tab of tabs.values())tab.frame.contentWindow?.postMessage(view,tab.origin);
 }

 const api=async(route,data={})=>{
  const response=await fetch(route,{method:'POST',headers:{'content-type':'application/json','x-pwh-request':'1'},body:JSON.stringify(data)});
  const value=await response.json();if(!response.ok)throw Error(value.error||'문서 탭을 열지 못했습니다.');return value;
 };
 let recentRevision=0;
 async function refreshHome(){
  const revision=++recentRevision;
  try{
   const {documents}=await api('recent/list');if(revision!==recentRevision)return;
   const list=$('home-recent-list');list.replaceChildren();$('home-empty').hidden=documents.length!==0;$('home-status').textContent='';
   for(const item of documents){
    const row=document.createElement('div');row.className='recent-row'+(item.available?'':' recent-missing');
    const open=document.createElement('button');open.type='button';open.className='recent-open';open.title=item.path;open.setAttribute('aria-label',item.name+' 열기');open.onclick=()=>void openFromHome('recent/open',{id:item.id});
    const icon=document.createElement('span');icon.className='recent-icon';icon.setAttribute('aria-hidden','true');icon.textContent=item.name.toLowerCase().endsWith('.hwpx')?'HWPX':'HWP';
    const details=document.createElement('span');details.className='recent-details';const name=document.createElement('span');name.className='recent-name';name.textContent=item.name;const path=document.createElement('span');path.className='recent-path';path.textContent=item.path;details.append(name,path);
    const date=document.createElement('span');date.className='recent-time';date.textContent=item.available?new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'short',day:'numeric'}).format(new Date(item.openedAt)):'파일을 열 수 없음';
    const remove=document.createElement('button');remove.type='button';remove.className='recent-remove';remove.textContent='×';remove.title='최근 문서 목록에서 제거';remove.setAttribute('aria-label',item.name+' 최근 문서 목록에서 제거');remove.onclick=async()=>{try{await api('recent/remove',{id:item.id});await refreshHome();}catch(error){$('home-status').textContent=error.message;}};
    open.append(icon,details,date);row.append(open,remove);list.append(row);
   }
   setFrozen();
  }catch(error){if(revision===recentRevision)$('home-status').textContent='최근 문서를 불러오지 못했습니다. '+error.message;}
 }
 function showHome({focus=false}={}){
  active=null;$('home-view').hidden=false;document.body.classList.remove('integrated-tabs');
  for(const tab of tabs.values()){tab.frame.hidden=true;tab.element.setAttribute('aria-selected','false');tab.name.tabIndex=0;}
  publishWorkspace();void refreshHome();if(focus)$('home-title').focus({preventScroll:true});
 }
 function activate(id){
  const tab=tabs.get(id);if(!tab)return;active=id;$('home-view').hidden=true;document.body.classList.toggle('integrated-tabs',tab.tabsReady===true);
  for(const [key,item] of tabs){const selected=key===id;item.frame.hidden=!selected;item.element.setAttribute('aria-selected',String(selected));item.name.tabIndex=selected?0:-1;}publishWorkspace();
 }
 function add({id,url}){
  const element=document.createElement('div');element.className='tab';element.setAttribute('role','tab');element.setAttribute('aria-selected','false');
  const name=document.createElement('button');name.className='tab-name';name.type='button';name.textContent='새 문서';name.onclick=()=>activate(id);
  const close=document.createElement('button');close.className='tab-close';close.type='button';close.textContent='×';close.title='문서 닫기';close.setAttribute('aria-label','문서 닫기');close.onclick=()=>void closeTab(id);
  element.append(name,close);$('tabs').append(element);
  const frame=document.createElement('iframe'),childUrl=new URL(url);childUrl.searchParams.set('workspaceOrigin',location.origin);frame.src=childUrl.href;frame.title='문서와 AI 대화';frame.hidden=true;$('documents').append(frame);
  tabs.set(id,{id,url,origin:new URL(url).origin,frame,element,name,title:'새 문서',dirty:true,busy:false,ready:false,tabsReady:false});activate(id);
 }
 function request(tab,kind,extra={},timeout=4000){
  return new Promise(resolve=>{
   const requestId=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(requestId);resolve(null);},timeout);
   pending.set(requestId,{id:tab.id,kind,resolve,timer});
   tab.frame.contentWindow.postMessage({type:kind==='inspect'?'pwh-workspace-inspect':'pwh-workspace-command',requestId,...extra},tab.origin);
  });
 }
 const inspect=tab=>request(tab,'inspect');
 const command=(tab,action,expected)=>request(tab,'command',{action,...expected?{expected}:{}},action==='save'?310000:10000);
 const setFrozen=()=>{const locked=updateLocked||closeLocked;$('documents').inert=locked;$('tabs').inert=locked;$('new-tab').disabled=locked||starting;$('workspace-home').disabled=locked||starting;for(const button of $('home-view').querySelectorAll('button'))button.disabled=locked||starting;publishWorkspace();};
 const freeze=value=>{updateLocked=value;setFrozen();};

 function askToSave(name){
  return new Promise(resolve=>{
   const dialog=document.createElement('dialog');dialog.className='workspace-close-dialog';dialog.setAttribute('aria-labelledby','workspace-close-title');dialog.setAttribute('aria-describedby','workspace-close-description');
   dialog.innerHTML='<h2 id="workspace-close-title">변경 내용 저장</h2><p id="workspace-close-description"></p><div class="workspace-close-actions"><button type="button" data-choice="save">저장</button><button type="button" data-choice="discard">저장하지 않음</button><button type="button" data-choice="cancel">취소</button></div>';
   dialog.querySelector('p').textContent='‘'+name+'’의 변경 내용을 저장할까요?';document.body.appendChild(dialog);let done=false;
   const finish=value=>{if(done)return;done=true;dialog.close();dialog.remove();resolve(value);};
   dialog.querySelectorAll('button').forEach(button=>button.onclick=()=>finish(button.dataset.choice));
   dialog.oncancel=event=>{event.preventDefault();finish('cancel');};dialog.showModal();dialog.querySelector('[data-choice="save"]').focus();
  });
 }
 function askToCloseUnavailable(name){
  return new Promise(resolve=>{
   const dialog=document.createElement('dialog');dialog.className='workspace-close-dialog';dialog.setAttribute('aria-labelledby','workspace-unavailable-title');
   dialog.innerHTML='<h2 id="workspace-unavailable-title">문서 상태 확인 불가</h2><p></p><div class="workspace-close-actions"><button type="button" data-choice="close">그래도 닫기</button><button type="button" data-choice="cancel">취소</button></div>';
   dialog.querySelector('p').textContent='‘'+name+'’의 저장 상태를 확인하지 못했습니다. 저장 여부를 확인하지 않고 닫을까요? 이미 보관된 복구본은 유지됩니다.';
   document.body.appendChild(dialog);let done=false;const finish=value=>{if(done)return;done=true;dialog.close();dialog.remove();resolve(value);};
   dialog.querySelectorAll('button').forEach(button=>button.onclick=()=>finish(button.dataset.choice));dialog.oncancel=event=>{event.preventDefault();finish('cancel');};dialog.showModal();dialog.querySelector('[data-choice="cancel"]').focus();
  });
 }
 async function decide(tab){
  const state=await inspect(tab);
  if(!state?.ready||!state.documentState){activate(tab.id);return await askToCloseUnavailable(state?.name||tab.title||'문서')==='close'?{tab,skipPrepare:true}:null;}
  if(state.busy)throw Error('AI 작업이나 저장이 진행 중입니다. 작업을 마친 뒤 다시 닫아 주세요.');
  if(!state.dirty)return {tab,state};
  activate(tab.id);const choice=await askToSave(state.name||'새 문서');if(choice==='cancel')return null;
  if(choice==='save'){
   const result=await command(tab,'save');if(!result?.ok)throw Error(result?.error||'저장이 취소되었거나 완료되지 않아 닫지 않았습니다.');
   const saved=await inspect(tab);if(!saved?.ready||saved.dirty||saved.busy||!saved.documentState)throw Error('저장 후 문서 상태를 확인하지 못해 닫지 않았습니다.');
   return {tab,state:saved};
  }
  return {tab,state};
 }
 async function prepare(item){
  if(item.skipPrepare)return;
  const current=await inspect(item.tab),a=item.state.documentState,b=current?.documentState;
  if(!current?.ready||current.busy||!b||a.documentEpoch!==b.documentEpoch||a.changeSeq!==b.changeSeq||a.dirty!==b.dirty)throw Error('닫는 동안 문서가 변경되어 다시 확인해야 합니다.');
  const result=await command(item.tab,'prepare-close',b);if(!result?.ok)throw Error(result?.error||'문서 복구 상태를 정리하지 못해 닫지 않았습니다.');
 }
 async function rollback(items){for(const item of items)if(!item.skipPrepare)await command(item.tab,'abort-close');}

 async function closeTab(id){
  const tab=tabs.get(id);if(!tab||updateLocked||closeLocked||starting)return;closingTabs++;closeLocked=true;setFrozen();let prepared=false;
  try{
   const item=await decide(tab);if(!item)return;
   prepared=!item.skipPrepare;await prepare(item);
   await api('tabs/close',{id});tab.frame.remove();tab.element.remove();tabs.delete(id);if(active===id){if(tabs.size)activate(tabs.keys().next().value);else showHome({focus:true});}else if(active===null)void refreshHome();publishWorkspace();$('workspace-status').textContent='';
  }catch(error){
   if(prepared)await command(tab,'abort-close');
   $('workspace-status').textContent=error.message;
  }finally{closingTabs--;closeLocked=false;setFrozen();}
 }
 async function closeWindow(){
  if(closingWindow||updateLocked||closeLocked||starting||closingTabs)return;
  closingWindow=true;closeLocked=true;setFrozen();const prepared=[];let requested=false;
  try{
   const decisions=[];
   for(const tab of tabs.values()){const item=await decide(tab);if(!item)return;decisions.push(item);}
   for(const item of decisions){prepared.push(item);await prepare(item);}
   allowUnload=true;await api('native/request-close');requested=true;
   setTimeout(async()=>{
    allowUnload=false;await rollback(prepared);closeLocked=false;closingWindow=false;setFrozen();$('workspace-status').textContent='앱 창을 닫지 못했습니다. 문서 상태를 확인해 주세요.';
   },5000);
  }catch(error){allowUnload=false;await rollback(prepared);$('workspace-status').textContent=error.message;}
  finally{if(!requested){closeLocked=false;closingWindow=false;setFrozen();}}
 }
 window.addEventListener('pwh-native-close-request',()=>void closeWindow());
 window.addEventListener('message',event=>{
  if(!event.data||!['pwh-workspace-state','pwh-workspace-command-result','pwh-workspace-tabs-ready','pwh-workspace-ui','pwh-workspace-drop','pwh-workspace-focus-needed'].includes(event.data.type))return;
  const tab=[...tabs.values()].find(item=>item.frame.contentWindow===event.source&&item.origin===event.origin);if(!tab)return;
  const state=event.data;
  if(state.type==='pwh-workspace-focus-needed'){
   if(active===tab.id&&document.hasFocus()&&(document.activeElement===document.body||document.activeElement===tab.frame))tab.frame.contentWindow.postMessage({type:'pwh-workspace-focus-editor'},tab.origin);
   return;
  }
  if(state.type==='pwh-workspace-drop'){void openDroppedFiles(state.files);return;}
  if(state.type==='pwh-workspace-tabs-ready'){tab.tabsReady=true;if(active===tab.id)document.body.classList.add('integrated-tabs');publishWorkspace();return;}
  if(state.type==='pwh-workspace-ui'){
   if(state.action==='activate'&&typeof state.id==='string')activate(state.id);
   else if(state.action==='close'&&typeof state.id==='string')void closeTab(state.id);
   else if(state.action==='new')$('new-tab').click();
   else if(state.action==='home')showHome({focus:true});
   else if(state.action==='update')$('workspace-update').click();
   else if(state.action==='codex')$('codex-plugin-retry').click();
   return;
  }
  if(state.type==='pwh-workspace-state'){
   tab.ready=state.ready===true;tab.dirty=state.dirty!==false;tab.busy=state.busy===true;tab.title=typeof state.name==='string'&&state.name?state.name:'새 문서';tab.name.textContent=tab.title+(tab.dirty?' ●':'');tab.name.title=tab.title+(tab.dirty?' · 저장되지 않은 변경':'')+(tab.busy?' · AI 작업 중':'');publishWorkspace();
  }
  const wait=pending.get(state.requestId),kind=state.type==='pwh-workspace-state'?'inspect':'command';
  if(wait&&wait.id===tab.id&&wait.kind===kind){clearTimeout(wait.timer);pending.delete(state.requestId);wait.resolve(state);}
 });
 window.addEventListener('beforeunload',event=>{if(!allowUnload&&[...tabs.values()].some(tab=>tab.dirty||tab.busy||!tab.ready)){event.preventDefault();event.returnValue='';}});
 window.addEventListener('pagehide',()=>navigator.sendBeacon('tabs/closing'));
 async function openDroppedFiles(input){
  if(starting||updateLocked||closeLocked){$('workspace-status').textContent='현재 작업을 마친 뒤 파일을 열어 주세요.';return;}
  const files=Array.from(input||[]);if(!files.length)return;if(files.length>12||files.some(file=>!(file instanceof File)||!/\.hwpx?$/i.test(file.name)||file.size<8||file.size>64*1024*1024)){$('workspace-status').textContent='64 MiB 이하의 HWP 또는 HWPX 파일을 놓아 주세요.';return;}
  if(tabs.size+files.length>12){$('workspace-status').textContent='문서는 최대 12개까지 열 수 있습니다.';return;}
  starting=true;setFrozen();const id=crypto.randomUUID();window.__pwhDropFiles.set(id,files);
  try{
   let result;try{result=await api('native/drop-open',{id,count:files.length});}
   catch{
    // If the native path is unavailable, open an independent staged copy.
    // Its save target is deliberately unset so it cannot silently save to temp.
    result={opened:[],errors:[]};for(const file of files){try{const response=await fetch('tabs/import',{method:'POST',headers:{'x-pwh-request':'1','x-pwh-filename':encodeURIComponent(file.name)},body:await file.arrayBuffer()});const value=await response.json();if(!response.ok)throw Error(value.error);result.opened.push(value);}catch(error){result.errors.push(file.name+': '+error.message);}}
   }
   for(const tab of result.opened)add(tab);$('workspace-status').textContent=result.errors.length?result.errors.join(' · '):'';
  }finally{window.__pwhDropFiles.delete(id);starting=false;setFrozen();}
 }
 document.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files')&&Array.from(event.dataTransfer.items).some(item=>item.kind==='file'&&!item.type.startsWith('image/'))){event.preventDefault();event.dataTransfer.dropEffect='copy';}},true);
 document.addEventListener('drop',event=>{if(Array.from(event.dataTransfer?.files||[]).some(file=>/\.hwpx?$/i.test(file.name))){event.preventDefault();event.stopPropagation();if(event.isTrusted)void openDroppedFiles(event.dataTransfer.files);}},true);
 const viewObserver=new MutationObserver(()=>publishWorkspace());for(const id of ['workspace-status','workspace-update','codex-plugin-retry'])viewObserver.observe($(id),{childList:true,characterData:true,attributes:true,subtree:true});
 $('workspace-home').onclick=()=>{if(!starting&&!updateLocked&&!closeLocked)showHome({focus:true});};
 $('home-refresh').onclick=()=>void refreshHome();
 $('home-new').onclick=()=>$('new-tab').click();
 async function openFromHome(route,data={}){
  if(starting||updateLocked||closeLocked)return;starting=true;setFrozen();$('home-status').textContent='';
  try{const result=await api(route,data);if(!result.cancelled)add(result);$('workspace-status').textContent='';}
  catch(error){$('home-status').textContent=error.message;}
  finally{starting=false;setFrozen();}
 }
 $('home-open').onclick=()=>void openFromHome('tabs/open');
 $('new-tab').onclick=async()=>{if(starting||updateLocked||closeLocked)return;starting=true;setFrozen();try{add(await api('tabs/new'));$('workspace-status').textContent='';}catch(e){$('workspace-status').textContent=e.message;}finally{starting=false;setFrozen();}};
 async function documentsReady(){if(starting||closingTabs||closingWindow)return false;const states=await Promise.all([...tabs.values()].map(inspect));return !starting&&!closingTabs&&!closingWindow&&states.every(state=>state&&state.ready===true&&!state.dirty&&!state.busy);}
 $('workspace-update').onclick=async()=>{
  const button=$('workspace-update');button.disabled=true;
  try{
   if(!await documentsReady())throw Error('열린 문서를 저장하고 진행 중인 AI 작업을 마친 뒤 업데이트해 주세요.');
   $('workspace-status').textContent='업데이트를 내려받고 확인하고 있습니다.';await api('update/download');
   freeze(true);if(!await documentsReady())throw Error('열린 문서를 저장하고 진행 중인 AI 작업을 마친 뒤 업데이트해 주세요.');
   $('workspace-status').textContent='Pwh Desktop을 닫고 업데이트를 설치합니다.';await api('update/install');
   setTimeout(async()=>{try{const result=await api('update/result');if(result.message){freeze(false);button.disabled=false;$('workspace-status').textContent=result.message;}}catch{}},95000);
  }catch(e){freeze(false);button.disabled=false;$('workspace-status').textContent=e.message;}
 };
 (async()=>{try{const initial=await api('tabs/initial');if(initial.home)showHome({focus:true});else add(initial);}catch(e){$('workspace-status').textContent=e.message;}})();
 (async()=>{try{const result=await api('update/result');if(result.message)$('workspace-status').textContent=result.message;const available=await api('update/status');if(available.version){const button=$('workspace-update');button.textContent='업데이트 '+available.version;button.title='새 버전 설치';button.hidden=false;}}catch{}})();
})();
