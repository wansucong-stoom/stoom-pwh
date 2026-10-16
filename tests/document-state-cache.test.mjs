import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocumentStateDigestCache} from '../src/document-state-cache.mjs';
const revision={documentEpoch:1,changeSeq:0,format:'hwpx',pageCount:13,dirty:false};
const digest='a'.repeat(64),changed='b'.repeat(64);

test('unchanged presentation reads export once, while every revision component invalidates reuse',()=>{
 const cache=createDocumentStateDigestCache();let exports=0;const compute=()=>{exports++;return digest;};
 for(let i=0;i<100;i++)assert.equal(cache.read(revision,compute),digest);
 assert.equal(exports,1);
 for(const update of [{documentEpoch:2},{changeSeq:1},{format:'hwp'},{pageCount:14},{dirty:true}]){
  const current={...revision,...update};assert.equal(cache.read(current,compute),digest);assert.equal(cache.read(current,compute),digest);
 }
 assert.equal(exports,6);
});

test('authoritative fresh reads detect an unsignaled mutation even when revision fields are unchanged',()=>{
 const cache=createDocumentStateDigestCache();let source=digest,exports=0;const compute=()=>{exports++;return source;};
 assert.equal(cache.read(revision,compute),digest);source=changed;
 assert.equal(cache.read(revision,compute),digest); // Presentation metadata alone is not an integrity guard.
 assert.equal(cache.read(revision,compute,{fresh:true}),changed);assert.equal(exports,2);
 assert.equal(cache.read(revision,compute),changed);
 cache.invalidate();assert.equal(cache.read(revision,compute),changed);assert.equal(exports,3);
});

test('failed fresh verification and invalid output cannot publish or retain stale cache entries',()=>{
 const cache=createDocumentStateDigestCache();cache.read(revision,()=>digest);
 assert.throws(()=>cache.read(revision,()=>{throw Error('export failed');},{fresh:true}),/export failed/);
 let exports=0;assert.equal(cache.read(revision,()=>{exports++;return changed;}),changed);assert.equal(exports,1);
 for(const output of ['invalid','A'.repeat(64),null,Promise.resolve(digest)])assert.throws(()=>cache.read(revision,()=>output,{fresh:true}),/export digest/);
 assert.equal(cache.read(revision,()=>digest),digest);
});

test('invalid keys never compute and reentrant invalidation never publishes an obsolete result',()=>{
 const cache=createDocumentStateDigestCache();let exports=0;
 for(const update of [{documentEpoch:-1},{changeSeq:0.1},{format:'pdf'},{pageCount:NaN},{dirty:0}])assert.throws(()=>cache.read({...revision,...update},()=>{exports++;return digest;}),/revision/);
 assert.equal(exports,0);
 cache.read(revision,()=>{cache.invalidate();return digest;});
 assert.equal(cache.read(revision,()=>{exports++;return changed;}),changed);assert.equal(exports,1);
 const newer={...revision,changeSeq:1};
 cache.read(revision,()=>{cache.read(newer,()=>changed);return digest;},{fresh:true});
 assert.equal(cache.read(newer,()=>{throw Error('newer entry should remain');}),changed);
});
