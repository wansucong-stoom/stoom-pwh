#!/usr/bin/env node
// Build the Windows installer from this repository's public Desktop sources.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {packagePlugin} from './package.mjs';
import {zipEntries} from './setup.mjs';
import {assertEditorBuildInputs,assertPortableEditorBundle} from './editor-build-contract.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){const key=args[i];if(!['--output','--runtime-archive','--wix-dir','--codex-runtime','--electron-archive','--version','--format','--sdk-dir','--channel','--identity'].includes(key)||options[key]||!args[i+1])throw Error('Use --output, --runtime-archive, --codex-runtime, --electron-archive; MSI: --wix-dir; MSIX: --format msix --sdk-dir --channel preview|store [--identity JSON]');options[key]=args[i+1];}
const format=options['--format']||'msi';if(!['msi','msix'].includes(format))throw Error('Use msi or msix');
if(process.platform!=='win32'||process.arch!=='x64')throw Error('Windows x64 is required to build the MSI');
for(const key of ['--output','--runtime-archive','--codex-runtime','--electron-archive',format==='msi'?'--wix-dir':'--sdk-dir'])if(!options[key]||!path.isAbsolute(options[key]))throw Error(key+' requires an absolute path');
if(!options['--output'].toLowerCase().endsWith('.'+format))throw Error('Output extension differs from package format');
if(format==='msix'){
 if(options['--identity']&&!path.isAbsolute(options['--identity']))throw Error('--identity requires an absolute path');
 const {msixIdentity}=await import('./msix-package.mjs');
 msixIdentity({channel:options['--channel'],version:options['--version']||'0.1.35',identity:options['--identity']?JSON.parse(await fs.readFile(options['--identity'],'utf8')):undefined});
}
const desktopClient=JSON.parse(await fs.readFile(path.join(root,'desktop','standalone-pwh','client','manifest.json'),'utf8'));
await assertEditorBuildInputs(root,desktopClient.buildInputs,'desktop');
assertPortableEditorBundle(await fs.readFile(path.join(root,'desktop','standalone-pwh','client','editor.js'),'utf8'));
const stage=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-desktop-source-'));
await fs.cp(path.join(root,'desktop','standalone-pwh'),path.join(stage,'standalone-pwh'),{recursive:true});
await fs.mkdir(path.join(stage,'bridge'));for(const name of ['hwp-codex-host.mjs','codex-image-host.mjs'])await fs.copyFile(path.join(root,'desktop','bridge',name),path.join(stage,'bridge',name));
const source=path.join(stage,'pwh-source.zip');await packagePlugin({output:source});
for(const entry of zipEntries(await fs.readFile(source))){const parts=entry.name.split('/');if(parts.shift()!=='pwh')throw Error('Unexpected source archive root');const relative=parts.join('/');if(!relative)continue;const target=path.join(stage,'release-source',relative);if(entry.name.endsWith('/'))await fs.mkdir(target,{recursive:true});else{await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,entry.read(),{flag:'wx'});}}
await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(stage,'standalone-pwh','build-msi.mjs'),options['--output']],{cwd:stage,windowsHide:true,stdio:'inherit',env:{...process.env,PWH_OFFLINE_RUNTIME_ARCHIVE:options['--runtime-archive'],PWH_WIX_DIR:options['--wix-dir']||'',PWH_CODEX_RUNTIME_DIR:options['--codex-runtime'],PWH_ELECTRON_ARCHIVE:options['--electron-archive'],PWH_MSI_VERSION:options['--version']||'0.1.35',PWH_DESKTOP_FORMAT:format,PWH_MSIX_CHANNEL:options['--channel']||'',PWH_MSIX_IDENTITY_FILE:options['--identity']||'',PWH_WINDOWS_SDK_DIR:options['--sdk-dir']||'',PWH_MSIX_ASSET_ROOT:path.join(root,'packaging','msix')}});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(format.toUpperCase()+' build failed: '+code)));});
console.log('Build staging preserved for review: '+stage);
