import test from 'node:test';import assert from 'node:assert/strict';
import {base64ToBytes,base64ToBytesFallback,bytesToBase64,bytesToBase64Fallback} from '../src/base64-bytes.mjs';
test('native and compatibility byte conversion preserve binary data, offset views and canonical padding',()=>{
  for(const length of [0,1,2,3,255,256,8191,8192,8193,2*1024*1024]){
    const all=Uint8Array.from({length:length+6},(_,i)=>(i*73+191)%256),view=all.subarray(3,3+length),original=all.slice(),expected=Buffer.from(view).toString('base64');
    assert.equal(bytesToBase64(view),expected);assert.equal(bytesToBase64Fallback(view),expected);
    assert.deepEqual(base64ToBytes(expected),view);assert.deepEqual(base64ToBytesFallback(expected),view);assert.deepEqual(all,original);
  }
});
test('malformed base64 fails rather than silently returning an empty document',()=>{
  for(const value of ['!','a','====','ab=c']){assert.throws(()=>base64ToBytes(value));assert.throws(()=>base64ToBytesFallback(value));}
});
