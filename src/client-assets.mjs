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
const CHUNK=512*1024, MAX_DOCUMENT=8*1024*1024;
const documents=new Map();
const hashPattern=/^[a-f0-9]{64}$/i;

export async function registerClientDocument(filename) {
  if(!path.isAbsolute(filename)||!/\.hwpx$/i.test(filename)) throw new Error('Client viewer requires an absolute HWPX path');
  const real=await fs.realpath(filename), stat=await fs.stat(real);
  if(!stat.isFile()||stat.size>MAX_DOCUMENT) throw new Error('Client HWPX must be at most 8 MiB');
  const bytes=await fs.readFile(real);
  if(bytes.length>MAX_DOCUMENT) throw new Error('Client HWPX changed or exceeds 8 MiB');
  if(bytes.subarray(0,2).toString()!=='PK') throw new Error('HWPX ZIP signature is missing');
  const id=randomUUID(); documents.set(id,{path:real,sha256:sha(bytes)});
  if(documents.size>64) documents.delete(documents.keys().next().value);
  return {documentId:id,source:real,sourceSha256:sha(bytes),name:path.basename(real)};
}
function documentPath(meta,id) {
  if(id) { const record=documents.get(id); if(!record) throw new Error('Document context expired; reopen the HWPX'); return record.path; }
  const filename=meta?.['openai/resource']?.path;
  if(typeof filename!=='string'||!path.isAbsolute(filename)||!/\.hwpx$/i.test(filename)) throw new Error('Host HWPX file context is required');
  return filename;
}
export async function readClientAsset(args,meta={}) {
  if(!Number.isSafeInteger(args.offset)||args.offset<0) throw new Error('Invalid asset offset');
  let file;
  if(args.kind==='wasm') file=path.join(config.runtimeRoot,'core','rhwp_bg.wasm');
  else if(args.kind==='document') file=documentPath(meta,args.documentId);
  else throw new Error('Unknown client asset');
  const stat=await fs.stat(file);
  if(!stat.isFile()||stat.size>(args.kind==='wasm'?32*1024*1024:MAX_DOCUMENT)) throw new Error('Client asset too large');
  const bytes=await fs.readFile(file),hash=sha(bytes);
  if(args.kind==='wasm') await checkCoreFile('rhwp_bg.wasm',bytes);
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
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>pwh HWPX 편집기</title><style>${css}\n#pwh-header{font:12px system-ui;background:#fff;color:#222;padding:6px 10px;display:flex;gap:10px;align-items:center;border-bottom:1px solid #ddd}#pwh-title{max-width:30%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#pwh-status{flex:1}#studio-root{height:calc(100vh - 40px)!important}</style><script>${escapeScript(recovery.replace(/export /g,''))}\n${escapeScript(host)}</script></head><body><div id="pwh-header"><span id="pwh-title">HWPX 편집기</span><span id="pwh-task" style="color:#375c92;font-size:11px"></span><span id="pwh-status" role="status">편집기를 불러오고 있습니다.</span><button id="pwh-retry" hidden>다시 연결</button><button id="pwh-save">새 수정본 저장</button></div>${body}<script type="module">${escapeScript(editor)}</script></body></html>`;
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
