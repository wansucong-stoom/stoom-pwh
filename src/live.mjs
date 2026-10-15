import {createServer} from 'node:http';
import {promises as fs, constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {runEngine} from './engine.mjs';
import {documentFontFiles} from './font-files.mjs';
import config from './config.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const outputRoot=config.outputRoot;
const descriptorPath=path.join(outputRoot,'live-session.json');
let localService;
const hash=b=>createHash('sha256').update(b).digest('hex');
const json=(res,code,value)=>res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}).end(JSON.stringify(value));

async function body(req){
  const chunks=[];let size=0;
  for await(const part of req){size+=part.length;if(size>32*1024*1024)throw new Error('요청이 32MiB를 넘습니다.');chunks.push(part);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
}
function validDocument(p){if(!path.isAbsolute(p)||!/\.(hwpx|hwp)$/i.test(p))throw new Error('HWP/HWPX 절대 경로가 필요합니다.');}
function assertOperation(op){
  if(!op||!['state','commands','command','hwpctrl','applyTextCommand','undo','redo','snapshot','load'].includes(op.type))throw new Error('지원하지 않는 편집 명령입니다.');
  if(op.type==='hwpctrl'&&(!Array.isArray(op.calls)||!op.calls.length||op.calls.length>100||op.calls.some(c=>typeof c.method!=='string'||!Array.isArray(c.args))))throw new Error('HwpCtrl 호출 배열이 올바르지 않습니다.');
}

async function publishSnapshot(snapshot,output){
  const format=output?path.extname(output).slice(1).toLowerCase():(snapshot.format||'hwpx');
  if(!['hwp','hwpx'].includes(format)||format!==snapshot.format)throw new Error('내보낸 형식과 출력 확장자가 다릅니다.');
  const target=output||path.join(outputRoot,'saved',`${Date.now()}-${randomUUID().slice(0,8)}.${format}`);
  validDocument(target);
  const bytes=Buffer.from(snapshot.base64||'','base64');
  if(bytes.length<100||bytes.length>24*1024*1024)throw new Error('내보낸 문서 크기가 올바르지 않습니다.');
  await fs.mkdir(path.dirname(target),{recursive:true});
  const temporary=path.join(outputRoot,`.snapshot-${randomUUID()}.${format}`);
  try{
    await fs.writeFile(temporary,bytes,{flag:'wx'});
    const info=(await runEngine(['info',temporary,'--json'])).data;
    await fs.copyFile(temporary,target,constants.COPYFILE_EXCL);
    return{path:target,sha256:hash(bytes),state:snapshot.state,info};
  }finally{await fs.rm(temporary,{force:true});}
}

export async function startLiveServer(){
  if(localService)return localService;
  await fs.access(path.join(config.studioDistPath,'index.html'));
  await fs.mkdir(outputRoot,{recursive:true});
  const documentFonts=await documentFontFiles(config.documentFonts);
  const token=randomBytes(32).toString('hex'),sessionId=randomUUID();
  const pending=new Map(),queue=[],results=new Map();
  let source=null,document=null,lastState=null,lastContact=0,sourceEpoch,ownerClientId;
  const service={descriptor:null,server:null};
  const status=()=>({sessionId,url:`${service.descriptor.baseUrl}/#${token}`,source,connected:!!lastState&&Date.now()-lastContact<8000,lastState});
  async function send(operation,expectedState){
    assertOperation(operation);
    const id=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        const record=pending.get(id);pending.delete(id);
        const i=queue.findIndex(c=>c.id===id);if(i>=0)queue.splice(i,1);
        reject(new Error(`편집 화면 응답 시간 초과 (commandId=${id}). 재실행 전에 현재 세션 상태를 다시 확인하세요.${record?.delivered?' 편집 결과가 나중에 도착할 수 있습니다.':''}`));
      },55000);
      pending.set(id,{resolve,reject,timer,delivered:false});queue.push({id,operation,expectedState});
    });
  }
  async function open(input){
    if(input){
      validDocument(input);const actual=await fs.realpath(input),bytes=await fs.readFile(actual);
      if(bytes.length>24*1024*1024)throw new Error('한 번에 24MiB 이하 문서를 여세요.');
      const next={name:path.basename(actual),base64:bytes.toString('base64')};
      if(status().connected){
        const current=await send({type:'state'});
        const loaded=await send({type:'load',...next},current.state);
        lastState=loaded.state;
      }
      document=next;source=actual;sourceEpoch=lastState?.documentEpoch;
    }
    return status();
  }
  service.open=open;service.send=send;service.status=status;
  const server=createServer(async(req,res)=>{
    try{
      if(req.headers.host!==service.descriptor?.host){json(res,403,{error:'Host rejected'});return;}
      const url=new URL(req.url,service.descriptor.baseUrl);
      if(url.pathname.startsWith('/api/')){
        if(req.headers.authorization!==`Bearer ${token}`){json(res,401,{error:'Unauthorized'});return;}
        if(req.headers.origin&&req.headers.origin!==service.descriptor.baseUrl){json(res,403,{error:'Origin rejected'});return;}
        if(url.pathname==='/api/status'){json(res,200,status());return;}
        if(url.pathname==='/api/bootstrap'){
          const clientId=req.headers['x-hop-client'];
          if(typeof clientId!=='string'||!clientId){json(res,400,{error:'편집 탭 ID가 필요합니다.'});return;}
          if(ownerClientId&&ownerClientId!==clientId&&Date.now()-lastContact<10000){json(res,409,{error:'이미 다른 탭에서 같은 문서를 편집하고 있습니다. 기존 편집 탭을 사용하세요.'});return;}
          ownerClientId=clientId;lastContact=Date.now();
          json(res,200,{sessionId,source,document});return;
        }
        if(['/api/poll','/api/change','/api/result','/api/user-save','/api/annotation'].includes(url.pathname)&&req.headers['x-hop-client']!==ownerClientId){json(res,409,{error:'현재 문서를 소유한 편집 탭이 아닙니다.',code:'SESSION_OWNED_ELSEWHERE'});return;}
        if(url.pathname==='/api/poll'){
          lastContact=Date.now();const command=queue.shift()||null;
          if(command&&pending.has(command.id))pending.get(command.id).delivered=true;
          json(res,200,{command});return;
        }
        if(req.method!=='POST'){json(res,405,{error:'POST required'});return;}
        const data=await body(req);
        if(url.pathname==='/api/result'){
          const request=pending.get(data.id);
          results.set(data.id,data);if(results.size>100)results.delete(results.keys().next().value);
          if(request){clearTimeout(request.timer);pending.delete(data.id);data.ok?request.resolve(data.result):request.reject(new Error(typeof data.error==='string'?data.error:(data.error?.message||'편집 명령 실패')));}
          json(res,200,{received:true});return;
        }
        if(url.pathname==='/api/change'){
          if(sourceEpoch!==undefined&&data.state?.documentEpoch!==sourceEpoch){source=null;document=null;sourceEpoch=undefined;}
          lastState=data.state;lastContact=Date.now();if(sourceEpoch===undefined&&source)sourceEpoch=lastState?.documentEpoch;
          json(res,200,{received:true});return;
        }
        if(url.pathname==='/api/user-save'){json(res,200,await publishSnapshot(data));return;}
        if(url.pathname==='/api/annotation'){
          if(!/^[0-9a-f-]{36}$/i.test(data.requestId||''))throw new Error('올바른 주석 요청 ID가 필요합니다.');
          if(!data.state||!data.context)throw new Error('선택한 문서 상태와 객체 정보가 필요합니다.');
          const request={schemaVersion:1,requestId:data.requestId,sessionId,source,state:data.state,context:data.context,comment:String(data.comment||'').slice(0,4000),createdAt:new Date().toISOString(),untrustedContent:true};
          const requestRoot=path.join(outputRoot,'requests');
          await fs.mkdir(requestRoot,{recursive:true});
          await fs.writeFile(path.join(requestRoot,`${data.requestId}.json`),JSON.stringify(request,null,2),{flag:'wx'});
          json(res,200,{requestId:data.requestId});return;
        }
        if(url.pathname==='/api/agent'){
          if(data.action==='open'){json(res,200,await open(data.input));return;}
          if(data.action==='result'){json(res,200,results.get(data.commandId)||{pending:pending.has(data.commandId)});return;}
          if(!status().connected)throw new Error('공유 편집 화면을 먼저 열고 로딩이 끝날 때까지 기다리세요.');
          json(res,200,await send(data.operation,data.expectedState));return;
        }
        json(res,404,{error:'Unknown API'});return;
      }
      if(req.method!=='GET'){res.writeHead(405).end();return;}
      if(url.pathname==='/document-fonts/manifest'){json(res,200,documentFonts.manifest);return;}
      if(url.pathname.startsWith('/document-fonts/')){
        const bytes=documentFonts.files.get(decodeURIComponent(url.pathname.slice('/document-fonts/'.length)));
        if(!bytes){res.writeHead(404).end();return;}
        res.writeHead(200,{'Content-Type':'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(bytes);return;
      }
      let directory,relative;
      if(url.pathname==='/'||url.pathname==='/index.html'){directory=path.join(root,'src');relative='editor.html';}
      else if(url.pathname==='/editor-client.mjs'){directory=path.join(root,'src');relative='editor-client.mjs';}
      else if(url.pathname==='/font-provider.mjs'){directory=path.join(root,'src');relative='font-provider.mjs';}
      else if(url.pathname.startsWith('/sdk/')){directory=config.editorSdkPath;relative=url.pathname.slice(5);}
      else if(url.pathname.startsWith('/studio/')){directory=config.studioDistPath;relative=url.pathname.slice(8)||'index.html';}
      else{res.writeHead(404).end();return;}
      relative=decodeURIComponent(relative);
      const filename=path.resolve(directory,relative),boundary=path.resolve(directory)+path.sep;
      if(!filename.startsWith(boundary)){res.writeHead(403).end();return;}
      const content=await fs.readFile(filename);
      const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.ico':'image/x-icon'}[path.extname(filename)]||'application/octet-stream';
      res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self' data: blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"}).end(content);
    }catch(error){json(res,400,{error:error.message});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  service.descriptor={baseUrl:`http://127.0.0.1:${server.address().port}`,host:`127.0.0.1:${server.address().port}`,token,sessionId,pid:process.pid};
  service.server=server;
  await fs.writeFile(descriptorPath,JSON.stringify(service.descriptor),{mode:0o600});
  localService=service;
  return service;
}

async function descriptor(){
  let data;
  try{data=JSON.parse(await fs.readFile(descriptorPath,'utf8'));}
  catch(error){
    if(error.code==='ENOENT')return(await startLiveServer()).descriptor;
    throw new Error(`기존 공유 세션 기록을 읽지 못했습니다. 원본 기록을 보존합니다: ${error.message}`);
  }
  const url=new URL(data.baseUrl);
  if(url.hostname!=='127.0.0.1'||url.protocol!=='http:'||!/^\d+$/.test(url.port)||url.pathname!=='/'||url.search||url.hash||url.username||url.password||data.host!==url.host||!Number.isInteger(data.pid)||data.pid<=0||!/^[0-9a-f]{64}$/i.test(data.token||''))throw new Error('기존 공유 세션 기록이 올바르지 않습니다. 기록을 보존합니다.');
  try{
    const response=await fetch(`${data.baseUrl}/api/status`,{headers:{Authorization:`Bearer ${data.token}`},signal:AbortSignal.timeout(2000)});
    if(!response.ok)throw new Error(`공유 세션 응답 오류 (${response.status})`);
    return data;
  }catch(error){
    const refused=cause=>cause?.code==='ECONNREFUSED'||(Array.isArray(cause?.errors)&&cause.errors.length>0&&cause.errors.every(refused));
    let processStopped=false;
    if(refused(error.cause||error)){
      try{process.kill(data.pid,0);}catch(processError){processStopped=processError.code==='ESRCH';}
    }
    if(processStopped)return(await startLiveServer()).descriptor;
    throw new Error(`기존 공유 세션(${data.baseUrl})에 연결하지 못했습니다. 미저장 문서를 보호하기 위해 세션 기록을 보존합니다: ${error.message}`);
  }
}
async function agent(data){
  const d=await descriptor();
  const response=await fetch(`${d.baseUrl}/api/agent`,{method:'POST',headers:{Authorization:`Bearer ${d.token}`,'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(60000)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||`공유 편집 서버 오류 ${response.status}`);return result;
}
export async function openLiveDocument(input){return agent({action:'open',input});}
export async function describeLiveSession(){const d=await descriptor();return(await fetch(`${d.baseUrl}/api/status`,{headers:{Authorization:`Bearer ${d.token}`}})).json();}
export async function readLiveSession({diagnostics=false,page=0}={}){return agent({operation:{type:'state',diagnostics,page}});}
export async function listLiveCommands(){return agent({operation:{type:'commands'}});}
export async function readLiveRequest(requestId){
  if(!/^[0-9a-f-]{36}$/i.test(requestId||''))throw new Error('올바른 주석 요청 ID가 필요합니다.');
  return JSON.parse(await fs.readFile(path.join(outputRoot,'requests',`${requestId}.json`),'utf8'));
}
export async function applyLiveSession(operation,expectedState){
  if(!['command','hwpctrl','applyTextCommand','undo','redo'].includes(operation?.type))throw new Error('허용된 편집 동작이 아닙니다.');
  if(!expectedState||!Number.isInteger(expectedState.documentEpoch)||!Number.isInteger(expectedState.changeSeq)||typeof expectedState.documentSha256!=='string')throw new Error('최신 문서 상태를 먼저 읽고 expectedState를 지정하세요.');
  return agent({operation,expectedState});
}
export async function saveLiveSession(output,expectedState){
  if(output)validDocument(output);
  if(!expectedState)throw new Error('저장할 현재 문서 상태가 필요합니다.');
  const format=output?path.extname(output).slice(1).toLowerCase():'hwpx';
  const snapshot=await agent({operation:{type:'snapshot',format},expectedState});
  return publishSnapshot(snapshot,output);
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  const [command,...args]=process.argv.slice(2);
  try{
    let result;
    if(command==='serve'){const service=await startLiveServer();result=await service.open(args[0]);}
    else if(command==='open')result=await openLiveDocument(args[0]);
    else if(command==='status')result=await describeLiveSession();
    else if(command==='read')result=await readLiveSession();
    else if(command==='commands')result=await listLiveCommands();
    else if(command==='apply'){const request=JSON.parse(await fs.readFile(args[0],'utf8'));result=await applyLiveSession(request.operation,request.expectedState);}
    else if(command==='save'){const current=await readLiveSession();result=await saveLiveSession(args[0],current.state);}
    else throw new Error('사용법: serve [FILE] | open [FILE] | status | read | commands | apply REQUEST.json | save [OUTPUT]');
    console.log(JSON.stringify(result,null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
