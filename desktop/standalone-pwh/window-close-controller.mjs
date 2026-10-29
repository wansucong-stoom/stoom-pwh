// A private DevTools pipe belongs only to the Edge process launched for Pwh.
// It converts the browser's beforeunload prompt into the app's save choices.
// If the pipe or page is unavailable the browser's own warning stays in place.
const MAX_MESSAGE=16*1024*1024;
const workspaceUrl=value=>{try{const u=new URL(value);return u.protocol==='http:'&&u.hostname==='127.0.0.1'&&/^\/[a-f0-9]{48}\/$/.test(u.pathname);}catch{return false;}};

export function startWindowCloseController(child){
 const input=child.stdio?.[3],output=child.stdio?.[4];if(!input||!output)return;
 let sequence=0,buffer='',closed=false;const pending=new Map(),targets=new Map(),sessions=new Map(),attaching=new Set();
 const close=()=>{if(closed)return;closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Pwh window connection closed'));}pending.clear();};
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
  if(closed)return reject(Error('Pwh window connection closed'));
  const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('Pwh window connection timed out'));},5000);timer.unref?.();
  pending.set(id,{resolve,reject,timer});input.write(JSON.stringify({id,method,params,...sessionId?{sessionId}:{}})+'\0',error=>{if(error&&pending.has(id)){clearTimeout(timer);pending.delete(id);reject(error);}});
 });
 async function verify(session){
  const page=sessions.get(session);if(!page||page.verified||page.verifying)return;page.verifying=true;
  try{const response=await send('Runtime.evaluate',{expression:'window.__pwhWorkspaceCloseProtocol === true',returnByValue:true},session);page.verified=response?.result?.value===true;}catch{}finally{page.verifying=false;}
 }
 async function attach(info){
  if(!info||info.type!=='page'||!workspaceUrl(info.url)||targets.has(info.targetId)||attaching.has(info.targetId))return;
  attaching.add(info.targetId);
  try{const {sessionId}=await send('Target.attachToTarget',{targetId:info.targetId,flatten:true});const page={targetId:info.targetId,url:info.url,sessionId,verified:false,verifying:false};targets.set(info.targetId,page);sessions.set(sessionId,page);await send('Page.enable',{},sessionId);await verify(sessionId);}
  catch{}finally{attaching.delete(info.targetId);}
 }
 async function handle(message){
  if(message.id&&pending.has(message.id)){const p=pending.get(message.id);pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(message.error.message||'Pwh window connection failed')):p.resolve(message.result||{});return;}
  if(message.method==='Target.targetCreated'||message.method==='Target.targetInfoChanged')void attach(message.params?.targetInfo);
  else if(message.method==='Target.targetDestroyed'){const page=targets.get(message.params?.targetId);if(page){targets.delete(page.targetId);sessions.delete(page.sessionId);}}
  else if(message.method==='Target.detachedFromTarget'){const page=sessions.get(message.params?.sessionId);if(page){targets.delete(page.targetId);sessions.delete(page.sessionId);}}
  else if(message.method==='Page.loadEventFired'&&message.sessionId)void verify(message.sessionId);
  else if(message.method==='Page.javascriptDialogOpening'&&message.params?.type==='beforeunload'){
   const page=sessions.get(message.sessionId);if(!page?.verified||page.handling)return;page.handling=true;
   try{await send('Page.handleJavaScriptDialog',{accept:false},page.sessionId);await send('Runtime.evaluate',{expression:"window.dispatchEvent(new Event('pwh-native-close-request'))"},page.sessionId);}catch{}finally{page.handling=false;}
  }
 }
 output.on('data',chunk=>{buffer+=chunk.toString('utf8');if(buffer.length>MAX_MESSAGE){close();return;}for(let i;(i=buffer.indexOf('\0'))>=0;){const part=buffer.slice(0,i);buffer=buffer.slice(i+1);try{void handle(JSON.parse(part));}catch{}}});
 input.on('error',close);output.on('error',close);output.on('end',close);child.once('exit',close);
 void (async()=>{try{await send('Target.setDiscoverTargets',{discover:true});const result=await send('Target.getTargets');for(const info of result.targetInfos||[])void attach(info);}catch{}})();
 async function resolveDroppedFiles(url,id,count){
  if(!workspaceUrl(url)||!/^[0-9a-f-]{36}$/i.test(id)||!Number.isInteger(count)||count<1||count>12)throw Error('끌어온 파일 정보를 확인하지 못했습니다.');
  let page;for(let i=0;i<40;i++){page=[...targets.values()].find(value=>value.url===url&&value.verified);if(page)break;await new Promise(resolve=>setTimeout(resolve,50));}
  if(!page)throw Error('앱 창의 파일 연결을 확인하지 못했습니다.');const paths=[];
  for(let i=0;i<count;i++){
   const expression=`window.__pwhDropFiles?.get(${JSON.stringify(id)})?.[${i}]`,result=await send('Runtime.evaluate',{expression},page.sessionId),objectId=result?.result?.objectId;
   if(!objectId)throw Error('끌어온 파일을 확인하지 못했습니다.');try{const info=await send('DOM.getFileInfo',{objectId},page.sessionId);if(typeof info.path!=='string'||!info.path)throw Error('원본 파일 경로를 확인하지 못했습니다.');paths.push(info.path);}finally{void send('Runtime.releaseObject',{objectId},page.sessionId).catch(()=>{});}
  }return paths;
 }
 return {close,send,resolveDroppedFiles};
}
