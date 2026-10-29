#!/usr/bin/env node
// Build the Windows installer from this repository's public Desktop sources.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {packagePlugin} from './package.mjs';
import {zipEntries} from './setup.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){const key=args[i];if(!['--output','--runtime-archive','--wix-dir','--codex-runtime','--version'].includes(key)||options[key]||!args[i+1])throw Error('Use --output, --runtime-archive, --wix-dir, --codex-runtime and optional --version');options[key]=args[i+1];}
if(process.platform!=='win32'||process.arch!=='x64')throw Error('Windows x64 is required to build the MSI');
for(const key of ['--output','--runtime-archive','--wix-dir','--codex-runtime'])if(!options[key]||!path.isAbsolute(options[key]))throw Error(key+' requires an absolute path');
const stage=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-desktop-source-'));
await fs.cp(path.join(root,'desktop','standalone-pwh'),path.join(stage,'standalone-pwh'),{recursive:true});
await fs.mkdir(path.join(stage,'bridge'));await fs.copyFile(path.join(root,'desktop','bridge','hwp-codex-host.mjs'),path.join(stage,'bridge','hwp-codex-host.mjs'));
const source=path.join(stage,'pwh-source.zip');await packagePlugin({output:source});
for(const entry of zipEntries(await fs.readFile(source))){const parts=entry.name.split('/');if(parts.shift()!=='pwh')throw Error('Unexpected source archive root');const relative=parts.join('/');if(!relative)continue;const target=path.join(stage,'release-source',relative);if(entry.name.endsWith('/'))await fs.mkdir(target,{recursive:true});else{await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,entry.read(),{flag:'wx'});}}
await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(stage,'standalone-pwh','build-msi.mjs'),options['--output']],{cwd:stage,windowsHide:true,stdio:'inherit',env:{...process.env,PWH_OFFLINE_RUNTIME_ARCHIVE:options['--runtime-archive'],PWH_WIX_DIR:options['--wix-dir'],PWH_CODEX_RUNTIME_DIR:options['--codex-runtime'],PWH_MSI_VERSION:options['--version']||'0.1.11'}});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('MSI build failed: '+code)));});
console.log('Build staging preserved for review: '+stage);
