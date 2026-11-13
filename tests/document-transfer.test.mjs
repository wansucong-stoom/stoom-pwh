import test from 'node:test';import assert from 'node:assert/strict';
import {documentChunkBytes,MAX_DOCUMENT_CHUNK,DEFAULT_DOCUMENT_CHUNK,DOCUMENT_RPC_BYTES} from '../src/document-transfer.mjs';
test('document chunks grow with file size within the receiver limit',()=>{
  assert.equal(documentChunkBytes(100),65536);assert.equal(documentChunkBytes(100000),131072);
  assert.equal(documentChunkBytes(4*1024*1024,MAX_DOCUMENT_CHUNK),512*1024);
  assert.equal(documentChunkBytes(30*1024*1024,MAX_DOCUMENT_CHUNK),1024*1024);
  assert.equal(documentChunkBytes(100*1024*1024,MAX_DOCUMENT_CHUNK),MAX_DOCUMENT_CHUNK);
  assert.equal(documentChunkBytes(100*1024*1024),DEFAULT_DOCUMENT_CHUNK,'Generic hosts retain their transport ceiling');
  assert.ok(Math.ceil(MAX_DOCUMENT_CHUNK*4/3)+10000<DOCUMENT_RPC_BYTES);
});
test('invalid negotiation cannot create an unbounded request or a zero-progress transfer',()=>{
  for(const size of [0,-1,Infinity,NaN,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>documentChunkBytes(size));
  for(const cap of [0,65535,MAX_DOCUMENT_CHUNK+1,Infinity,NaN])assert.throws(()=>documentChunkBytes(100,cap));
});
