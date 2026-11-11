import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {msixIdentity,msixManifest} from '../scripts/msix-package.mjs';
import {desktopDistribution} from '../desktop/standalone-pwh/desktop-distribution.mjs';
import {createWorkspaceServer} from '../desktop/standalone-pwh/workspace-shell.mjs';

const store = {name:'Example.PwhDesktop',publisher:'CN=12345678-1234-1234-1234-123456789abc',publisherDisplayName:'Example & Partners'};
test('preview MSIX has its own unsigned identity and Store requires an explicit identity', () => {
  const value=msixIdentity({channel:'preview',version:'0.1.32'});
  assert.equal(value.name,'STOOM.PwhDesktop.Preview');assert.equal(value.version,'0.1.32.0');
  assert.match(value.publisher,/OID\.2\.25\./);
  assert.throws(()=>msixIdentity({channel:'preview',version:'0.1.32',identity:store}),/isolated/);
  assert.throws(()=>msixIdentity({channel:'store',version:'0.1.32'}),/Partner Center/);
  assert.throws(()=>msixIdentity({channel:'store',version:'0.1.32',identity:value}),/Partner Center/);
});
test('MSIX rejects malformed version, channel and Store identity before packaging', () => {
  for(const version of ['0.1.32.0','65536.1.1','1.-2.3','1.2'])assert.throws(()=>msixIdentity({channel:'preview',version}),/version/);
  assert.throws(()=>msixIdentity({channel:'other',version:'1.2.3'}),/channel/);
  for(const identity of [{...store,name:'../invalid'},{...store,publisher:'CN=PLACEHOLDER'},{...store,publisher:'CN=x\ninvalid'},{...store,publisherDisplayName:''}])assert.throws(()=>msixIdentity({channel:'store',version:'1.2.3',identity}),/Partner Center/);
});
test('Store manifest escapes metadata, carries both document types and uses the native launcher', () => {
  const manifest=msixManifest(msixIdentity({channel:'store',version:'0.1.32',identity:store}));
  assert.match(manifest,/Example &amp; Partners/);assert.match(manifest,/Executable="PwhDesktop.exe"/);
  assert.match(manifest,/Windows.FullTrustApplication/);assert.match(manifest,/Parameters="&quot;%1&quot;"/);
  assert.match(manifest,/<uap:FileType>\.hwp<\/uap:FileType>/);assert.match(manifest,/<uap:FileType>\.hwpx<\/uap:FileType>/);
  assert.doesNotMatch(manifest,/OID\.2\.25|broadFileSystemAccess|unvirtualizedResources/);
});
test('distribution metadata defaults to MSI and fails closed on corrupt or unknown channels', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-msix-config-'));
  t.after(async()=>{assert.equal(path.dirname(dir),os.tmpdir());await fs.rm(dir,{recursive:true,force:true});});
  assert.equal((await desktopDistribution(dir)).channel,'msi');
  for(const channel of ['msix-preview','microsoft-store']){
    await fs.writeFile(path.join(dir,'distribution.json'),JSON.stringify({schema:1,channel}));
    assert.equal((await desktopDistribution(dir)).channel,channel);
  }
  await fs.writeFile(path.join(dir,'distribution.json'),JSON.stringify({schema:1,channel:'unknown'}));
  await assert.rejects(desktopDistribution(dir),/배포 채널/);
  await fs.writeFile(path.join(dir,'distribution.json'),'{');await assert.rejects(desktopDistribution(dir),SyntaxError);
});
test('MSIX channels never query, download or install MSI updates and preserve old update records', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-msix-updates-'));
  t.after(async()=>{assert.equal(path.dirname(dir),os.tmpdir());await fs.rm(dir,{recursive:true,force:true});});
  await fs.mkdir(path.join(dir,'updates'));const record=path.join(dir,'updates/last-result.json');await fs.writeFile(record,'{"status":"old"}');
  const previous=process.env.PWH_DESKTOP_DISTRIBUTION;
  t.after(()=>{if(previous===undefined)delete process.env.PWH_DESKTOP_DISTRIBUTION;else process.env.PWH_DESKTOP_DISTRIBUTION=previous;});
  for(const channel of ['msix-preview','microsoft-store']){
    process.env.PWH_DESKTOP_DISTRIBUTION=channel;let calls=0;
    const unwanted=async()=>{calls++;throw Error('MSI updater must not run');};
    const app=await createWorkspaceServer({dataRoot:dir,nativeBranding:{complete:true},updateServices:{check:unwanted,download:unwanted,schedule:unwanted}});
    try{
      for(const [route,status] of [['update/status',200],['update/result',200],['update/download',400],['update/install',400]]){
        const response=await fetch(new URL(route,app.url),{method:'POST',headers:{origin:new URL(app.url).origin,'x-pwh-request':'1'}});
        assert.equal(response.status,status);const data=await response.json();
        if(route==='update/status')assert.equal(data.version,null);
      }
      assert.equal(calls,0);assert.equal(await fs.readFile(record,'utf8'),'{"status":"old"}');
    }finally{await new Promise(resolve=>app.server.close(resolve));}
  }
});
