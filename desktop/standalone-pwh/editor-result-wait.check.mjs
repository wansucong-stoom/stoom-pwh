import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForEditorResult} from './editor-result-wait.mjs';

test('waits for the original ticket to finish without enqueueing another edit',async()=>{
 let ticket={status:'pending'},reads=0;
 setTimeout(()=>{ticket={status:'applied',result:{ok:true}};},30);
 const result=await waitForEditorResult(()=>{reads++;return ticket;},{timeoutMs:500,intervalMs:5});
 assert.equal(result.status,'applied');assert.ok(reads>1);
});
test('returns rejected and bounded pending results without claiming success',async()=>{
 assert.equal((await waitForEditorResult(()=>({status:'rejected'}))).status,'rejected');
 const started=Date.now(),result=await waitForEditorResult(()=>({status:'pending'}),{timeoutMs:30,intervalMs:5});
 assert.equal(result.status,'pending');assert.ok(Date.now()-started>=25);
});
test('stops waiting when the caller disconnects',async()=>{
 const controller=new AbortController();setTimeout(()=>controller.abort(),20);
 assert.equal((await waitForEditorResult(()=>({status:'pending'}),{timeoutMs:500,signal:controller.signal})).status,'pending');
});
