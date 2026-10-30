import path from 'node:path';
import os from 'node:os';
import {promises as fs} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createElectronController} from './electron-controller.mjs';

const appRoot=path.dirname(fileURLToPath(import.meta.url));
const dataRoot=process.env.PWH_DESKTOP_DATA_ROOT||path.join(process.env.LOCALAPPDATA||os.homedir(),'PwhDesktop');
const programRoot=path.dirname(appRoot),runtime=path.join(programRoot,'electron','PwhDesktopShell.exe');
for(const key of ['PWH_CONFIG','PWH_RHWP_PATH','PWH_STUDIO_PATH','PWH_EDITOR_SDK_PATH','PWH_HOP_PATH','PWH_STOOM_MODULE','PWH_DESKTOP_DEBUG','HWPXYZ_RHWP_PATH','HWPXYZ_OUTPUT_ROOT'])delete process.env[key];
process.env.PWH_STANDALONE_DATA=dataRoot;
process.env.PWH_RUNTIME_ROOT=path.join(programRoot,'engine');
process.env.PWH_OUTPUT_ROOT=path.join(dataRoot,'documents');
process.env.PWH_FONT_ROOT=path.join(dataRoot,'fonts');
const arg=process.argv[2];
if(arg&&!/\.hwpx?$/i.test(arg))throw Error('HWP 또는 HWPX 문서를 선택하세요.');
if(arg&&(await fs.stat(path.resolve(arg))).size>64*1024*1024)throw Error('문서 크기 한도는 64 MiB입니다.');
await fs.access(runtime);await fs.mkdir(dataRoot,{recursive:true});
const {createWorkspaceServer}=await import('./workspace-shell.mjs');
const nativeBranding={token:randomBytes(16).toString('hex'),complete:false,failed:false};
const startOptions={initialPath:arg?path.resolve(arg):undefined,nativeBranding};let instance;
try{instance=await createWorkspaceServer({...startOptions,port:48673});}catch(error){if(error.code!=='EADDRINUSE')throw error;instance=await createWorkspaceServer(startOptions);}
const {server,url}=instance;
const controller=await createElectronController({
 onReady:()=>{nativeBranding.complete=true;},
 onFailure:()=>{nativeBranding.failed=true;},
});
const child=spawn(runtime,[path.join(appRoot,'electron-shell.cjs'),'--pwh-url='+url,'--pwh-host-pipe='+controller.pipe,'--pwh-host-token='+controller.token],{windowsHide:false,stdio:['ignore','ignore','pipe'],env:{...process.env}});
let startupDiagnostic='';child.stderr.on('data',chunk=>{startupDiagnostic=(startupDiagnostic+chunk.toString()).slice(-8000);});
controller.attachProcess(child);
nativeBranding.resolveDroppedFiles=(id,count)=>controller.resolveDroppedFiles(url,id,count);
nativeBranding.ready=()=>{};nativeBranding.closing=()=>{};
nativeBranding.requestClose=()=>controller.requestClose();
nativeBranding.helperPid=child.pid;
child.once('error',()=>{process.exitCode=1;server.close();});child.once('exit',code=>{if(code||!nativeBranding.complete){process.exitCode=code||1;void fs.writeFile(path.join(dataRoot,'startup-error.log'),startupDiagnostic.replace(/http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{48}\//g,'[Pwh local window]')).catch(()=>{});}server.close();});
server.once('close',()=>controller.close());
