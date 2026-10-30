'use strict';
const {app,BrowserWindow,ipcMain,shell,session}=require('electron');
const path=require('node:path');
const readline=require('node:readline');
const fs=require('node:fs');
const net=require('node:net');
const {printOptions}=require('./print-options.cjs');

const urlArgument=process.argv.find(arg=>arg.startsWith('--pwh-url='));
const url=urlArgument?.slice('--pwh-url='.length),dataRoot=process.env.PWH_STANDALONE_DATA;
const ownedLocal=(value,print=false)=>{try{const u=new URL(value);return u.protocol==='http:'&&u.hostname==='127.0.0.1'&&/^\/[a-f0-9]{48}\/(?:print\.html)?$/.test(u.pathname)&&(!print||u.pathname.endsWith('/print.html'));}catch{return false;}};
const failStartup=error=>{process.stderr.write('Pwh startup failed: '+String(error?.stack||error)+'\n');app.exit(1);};
process.on('uncaughtException',failStartup);process.on('unhandledRejection',failStartup);
if(!ownedLocal(url)||!dataRoot){process.stderr.write('Pwh 앱 시작 정보가 올바르지 않습니다.\n');app.exit(1);}
app.setName('Pwh Desktop');app.setAppUserModelId('STOOM.PwhDesktop');
try{fs.mkdirSync(path.join(dataRoot,'electron-profile'),{recursive:true});app.setPath('userData',path.join(dataRoot,'electron-profile'));}catch(error){failStartup(error);}
let win=null,approvedClose=false,debugAttached=false;const printWindows=new Map();
const hostPipe=process.argv.find(arg=>arg.startsWith('--pwh-host-pipe='))?.slice('--pwh-host-pipe='.length);
const hostToken=process.argv.find(arg=>arg.startsWith('--pwh-host-token='))?.slice('--pwh-host-token='.length);
if(hostPipe&&(!/^\\\\\.\\pipe\\stoom-pwh-[0-9]+-[a-f0-9]{32}$/.test(hostPipe)||!/^[a-f0-9]{64}$/.test(hostToken||''))){process.stderr.write('Pwh 창 연결 정보가 올바르지 않습니다.\n');app.exit(1);}
const host=hostPipe?net.createConnection(hostPipe):null;
const emit=value=>{const message=JSON.stringify(value)+'\n';if(host)host.write(message);else process.stdout.write(message);};
if(host){host.once('connect',()=>emit({type:'hello',token:hostToken}));host.on('error',failStartup);}
const cleanError=()=> 'Pwh 앱 창에서 요청을 처리하지 못했습니다.';

async function droppedPaths(id,count){
 if(!win||!/^[0-9a-f-]{36}$/i.test(id)||!Number.isInteger(count)||count<1||count>12)throw Error('끌어온 파일 정보를 확인하지 못했습니다.');
 const debug=win.webContents.debugger;if(!debugAttached){debug.attach('1.3');debugAttached=true;}
 const paths=[];
 for(let i=0;i<count;i++){
  const expression=`window.__pwhDropFiles?.get(${JSON.stringify(id)})?.[${i}]`;
  const result=await debug.sendCommand('Runtime.evaluate',{expression});const objectId=result?.result?.objectId;
  if(!objectId)throw Error('끌어온 파일을 확인하지 못했습니다.');
  try{const info=await debug.sendCommand('DOM.getFileInfo',{objectId});if(typeof info.path!=='string'||!info.path)throw Error('원본 파일 경로를 확인하지 못했습니다.');paths.push(info.path);}
  finally{await debug.sendCommand('Runtime.releaseObject',{objectId}).catch(()=>{});}
 }
 return paths;
}

function printWindow(event){
 const info=printWindows.get(event.sender.id);
 if(!info||event.senderFrame!==event.sender.mainFrame||!ownedLocal(event.sender.getURL(),true))throw Error('인쇄 창을 확인하지 못했습니다.');
 return info;
}
ipcMain.handle('pwh:printers',async event=>{
 printWindow(event);return (await event.sender.getPrintersAsync()).map(p=>({name:p.name,displayName:p.displayName,isDefault:p.isDefault===true,status:p.status}));
});
ipcMain.handle('pwh:show-print',event=>{
 const info=printWindow(event);info.window.setTitle('인쇄');
 if(process.env.PWH_ELECTRON_TEST_HIDDEN!=='1'){info.window.show();info.window.focus();}
 return {ok:true};
});
ipcMain.handle('pwh:print-document',async(event,value)=>{
 const info=printWindow(event);if(info.printing)throw Error('인쇄 작업이 진행 중입니다.');
 const options=printOptions(value,await event.sender.getPrintersAsync());info.printing=true;
 try{
  const hasPages=await event.sender.executeJavaScript('document.querySelectorAll("#pwh-print-output .pwh-print-sheet .page svg").length');
  if(!hasPages)throw Error('인쇄할 쪽을 준비하지 못했습니다.');
  if(typeof value.jobName==='string'&&value.jobName.length<=1024)await event.sender.executeJavaScript('document.title='+JSON.stringify(value.jobName));
  return await new Promise(resolve=>event.sender.print(options,(success,reason)=>resolve({ok:success===true,...success?{}:{cancelled:/cancel/i.test(reason||''),error:success?undefined:'인쇄하지 못했습니다. 프린터 상태를 확인한 뒤 다시 시도해 주세요.'}})));
 }finally{info.printing=false;if(!event.sender.isDestroyed())await event.sender.executeJavaScript('document.title="인쇄"').catch(()=>{});}
});

