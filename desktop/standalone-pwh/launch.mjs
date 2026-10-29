import path from 'node:path';
import os from 'node:os';
import {promises as fs} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';

const dataRoot=process.env.PWH_DESKTOP_DATA_ROOT||path.join(process.env.LOCALAPPDATA||os.homedir(),'PwhDesktop');
const programRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for(const key of ['PWH_CONFIG','PWH_RHWP_PATH','PWH_STUDIO_PATH','PWH_EDITOR_SDK_PATH','PWH_HOP_PATH','PWH_STOOM_MODULE','PWH_DESKTOP_DEBUG','HWPXYZ_RHWP_PATH','HWPXYZ_OUTPUT_ROOT'])delete process.env[key];
process.env.PWH_STANDALONE_DATA=dataRoot;
process.env.PWH_RUNTIME_ROOT=path.join(programRoot,'engine');
process.env.PWH_OUTPUT_ROOT=path.join(dataRoot,'documents');
process.env.PWH_FONT_ROOT=path.join(dataRoot,'fonts');
const arg=process.argv[2];
if(arg&&!/\.hwpx?$/i.test(arg))throw Error('HWP 또는 HWPX 문서를 선택하세요.');
if(arg&&(await fs.stat(path.resolve(arg))).size>64*1024*1024)throw Error('문서 크기 한도는 64 MiB입니다.');
const {createWorkspaceServer}=await import('./workspace-shell.mjs');
const nativeLauncher=path.join(programRoot,'PwhDesktop.exe');
const nativeBranding=process.platform==='win32'&&process.env.PWH_NATIVE_LAUNCHER===nativeLauncher?{token:randomBytes(16).toString('hex'),complete:false,failed:false}:undefined;
const startOptions={initialPath:arg?path.resolve(arg):undefined,nativeBranding};let instance;
try{instance=await createWorkspaceServer({...startOptions,port:48673});}catch(error){if(error.code!=='EADDRINUSE')throw error;instance=await createWorkspaceServer(startOptions);}
const {server,url}=instance;
const candidates=[path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe'),path.join(process.env.ProgramFiles||'C:/Program Files','Microsoft/Edge/Application/msedge.exe')];
let edge='';for(const candidate of candidates){try{await fs.access(candidate);edge=candidate;break;}catch{}}
if(!edge){server.close();throw Error('Microsoft Edge가 필요합니다.');}
await fs.mkdir(dataRoot,{recursive:true});
const child=spawn(edge,[`--app=${url}`,`--user-data-dir=${path.join(dataRoot,'browser-profile')}`,'--no-first-run'],{windowsHide:false,stdio:'ignore'});
child.once('error',()=>server.close());child.once('exit',code=>{if(code)server.close();});
server.once('close',()=>child.unref());
if(nativeBranding){
 const brand=spawn(nativeLauncher,['--brand-window',nativeBranding.token],{windowsHide:true,stdio:['pipe','pipe','ignore']});
 nativeBranding.helperPid=brand.pid;
 let output='';brand.stdout.on('data',chunk=>{output=(output+chunk).slice(-1024);if(/PWH_WINDOW_BRANDED \d+/.test(output))nativeBranding.complete=true;});
 brand.once('error',()=>nativeBranding.failed=true);brand.once('exit',()=>{if(!nativeBranding.complete)nativeBranding.failed=true;});
 nativeBranding.closing=()=>{if(!brand.stdin.destroyed)brand.stdin.write('closing\n');};
 nativeBranding.ready=()=>{if(!brand.stdin.destroyed)brand.stdin.write('ready\n');};
 nativeBranding.requestClose=()=>{if(!brand.stdin.destroyed)brand.stdin.write('update-close\n');};
 brand.stdin.on('error',()=>{});
 server.once('close',()=>{nativeBranding.closing();brand.stdin.end();});
}
