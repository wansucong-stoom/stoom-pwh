import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
export async function createWorkspaceServer({initialPath,nativeBranding,port=0,spawnImpl=spawn}={}){
 const token=randomBytes(24).toString('hex'),tabs=new Map();let closing=false,generation=0;
 const makeTab=async file=>{
  if(closing||tabs.size>=12)throw Error('문서는 최대 12개까지 열 수 있습니다.');
  const id=randomUUID();
  // A stable origin per tab slot keeps the editor's local recovery store reachable
  // after reopening. A second window skips ports already owned by another app.
  for(let childPort=48674;childPort<48738;childPort++){
   if([...tabs.values()].some(tab=>tab.port===childPort))continue;
   const child=spawnImpl(process.execPath,[path.join(root,'workspace-child.mjs'),String(childPort),...(file?[file]:[])],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:process.env});
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
 let first=null;
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
  if(req.method==='GET'&&['workspace.js','workspace.css','stoom-mark.svg','stoom.ico'].includes(route)){const type=route.endsWith('.js')?'text/javascript':route.endsWith('.css')?'text/css':route.endsWith('.svg')?'image/svg+xml':'image/x-icon';res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});return res.end(await fs.readFile(path.join(root,route)));}
  if(req.method==='GET'&&route==='native/window-branding'){if(url.searchParams.get('instance')===String(generation))nativeBranding?.ready?.();return send(res,{complete:!!nativeBranding?.complete,failed:!!nativeBranding?.failed});}
  if(req.method==='POST'&&route==='native/window-closing'&&req.headers.origin===origin){if(url.searchParams.get('instance')===String(generation))nativeBranding?.closing?.();closeAll();return send(res,{ok:true});}
  if(req.method==='POST'&&route==='tabs/closing'&&req.headers.origin===origin){closeAll();server.close();return send(res,{ok:true});}
  if(req.method!=='POST'||req.headers.origin!==origin||req.headers['x-pwh-request']!=='1')return send(res,{error:'허용되지 않은 요청입니다.'},403);
  if(route==='tabs/initial'){if(!first)throw Error('처음 문서 탭이 이미 열렸습니다.');const value=first;first=null;return send(res,value);}
  if(route==='tabs/new')return send(res,await makeTab());
  if(route==='tabs/close'){let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)throw Error('탭 요청이 너무 큽니다.');}const tab=tabs.get(JSON.parse(body).id);if(!tab)throw Error('문서 탭을 찾을 수 없습니다.');stopTab(tab);tabs.delete(tab.id);return send(res,{ok:true});}
  return send(res,{error:'찾을 수 없는 요청입니다.'},404);
 }catch(error){return send(res,{error:error.message||'문서 탭을 열지 못했습니다.'},400);}});
 server.once('close',closeAll);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 try{first=await makeTab(initialPath);}catch(error){server.close();throw error;}
 return {server,url:`http://127.0.0.1:${server.address().port}/${token}/`};
}
