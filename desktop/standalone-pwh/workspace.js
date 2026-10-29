(()=>{
 const $=id=>document.getElementById(id),tabs=new Map(),pending=new Map();let active=null,starting=false;
 const api=async(route,data={})=>{const response=await fetch(route,{method:'POST',headers:{'content-type':'application/json','x-pwh-request':'1'},body:JSON.stringify(data)});const value=await response.json();if(!response.ok)throw Error(value.error||'문서 탭을 열지 못했습니다.');return value;};
 function activate(id){const tab=tabs.get(id);if(!tab)return;active=id;for(const [key,item] of tabs){const selected=key===id;item.frame.hidden=!selected;item.element.setAttribute('aria-selected',String(selected));item.name.tabIndex=selected?0:-1;}}
 function add({id,url}){
  const element=document.createElement('div');element.className='tab';element.setAttribute('role','tab');element.setAttribute('aria-selected','false');
  const name=document.createElement('button');name.className='tab-name';name.type='button';name.textContent='새 문서';name.onclick=()=>activate(id);
  const close=document.createElement('button');close.className='tab-close';close.type='button';close.textContent='×';close.title='문서 닫기';close.setAttribute('aria-label','문서 닫기');close.onclick=()=>void closeTab(id);
  element.append(name,close);$('tabs').append(element);
  const frame=document.createElement('iframe');const childUrl=new URL(url);childUrl.searchParams.set('workspaceOrigin',location.origin);frame.src=childUrl.href;frame.title='문서와 AI 대화';frame.hidden=true;$('documents').append(frame);
  tabs.set(id,{id,url,origin:new URL(url).origin,frame,element,name,dirty:true,busy:false,ready:false});activate(id);
 }
 function inspect(tab){return new Promise(resolve=>{const requestId=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(requestId);resolve(null);},4000);pending.set(requestId,{id:tab.id,resolve,timer});tab.frame.contentWindow.postMessage({type:'pwh-workspace-inspect',requestId},tab.origin);});}
 async function closeTab(id){const tab=tabs.get(id);if(!tab)return;const state=await inspect(tab);if(!state){$('workspace-status').textContent='문서 상태를 확인하지 못해 탭을 닫지 않았습니다.';return;}if((state.dirty||state.busy)&&!confirm(state.busy?'이 문서에서 AI 작업이 진행 중입니다. 저장하지 않은 내용도 잃을 수 있습니다. 탭을 닫을까요?':'저장하지 않은 변경 내용이 있습니다. 이 문서 탭을 닫을까요?'))return;
  try{if(tabs.size===1){const replacement=await api('tabs/new');add(replacement);}await api('tabs/close',{id});tab.frame.remove();tab.element.remove();tabs.delete(id);if(active===id)activate(tabs.keys().next().value);$('workspace-status').textContent='';}catch(e){$('workspace-status').textContent=e.message;}}
 window.addEventListener('message',event=>{if(!event.data||event.data.type!=='pwh-workspace-state')return;const tab=[...tabs.values()].find(item=>item.frame.contentWindow===event.source&&item.origin===event.origin);if(!tab)return;const state=event.data;tab.ready=state.ready===true;tab.dirty=state.dirty!==false;tab.busy=state.busy===true;tab.name.textContent=(typeof state.name==='string'&&state.name?state.name:'새 문서')+(tab.dirty?' ●':'');tab.name.title=(state.name||'새 문서')+(tab.dirty?' · 저장되지 않은 변경':'')+(tab.busy?' · AI 작업 중':'');const wait=pending.get(state.requestId);if(wait&&wait.id===tab.id){clearTimeout(wait.timer);pending.delete(state.requestId);wait.resolve(state);}});
 window.addEventListener('beforeunload',event=>{if([...tabs.values()].some(tab=>tab.dirty||tab.busy||!tab.ready)){event.preventDefault();event.returnValue='';}});
 window.addEventListener('pagehide',()=>navigator.sendBeacon('tabs/closing'));
 $('new-tab').onclick=async()=>{if(starting)return;starting=true;$('new-tab').disabled=true;try{add(await api('tabs/new'));$('workspace-status').textContent='';}catch(e){$('workspace-status').textContent=e.message;}finally{starting=false;$('new-tab').disabled=false;}};
 (async()=>{try{add(await api('tabs/initial'));}catch(e){$('workspace-status').textContent=e.message;}})();
})();
