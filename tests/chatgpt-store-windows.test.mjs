import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createCredentialStore} from '../desktop/standalone-pwh/chatgpt-store.mjs';

test('Windows encrypts credentials for this user and serializes parallel processes', {skip:process.platform!=='win32',timeout:60000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-dpapi-'));const store=createCredentialStore({root:dir}),other=createCredentialStore({root:dir});
 try{
  await store.transaction(async state=>{state.syntheticSecret='private-synthetic-token';state.counter=0;return {write:true};});
  const bytes=await fs.readFile(path.join(dir,'credentials.dat'));assert.equal(bytes.includes(Buffer.from('private-synthetic-token')),false);
  await Promise.all(Array.from({length:4},(_,i)=>(i%2?other:store).transaction(async state=>{const n=state.counter;await new Promise(resolve=>setTimeout(resolve,30));state.counter=n+1;return {write:true};})));
  const result=await other.transaction(async state=>({value:{counter:state.counter,secret:state.syntheticSecret,hostId:state.hostId}}));assert.equal(result.counter,4);assert.equal(result.secret,'private-synthetic-token');assert.match(result.hostId,/^urn:uuid:/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
