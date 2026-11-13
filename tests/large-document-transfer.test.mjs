import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {createHash} from 'node:crypto';import os from 'node:os';import path from 'node:path';
import {registerClientDocument,readClientAsset,selectClientSaveDestination,beginClientSave,uploadClientChunk,commitClientSave} from '../src/client-assets.mjs';
import {MAX_DOCUMENT_CHUNK} from '../src/document-transfer.mjs';

test('a 65 MiB document opens, transfers in negotiated chunks and saves without a file-size cap',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-large-document-')),source=path.join(dir,'large.hwpx'),size=65*1024*1024,block=Buffer.alloc(MAX_DOCUMENT_CHUNK,65),digest=createHash('sha256');
  try{
    const file=await fs.open(source,'wx');try{for(let offset=0;offset<size;){const part=Buffer.from(block.subarray(0,Math.min(block.length,size-offset)));if(offset===0)part.write('PK');digest.update(part);await file.write(part);offset+=part.length;}}finally{await file.close();}
    const expected=digest.digest('hex'),doc=await registerClientDocument(source);assert.equal(doc.sourceSha256,expected);
    const choice=await selectClientSaveDestination({documentId:doc.documentId,expectedSourceSha256:expected},{},async()=>({path:path.join(dir,'saved.hwpx')}));
    const transfer=await beginClientSave({documentId:doc.documentId,saveTicket:choice.saveTicket,expectedSourceSha256:expected,documentSha256:expected,totalBytes:size,maxChunkBytes:MAX_DOCUMENT_CHUNK});assert.equal(transfer.chunkBytes,MAX_DOCUMENT_CHUNK);
    let offset=0,requests=0;const received=createHash('sha256');
    while(offset<size){const chunk=await readClientAsset({kind:'document',documentId:doc.documentId,offset,expectedSha256:expected,maxChunkBytes:MAX_DOCUMENT_CHUNK}),part=Buffer.from(chunk._meta['pwh/client-bytes'],'base64');assert.ok(part.length<=MAX_DOCUMENT_CHUNK);assert.equal(chunk.structuredContent.chunkBytes,MAX_DOCUMENT_CHUNK);received.update(part);const sent=await uploadClientChunk({transferId:transfer.transferId,offset,base64:part.toString('base64')});offset=sent.nextOffset;requests++;}
    assert.equal(received.digest('hex'),expected);assert.equal(requests,33);
    const saved=await commitClientSave({transferId:transfer.transferId},async()=>({format:'hwpx'}));assert.equal(saved.documentSha256,expected);assert.equal((await fs.stat(saved.path)).size,size);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
