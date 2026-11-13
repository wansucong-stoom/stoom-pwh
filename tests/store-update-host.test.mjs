import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createWorkspaceServer} from '../desktop/standalone-pwh/workspace-shell.mjs';

for(const status of ['available','current','unavailable'])test(`Store ${status}: authenticated status and Store action never start an MSI`,async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-store-host-'));let checks=0,opens=0;
  const app=await createWorkspaceServer({distribution:'microsoft-store',dataRoot:dir,nativeBranding:{complete:true},storeUpdateServices:{check:async()=>{checks++;return {channel:'microsoft-store',status,available:status==='available'};},open:async()=>{opens++;return {ok:true};}},updateServices:{check(){throw Error('No GitHub MSI check');},download(){throw Error('No MSI download');},schedule(){throw Error('No MSI install');}}});
  const post=(route,origin=new URL(app.url).origin)=>fetch(app.url+route,{method:'POST',headers:{origin,'x-pwh-request':'1','content-type':'application/json'},body:'{}'});
  try{
    const response=await post('update/status');assert.equal(response.status,200);assert.equal((await response.json()).available,status==='available');assert.equal(checks,1);
    const opened=await post('update/store');assert.equal((await opened.json()).opened,true);assert.equal(opens,1);
    for(const route of ['update/download','update/install'])assert.equal((await post(route)).ok,false);
    assert.equal((await post('update/store','https://example.invalid')).status,403);assert.equal(opens,1);
  }finally{await new Promise(resolve=>app.server.close(resolve));await fs.rm(dir,{recursive:true,force:true});}
});
test('preview packages neither query production updates nor open the production Store',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-store-host-'));const app=await createWorkspaceServer({distribution:'msix-preview',dataRoot:dir,nativeBranding:{complete:true},storeUpdateServices:{check(){throw Error('Must not query');},open(){throw Error('Must not open');}}});
  const post=route=>fetch(app.url+route,{method:'POST',headers:{origin:new URL(app.url).origin,'x-pwh-request':'1'},body:'{}'});
  try{assert.equal((await(await post('update/status')).json()).version,null);assert.equal((await post('update/store')).ok,false);}finally{await new Promise(resolve=>app.server.close(resolve));await fs.rm(dir,{recursive:true,force:true});}
});
