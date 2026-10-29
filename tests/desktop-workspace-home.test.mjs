import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createWorkspaceServer} from '../desktop/standalone-pwh/workspace-shell.mjs';
import {createRecentDocuments} from '../desktop/standalone-pwh/recent-documents.mjs';

test('home opens chosen or recent original documents in independent tabs', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pwh-home-test-'));
  const file = path.join(dir, '원본.hwpx'); await fs.writeFile(file, 'original document');
  const calls = [], children = [], recent = createRecentDocuments(path.join(dir, 'data'));
  await recent.record(file);
  let choice = {cancelled:true};
  const spawnImpl = (_exe,args) => {
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
    child.kill=()=>child.emit('exit',0);child.stdin.on('end',()=>child.emit('exit',0));children.push(child);calls.push(args);
    setImmediate(()=>child.stdout.write(JSON.stringify({url:`http://127.0.0.1:${Number(args[1])}/test-token/`})+'\n'));return child;
  };
  const app=await createWorkspaceServer({spawnImpl,dataRoot:path.join(dir,'data'),chooseFile:async()=>choice});
  const origin=new URL(app.url).origin;
  const post=async(route,body={},requestOrigin=origin)=>{
    const response=await fetch(app.url+route,{method:'POST',headers:{origin:requestOrigin,'x-pwh-request':'1','content-type':'application/json'},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  };
  try {
    assert.deepEqual((await post('tabs/initial')).body,{home:true});
    assert.equal(children.length,0,'home does not create an unused blank document');
    const entries=(await post('recent/list')).body.documents;
    assert.equal(entries.length,1);assert.equal(entries[0].name,'원본.hwpx');assert.equal(entries[0].available,true);
    assert.deepEqual((await post('tabs/open')).body,{cancelled:true});assert.equal(children.length,0);
    choice={cancelled:false,path:file};
    const selected=(await post('tabs/open')).body;assert.ok(selected.id);assert.equal(calls[0][2],file);
    const reopened=(await post('recent/open',{id:entries[0].id})).body;assert.ok(reopened.id);assert.notEqual(reopened.id,selected.id);assert.equal(calls[1][2],file);
    assert.equal((await post('recent/remove',{id:entries[0].id},'http://invalid.example')).status,403);
    assert.equal((await post('recent/remove',{id:entries[0].id})).status,200);
    assert.equal(await fs.readFile(file,'utf8'),'original document');
    assert.deepEqual((await post('recent/list')).body.documents,[]);
    assert.equal((await post('recent/open',{id:'../원본.hwpx'})).status,400);
  } finally {
    app.server.closeAllConnections?.();await new Promise(resolve=>app.server.close(resolve));
    await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});
