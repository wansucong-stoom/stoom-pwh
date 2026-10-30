import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {desktopVersion} from './version-info.mjs';
import {checkForDesktopUpdate,downloadInstaller,scheduleDesktopUpdate} from './update-check.mjs';
import {recordCodexPluginSetup} from './codex-plugin-setup.mjs';
import {chooseDesktopFile} from './desktop-files.mjs';
import {createRecentDocuments} from './recent-documents.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
export async function createWorkspaceServer({initialPath,nativeBranding,port=0,spawnImpl=spawn,updateServices,chooseFile=chooseDesktopFile,dataRoot:providedDataRoot}={}){
 const token=randomBytes(24).toString('hex'),tabs=new Map();let closing=false,generation=0;
 const dataRoot=providedDataRoot||process.env.PWH_STANDALONE_DATA||path.join(process.env.LOCALAPPDATA||process.env.HOME||root,'PwhDesktop');
 const services=updateServices||{check:checkForDesktopUpdate,download:downloadInstaller,schedule:scheduleDesktopUpdate};
 const recent=createRecentDocuments(dataRoot);let fileDialogBusy=false;
 // One nonblocking GitHub lookup per app start; offline operation is normal.
 const updateCheck=nativeBranding?desktopVersion(root).then(v=>v?services.check(v):null).catch(()=>null):Promise.resolve(null);
 let preparedUpdate=null,preparingUpdate=null,installingUpdate=false,codexSetup=null;
 const makeTab=async (file,imported=false)=>{
  if(closing||tabs.size>=12)throw Error('문서는 최대 12개까지 열 수 있습니다.');
  const id=randomUUID();
  // A stable origin per tab slot keeps the editor's local recovery store reachable
  // after reopening. A second window skips ports already owned by another app.
  for(let childPort=48674;childPort<48738;childPort++){
   if([...tabs.values()].some(tab=>tab.port===childPort))continue;
   const child=spawnImpl(process.execPath,[path.join(root,'workspace-child.mjs'),String(childPort),...(file?[file,...imported?['imported']:[]]:[])],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:process.env});
   let output='',diagnostic='';child.stdin.on('error',()=>{});child.stderr.on('data',x=>diagnostic=(diagnostic+String(x)).slice(-1500));
   const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('문서 탭을 준비하지 못했습니다.'));},90000);timer.unref?.();
    child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',()=>{clearTimeout(timer);reject(Error('문서 탭이 종료되었습니다. '+diagnostic.slice(0,200)));});
    child.stdout.on('data',part=>{output+=String(part);const end=output.indexOf('\n');if(end<0)return;clearTimeout(timer);try{const value=JSON.parse(output.slice(0,end));if(value.errorCode)return resolve(value);const candidate=new URL(value.url);if(candidate.hostname!=='127.0.0.1'||candidate.protocol!=='http:'||Number(candidate.port)!==childPort)throw Error('Invalid document host');resolve({url:candidate.href});}catch{child.kill();reject(Error('문서 탭 연결을 확인하지 못했습니다.'));}});
   });
   if(result.errorCode==='EADDRINUSE')continue;
   if(result.errorCode)throw Error('문서 탭을 열지 못했습니다.');
   tabs.set(id,{id,url:result.url,child,port:childPort});child.once('exit',()=>tabs.delete(id));return {id,url:result.url};
  }
  throw Error('사용 가능한 문서 탭 연결을 찾지 못했습니다.');
 };
 let first=null,initialDelivered=false;
 const stopTab=tab=>{const timer=setTimeout(()=>tab.child.kill(),3000);timer.unref?.();tab.child.once('exit',()=>clearTimeout(timer));try{tab.child.stdin.end();}catch{tab.child.kill();}};
 const closeAll=()=>{if(closing)return;closing=true;for(const tab of tabs.values())stopTab(tab);tabs.clear();};
 const send=(res,data,code=200)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
 const server=createServer(async(req,res)=>{try{
  const address=server.address(),origin=`http://127.0.0.1:${address.port}`,url=new URL(req.url,origin),prefix=`/${token}/`;
  if(!url.pathname.startsWith(prefix))return send(res,{error:'연결이 만료되었습니다.'},404);
  const route=url.pathname.slice(prefix.length);res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method==='GET'&&route===''){
   let html=await fs.readFile(path.join(root,'workspace.html'),'utf8');
   if(nativeBranding){const current=++generation;html=html.replace('<title>Pwh Desktop</title>',`<title>Pwh Desktop [${nativeBranding.token}]</title>`).replace('</head>',`<script>(()=>{let n=0;async function ready(){try{const r=await fetch('native/window-branding?instance=${current}'),s=await r.json();if(s.complete||s.failed){document.title='Pwh Desktop';return;}}catch{}if(++n<240)setTimeout(ready,250);else document.title='Pwh Desktop';}ready();addEventListener('pagehide',()=>navigator.sendBeacon('native/window-closing?instance=${current}'));})();</script></head>`);}
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(html);
  }
  if(req.method==='GET'&&['workspace.js','workspace.css','stoom-mark-original.css','stoom-product-marks.css','Inter-variable.ttf','stoom-mark.svg','stoom.ico'].includes(route)){const type=route.endsWith('.js')?'text/javascript':route.endsWith('.css')?'text/css':route.endsWith('.ttf')?'font/ttf':route.endsWith('.svg')?'image/svg+xml':'image/x-icon';res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});return res.end(await fs.readFile(path.join(root,route)));}
  if(req.method==='GET'&&route==='native/window-branding'){if(url.searchParams.get('instance')===String(generation))nativeBranding?.ready?.();return send(res,{complete:!!nativeBranding?.complete,failed:!!nativeBranding?.failed});}
  if(req.method==='POST'&&route==='native/window-closing'&&req.headers.origin===origin){if(url.searchParams.get('instance')===String(generation))nativeBranding?.closing?.();closeAll();return send(res,{ok:true});}
  if(req.method==='POST'&&route==='tabs/closing'&&req.headers.origin===origin){closeAll();server.close();return send(res,{ok:true});}
  if(req.method!=='POST'||req.headers.origin!==origin||req.headers['x-pwh-request']!=='1')return send(res,{error:'허용되지 않은 요청입니다.'},403);
  if(route==='tabs/initial'){if(initialDelivered)throw Error('처음 화면이 이미 열렸습니다.');initialDelivered=true;const value=first||{home:true};first=null;return send(res,value);}
  if(route==='native/request-close'){
   if(!nativeBranding?.complete||typeof nativeBranding.requestClose!=='function')throw Error('앱 창을 확인하지 못했습니다. 문서를 저장한 뒤 다시 닫아 주세요.');
   setTimeout(()=>nativeBranding.requestClose(),100);return send(res,{requested:true});
  }
  if(route==='native/drop-open'){
   let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)throw Error('파일 요청이 너무 큽니다.');}const {id,count}=JSON.parse(body);
   const paths=await nativeBranding?.resolveDroppedFiles?.(id,count);if(!Array.isArray(paths)||paths.length!==count)throw Error('원본 파일 경로를 확인하지 못했습니다.');
   for(const file of paths){if(typeof file!=='string'||!path.isAbsolute(file)||!/\.hwpx?$/i.test(file))throw Error('HWP 또는 HWPX 파일만 열 수 있습니다.');const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024*1024)throw Error('64 MiB 이하의 일반 문서 파일을 선택하세요.');}
   if(tabs.size+paths.length>12)throw Error('문서는 최대 12개까지 열 수 있습니다.');
   const opened=[],errors=[];for(const file of paths){try{opened.push(await makeTab(file));}catch(error){errors.push(path.basename(file)+': '+error.message);}}
   return send(res,{opened,errors});
  }
  if(route==='recent/list')return send(res,{documents:await recent.list()});
  if(route==='recent/remove'){let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)throw Error('최근 문서 요청이 너무 큽니다.');}await recent.remove(JSON.parse(body).id);return send(res,{ok:true});}
  if(route==='recent/open'){let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)throw Error('최근 문서 요청이 너무 큽니다.');}const file=await recent.open(JSON.parse(body).id);return send(res,await makeTab(file));}
  if(route==='tabs/open'){
   if(fileDialogBusy)throw Error('파일 선택창이 이미 열려 있습니다.');if(tabs.size>=12)throw Error('문서는 최대 12개까지 열 수 있습니다.');fileDialogBusy=true;
   try{const picked=await chooseFile({mode:'Open'});if(picked?.cancelled)return send(res,{cancelled:true});const file=picked?.path;if(typeof file!=='string'||!path.isAbsolute(file)||!/\.hwpx?$/i.test(file))throw Error('HWP 또는 HWPX 문서를 선택하세요.');const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024*1024)throw Error('64 MiB 이하의 일반 문서를 선택하세요.');return send(res,await makeTab(file));}finally{fileDialogBusy=false;}
  }
  if(route==='tabs/import'){
   let name;try{name=decodeURIComponent(String(req.headers['x-pwh-filename']||''));}catch{throw Error('파일 이름을 확인하지 못했습니다.');}
   if(!name||name!==path.basename(name)||!/\.hwpx?$/i.test(name)||name.length>200)throw Error('HWP 또는 HWPX 파일만 열 수 있습니다.');
   let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>64*1024*1024)throw Error('64 MiB 이하의 문서를 선택하세요.');chunks.push(chunk);}const bytes=Buffer.concat(chunks);
   if(bytes.length<8||(bytes.subarray(0,2).toString()!=='PK'&&bytes.subarray(0,8).toString('hex')!=='d0cf11e0a1b11ae1'))throw Error('HWP 또는 HWPX 문서가 아닙니다.');
   const dir=path.join(dataRoot,'documents','import-'+randomUUID());await fs.mkdir(dir,{recursive:true});const file=path.join(dir,name);await fs.writeFile(file,bytes,{flag:'wx'});return send(res,await makeTab(file,true));
  }
  if(route==='update/status'){const available=await updateCheck;return send(res,{version:available?.version||null});}
  if(route==='codex-plugin/status'){
   try{return send(res,JSON.parse(await fs.readFile(path.join(dataRoot,'codex-setup-result.json'),'utf8')));}catch(error){if(error.code==='ENOENT')return send(res,nativeBranding?{status:'not-configured',message:'Codex Pwh 연결을 확인해 주세요.'}:{});throw error;}
  }
  if(route==='codex-plugin/retry'){
   if(!nativeBranding)throw Error('설치된 Pwh Desktop에서 연결해 주세요.');
   codexSetup??=recordCodexPluginSetup({dataRoot}).finally(()=>{codexSetup=null;});return send(res,await codexSetup);
  }
  if(route==='update/result'){
   const file=path.join(dataRoot,'updates','last-result.json');try{const value=JSON.parse(await fs.readFile(file,'utf8'));await fs.rm(file,{force:true});return send(res,{status:value.status,message:value.message});}catch(error){if(error.code==='ENOENT')return send(res,{});throw error;}
  }
  if(route==='update/download'){
   if(installingUpdate)throw Error('이미 업데이트를 시작했습니다.');const asset=await updateCheck;if(!asset)throw Error('설치할 업데이트가 없습니다.');
   if(!preparedUpdate){const controller=new AbortController();res.once('close',()=>controller.abort());preparingUpdate??=services.download(asset,path.join(dataRoot,'updates'),{signal:controller.signal}).then(installer=>{preparedUpdate={asset,installer};}).finally(()=>{preparingUpdate=null;});await preparingUpdate;}return send(res,{version:asset.version});
  }
  if(route==='update/install'){
   if(!preparedUpdate||installingUpdate)throw Error('업데이트 파일을 먼저 준비해 주세요.');
   if(!nativeBranding?.complete||typeof nativeBranding.requestClose!=='function')throw Error('앱 창을 확인하지 못했습니다. 설치 파일을 직접 실행해 주세요.');
   installingUpdate=true;
   try{const pids=[process.pid,process.ppid,nativeBranding.helperPid,...[...tabs.values()].map(t=>t.child.pid)].filter(pid=>Number.isSafeInteger(pid)&&pid>0);
    await services.schedule({installer:preparedUpdate.installer,asset:preparedUpdate.asset,dataRoot,appExe:path.join(path.dirname(root),'PwhDesktop.exe'),pids});
   }catch(error){installingUpdate=false;throw error;}
   setTimeout(()=>nativeBranding.requestClose(),250);return send(res,{started:true});
  }
  if(route==='tabs/new')return send(res,await makeTab());
  if(route==='tabs/close'){let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)throw Error('탭 요청이 너무 큽니다.');}const tab=tabs.get(JSON.parse(body).id);if(!tab)throw Error('문서 탭을 찾을 수 없습니다.');stopTab(tab);tabs.delete(tab.id);return send(res,{ok:true});}
  return send(res,{error:'찾을 수 없는 요청입니다.'},404);
 }catch(error){return send(res,{error:error.message||'문서 탭을 열지 못했습니다.'},400);}});
 server.once('close',closeAll);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 try{if(initialPath)first=await makeTab(initialPath);}catch(error){server.close();throw error;}
 return {server,url:`http://127.0.0.1:${server.address().port}/${token}/`};
}
