'use strict';

const {app,dialog,shell}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {randomBytes}=require('node:crypto');
const {startElectronShell}=require('./electron-shell.cjs');

const programRoot=path.resolve(__dirname,'..');
const dataRoot=process.env.PWH_DESKTOP_DATA_ROOT||path.join(app.getPath('appData'),'STOOM','Pwh Desktop');
const profile=path.join(dataRoot,'electron-profile');
fs.mkdirSync(profile,{recursive:true});
app.setPath('userData',profile);
if(!app.requestSingleInstanceLock()){
 app.quit();
}else{
 const pendingFiles=new Set();
 let workspace,window,dialogBusy=false;

 function flushOpenFiles(){
  if(!workspace||!window||window.isDestroyed()||!pendingFiles.size)return;
  for(const file of pendingFiles)workspace.queueNativeFile(file);
  pendingFiles.clear();
  void window.webContents.executeJavaScript("window.dispatchEvent(new Event('pwh-native-open'))").catch(()=>{});
 }

 function openFile(file){
  if(typeof file==='string'&&path.isAbsolute(file)&&/\.hwpx?$/i.test(file)&&pendingFiles.size<12)pendingFiles.add(file);
  flushOpenFiles();
 }
 app.on('open-file',(event,file)=>{event.preventDefault();openFile(file);});
 app.on('second-instance',(_event,args)=>{
  for(const arg of args)openFile(arg);
  if(window?.isMinimized())window.restore();
  window?.focus();
 });
 app.on('activate',()=>window?.show());
 for(const arg of process.argv.slice(1))openFile(arg);

 async function chooseFile({mode,suggestedName}){
  if(!window||window.isDestroyed())throw Error('문서 창을 확인하지 못했습니다.');
  if(dialogBusy)throw Error('파일 선택창이 이미 열려 있습니다.');
  dialogBusy=true;
  try{
   if(mode==='Open'){
    const result=await dialog.showOpenDialog(window,{title:'문서 열기',properties:['openFile'],filters:[{name:'한글 문서',extensions:['hwp','hwpx']}]});
    return result.canceled?{cancelled:true}:{path:result.filePaths[0]};
   }
   if(mode!=='Save'&&mode!=='Image')throw Error('파일 선택 방식이 올바르지 않습니다.');
   const image=mode==='Image';
   const defaultPath=path.basename(typeof suggestedName==='string'?suggestedName:'')||(image?'문서.png':'문서.hwpx');
   const result=await dialog.showSaveDialog(window,{title:image?'그림으로 저장':'문서 저장',defaultPath,filters:image?
    [{name:'그림',extensions:['png','jpg','jpeg','bmp','gif','tif','tiff']}]:[{name:'한글 문서',extensions:['hwpx']}]});
   return result.canceled?{cancelled:true}:{path:result.filePath};
  }finally{dialogBusy=false;}
 }

 async function start(){
  for(const key of ['PWH_CONFIG','PWH_RHWP_PATH','PWH_STUDIO_PATH','PWH_EDITOR_SDK_PATH','PWH_HOP_PATH','PWH_STOOM_MODULE','PWH_DESKTOP_DEBUG','HWPXYZ_RHWP_PATH','HWPXYZ_OUTPUT_ROOT'])delete process.env[key];
  Object.assign(process.env,{
   PWH_DESKTOP_DISTRIBUTION:'macos-preview',
   PWH_STANDALONE_DATA:dataRoot,
   PWH_RUNTIME_ROOT:path.join(programRoot,'engine'),
   PWH_OUTPUT_ROOT:path.join(dataRoot,'documents'),
   PWH_FONT_ROOT:path.join(dataRoot,'fonts'),
  });
  const {createWorkspaceServer}=await import('./workspace-shell.mjs');
  const nativeBranding={
   token:randomBytes(16).toString('hex'),
   complete:false,
   openMacUpdate:async value=>{
    const url=new URL(value);
    if(url.origin!=='https://github.com'||!/^\/wansucong-stoom\/stoom-pwh\/releases\/tag\/(?:macos-preview-|v)\d+\.\d+\.\d+$/.test(url.pathname)||url.search||url.hash||url.username||url.password)throw Error('GitHub 배포 주소를 확인하지 못했습니다.');
    await shell.openExternal(url.href);
   },
  };
  workspace=await createWorkspaceServer({
   nativeBranding,chooseFile,distribution:'macos-preview',
   nodeExecutable:path.join(programRoot,'node','node'),
  });
  app.once('will-quit',()=>workspace.server.close());
  const desktop=startElectronShell({url:workspace.url,dataRoot,onReady:current=>{
   window=current;
   nativeBranding.complete=true;
   flushOpenFiles();
  }});
  nativeBranding.resolveDroppedFiles=desktop.resolveDroppedFiles;
  nativeBranding.requestClose=desktop.requestClose;
  await desktop.ready;
 }

 start().catch(error=>{
  console.error('Pwh startup failed:',error);
  if(process.env.PWH_ELECTRON_TEST_HIDDEN!=='1')dialog.showErrorBox('Pwh Desktop','앱을 시작하지 못했습니다. 시험판 파일을 다시 확인해 주세요.');
  workspace?.server.close();
  app.exit(1);
 });
}
