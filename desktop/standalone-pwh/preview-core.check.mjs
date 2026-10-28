import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {stagePreviewCore,verifyPreviewCore} from './preview-core.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-preview-core-')),candidateDir=path.join(root,'candidate'),runtimeRoot=path.join(root,'runtime'),pluginRoot=path.join(root,'plugin'),patchRoot=path.join(pluginRoot,'docs','engine-patches'),core=path.join(runtimeRoot,'core');
 await Promise.all([candidateDir,core,patchRoot].map(dir=>fs.mkdir(dir,{recursive:true})));
 const lock={id:'rhwp-0.8.7-pwh-r3',upstreamCommit:'a'.repeat(40),runtime:{sha256:'b'.repeat(64)},preservationAssets:[{file:'pwh-upstream-rhwp-0.8.7-pinned.zip',sha256:'c'.repeat(64)}]};
 const original={'rhwp.js':'same glue','rhwp.d.ts':'types','rhwp_bg.wasm':'base wasm','rhwp_bg.wasm.d.ts':'wasm types'},files={};
 for(const [name,text]of Object.entries(original)){await fs.writeFile(path.join(core,name),text);const bytes=Buffer.from(name==='rhwp_bg.wasm'?'candidate wasm':text);await fs.writeFile(path.join(candidateDir,name),bytes);files[name]={size:bytes.length,sha256:sha(bytes)};}
 const patch='verified source change';await fs.writeFile(path.join(patchRoot,'ownership.patch'),patch);
 const record={schemaVersion:1,id:'test-candidate',upstreamCommit:lock.upstreamCommit,sourceArchiveSha256:lock.preservationAssets[0].sha256,target:'wasm32-unknown-unknown',features:'upstream defaults',buildArgs:['build','--release'],lockAudit:{addedPackages:0,changedRetainedPackages:0},patches:[{file:'ownership.patch',sha256:sha(patch),sources:[{path:'src/layout.rs',originalSha256:'d'.repeat(64),patchedSha256:'e'.repeat(64)}]}],files,unchangedGlueSha256:sha(original['rhwp.js'])};
 await fs.writeFile(path.join(candidateDir,'BUILD-RECORD.json'),JSON.stringify(record));await fs.writeFile(path.join(core,'.pwh-install.json'),JSON.stringify({kind:'core',sourceCommit:lock.upstreamCommit,files:Object.fromEntries(Object.entries(original).map(([name,text])=>[name,sha(text)]))}));await fs.writeFile(path.join(runtimeRoot,'.preserved-runtime.json'),JSON.stringify({id:lock.id,archiveSha256:lock.runtime.sha256}));
 return {root,candidateDir,runtimeRoot,pluginRoot,lock,record};
}

test('preview core verifies source patches and records a distinct candidate identity',async()=>{
 const f=await fixture();await stagePreviewCore(f);const marker=JSON.parse(await fs.readFile(path.join(f.runtimeRoot,'core','.pwh-install.json'))),receipt=JSON.parse(await fs.readFile(path.join(f.runtimeRoot,'.preserved-runtime.json')));assert.equal(marker.runtimeVariant,'local-candidate');assert.equal(marker.files['rhwp_bg.wasm'],f.record.files['rhwp_bg.wasm'].sha256);assert.equal(receipt.variant,'local-candidate');assert.notEqual(receipt.id,f.lock.id);assert.equal(receipt.basePreservedRuntime.id,f.lock.id);assert.equal(receipt.archiveSha256,undefined);
});
test('changed candidate bytes are rejected before the preserved core is written',async()=>{
 const f=await fixture();await fs.writeFile(path.join(f.candidateDir,'rhwp_bg.wasm'),'changed');await assert.rejects(stagePreviewCore(f),/체크섬/);assert.equal(await fs.readFile(path.join(f.runtimeRoot,'core','rhwp_bg.wasm'),'utf8'),'base wasm');
});
test('omitted or stale source patches cannot be packaged as the current candidate',async()=>{
 const f=await fixture();f.record.patches=[];await fs.writeFile(path.join(f.candidateDir,'BUILD-RECORD.json'),JSON.stringify(f.record));await assert.rejects(verifyPreviewCore(f),/패치 목록/);assert.equal(await fs.readFile(path.join(f.runtimeRoot,'core','rhwp_bg.wasm'),'utf8'),'base wasm');
});
