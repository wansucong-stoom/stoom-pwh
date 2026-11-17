#!/usr/bin/env node
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {packagePlugin} from './package.mjs';import {zipEntries,childPath} from './setup.mjs';
import {verifyOfficialRuntime} from '../desktop/standalone-pwh/official-codex-runtime.mjs';
import {ELECTRON_VERSION} from './stage-electron.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),exec=promisify(execFile),sha=b=>createHash('sha256').update(b).digest('hex');
const options={};for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i];if(!['--output','--cache'].includes(key)||options[key]||!path.isAbsolute(process.argv[i+1]||''))throw Error('Usage: --output ABSOLUTE.tar.gz --cache ABSOLUTE_DIRECTORY');options[key]=process.argv[i+1];}
if(process.platform!=='linux'||process.arch!=='x64')throw Error('Linux x64 is required');
const version=JSON.parse(await fs.readFile(path.join(root,'desktop/standalone-pwh/version.json'),'utf8')).version,pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
if(!options['--output']||path.basename(options['--output'])!==`PwhDesktop-${version}-linux-x64.tar.gz`)throw Error('Output name must match the shared Desktop version');
await fs.mkdir(path.dirname(options['--output']),{recursive:true});try{await fs.access(options['--output']);throw Error('Output already exists');}catch(e){if(e.code!=='ENOENT')throw e;}
const cache=options['--cache']||await fs.mkdtemp(path.join(os.tmpdir(),'pwh-linux-cache-'));await fs.mkdir(cache,{recursive:true});
const pin=JSON.parse(await fs.readFile(path.join(root,'packaging/linux/runtime-lock.json'),'utf8')),common=JSON.parse(await fs.readFile(path.join(root,'runtime-lock.json'),'utf8'));
if(pin.artifacts.electron.name!==`electron-v${ELECTRON_VERSION}-linux-x64.zip`||!pin.artifacts.rhwp.name.startsWith('rhwp-v'+common.upstreamVersion+'-'))throw Error('Linux native runtime versions differ from the shared Windows release');
async function archive(item){const file=path.join(cache,item.name||item.file);let b;try{b=await fs.readFile(file);}catch(e){if(e.code!=='ENOENT')throw e;const r=await fetch(item.url,{signal:AbortSignal.timeout(900000)});if(!r.ok)throw Error('Artifact download failed: '+r.status);b=Buffer.from(await r.arrayBuffer());if(b.length===item.size&&sha(b)===item.sha256)await fs.writeFile(file,b,{flag:'wx'});}
 if(b.length!==item.size||sha(b)!==item.sha256)throw Error('Artifact integrity differs: '+path.basename(file));return {file,bytes:b};}
const inputs={};for(const[key,item]of Object.entries({...pin.artifacts,common:common.runtime})){inputs[key]=await archive(item);console.log('Verified '+path.basename(inputs[key].file));}
const work=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-linux-build-')),app=path.join(work,'PwhDesktop');await fs.mkdir(app);
async function unzip(bytes,destination,{strip='',filter=()=>true}={}){const seen=new Set();for(const e of zipEntries(bytes,{maxMember:300*1024*1024})){let n=e.name;if(strip){if(!n.startsWith(strip))throw Error('Archive root differs');n=n.slice(strip.length);}if(!n||!filter(n))continue;const key=n.replace(/\/$/,'');if(seen.has(key))throw Error('Duplicate archive path');seen.add(key);const target=childPath(destination,key);if(n.endsWith('/'))await fs.mkdir(target,{recursive:true});else{await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,e.read(),{flag:'wx',mode:0o644});}}}
await fs.cp(path.join(root,'desktop/standalone-pwh'),path.join(app,'standalone-pwh'),{recursive:true});await fs.mkdir(path.join(app,'bridge'));for(const n of ['hwp-codex-host.mjs','codex-image-host.mjs'])await fs.copyFile(path.join(root,'desktop/bridge',n),path.join(app,'bridge',n));
const plugin=path.join(work,'plugin.zip');await packagePlugin({output:plugin});await unzip(await fs.readFile(plugin),path.join(app,'release-source'),{strip:'pwh/'});
await unzip(inputs.common.bytes,path.join(app,'engine'),{filter:n=>!n.startsWith('rhwp/')&&!n.toLowerCase().endsWith('.exe')});
await unzip(inputs.electron.bytes,path.join(app,'electron'));
for(const key of ['node','rhwp','codex']){const target=path.join(work,key);await fs.mkdir(target);await exec('tar',['-xf',inputs[key].file,'-C',target,'--no-same-owner']);inputs[key].directory=target;}
await fs.cp(path.join(inputs.rhwp.directory,'rhwp'),path.join(app,'engine','rhwp'),{recursive:true});
await fs.cp(inputs.codex.directory,path.join(app,'standalone-pwh','codex-runtime'),{recursive:true});await verifyOfficialRuntime(path.join(app,'standalone-pwh','codex-runtime'));
const nodeRoot=path.join(inputs.node.directory,'node-v24.22.3-linux-x64');await fs.mkdir(path.join(app,'node'));for(const [from,to]of [['bin/node','node'],['LICENSE','LICENSE']])await fs.copyFile(path.join(nodeRoot,from),path.join(app,'node',to));
for(const n of ['electron/electron','electron/chrome_crashpad_handler','electron/chrome-sandbox','node/node','engine/rhwp/rhwp'])await fs.chmod(path.join(app,n),0o755);
await fs.writeFile(path.join(app,'standalone-pwh','distribution.json'),JSON.stringify({schema:1,channel:'linux'})+'\n');
await fs.writeFile(path.join(app,'pwh-desktop'),'#!/bin/sh\nset -eu\nAPP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nif [ "${1-}" = "--install" ]; then exec "$APP_DIR/node/node" "$APP_DIR/standalone-pwh/linux-install.mjs"; fi\nexec "$APP_DIR/node/node" "$APP_DIR/standalone-pwh/launch.mjs" "$@"\n',{mode:0o755});
const manifest={schema:1,platform:'linux-x64',pwhVersion:pkg.version,desktopVersion:version,commonRuntime:common.id,commonArchiveSha256:common.runtime.sha256,coreSha256:sha(await fs.readFile(path.join(app,'engine/core/rhwp_bg.wasm'))),editorSha256:sha(await fs.readFile(path.join(app,'standalone-pwh/client/editor.js'))),artifacts:pin.artifacts};
await fs.writeFile(path.join(app,'engine','.preserved-runtime.json'),JSON.stringify({schemaVersion:1,id:common.id,platform:'linux-x64',archiveSha256:common.runtime.sha256})+'\n');
await fs.writeFile(path.join(app,'LINUX-BUILD.json'),JSON.stringify(manifest,null,2)+'\n');
await fs.copyFile(path.join(root,'docs','LINUX.md'),path.join(app,'README.md'));
await exec('tar',['-czf',options['--output'],'-C',work,'PwhDesktop'],{timeout:600000,maxBuffer:1024*1024});
const bytes=await fs.readFile(options['--output']),report={...manifest,package:path.basename(options['--output']),size:bytes.length,sha256:sha(bytes)};await fs.writeFile(options['--output']+'.json',JSON.stringify(report,null,2)+'\n');
if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,'package='+options['--output']+'\nverification='+options['--output']+'.json\n');
console.log(JSON.stringify({package:options['--output'],appRoot:app,size:bytes.length,sha256:report.sha256,coreSha256:manifest.coreSha256}));
