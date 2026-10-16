import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import config from './config.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const execFileAsync=promisify(execFile);
const saveTickets=new Map();
export async function chooseSavePath({initialDirectory,suggestedName}) {
  if(process.platform!=='win32') throw new Error('Windows save dialog is required on this platform');
  const {stdout}=await execFileAsync('powershell.exe',['-NoProfile','-STA','-File',fileURLToPath(new URL('../scripts/save-dialog.ps1',import.meta.url)),'-InitialDirectory',initialDirectory,'-SuggestedName',suggestedName],{windowsHide:true,timeout:300000,maxBuffer:65536,encoding:'utf8'});
  return JSON.parse(stdout.trim());
}
export async function selectClientSaveDestination(args,meta={},choose=chooseSavePath) {
  const source=documentPath(meta,args.documentId);
  if(!hashPattern.test(args.expectedSourceSha256||'')||sha(await fs.readFile(source))!==args.expectedSourceSha256) throw new Error('Source changed; reopen the document');
  const selected=await choose({initialDirectory:path.dirname(source),suggestedName:`${path.basename(source,path.extname(source))}-수정본-${randomUUID().slice(0,8)}.hwpx`});
  if(selected.cancelled)return {cancelled:true};
  const filename=selected.path;
  if(typeof filename!=='string'||!path.isAbsolute(filename)||!/\.hwpx$/i.test(filename))throw new Error('Choose an absolute HWPX filename');
  try {await fs.lstat(filename);throw new Error('Existing file cannot be overwritten; choose a new filename');}catch(e){if(e.code!=='ENOENT')throw e;}
  const saveTicket=randomUUID();
  for(const [id,t] of saveTickets)if(Date.now()-t.createdAt>600000)saveTickets.delete(id);
  if(saveTickets.size>=64)throw new Error('Too many pending save dialogs');
  saveTickets.set(saveTicket,{source,filename,sha256:args.expectedSourceSha256,createdAt:Date.now()});
  return {cancelled:false,saveTicket,path:filename};
}
import {runEngine} from './engine.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const CHUNK=512*1024, MAX_DOCUMENT=64*1024*1024;
const assetCache=new Map();let cachedBytes=0;
async function cachedAsset(file,kind){
 const stat=await fs.stat(file);if(!stat.isFile()||stat.size>(kind==='wasm'?32*1024*1024:MAX_DOCUMENT))throw Error('Client asset too large');
 const marker=kind==='wasm'?await fs.readFile(path.join(config.runtimeRoot,'core','.pwh-install.json'),'utf8'):'';
 const key=`${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${marker}`;
 let record=assetCache.get(file);if(record?.key===key){assetCache.delete(file);assetCache.set(file,record);return record;}
 if(record){cachedBytes-=record.bytes.length;assetCache.delete(file);}
 const bytes=await fs.readFile(file);if(bytes.length!==stat.size)throw Error('Asset changed during read');
 const hash=sha(bytes);if(kind==='wasm')await checkCoreFile('rhwp_bg.wasm',bytes);
 record={key,bytes,hash};
 while(assetCache.size&&(cachedBytes+bytes.length>96*1024*1024||assetCache.size>=3)){const oldest=assetCache.keys().next().value;cachedBytes-=assetCache.get(oldest).bytes.length;assetCache.delete(oldest);}
 if(assetCache.has(file))cachedBytes-=assetCache.get(file).bytes.length;
 assetCache.set(file,record);cachedBytes+=bytes.length;return record;
}
const documents=new Map();
const hashPattern=/^[a-f0-9]{64}$/i;
const uploads=new Map(),UPLOAD_TTL=15*60*1000;
async function cleanUploads(){for(const [id,t]of uploads)if(!t.busy&&Date.now()-t.updatedAt>UPLOAD_TTL){uploads.delete(id);await fs.unlink(t.temporary).catch(()=>{});}}
const uploadCleanup=setInterval(()=>{void cleanUploads().catch(()=>{});},60000);uploadCleanup.unref();
export async function beginClientSave(args,meta={}){
 await cleanUploads();const source=documentPath(meta,args.documentId);
 if(!Number.isSafeInteger(args.totalBytes)||args.totalBytes<2||args.totalBytes>MAX_DOCUMENT||!hashPattern.test(args.documentSha256||'')||!hashPattern.test(args.expectedSourceSha256||''))throw Error('Invalid save size or digest; maximum is 64 MiB');
 if(sha(await fs.readFile(source))!==args.expectedSourceSha256)throw Error('Source changed; reopen the document');
 const ticket=saveTickets.get(args.saveTicket);
 if(!ticket||ticket.source!==source||ticket.sha256!==args.expectedSourceSha256||Date.now()-ticket.createdAt>600000)throw Error('Choose a save destination again');
 if(uploads.size>=4)throw Error('Too many pending saves');
 const transferId=randomUUID(),temporary=path.join(path.dirname(ticket.filename),`.pwh-upload-${transferId}.hwpx`);
 await fs.writeFile(temporary,Buffer.alloc(0),{flag:'wx'});
 uploads.set(transferId,{source,filename:ticket.filename,temporary,totalBytes:args.totalBytes,documentSha256:args.documentSha256,sourceSha256:args.expectedSourceSha256,offset:0,updatedAt:Date.now(),busy:false});
 saveTickets.delete(args.saveTicket);return {transferId,chunkBytes:CHUNK,totalBytes:args.totalBytes,nextOffset:0};
}
function getUpload(id){const transfer=uploads.get(id);if(!transfer||Date.now()-transfer.updatedAt>UPLOAD_TTL)throw Error('Save transfer expired; choose the destination again');if(transfer.busy)throw Error('Save transfer is busy');return transfer;}
export async function uploadClientChunk(args){
 const t=getUpload(args.transferId);
 if(!Number.isSafeInteger(args.offset)||args.offset<0||typeof args.base64!=='string'||!args.base64.length||args.base64.length>Math.ceil(CHUNK*4/3)+4||args.base64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(args.base64))throw Error('Invalid save chunk');
 const bytes=Buffer.from(args.base64,'base64'),hash=sha(bytes);
 if(!bytes.length||bytes.length>CHUNK||bytes.toString('base64')!==args.base64||args.offset+bytes.length>t.totalBytes)throw Error('Invalid save chunk size/encoding');
 if(t.last?.offset===args.offset&&t.last.hash===hash){t.updatedAt=Date.now();return {transferId:args.transferId,nextOffset:t.offset,totalBytes:t.totalBytes};}
 if(args.offset!==t.offset)throw Error('Save chunk offset mismatch');
 if(args.offset===0&&bytes.subarray(0,2).toString()!=='PK')throw Error('HWPX signature is missing');
 t.busy=true;
 try{const handle=await fs.open(t.temporary,'r+');try{let written=0;while(written<bytes.length){const result=await handle.write(bytes,written,bytes.length-written,args.offset+written);if(!result.bytesWritten)throw Error('Save chunk write failed');written+=result.bytesWritten;}}finally{await handle.close();}
  t.offset+=bytes.length;t.last={offset:args.offset,hash};t.updatedAt=Date.now();return {transferId:args.transferId,nextOffset:t.offset,totalBytes:t.totalBytes};
 }finally{t.busy=false;}
}
export async function abortClientSave(args){
 const t=uploads.get(args.transferId);if(!t)return {aborted:false};if(t.busy)throw Error('Save transfer is busy');uploads.delete(args.transferId);await fs.unlink(t.temporary).catch(()=>{});return {aborted:true};
}
export async function commitClientSave(args,verify=async file=>(await runEngine(['info',file,'--json'])).data){
 const t=getUpload(args.transferId);if(t.offset!==t.totalBytes)throw Error('Save transfer is incomplete');
 t.busy=true;
 try{
  const bytes=await fs.readFile(t.temporary);
  if(bytes.length!==t.totalBytes||sha(bytes)!==t.documentSha256)throw Error('Save transfer digest mismatch');
  if(sha(await fs.readFile(t.source))!==t.sourceSha256)throw Error('Source changed during save');
  const info=await verify(t.temporary);if(info?.format!=='hwpx')throw Error('Saved document did not reopen as HWPX');
  if(sha(await fs.readFile(t.source))!==t.sourceSha256)throw Error('Source changed during verification');
  // The verifier is read-only, but recheck staged bytes before publication too.
  if(sha(await fs.readFile(t.temporary))!==t.documentSha256)throw Error('Staged document changed during verification');
  await fs.copyFile(t.temporary,t.filename,1);
  const registered=await registerClientDocument(t.filename);return {...registered,path:t.filename,revision:1,documentSha256:t.documentSha256,info};
 }finally{uploads.delete(args.transferId);await fs.unlink(t.temporary).catch(()=>{});}
}

