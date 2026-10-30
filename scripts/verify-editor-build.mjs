#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {zipEntries} from './setup.mjs';
import {assertEditorBuildInputs,assertPortableEditorBundle} from './editor-build-contract.mjs';

const project=fileURLToPath(new URL('../',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i++){
  if(['--write','--check-inputs'].includes(args[i]))options[args[i]]=true;
  else if(['--cache-dir','--work-root'].includes(args[i])&&args[i+1])options[args[i]]=path.resolve(args[++i]);
  else throw Error('Use --check-inputs, --write, --cache-dir PATH or --work-root PATH');
}
async function checkInputs(){
  const common=JSON.parse(await fs.readFile(path.join(project,'client/.pwh-install.json'),'utf8'));
  const desktop=JSON.parse(await fs.readFile(path.join(project,'desktop/standalone-pwh/client/manifest.json'),'utf8'));
  await assertEditorBuildInputs(project,common.buildInputs);
  await assertEditorBuildInputs(project,desktop.buildInputs,'desktop');
  if(desktop.baseVersion!==common.version||desktop.baseEditorSha256!==common.files['editor.js'])throw Error('Common/Desktop editor versions do not match');
  for(const [relative,expected] of [...Object.entries(common.files).map(([name,digest])=>['client/'+name,digest]),['desktop/standalone-pwh/client/editor.js',desktop.sha256]]){
    const bytes=await fs.readFile(path.join(project,relative));assertPortableEditorBundle(bytes.toString('utf8'));
    if(hash(bytes)!==expected)throw Error('Committed editor digest mismatch: '+relative);
  }
}
if(options['--check-inputs']){await checkInputs();console.log('Both editor input records and portable bundles match.');process.exit(0);}
if(process.platform!=='win32')throw Error('The preserved client dependencies target Windows x64');
const lock=JSON.parse(await fs.readFile(path.join(project,'runtime-lock.json'),'utf8'));
const inputs=[...lock.preservationAssets].reverse().find(pin=>/^pwh-inline-build-inputs-/.test(pin.file));
const dependencies=lock.preservationAssets.find(pin=>/^pwh-studio-dependencies-/.test(pin.file));
if(!inputs||!dependencies)throw Error('Missing pinned editor inputs');
const work=options['--work-root']||await fs.mkdtemp(path.join(os.tmpdir(),'pwh-editor-rebuild-'));
await fs.mkdir(work,{recursive:true});
const cache=options['--cache-dir']||path.join(work,'downloads');await fs.mkdir(cache,{recursive:true});
async function archive(pin){
  const file=path.join(cache,pin.file);let bytes;
  try{bytes=await fs.readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;
    const url=new URL(pin.url);
    if(url.origin!=='https://github.com'||!url.pathname.startsWith('/wansucong-stoom/stoom-pwh/releases/download/'))throw Error('Untrusted build input URL');
    const response=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!response.ok)throw Error('Build input download: '+response.status);
    bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length>128*1024*1024)throw Error('Build input archive too large');
    if(bytes.length!==pin.size||hash(bytes)!==pin.sha256)throw Error('Build input digest mismatch');
    await fs.writeFile(file,bytes,{flag:'wx'});
  }
  if(bytes.length!==pin.size||hash(bytes)!==pin.sha256)throw Error('Build input digest mismatch: '+pin.file);
  return zipEntries(bytes);
}
const sourceEntries=await archive(inputs),dependencyEntries=await archive(dependencies);
async function extract(entries,destination,accept){
  for(const entry of entries){
    if(!accept(entry.name)||entry.name.endsWith('/'))continue;
    const parts=entry.name.split('/');
    if(parts.some(p=>!p||p==='.'||p==='..')||entry.name.includes('\\')||entry.name.includes(':'))throw Error('Unsafe editor input member');
    const target=path.join(destination,...parts);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,entry.read(),{flag:'wx'});
  }
}
const dependencyRoot=path.join(work,'dependencies');
await extract(dependencyEntries,dependencyRoot,name=>name.startsWith('rhwp-studio/node_modules/'));
await fs.access(path.join(dependencyRoot,'rhwp-studio/node_modules/vite/package.json'));
const run=(file,argv,env={})=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[file,...argv],{cwd:project,windowsHide:true,env:{...process.env,...env},stdio:'inherit'});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('Editor rebuild failed: '+code)));
});
const builtFiles=['client/editor.js','client/rhwp-studio.css','client/editor-body.html','client/.pwh-install.json','desktop/standalone-pwh/client/editor.js','desktop/standalone-pwh/client/manifest.json'];
let baseline;
for(let attempt=1;attempt<=2;attempt++){
  const stage=path.join(work,'run-'+attempt),build=path.join(stage,'pwh-build'),source=path.join(stage,'release-source');
  await fs.mkdir(stage);await extract(sourceEntries,build,name=>name.startsWith('rhwp-studio/')||name.startsWith('pkg/'));
  await fs.symlink(path.join(dependencyRoot,'rhwp-studio/node_modules'),path.join(build,'rhwp-studio/node_modules'),'junction');
  for(const name of ['src','scripts','client','desktop'])await fs.cp(path.join(project,name),path.join(source,name),{recursive:true});
  for(const name of ['package.json','runtime-lock.json'])await fs.copyFile(path.join(project,name),path.join(source,name));
  await run(path.join(source,'scripts/build-inline.mjs'),[build]);
  await run(path.join(source,'scripts/bundle-client.mjs'),[build]);
  await run(path.join(source,'desktop/standalone-pwh/build-desktop-editor.mjs'),[],{PWH_SOURCE_WORKSPACE:stage});
  const bytes=new Map();for(const name of builtFiles)bytes.set(name,await fs.readFile(path.join(source,name)));
  if(baseline){for(const [name,data] of bytes)if(!data.equals(baseline.get(name)))throw Error('Non-reproducible editor build: '+name);}
  else baseline=bytes;
}
for(const [name,bytes] of baseline){
  if(options['--write'])await fs.writeFile(path.join(project,name),bytes);
  else if(!(await fs.readFile(path.join(project,name))).equals(bytes))throw Error('Stale committed editor; rebuild required: '+name);
}
await checkInputs();
console.log(JSON.stringify({ok:true,independentBuilds:2,filesCompared:builtFiles.length,write:!!options['--write'],inputs:inputs.file,dependencies:dependencies.file}));
