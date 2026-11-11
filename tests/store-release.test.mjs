import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {storeReleaseAsset,verifyStoreDownload,verifyStoreFiles} from '../scripts/store-release.mjs';
import {msixIdentity,msixManifest} from '../scripts/msix-package.mjs';

const versions = {pwhVersion:'1.2.3',desktopVersion:'1.2.4'};
const bytes = Buffer.from('released bytes');
const asset = {name:'PwhDesktop-1.2.4-store-x64.msix',state:'uploaded',size:bytes.length,
  digest:'sha256:'+createHash('sha256').update(bytes).digest('hex'),
  browser_download_url:'https://github.com/wansucong-stoom/stoom-pwh/releases/download/v1.2.3/PwhDesktop-1.2.4-store-x64.msix'};
const release = {draft:false,prerelease:false,tag_name:'v1.2.3',assets:[asset]};
test('only the matching completed stable Store asset can be submitted', () => {
  assert.equal(storeReleaseAsset(release,versions),asset);
  for (const override of [{draft:true},{prerelease:true},{tag_name:'v1.2.2'},{assets:[]},{assets:[asset,asset]}]) assert.throws(()=>storeReleaseAsset({...release,...override},versions));
  for (const override of [{state:'new'},{digest:null},{size:0},{size:2**31},{browser_download_url:'https://example.com/package.msix'},
    {browser_download_url:asset.browser_download_url+'?download=1'},
    {browser_download_url:asset.browser_download_url.replace('v1.2.3','v1.2.2')}]) {
    assert.throws(()=>storeReleaseAsset({...release,assets:[{...asset,...override}]},versions));
  }
});
test('downloaded bytes must match both the GitHub length and SHA-256', () => {
  verifyStoreDownload(bytes,asset);
  assert.throws(()=>verifyStoreDownload(Buffer.from('altered bytes!'),asset),/digest/);
  assert.throws(()=>verifyStoreDownload(bytes,{...asset,size:bytes.length+1}),/digest/);
});

test('Store verification rejects preview identity and a different capability before reading payload files', async () => {
  const identity={name:'Tests.PwhDesktop',publisher:'CN=unit-test',publisherDisplayName:'Tests'};
  const expected=msixManifest(msixIdentity({channel:'store',version:'1.2.4',identity}));
  for (const manifest of [expected.replace('Tests.PwhDesktop','STOOM.PwhDesktop.Preview'),expected.replace('runFullTrust','broadFileSystemAccess'),expected.replace('1.2.4.0','1.2.3.0')]) {
    await assert.rejects(verifyStoreFiles(async name=>{assert.equal(name,'AppxManifest.xml');return Buffer.from(manifest);},
      {identity,desktopVersion:'1.2.4'}),/identity, version/);
  }
});

test('Store verification catches stale host, common editor, core, and wrong update channel', async t => {
  const sourceRoot=fileURLToPath(new URL('../',import.meta.url)),runtimeRoot=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-store-test-'));
  t.after(async()=>{assert.equal(path.dirname(runtimeRoot),os.tmpdir());await fs.rm(runtimeRoot,{recursive:true,force:true});});
  await fs.mkdir(path.join(runtimeRoot,'core'));await fs.writeFile(path.join(runtimeRoot,'core/rhwp.js'),'core JS');await fs.writeFile(path.join(runtimeRoot,'core/rhwp_bg.wasm'),'core WASM');
  const identity={name:'Tests.PwhDesktop',publisher:'CN=unit-test',publisherDisplayName:'Tests'},desktopVersion='1.2.4';
  const manifest=Buffer.from(msixManifest(msixIdentity({channel:'store',version:desktopVersion,identity})));
  const options={sourceRoot,runtimeRoot,identity,desktopVersion};
  for (const [member,match] of [['standalone-pwh/host.mjs',/package\/source mismatch/],['release-source/client/editor.js',/package\/source mismatch/],['engine/core/rhwp_bg.wasm',/package\/source mismatch/],['standalone-pwh/distribution.json',/distribution differs/]]) {
    const read=async name=>{
      if(name==='AppxManifest.xml')return manifest;
      if(name==='standalone-pwh/distribution.json')return Buffer.from(JSON.stringify({schema:1,channel:name===member?'msix-preview':'microsoft-store',name:identity.name}));
      if(name===member)return Buffer.from('stale bytes');
      if(name.startsWith('standalone-pwh/'))return fs.readFile(path.join(sourceRoot,'desktop',name));
      if(name.startsWith('release-source/'))return fs.readFile(path.join(sourceRoot,name.slice('release-source/'.length)));
      if(name.startsWith('engine/'))return fs.readFile(path.join(runtimeRoot,name.slice('engine/'.length)));
      throw Error('Unexpected read: '+name);
    };
    await assert.rejects(verifyStoreFiles(read,options),match);
  }
});
