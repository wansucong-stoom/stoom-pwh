import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import config from './config.mjs';
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
  const core=await fs.readFile(path.join(config.runtimeRoot,'core','rhwp.js'));
  await checkCoreFile('rhwp.js',core);
  const html=await fs.readFile(new URL('./client-viewer.html',import.meta.url),'utf8');
  if(!html.includes('/* PWH_CORE_MODULE */')) throw new Error('Client core insertion marker is absent');
  return html.replace('/* PWH_CORE_MODULE */',()=>core.toString('utf8').replace(/<\/script/gi,'<\\/script'));
}
export async function saveClientDocument(args,meta={}) {
  const source=documentPath(meta,args.documentId);
  if(!hashPattern.test(args.expectedSourceSha256||'')||!hashPattern.test(args.documentSha256||'')) throw new Error('Source and document SHA256 required');
  if(!Number.isSafeInteger(args.revision)||args.revision<0) throw new Error('Invalid client revision');
  if(sha(await fs.readFile(source))!==args.expectedSourceSha256) throw new Error('Source changed; client save refused');
  if(typeof args.base64!=='string'||args.base64.length>Math.ceil(MAX_DOCUMENT*4/3)+4||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(args.base64)) throw new Error('Invalid or oversized HWPX snapshot');
  const bytes=Buffer.from(args.base64,'base64');
  if(!bytes.length||bytes.length>MAX_DOCUMENT||bytes.subarray(0,2).toString()!=='PK'||sha(bytes)!==args.documentSha256) throw new Error('Snapshot signature/digest mismatch');
  const filename=path.join(path.dirname(source),`${path.basename(source,'.hwpx')}-수정본-${randomUUID().slice(0,8)}.hwpx`);
  // A fresh same-directory file never overwrites the source. Parse before publishing.
  const temporary=path.join(path.dirname(source),`.pwh-${randomUUID()}.hwpx`);
  let created=false;
  try {
    await fs.writeFile(temporary,bytes,{flag:'wx'});
    created=true;
    const info=(await runEngine(['info',temporary,'--json'])).data;
    if(info?.format!=='hwpx') throw new Error('Client snapshot did not reopen as HWPX');
    if(sha(await fs.readFile(source))!==args.expectedSourceSha256) throw new Error('Source changed during save');
    await fs.copyFile(temporary,filename,1);
    const registered=await registerClientDocument(filename);
    return {...registered,path:filename,revision:args.revision,documentSha256:sha(bytes),info};
  } finally { if(created) await fs.unlink(temporary).catch(()=>{}); }
}