app.whenReady().then(async()=>{
 const prefs={nodeIntegration:false,contextIsolation:true,sandbox:true,preload:path.join(__dirname,'electron-preload.cjs'),backgroundThrottling:false};
 win=new BrowserWindow({width:1440,height:900,minWidth:700,minHeight:500,title:'Pwh Desktop',icon:path.join(__dirname,'stoom.ico'),backgroundColor:'#ffffff',autoHideMenuBar:true,show:false,webPreferences:prefs});
 win.setAppDetails({appId:'STOOM.PwhDesktop',appIconPath:path.join(__dirname,'stoom.ico'),appIconIndex:0,relaunchCommand:'"'+path.join(__dirname,'..','PwhDesktop.exe')+'"',relaunchDisplayName:'Pwh Desktop'});
 win.removeMenu();
 session.defaultSession.setPermissionRequestHandler((contents,permission,callback,details)=>callback(['clipboard-read','clipboard-sanitized-write'].includes(permission)&&ownedLocal(details.requestingUrl||contents.getURL())));
 win.webContents.setWindowOpenHandler(({url:target})=>{
  const printOwner=ownedLocal(target,true)&&win.webContents.mainFrame.framesInSubtree.some(frame=>{try{const a=new URL(frame.url),b=new URL(target);return a.origin===b.origin&&a.pathname.split('/')[1]===b.pathname.split('/')[1];}catch{return false;}});
  if(printOwner)return {action:'allow',overrideBrowserWindowOptions:{parent:win,title:'인쇄',width:1080,height:820,minWidth:760,minHeight:500,icon:path.join(__dirname,'stoom.ico'),show:process.env.PWH_ELECTRON_TEST_HIDDEN!=='1'&&new URL(target).searchParams.get('pwhDirect')!=='1',autoHideMenuBar:true,webPreferences:prefs}};
  try{const u=new URL(target);if(u.protocol==='https:')void shell.openExternal(u.href);}catch{}
  return {action:'deny'};
 });
 win.webContents.on('did-create-window',(popup,details)=>{if(ownedLocal(details.url,true)){const id=popup.webContents.id;printWindows.set(id,{window:popup,printing:false});popup.removeMenu();popup.setAppDetails({appId:'STOOM.PwhDesktop',appIconPath:path.join(__dirname,'stoom.ico'),appIconIndex:0});popup.on('page-title-updated',event=>{event.preventDefault();popup.setTitle('인쇄');});popup.webContents.setWindowOpenHandler(()=>({action:'deny'}));popup.webContents.on('will-navigate',(event,target)=>{if(!ownedLocal(target,true))event.preventDefault();});popup.on('close',event=>{if(printWindows.get(id)?.printing)event.preventDefault();});popup.once('closed',()=>printWindows.delete(id));}});
 win.webContents.on('will-navigate',(event,target)=>{if(!ownedLocal(target))event.preventDefault();});
 win.on('close',event=>{if(approvedClose)return;event.preventDefault();void win.webContents.executeJavaScript("window.dispatchEvent(new Event('pwh-native-close-request'))",true).catch(()=>{});});
 win.once('closed',()=>{win=null;app.quit();});
 await win.loadURL(url);emit({type:'ready'});if(process.env.PWH_ELECTRON_TEST_HIDDEN!=='1')win.show();
}).catch(error=>{emit({type:'error',error:cleanError()});failStartup(error);});

if(host){
const input=readline.createInterface({input:host,crlfDelay:Infinity});
input.on('line',async line=>{let message;try{message=JSON.parse(line);}catch{return;}if(!Number.isSafeInteger(message.id))return;
 try{let result;if(message.method==='close'){approvedClose=true;win?.close();result={ok:true};}
  else if(message.method==='resolve-drop')result=await droppedPaths(message.params?.id,message.params?.count);
  else throw Error('지원하지 않는 요청입니다.');emit({id:message.id,result});
 }catch(error){emit({id:message.id,error:error?.message||cleanError()});}
});
input.on('close',()=>{if(win){approvedClose=true;win.close();}else app.quit();});
}
