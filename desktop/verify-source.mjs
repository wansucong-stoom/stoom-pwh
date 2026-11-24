#!/usr/bin/env node
// Verify the public mirror without requiring the original development workspace.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {assertEditorBuildInputs,assertPortableEditorBundle} from '../scripts/editor-build-contract.mjs';

const root=path.dirname(fileURLToPath(import.meta.url)),args=process.argv.slice(2);
const write=args.length===1&&args[0]==='--write';
if(args.length&&!write&&!(args.length===2&&args[0]==='--source-root'))throw Error('Usage: node desktop/verify-source.mjs [--write | --source-root <original-workspace>]');
const sourceRoot=args[0]==='--source-root'?path.resolve(args[1]):null;
const manifestFile=path.join(root,'source-manifest.json');
const manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));
assert.equal(manifest.schemaVersion,1);assert.ok(Array.isArray(manifest.files)&&manifest.files.length>0);
const sharedPackage=JSON.parse(await fs.readFile(path.join(root,'..','package.json'),'utf8'));
if(!write)assert.equal(manifest.pluginVersion,sharedPackage.version,'Desktop source manifest must match the shared Pwh version');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const safeRelative=value=>typeof value==='string'&&value.length>0&&!path.isAbsolute(value)&&!value.includes('\\')&&!value.split('/').some(part=>!part||part==='.'||part==='..');
const allowed=new Set(['.mjs','.cjs','.js','.css','.html','.svg','.ico','.png','.ttf','.cs','.ps1','.cmd','.vbs','.txt']);
const generated=new Set(['README.md','verify-source.mjs','source-manifest.json']);
const listed=new Map();
for(const file of manifest.files){
 assert.ok(safeRelative(file.path)&&safeRelative(file.source),'Unsafe manifest path');assert.ok(!listed.has(file.path),'Duplicate manifest path');
 assert.ok(/^[a-f0-9]{64}$/.test(file.sha256)&&Number.isSafeInteger(file.size)&&file.size>0,'Invalid source digest');
 const expected=file.source.replace(/\.test\.mjs$/,'.check.mjs');assert.equal(file.path,expected,'Only the documented check filename rename is allowed');listed.set(file.path,file);
}
async function walk(dir,relative=''){
 const files=[];
 for(const entry of await fs.readdir(dir,{withFileTypes:true})){
  const rel=relative?`${relative}/${entry.name}`:entry.name,full=path.join(dir,entry.name),stat=await fs.lstat(full);
  assert.ok(!stat.isSymbolicLink(),`Symlink is not public source: ${rel}`);
  assert.ok(!['.git','node_modules','data','logs','profiles','temp','tmp','.cache'].includes(entry.name.toLowerCase()),`Unexpected private/build directory: ${rel}`);
  if(stat.isDirectory())files.push(...await walk(full,rel));else{assert.ok(stat.isFile(),`Unsupported source entry: ${rel}`);files.push(rel);}
 }return files;
}
const files=(await walk(root)).sort(),expected=[...listed.keys(),...generated].sort();
if(write)assert.deepEqual(files.filter(file=>generated.has(file)),[...generated].sort(),'Public mirror is missing generated source metadata');
else assert.deepEqual(files,expected,'Public mirror contains missing or extra files');
let originalComparisons=0;
const refreshed=[];
for(const rel of files){
 assert.ok(!rel.endsWith('.test.mjs'),'Unstaged checks must not join repository test discovery');
 assert.ok(allowed.has(path.extname(rel).toLowerCase())||generated.has(rel)||rel==='standalone-pwh/client/manifest.json'||rel==='standalone-pwh/version.json'||rel==='standalone-pwh/font-provenance.json',`File type is outside the public source allowlist: ${rel}`);
 const bytes=await fs.readFile(path.join(root,...rel.split('/'))),record=listed.get(rel);
 if(!write&&record){assert.equal(bytes.length,record.size,`${rel}: size mismatch`);assert.equal(hash(bytes),record.sha256,`${rel}: SHA256 mismatch`);}
 if(!['.ico','.png','.ttf'].includes(path.extname(rel).toLowerCase())){
  const text=bytes.toString('utf8');
  assert.ok(!/[a-z]:[\\/]+Users[\\/]+[^\s'"`<>]+/i.test(text),`${rel}: a Windows user-home path was embedded`);
  assert.ok(!/(?:\/home\/|\/Users\/)[a-z0-9_.-]+\//i.test(text),`${rel}: a user-home path was embedded`);
 }
 if(sourceRoot&&record){const original=await fs.readFile(path.join(sourceRoot,...record.source.split('/')));assert.equal(hash(original),record.sha256,`${record.source}: original differs from public mirror`);originalComparisons++;}
 if(write&&!generated.has(rel)){
  assert.ok(bytes.length,`${rel}: empty public Desktop source`);
  refreshed.push({path:rel,source:record?.source??rel.replace(/\.check\.mjs$/,'.test.mjs'),size:bytes.length,sha256:hash(bytes)});
 }
}
const editor=await fs.readFile(path.join(root,'standalone-pwh','client','editor.js')),client=JSON.parse(await fs.readFile(path.join(root,'standalone-pwh','client','manifest.json'),'utf8'));
assert.equal(hash(editor),client.sha256,'Desktop client bundle differs from its own manifest');
await assertEditorBuildInputs(path.join(root,'..'),client.buildInputs,'desktop');
assertPortableEditorBundle(editor.toString('utf8'));
if(write){
 const temporary=manifestFile+'.'+randomUUID()+'.tmp';
 try{
  await fs.writeFile(temporary,JSON.stringify({...manifest,pluginVersion:sharedPackage.version,files:refreshed},null,2)+'\n',{flag:'wx'});
  await fs.rename(temporary,manifestFile);
 }finally{await fs.unlink(temporary).catch(()=>{});}
}
const fileList=write?refreshed.map(record=>record.path):[...listed.keys()];
console.log(JSON.stringify({ok:true,wroteManifest:write,copiedFiles:fileList.length,totalFiles:files.length,renamedChecks:fileList.filter(name=>name.endsWith('.check.mjs')).length,originalComparisons,embeddedUserPaths:0,nestedRepositories:0,clientVersion:client.baseVersion,desktopClientSha256:client.sha256}));
