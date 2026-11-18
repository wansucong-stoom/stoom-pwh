import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {copyDesktopRuntime} from '../scripts/desktop-runtime-assets.mjs';
import {verifyPackagedImports,verifyDesktopRuntime} from '../scripts/verify-desktop-runtime.mjs';
import {packagePlugin} from '../scripts/package.mjs';
import {zipEntries} from '../scripts/setup.mjs';
import {fileURLToPath} from 'node:url';

async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-runtime-test-'));t.after(async()=>{assert.equal(path.dirname(root),os.tmpdir());await fs.rm(root,{recursive:true,force:true});});return root;}
async function put(root,name,text){const p=path.join(root,name);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,text);return p;}

test('one runtime collector automatically includes a newly imported platform adapter',async t=>{
  const root=await fixture(t),source=path.join(root,'source'),payload=path.join(root,'payload'),target=path.join(payload,'standalone-pwh');
  await put(source,'host.mjs',"import './chatgpt-store.mjs';\n");
  await put(source,'chatgpt-store.mjs',"import './linux-credentials.mjs';\n");
  await put(source,'linux-credentials.mjs','export const adapter=true;\n');
  await put(source,'client/editor.js','/* fixture */');await put(source,'client/manifest.json','{}');
  await put(source,'build-unrelated.mjs','throw Error("build only");');await put(source,'version.json','{}');
  const copied=await copyDesktopRuntime(source,target);
  assert.ok(copied.includes('linux-credentials.mjs'));assert.ok(!copied.includes('version.json'));assert.ok(!copied.includes('build-unrelated.mjs'));
  assert.equal(await fs.readFile(path.join(target,'linux-credentials.mjs'),'utf8'),'export const adapter=true;\n');
  assert.equal((await verifyPackagedImports(payload,{node:process.execPath})).imports,true);
  await fs.unlink(path.join(target,'linux-credentials.mjs'));
  await assert.rejects(verifyPackagedImports(payload,{node:process.execPath}),/linux-credentials\.mjs/);
});

test('runtime assembly refuses to overwrite a destination file',async t=>{
  const root=await fixture(t),source=path.join(root,'source'),target=path.join(root,'payload');
  await put(source,'host.mjs','source');await put(target,'host.mjs','keep existing');
  await assert.rejects(copyDesktopRuntime(source,target),{code:'EEXIST'});
  assert.equal(await fs.readFile(path.join(target,'host.mjs'),'utf8'),'keep existing');
});

test('assembled Desktop runtime starts new and existing HWPX tabs with the real preserved core',{skip:!process.env.PWH_RUNTIME_ROOT,timeout:120000},async t=>{
 const root=await fixture(t),source=fileURLToPath(new URL('../',import.meta.url)),payload=path.join(root,'payload');
 await copyDesktopRuntime(path.join(source,'desktop/standalone-pwh'),path.join(payload,'standalone-pwh'));
 await put(payload,'standalone-pwh/version.json',await fs.readFile(path.join(source,'desktop/standalone-pwh/version.json')));
 const archive=path.join(root,'plugin.zip');await packagePlugin({output:archive});
 for(const entry of zipEntries(await fs.readFile(archive))){const parts=entry.name.split('/');assert.equal(parts.shift(),'pwh');const relative=parts.join('/');if(!relative||entry.name.endsWith('/'))continue;assert.ok(!parts.includes('..'));await put(payload,path.join('release-source',relative),entry.read());}
 for(const name of ['hwp-codex-host.mjs','codex-image-host.mjs'])await put(payload,'bridge/'+name,await fs.readFile(path.join(source,'desktop/bridge',name)));
 await fs.mkdir(path.join(payload,'engine'),{recursive:true});await fs.cp(path.join(process.env.PWH_RUNTIME_ROOT,'core'),path.join(payload,'engine/core'),{recursive:true});
 const executable=await put(payload,path.join('node',process.platform==='win32'?'node.exe':'node'),await fs.readFile(process.execPath));if(process.platform!=='win32')await fs.chmod(executable,0o755);
 const result=await verifyDesktopRuntime(payload);assert.equal(result.imports,true);assert.equal(result.newDocument,true);assert.equal(result.existingHwpx,true);assert.equal(result.originalPreserved,true);
});
