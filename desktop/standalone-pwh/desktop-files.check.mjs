import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createDesktopFileManager} from './desktop-files.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
test('save protects external edits, save as publishes only chosen path',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-files-'));const original=path.join(dir,'original.hwpx'),copy=path.join(dir,'copy.hwpx'),initial=Buffer.from('PK-original'),updated=Buffer.from('PK-updated');let picked=copy;
 const files=createDesktopFileManager({choose:async()=>({cancelled:false,path:picked}),verify:async()=>({format:'hwpx'}),register:async file=>({documentId:'next',source:file,sourceSha256:digest(await fs.readFile(file)),name:path.basename(file)})});
 try{await fs.writeFile(original,initial);files.setTarget(original,digest(initial));let prepared=await files.prepare({mode:'save',documentId:'doc'});await fs.writeFile(original,Buffer.from('PK-external'));await assert.rejects(files.write({ticket:prepared.ticket,documentId:'doc',bytes:updated}),/변경/);assert.equal((await fs.readFile(original)).toString(),'PK-external');
  prepared=await files.prepare({mode:'save-as',documentId:'doc'});const saved=await files.write({ticket:prepared.ticket,documentId:'doc',bytes:updated});assert.equal(saved.source,copy);assert.equal((await fs.readFile(copy)).toString(),'PK-updated');assert.equal((await fs.readFile(original)).toString(),'PK-external');
  prepared=await files.prepare({mode:'save',documentId:'next'});await files.write({ticket:prepared.ticket,documentId:'next',bytes:Buffer.from('PK-again')});assert.equal((await fs.readFile(copy)).toString(),'PK-again');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
