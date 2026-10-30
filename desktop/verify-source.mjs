#!/usr/bin/env node
// Verify the public mirror without requiring the original development workspace.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {assertEditorBuildInputs,assertPortableEditorBundle} from '../scripts/editor-build-contract.mjs';

const root=path.dirname(fileURLToPath(import.meta.url)),args=process.argv.slice(2);
if(args.length&&!(args.length===2&&args[0]==='--source-root'))throw Error('Usage: node desktop/verify-source.mjs [--source-root <original-workspace>]');
const sourceRoot=args.length?path.resolve(args[1]):null;
const manifest=JSON.parse(await fs.readFile(path.join(root,'source-manifest.json'),'utf8'));
assert.equal(manifest.schemaVersion,1);assert.ok(Array.isArray(manifest.files)&&manifest.files.length>0);
const sharedPackage=JSON.parse(await fs.readFile(path.join(root,'..','package.json'),'utf8'));
assert.equal(manifest.pluginVersion,sharedPackage.version,'Desktop source manifest must match the shared Pwh version');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const safeRelative=value=>typeof value==='string'&&value.length>0&&!path.isAbsolute(value)&&!value.includes('\\')&&!value.split('/').some(part=>!part||part==='.'||part==='..');
const allowed=new Set(['.mjs','.cjs','.js','.css','.html','.svg','.ico','.ttf','.cs','.ps1','.cmd','.vbs','.txt']);
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
const files=(await walk(root)).sort(),expected=[...listed.keys(),...generated].sort();assert.deepEqual(files,expected,'Public mirror contains missing or extra files');
let originalComparisons=0;
for(const rel of files){
 assert.ok(!rel.endsWith('.test.mjs'),'Unstaged checks must not join repository test discovery');
 assert.ok(allowed.has(path.extname(rel).toLowerCase())||generated.has(rel)||rel==='standalone-pwh/client/manifest.json'||rel==='standalone-pwh/version.json'||rel==='standalone-pwh/font-provenance.json',`File type is outside the public source allowlist: ${rel}`);
 const bytes=await fs.readFile(path.join(root,...rel.split('/'))),record=listed.get(rel);
 if(record){assert.equal(bytes.length,record.size,`${rel}: size mismatch`);assert.equal(hash(bytes),record.sha256,`${rel}: SHA256 mismatch`);}
 if(!['.ico','.ttf'].includes(path.extname(rel).toLowerCase())){
  const text=bytes.toString('utf8');
  assert.ok(!/[a-z]:[\\/]+Users[\\/]+[^\s'"`<>]+/i.test(text),`${rel}: a Windows user-home path was embedded`);
  assert.ok(!/(?:\/home\/|\/Users\/)[a-z0-9_.-]+\//i.test(text),`${rel}: a user-home path was embedded`);
 }
 if(sourceRoot&&record){const original=await fs.readFile(path.join(sourceRoot,...record.source.split('/')));assert.equal(hash(original),record.sha256,`${record.source}: original differs from public mirror`);originalComparisons++;}
}
const editor=await fs.readFile(path.join(root,'standalone-pwh','client','editor.js')),client=JSON.parse(await fs.readFile(path.join(root,'standalone-pwh','client','manifest.json'),'utf8'));
assert.equal(hash(editor),client.sha256,'Desktop client bundle differs from its own manifest');
await assertEditorBuildInputs(path.join(root,'..'),client.buildInputs,'desktop');
assertPortableEditorBundle(editor.toString('utf8'));
console.log(JSON.stringify({ok:true,copiedFiles:listed.size,totalFiles:files.length,renamedChecks:[...listed.keys()].filter(name=>name.endsWith('.check.mjs')).length,originalComparisons,embeddedUserPaths:0,nestedRepositories:0,clientVersion:client.baseVersion,desktopClientSha256:client.sha256}));
