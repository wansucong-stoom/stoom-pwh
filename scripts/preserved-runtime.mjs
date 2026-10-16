import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const COMPONENTS=['rhwp','core','editor-sdk','studio','studio-inline'];
const required={'rhwp':'rhwp.exe','core':'rhwp_bg.wasm','editor-sdk':'index.js','studio':'index.html','studio-inline':'editor.js'};
export function validateRuntimeLock(lock){
 if(lock?.schemaVersion!==1||lock.platform!=='win32-x64'||!/^rhwp-\d+\.\d+\.\d+-pwh-r\d+$/.test(lock.id||''))throw Error('Invalid preserved runtime identity');
 const pin=lock.runtime;
 if(!pin||!/^pwh-runtime-[\w.-]+\.zip$/.test(pin.file)||!/^[a-f0-9]{64}$/.test(pin.sha256||''))throw Error('Invalid preserved runtime digest');
 const url=new URL(pin.url);
 if(url.origin!=='https://github.com'||url.username||url.password||url.search||url.hash||!url.pathname.startsWith('/wansucong-stoom/stoom-pwh/releases/download/')||url.pathname.split('/').at(-1)!==pin.file)throw Error('Runtime must use the preserved pwh release');
 return lock;
}
function safeName(name){
 if(typeof name!=='string'||name.length>240||name.includes('\\')||name.includes('\0'))throw Error('Unsafe runtime member');
 for(const part of name.split('/'))if(!part||part==='.'||part==='..'||/[<>:"|?*\x00-\x1f]/.test(part)||/[. ]$/.test(part)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part))throw Error('Unsafe runtime member');
 if(name!=='runtime-manifest.json'&&!COMPONENTS.includes(name.split('/')[0]))throw Error('Unexpected runtime component');
}
export function readRuntimeArchive(bytes,lock,zipEntries){
 validateRuntimeLock(lock);if(hash(bytes)!==lock.runtime.sha256)throw Error('Preserved runtime archive digest mismatch');
 const entries=zipEntries(bytes);if(entries.length>10000)throw Error('Too many runtime files');
 const byName=new Map(),folded=new Set();let size=0;
 for(const entry of entries){const key=entry.name.toLowerCase();if(folded.has(key))throw Error('Duplicate runtime member');safeName(entry.name);folded.add(key);byName.set(entry.name,entry);size+=entry.size;if(size>512*1024*1024)throw Error('Expanded runtime exceeds limit');}
 const manifestEntry=byName.get('runtime-manifest.json');if(!manifestEntry||manifestEntry.size>4*1024*1024)throw Error('Missing runtime manifest');
 const manifest=JSON.parse(manifestEntry.read().toString('utf8'));
 if(manifest.schemaVersion!==1||manifest.id!==lock.id||manifest.upstreamCommit!==lock.upstreamCommit||!Array.isArray(manifest.files)||manifest.files.length!==entries.length-1)throw Error('Runtime manifest identity mismatch');
 const files=new Map();
 for(const record of manifest.files){safeName(record.path);if(record.path==='runtime-manifest.json'||files.has(record.path)||!/^[a-f0-9]{64}$/.test(record.sha256||''))throw Error('Invalid runtime manifest file');const entry=byName.get(record.path);if(!entry||entry.size!==record.size)throw Error('Runtime member size mismatch');const data=entry.read();if(hash(data)!==record.sha256)throw Error('Runtime member digest mismatch');files.set(record.path,data);}
 for(const component of COMPONENTS)if(!files.has(`${component}/${required[component]}`)||![...files.keys()].some(p=>p.startsWith(component+'/')&&/LICENSE/i.test(p)))throw Error(`Incomplete component or license: ${component}`);
 return {manifest,files};
}
async function exists(file){try{return await fs.lstat(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function assertPlainParents(root,relative){let p=root;for(const part of relative.split('/')){p=path.join(p,part);const stat=await exists(p);if(stat?.isSymbolicLink())throw Error('Existing runtime symlink was preserved');}}
// No Git, npm or upstream fetch is used by this installer. All files are pinned
// before publishing any component; existing directories are never overwritten.
export async function installPreservedRuntime(options,lock,helpers){
 validateRuntimeLock(lock);const root=path.resolve(options.runtimeRoot);
 if(options.dryRun){console.log(JSON.stringify({mode:'preserved-runtime',runtime:lock,requirements:['Windows x64','Node 22.12+ or 24+'],offline:options.skipDownload,localArchive:options.runtimeArchive||null,preserveExisting:true,startService:false},null,2));return;}
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('Preserved runtime supports Windows x64 only');
 const [major,minor]=process.versions.node.split('.').map(Number);if(major<22||major===22&&minor<12||major===23)throw Error('Node.js 22.12+ LTS or 24+ is required');
 await fs.mkdir(root,{recursive:true});const lockPath=path.join(root,'.setup.lock'),lease=await fs.open(lockPath,'wx');
 const stage=path.join(root,`.preserved-${randomUUID()}`);let completed=false;
 try{
  const archive=await helpers.download(root,lock.runtime,options,options.runtimeArchive);
  const {manifest,files}=readRuntimeArchive(await fs.readFile(archive),lock,helpers.zipEntries);
  const components=options.cliOnly?['rhwp']:COMPONENTS,add=[];
  // Check every existing target before staging or publishing any missing one.
  for(const component of components){const target=path.join(root,component),stat=await exists(target);if(!stat){add.push(component);continue;}if(!stat.isDirectory()||stat.isSymbolicLink())throw Error(`Existing ${component} was preserved`);
   for(const [relative,data]of files)if(relative.startsWith(component+'/')){await assertPlainParents(root,relative);const current=await fs.readFile(helpers.childPath(root,relative));if(hash(current)!==hash(data))throw Error(`Existing ${relative} differs; preserved. Use a fresh --runtime-root.`);}
  }
  await fs.mkdir(stage);
  for(const [relative,data]of files)if(add.includes(relative.split('/')[0])){const target=helpers.childPath(stage,relative);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,data,{flag:'wx'});}
  for(const component of add)await fs.rename(path.join(stage,component),path.join(root,component));
  if(options.withNanum)await helpers.installNanum(root,stage,options);
  await fs.mkdir(path.join(root,'documents'),{recursive:true});await fs.mkdir(path.join(root,'fonts'),{recursive:true});
  const receipt={id:lock.id,archiveSha256:lock.runtime.sha256,upstreamCommit:manifest.upstreamCommit,provenance:manifest.provenance,components};
  const receiptFile=path.join(root,'.preserved-runtime.json');
  if(!await exists(receiptFile))await fs.writeFile(receiptFile,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  completed=true;console.log(JSON.stringify({installed:true,root,...receipt},null,2));
 }finally{
  await lease.close();await fs.unlink(lockPath);
  const relative=path.relative(root,stage);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Unsafe runtime staging path');
  if(completed)await fs.rm(stage,{recursive:true,force:true});else console.error(`Incomplete staging, if present, was preserved: ${stage}`);
 }
}
