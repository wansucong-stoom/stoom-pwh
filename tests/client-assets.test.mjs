import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {registerClientDocument,readClientAsset,saveClientDocument} from '../src/client-assets.mjs';

test('client asset chunks reconstruct registered bytes and reject stale source',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-client-test-'));
 try {
  const file=path.join(dir,'test.hwpx'),bytes=Buffer.concat([Buffer.from('PK'),Buffer.alloc(600000,97)]);
  await fs.writeFile(file,bytes);const doc=await registerClientDocument(file);
  const chunks=[];let offset=0;
  do {const r=await readClientAsset({kind:'document',documentId:doc.documentId,offset,expectedSha256:doc.sourceSha256});chunks.push(Buffer.from(r._meta['pwh/client-bytes'],'base64'));offset=r.structuredContent.nextOffset;}while(offset!==null);
  assert.deepEqual(Buffer.concat(chunks),bytes);
  await fs.appendFile(file,'changed');
  await assert.rejects(readClientAsset({kind:'document',documentId:doc.documentId,offset:0}),/changed/);
  await assert.rejects(saveClientDocument({documentId:doc.documentId,expectedSourceSha256:doc.sourceSha256,documentSha256:createHash('sha256').update(bytes).digest('hex'),revision:1,base64:bytes.toString('base64')}),/Source changed/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('client cannot select an arbitrary path through ordinary arguments',async()=>{
 await assert.rejects(readClientAsset({kind:'document',offset:0,path:'C:/any.hwpx'}),/Host HWPX file context/);
 await assert.rejects(readClientAsset({kind:'document',offset:0,documentId:'unknown'}),/expired/);
});