export async function registerClientDocument(filename) {
  if(!path.isAbsolute(filename)||!/\.hwpx$/i.test(filename)) throw new Error('Client viewer requires an absolute HWPX path');
  const real=await fs.realpath(filename), stat=await fs.stat(real);
  if(!stat.isFile()||stat.size>MAX_DOCUMENT) throw new Error('Client HWPX must be at most 64 MiB');
  const bytes=await fs.readFile(real);
  if(bytes.length>MAX_DOCUMENT) throw new Error('Client HWPX changed or exceeds 64 MiB');
  if(bytes.subarray(0,2).toString()!=='PK') throw new Error('HWPX ZIP signature is missing');
  const id=randomUUID(); documents.set(id,{path:real,sha256:sha(bytes)});
  if(documents.size>64) documents.delete(documents.keys().next().value);
  return {documentId:id,source:real,sourceSha256:sha(bytes),name:path.basename(real)};
}
export function normalizeHostDocumentPath(filename){
 if(typeof filename!=='string')return filename;
 // Some Windows file-link routes prepend the drive to an already absolute
 // /C:/ path, producing C:\C:\folder\... . Correct only that exact same-drive
 // duplication; do not reinterpret arbitrary URI/path prefixes.
 const duplicate=filename.match(/^([a-z]):[\\/]+([a-z]):([\\/].*)$/i);
 if(duplicate&&duplicate[1].toLowerCase()===duplicate[2].toLowerCase())return duplicate[2]+':'+duplicate[3];
 if(/^[\\/][a-z]:[\\/]/i.test(filename))return filename.slice(1);
 return filename;
}
function documentPath(meta,id) {
  if(id) { const record=documents.get(id); if(!record) throw new Error('Document context expired; reopen the HWPX'); return record.path; }
  const filename=normalizeHostDocumentPath(meta?.['openai/resource']?.path);
  if(typeof filename!=='string'||!path.isAbsolute(filename)||!/\.hwpx$/i.test(filename)) throw new Error('Host HWPX file context is required');
  return filename;
}
export async function readClientAsset(args,meta={}) {
  if(!Number.isSafeInteger(args.offset)||args.offset<0) throw new Error('Invalid asset offset');
  let file;
  if(args.kind==='wasm') file=path.join(config.runtimeRoot,'core','rhwp_bg.wasm');
  else if(args.kind==='document') file=documentPath(meta,args.documentId);
  else throw new Error('Unknown client asset');
  const {bytes,hash}=await cachedAsset(file,args.kind);
  if(args.expectedSha256!==undefined&&args.expectedSha256!==hash) throw new Error('Asset changed during transfer; reopen the document');
  if(args.documentId&&args.kind==='document'&&documents.get(args.documentId)?.sha256!==hash) throw new Error('Source document changed; reopen it');
  if(args.offset>bytes.length) throw new Error('Asset offset out of range');
  const end=Math.min(bytes.length,args.offset+CHUNK);
  const summary={kind:args.kind,offset:args.offset,totalBytes:bytes.length,sha256:hash,nextOffset:end<bytes.length?end:null,
    ...(args.kind==='document'?{source:file,name:path.basename(file)}:{})};
  return {content:[{type:'text',text:'Client asset chunk'}],structuredContent:summary,
    _meta:{'pwh/client-bytes':bytes.subarray(args.offset,end).toString('base64')}};
}
async function checkCoreFile(name,bytes) {
  const marker=JSON.parse(await fs.readFile(path.join(config.runtimeRoot,'core','.pwh-install.json'),'utf8'));
  if(marker.kind!=='core'||marker.version!=='0.8.7'||marker.files?.[name]!==sha(bytes)) throw new Error('Client core integrity mismatch; run pwh setup');
}
export async function clientViewerHtml() {
  const root=path.join(config.runtimeRoot,'studio-inline');
  const [body,css,editor,host]=await Promise.all([fs.readFile(path.join(root,'editor-body.html'),'utf8'),fs.readFile(path.join(root,'rhwp-studio.css'),'utf8'),fs.readFile(path.join(root,'editor.js'),'utf8'),fs.readFile(new URL('./inline-host.js',import.meta.url),'utf8')]);
  const marker=JSON.parse(await fs.readFile(path.join(root,'.pwh-install.json'),'utf8'));
  if(marker.kind!=='studio-inline'||Object.entries({'editor-body.html':body,'rhwp-studio.css':css,'editor.js':editor}).some(([name,value])=>marker.files?.[name]!==sha(Buffer.from(value))))throw new Error('Inline editor integrity mismatch; rebuild it with pwh setup');
  const recovery=await fs.readFile(new URL('./inline-recovery.js',import.meta.url),'utf8');
  const escapeScript=s=>s.replace(/<\/script/gi,'<\\/script');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>pwh HWPX 편집기</title><style>${css}\nhtml,body{height:100%;overflow:hidden}body{display:flex;flex-direction:column}#pwh-header{box-sizing:border-box;font:12px/1.4 "Segoe UI","Malgun Gothic",sans-serif;background:var(--toolbar-bg,#f5f5f5);color:var(--text-color,#333);padding:0 12px;display:flex;flex:0 0 38px;height:38px;min-height:38px;max-height:38px;overflow:hidden;gap:12px;align-items:center;border-bottom:1px solid var(--border-color,#d0d0d0)}#pwh-title{flex:0 1 28%;min-width:0;font-weight:600;color:inherit}#pwh-task{flex:0 1 25%;min-width:0;color:#42607d!important;font-size:11px}#pwh-task:empty{display:none}#pwh-status{flex:1 1 0;min-width:0;font-size:11px;color:#68717c}#pwh-title,#pwh-task,#pwh-status{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#pwh-header button{box-sizing:border-box;flex:0 0 auto;white-space:nowrap;font:inherit;line-height:24px;height:26px;padding:0 10px;border:1px solid #c3c8ce;border-radius:4px;background:linear-gradient(#fff,#ededed);color:#333;cursor:pointer}#pwh-header button:hover{background:#e7eef7;border-color:#96abc5}#pwh-header button:focus-visible{outline:2px solid #638bb8;outline-offset:2px}#pwh-header button:disabled{opacity:.5;cursor:wait}#pwh-retry[hidden]{display:none}#pwh-save{margin-left:auto}#studio-root{flex:1 1 0;min-height:0;height:calc(100vh - 38px)!important}@media(max-width:650px){#pwh-title{flex-basis:32%}#pwh-status{display:none}#pwh-task{flex:1 1 0}}@media(prefers-color-scheme:dark){#pwh-header{background:#292b2e;color:#e2e5e9;border-color:#44484e}#pwh-status{color:#abb2be}#pwh-task{color:#a7bfdc!important}#pwh-header button{background:#373b41;border-color:#5a626c;color:#e2e5e9}#pwh-header button:hover{background:#444d5b}}</style><script>${escapeScript(recovery.replace(/export /g,''))}\n${escapeScript(host)}</script></head><body><div id="pwh-header"><span id="pwh-title">HWPX 편집기</span><span id="pwh-task" style="color:#375c92;font-size:11px"></span><span id="pwh-status" role="status">편집기를 불러오고 있습니다.</span><button id="pwh-retry" hidden>다시 연결</button><button id="pwh-save">새 수정본 저장</button></div>${body}<script type="module">${escapeScript(editor)}</script></body></html>`;
}
export async function saveClientDocument(args,meta={}) {
  const source=documentPath(meta,args.documentId);
  if(!hashPattern.test(args.expectedSourceSha256||'')||!hashPattern.test(args.documentSha256||'')) throw new Error('Source and document SHA256 required');
  if(!Number.isSafeInteger(args.revision)||args.revision<0) throw new Error('Invalid client revision');
  if(sha(await fs.readFile(source))!==args.expectedSourceSha256) throw new Error('Source changed; client save refused');
  if(typeof args.base64!=='string'||args.base64.length>Math.ceil(MAX_DOCUMENT*4/3)+4||args.base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(args.base64)) throw new Error('Invalid or oversized HWPX snapshot');
  const bytes=Buffer.from(args.base64,'base64');
  if(bytes.toString('base64')!==args.base64) throw new Error('Noncanonical base64 snapshot');
  if(!bytes.length||bytes.length>MAX_DOCUMENT||bytes.subarray(0,2).toString()!=='PK'||sha(bytes)!==args.documentSha256) throw new Error('Snapshot signature/digest mismatch');
  const ticket=saveTickets.get(args.saveTicket);
  if(!ticket||ticket.source!==source||ticket.sha256!==args.expectedSourceSha256||Date.now()-ticket.createdAt>600000)throw new Error('Choose a save destination again');
  const filename=ticket.filename;
  // A fresh same-directory file never overwrites the source. Parse before publishing.
  const temporary=path.join(path.dirname(filename),`.pwh-${randomUUID()}.hwpx`);
  let created=false;
  try {
    await fs.writeFile(temporary,bytes,{flag:'wx'});
    created=true;
    const info=(await runEngine(['info',temporary,'--json'])).data;
    if(info?.format!=='hwpx') throw new Error('Client snapshot did not reopen as HWPX');
    if(sha(await fs.readFile(source))!==args.expectedSourceSha256) throw new Error('Source changed during save');
    await fs.copyFile(temporary,filename,1);
    saveTickets.delete(args.saveTicket);
    const registered=await registerClientDocument(filename);
    return {...registered,path:filename,revision:args.revision,documentSha256:sha(bytes),info};
  } finally { if(created) await fs.unlink(temporary).catch(()=>{}); }
}
