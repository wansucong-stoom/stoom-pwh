import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createWorkspaceServer} from './workspace-shell.mjs';

test('allocates independent stable tab origins, skips occupied ports and cleans up children',async()=>{
 const children=[];
 const spawnImpl=(_exe,args)=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>child.emit('exit',0);child.stdin.on('end',()=>child.emit('exit',0));children.push(child);const port=Number(args[1]);setImmediate(()=>child.stdout.write(JSON.stringify(port===48674?{errorCode:'EADDRINUSE'}:{url:`http://127.0.0.1:${port}/test-token/`})+'\n'));return child;};
 const app=await createWorkspaceServer({spawnImpl,initialPath:'fixture.hwpx'});try{
  const origin=new URL(app.url).origin,post=async(route,body={})=>{const response=await fetch(app.url+route,{method:'POST',headers:{origin,'x-pwh-request':'1','content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
  const first=await post('tabs/initial'),second=await post('tabs/new');assert.equal(new URL(first.url).port,'48675');assert.equal(new URL(second.url).port,'48676');assert.notEqual(first.id,second.id);
  await post('tabs/close',{id:first.id});assert.equal(children[1].stdin.writableEnded,true);
  const denied=await fetch(app.url+'tabs/new',{method:'POST',headers:{origin:'http://example.invalid','x-pwh-request':'1'},body:'{}'});assert.equal(denied.status,403);
 }finally{app.server.close();}
});
