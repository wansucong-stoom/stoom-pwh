import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readVerifiedFont,createVerifiedFontReader} from '../src/font-transfer.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=Buffer.alloc(5*512*1024+17,73),pin={totalBytes:bytes.length,sha256:sha(bytes),faceIndex:2};
const reply=offset=>({structuredContent:{...pin,offset},_meta:{'pwh/font-bytes':bytes.subarray(offset,offset+512*1024).toString('base64')}});
test('parallel font transfer is bounded and reconstructs out-of-order chunks exactly',async()=>{
 let active=0,max=0;const requests=[];
 const request=async offset=>{requests.push(offset);active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,offset===512*1024?20:0));active--;return reply(offset);};
 const got=await readVerifiedFont(request,new AbortController().signal,sha);
 assert.deepEqual(Buffer.from(got.bytes),bytes);assert.equal(got.faceIndex,2);assert.equal(max,4);
 assert.deepEqual(requests.toSorted((a,b)=>a-b),Array.from({length:6},(_,i)=>i*512*1024));
});
test('changed identity, wrong offsets, truncated chunks and invalid final hash never publish a font',async()=>{
 for(const change of [r=>r.structuredContent.sha256='a'.repeat(64),r=>r.structuredContent.faceIndex=1,r=>r.structuredContent.offset++,r=>r._meta['pwh/font-bytes']='AA==']){
  await assert.rejects(readVerifiedFont(async offset=>{const r=reply(offset);if(offset)change(r);return r;},new AbortController().signal,sha),/글꼴/);
 }
 await assert.rejects(readVerifiedFont(async offset=>reply(offset),new AbortController().signal,()=> 'b'.repeat(64)),/SHA/);
});
test('aborted transfer makes no new requests',async()=>{
 const c=new AbortController();c.abort();let calls=0;
 await assert.rejects(readVerifiedFont(async()=>{calls++;return reply(0);},c.signal,sha),/취소/);assert.equal(calls,0);
});

test('another TTC face reuses verified file bytes after a fresh identity check and owns its buffer',async()=>{
 const read=createVerifiedFontReader();let calls=0;
 const request=async offset=>{calls++;return reply(offset);};
 const first=await read(request,new AbortController().signal,sha);
 new Uint8Array(first.bytes).fill(0);calls=0;
 const second=await read(async offset=>{const r=await request(offset);r.structuredContent.faceIndex=3;return r;},new AbortController().signal,sha);
 assert.equal(calls,1);assert.equal(second.faceIndex,3);assert.deepEqual(Buffer.from(second.bytes),bytes);
});
