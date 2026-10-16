import test from 'node:test';import assert from 'node:assert/strict';import {promises as fs} from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {registerClientDocument,selectClientSaveDestination,beginClientSave,uploadClientChunk,commitClientSave,abortClientSave,readClientAsset,CHUNK,MAX_DOCUMENT} from '../src/client-assets.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture(){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-chunks-')),source=path.join(dir,'source.hwpx');await fs.writeFile(source,'PKsource');const doc=await registerClientDocument(source);return {dir,source,doc};}
async function start(f,bytes,name='saved.hwpx'){
 const choice=await selectClientSaveDestination({documentId:f.doc.documentId,expectedSourceSha256:f.doc.sourceSha256},{},async()=>({path:path.join(f.dir,name)}));
 return beginClientSave({documentId:f.doc.documentId,saveTicket:choice.saveTicket,expectedSourceSha256:f.doc.sourceSha256,documentSha256:hash(bytes),totalBytes:bytes.length});
}
async function upload(t,bytes){for(let offset=0;offset<bytes.length;offset+=CHUNK)await uploadClientChunk({transferId:t.transferId,offset,base64:bytes.subarray(offset,offset+CHUNK).toString('base64')});}
test('9 MiB chunk save supports retry, exact reconstruction and bounded reads',async()=>{
 const f=await fixture(),bytes=Buffer.concat([Buffer.from('PK'),Buffer.alloc(9*1024*1024,65)]);
 try{
  const t=await start(f,bytes);const first={transferId:t.transferId,offset:0,base64:bytes.subarray(0,CHUNK).toString('base64')};
  await uploadClientChunk(first);assert.equal((await uploadClientChunk(first)).nextOffset,CHUNK);
  await assert.rejects(uploadClientChunk({...first,base64:Buffer.alloc(CHUNK,66).toString('base64')}),/offset/);
  await assert.rejects(commitClientSave({transferId:t.transferId}),/incomplete/);
  for(let offset=CHUNK;offset<bytes.length;offset+=CHUNK)await uploadClientChunk({transferId:t.transferId,offset,base64:bytes.subarray(offset,offset+CHUNK).toString('base64')});
  let inspected=false;const result=await commitClientSave({transferId:t.transferId},async filename=>{assert.deepEqual(await fs.readFile(filename),bytes);inspected=true;return {format:'hwpx'};});
  assert.ok(inspected);assert.deepEqual(await fs.readFile(result.path),bytes);assert.equal(result.documentSha256,hash(bytes));
  const part=await readClientAsset({kind:'document',documentId:result.documentId,offset:8*1024*1024,expectedSha256:hash(bytes)});assert.equal(part.structuredContent.totalBytes,bytes.length);assert.ok(Buffer.from(part._meta['pwh/client-bytes'],'base64').length<=CHUNK);
  assert.deepEqual((await fs.readdir(f.dir)).sort(),['saved.hwpx','source.hwpx']);
 }finally{await fs.rm(f.dir,{recursive:true,force:true});}
});
test('stale source, digest mismatch, occupied destination and abort publish no partial document',async()=>{
 const f=await fixture(),bytes=Buffer.from('PKdocument');
 try{
  let t=await start(f,bytes);await upload(t,Buffer.from('PKtampered'));
  await assert.rejects(commitClientSave({transferId:t.transferId}),/digest/);await assert.rejects(fs.stat(path.join(f.dir,'saved.hwpx')));
  t=await start(f,bytes);await upload(t,bytes);await fs.appendFile(f.source,'modified');await assert.rejects(commitClientSave({transferId:t.transferId}),/Source changed/);
  await fs.writeFile(f.source,'PKsource');t=await start(f,bytes);await upload(t,bytes);await fs.writeFile(path.join(f.dir,'saved.hwpx'),'keep');await assert.rejects(commitClientSave({transferId:t.transferId},async()=>({format:'hwpx'})));assert.equal(await fs.readFile(path.join(f.dir,'saved.hwpx'),'utf8'),'keep');
  t=await start(f,bytes,'aborted.hwpx');await uploadClientChunk({transferId:t.transferId,offset:0,base64:bytes.toString('base64')});assert.equal((await abortClientSave({transferId:t.transferId})).aborted,true);await assert.rejects(commitClientSave({transferId:t.transferId}),/expired/);
  assert.equal((await fs.readdir(f.dir)).some(n=>n.startsWith('.pwh-upload-')),false);
  assert.equal(MAX_DOCUMENT,64*1024*1024);
 }finally{await fs.rm(f.dir,{recursive:true,force:true});}
});
