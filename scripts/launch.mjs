#!/usr/bin/env node
// Running servers must not lazily import from a cache that the host can remove
// during an upgrade. Materialize a verified, immutable release before loading
// any plugin module, then keep this process and its cwd on that release.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const digest=b=>createHash('sha256').update(b).digest('hex');
const folders=['src','scripts','licenses','docs','skills','examples','.codex-plugin','client'];
const files=['package.json','plugin.json','runtime-lock.json','engine.config.json','engine.config.local.json','engine.config.example.json','README.md','LICENSE','THIRD_PARTY_NOTICES.md','.mcp.json','mcp.json','assets/stoom.png'];
export async function materializeRelease(source,releaseRoot){
 source=path.resolve(source);releaseRoot=path.resolve(releaseRoot);
 const entries=[];let total=0;
 async function collect(relative,optional=false){
  const filename=path.join(source,relative);let stat;try{stat=await fs.lstat(filename);}catch(e){if(optional&&e.code==='ENOENT')return;throw e;}
  if(stat.isSymbolicLink())throw Error('Plugin release contains a symbolic link');
  if(stat.isDirectory()){for(const name of (await fs.readdir(filename)).sort())await collect(path.join(relative,name));return;}
  if(!stat.isFile())throw Error('Plugin release contains a non-file entry');
  total+=stat.size;if(total>64*1024*1024||entries.length>=10000)throw Error('Plugin release exceeds source limits');
  const bytes=await fs.readFile(filename);entries.push({relative,bytes,sha256:digest(bytes)});
 }
 for(const relative of [...files,...folders])await collect(relative,true);
 entries.sort((a,b)=>a.relative.localeCompare(b.relative,'en'));
 const pkg=JSON.parse(entries.find(e=>e.relative==='package.json')?.bytes.toString()||'{}');
 if(!/^\d+\.\d+\.\d+$/.test(pkg.version||'')||!entries.some(e=>e.relative===path.join('src','server.mjs')))throw Error('Invalid plugin release');
 const sha256=digest(Buffer.from(JSON.stringify(entries.map(({relative,sha256})=>({relative,sha256})))));
 const destination=path.join(releaseRoot,`${pkg.version}-${sha256.slice(0,16)}`);
 async function verify(){
  const marker=JSON.parse(await fs.readFile(path.join(destination,'.pwh-release.json'),'utf8'));
  if(marker.sha256!==sha256)throw Error('Persistent plugin release identity mismatch');
  for(const entry of entries)if(digest(await fs.readFile(path.join(destination,entry.relative)))!==entry.sha256)throw Error('Persistent plugin release integrity mismatch');
  return destination;
 }
 try{await fs.stat(destination);return await verify();}catch(e){if(e.code!=='ENOENT')throw e;}
 await fs.mkdir(releaseRoot,{recursive:true});
 const staging=path.join(releaseRoot,`.stage-${randomUUID()}`);await fs.mkdir(staging);
 try{
  for(const entry of entries){const filename=path.join(staging,entry.relative);await fs.mkdir(path.dirname(filename),{recursive:true});await fs.writeFile(filename,entry.bytes,{flag:'wx'});}
  await fs.writeFile(path.join(staging,'.pwh-release.json'),JSON.stringify({version:pkg.version,sha256,files:entries.map(({relative,sha256})=>({relative,sha256}))}),{flag:'wx'});
  try{await fs.rename(staging,destination);}catch(e){if(!['EEXIST','ENOTEMPTY','EPERM'].includes(e.code))throw e;await fs.stat(destination);}
  return await verify();
 }finally{
  const relative=path.relative(releaseRoot,path.resolve(staging));
  if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Invalid release staging cleanup path');
  await fs.rm(staging,{recursive:true,force:true});
 }
}
async function main(){
 const kind=process.argv[2]||'pwh';if(!['pwh','rhwp-core'].includes(kind))throw Error('Unknown pwh server');
 const source=fileURLToPath(new URL('../',import.meta.url)),root=process.env.PWH_SERVER_RELEASE_ROOT||path.join(os.homedir(),'.stoom-pwh','server-releases');
 const release=await materializeRelease(source,root);process.chdir(release);
 if(kind==='pwh'){const server=await import(pathToFileURL(path.join(release,'src','server.mjs')));server.runStdio();}
 else await import(pathToFileURL(path.join(release,'src','native-mcp.mjs')));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{process.stderr.write(`pwh startup: ${error.message}\n`);process.exitCode=1;});
