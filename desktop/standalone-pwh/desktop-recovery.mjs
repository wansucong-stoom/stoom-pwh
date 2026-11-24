import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pipeline} from 'node:stream/promises';

const digestPattern=/^[a-f0-9]{64}$/;
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const headerBytes=32;
const absent=error=>error.code==='ENOENT';

function draftDirectory(root,document) {
  // Keep the recovery identity separate from the temporary HWPX transfer path.
  const source=document.docxSource??document.originalHwpSource??document.source;
  const digest=document.docxSha256??document.originalHwpSha256??document.sourceSha256;
  return path.join(root,createHash('sha256').update(source+'\0'+digest).digest('hex'));
}

async function openDraft(directory,owner) {
  let handle;
  try {
    handle=await fs.open(path.join(directory,owner+'.draft'),'r');
    const stat=await handle.stat();
    const header=Buffer.alloc(headerBytes);
    const {bytesRead}=await handle.read(header,0,headerBytes,0);
    if (!stat.isFile() || bytesRead!==headerBytes || stat.size<=headerBytes) {await handle.close();return null;}
    return {handle,record:{owner,sha256:header.toString('hex'),size:stat.size-headerBytes,savedAt:stat.mtimeMs}};
  } catch (error) {
    await handle?.close();
    if (absent(error))return null;
    throw error;
  }
}
const ackFile=(directory,owner)=>path.join(directory,owner+'.ack');
async function acknowledged(directory,record) {
  try {return await fs.readFile(ackFile(directory,record.owner),'utf8')===record.sha256;}
  catch (error) {if (absent(error))return false;throw error;}
}

export function createDesktopRecovery(root) {
  const owner=randomUUID();
  const collection=document=>draftDirectory(root,document);

  async function info(document,{own=false,includeDismissed=false}={}) {
    const directory=collection(document);
    let names;
    try {names=own?[owner+'.draft']:await fs.readdir(directory);}
    catch (error) {if(absent(error))return null;throw error;}
    let latest=null;
    for (const name of names) {
      if (!name.endsWith('.draft'))continue;
      const candidate=name.slice(0,-6);
      if (!uuid.test(candidate))continue;
      const opened=await openDraft(directory,candidate);
      if (!opened) continue;
      await opened.handle.close();
      const {record}=opened;
      if ((!latest||record.savedAt>latest.savedAt) && (includeDismissed||!await acknowledged(directory,record)))latest=record;
    }
    return latest;
  }

  async function write(document,stream,sha256,size,stillCurrent) {
    if (!digestPattern.test(sha256??'') || !Number.isSafeInteger(size) || size<8) throw Error('복구본의 길이 또는 확인값이 올바르지 않습니다.');
    const directory=collection(document), temporary=path.join(directory,'.write-'+randomUUID());
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    const handle=await fs.open(temporary,'wx',0o600);
    const hash=createHash('sha256');
    let bytes=0;
    const signature=Buffer.alloc(2);
    try {
      await handle.writeFile(Buffer.from(sha256,'hex'));
      for await (const chunk of stream) {
        if (bytes<2) chunk.copy(signature,bytes,0,Math.min(2-bytes,chunk.length));
        if (bytes+chunk.length>size) throw Error('복구본의 길이가 올바르지 않습니다.');
        await handle.writeFile(chunk);
        hash.update(chunk);bytes+=chunk.length;
      }
      if (bytes!==size||signature.toString()!=='PK'||hash.digest('hex')!==sha256) throw Error('복구본을 검증하지 못했습니다.');
      await handle.sync();
      await handle.close();
      if (!stillCurrent()) throw Error('복구본을 기록하는 동안 문서가 바뀌었습니다.');
      await fs.rename(temporary,path.join(directory,owner+'.draft'));
      return {owner,sha256};
    } finally {
      await handle.close().catch(()=>{});
      await fs.unlink(temporary).catch(()=>{});
    }
  }

  async function read(document,res,{owner:requested,sha256}) {
    const directory=collection(document);
    const opened=uuid.test(requested??'')&&digestPattern.test(sha256??'')?await openDraft(directory,requested):null;
    if (!opened)throw Error('복구본을 찾을 수 없습니다.');
    try {
      if (opened.record.sha256!==sha256)throw Error('복구본이 갱신되었습니다.');
      res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':opened.record.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      await pipeline(opened.handle.createReadStream({start:headerBytes,autoClose:false}),res).catch(error=>{if(!res.destroyed)throw error;});
    } finally {await opened.handle.close();}
  }

  async function acknowledge(document,record,dismissed) {
    if (!uuid.test(record?.owner??'')||!digestPattern.test(record?.sha256??''))return;
    const directory=collection(document),file=ackFile(directory,record.owner);
    const opened=await openDraft(directory,record.owner);
    if (!opened)return;
    await opened.handle.close();
    if (opened.record.sha256!==record.sha256)return;
    const alreadyDismissed=await acknowledged(directory,record);
    if (dismissed) {
      if(alreadyDismissed)return false;
      await fs.writeFile(file,record.sha256,{mode:0o600});
      return true;
    } else if (alreadyDismissed) {
      await fs.unlink(file).catch(error=>{if(!absent(error))throw error;});
      return true;
    }
  }

  async function removeOwn(document) {
    const directory=collection(document);
    for (const file of [path.join(directory,owner+'.draft'),ackFile(directory,owner)]) {
      await fs.unlink(file).catch(error=>{if(!absent(error))throw error;});
    }
    await fs.rmdir(directory).catch(error=>{if(!['ENOENT','ENOTEMPTY','EEXIST'].includes(error.code))throw error;});
  }
  return {info,write,read,acknowledge,removeOwn};
}
