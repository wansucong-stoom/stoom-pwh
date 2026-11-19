import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseInstaller,checkForDesktopUpdate} from '../desktop/standalone-pwh/update-check.mjs';
import {createWorkspaceServer} from '../desktop/standalone-pwh/workspace-shell.mjs';

const repository='https://github.com/wansucong-stoom/stoom-pwh';
function release(tag,version,prerelease=false){
 const name='PwhDesktop-'+version+'-macos-arm64.zip';
 return {tag_name:tag,prerelease,assets:[{
  name,size:100,digest:'sha256:'+'a'.repeat(64),state:'uploaded',
  browser_download_url:repository+'/releases/download/'+tag+'/'+name,
 }]};
}

test('Mac preview discovers only newer matching packages',async()=>{
 const preview=release('macos-preview-0.1.50','0.1.50',true);
 const stable=release('v0.6.68','0.1.49');
 const invalid=release('macos-preview-0.1.52','0.1.53',true);
 const current='0.1.48';
 assert.equal(releaseInstaller(preview,current,{platform:'linux'}),null);
 assert.equal(releaseInstaller(preview,'0.1.50',{platform:'darwin'}),null);
 assert.equal(releaseInstaller(invalid,current,{platform:'darwin'}),null);
 const selected=await checkForDesktopUpdate(current,{
  platform:'darwin',fetchImpl:async()=>Response.json([stable,invalid,preview]),
 });
 assert.equal(selected.version,'0.1.50');
 assert.equal(selected.releaseUrl,repository+'/releases/tag/macos-preview-0.1.50');
});

test('Mac preview links to GitHub and rejects installer requests',async t=>{
 const releaseUrl=repository+'/releases/tag/macos-preview-0.1.50';
 let opened;
 const workspace=await createWorkspaceServer({
  distribution:'macos-preview',
  nativeBranding:{openMacUpdate:async url=>{opened=url;}},
  updateServices:{check:async()=>({version:'0.1.50',releaseUrl})},
 });
 t.after(()=>workspace.server.close());
 const headers={origin:new URL(workspace.url).origin,'x-pwh-request':'1','content-type':'application/json'};
 const post=route=>fetch(workspace.url+route,{method:'POST',headers,body:'{}'});
 assert.equal((await (await post('update/status')).json()).version,'0.1.50');
 assert.equal((await post('update/download')).status,400);
 assert.equal((await post('update/install')).status,400);
 assert.equal((await post('update/macos')).status,200);
 assert.equal(opened,releaseUrl);
});
