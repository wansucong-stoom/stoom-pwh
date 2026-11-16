import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
const source=await fs.readFile(new URL('../desktop/standalone-pwh/app.js',import.meta.url),'utf8');
const start=source.indexOf(' function reportWorkspace('),end=source.indexOf('\n let workspaceCommandQueue',start);assert.ok(start>=0&&end>start);
test('workspace status polling never exports the document and stays fresh during motion',()=>{
 let exports=0,reads=0,state={documentEpoch:1,changeSeq:0,dirty:false};const messages=[],parent={postMessage:m=>messages.push(m)},window={parent};
 const report=vm.runInNewContext('('+source.slice(start,end).trim()+')',{window,workspaceOrigin:'http://localhost',frame:{contentWindow:{pwhEditor:{context(){exports++;throw Error('Expensive full context must not run');},status(){reads++;return{ready:true,documentState:state};}},pwhRecoveryReady:()=>true}},documentInfo:{name:'TEST.hwpx'},busy:false,saving:false});
 report('initial');assert.equal(messages[0].dirty,false);assert.equal(messages[0].ready,true);
 for(let i=1;i<=100;i++){state={...state,changeSeq:i,dirty:true};report();assert.equal(messages.at(-1).documentState.changeSeq,i);}
 assert.equal(exports,0);assert.equal(reads,101);assert.equal(messages.at(-1).dirty,true);assert.equal('documentSha256' in messages.at(-1).documentState,false);
 state={...state,dirty:false};report('saved');assert.equal(messages.at(-1).dirty,false);assert.equal(messages.at(-1).requestId,'saved');
});
test('an unavailable lightweight state reports not ready and conservatively dirty',()=>{
 const messages=[],parent={postMessage:m=>messages.push(m)},window={parent};
 const report=vm.runInNewContext('('+source.slice(start,end).trim()+')',{window,workspaceOrigin:'http://localhost',frame:{contentWindow:{}},documentInfo:null,busy:false,saving:false});report();assert.equal(messages[0].ready,false);assert.equal(messages[0].dirty,true);assert.equal(messages[0].documentState,null);
});
