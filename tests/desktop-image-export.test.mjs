import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createImageExportManager} from '../desktop/standalone-pwh/image-export.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=', 'base64');
const make = async (directory, extension, extra={}) => createImageExportManager({tempRoot:directory, choose:async()=>({cancelled:false,path:path.join(directory,`문서.${extension}`)}), ...extra});
const cleanup = async dir => {const root=await fs.realpath(os.tmpdir()),target=await fs.realpath(dir),relative=path.relative(root,target);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(target).startsWith('pwh-image-'));await fs.rm(target,{recursive:true,force:true});};

test('image export names every chosen page, preserves bytes and refuses collisions', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-image-test-'));
  try {
    const manager=await make(dir,'png'), start=await manager.start({documentId:'doc',pages:[1,3],suggestedName:'문서.hwpx'});
    await manager.add({ticket:start.ticket,documentId:'doc',page:1,bytes:png});
    await manager.add({ticket:start.ticket,documentId:'doc',page:3,bytes:png});
    const result=await manager.finish({ticket:start.ticket,documentId:'doc'});
    assert.deepEqual(result.files.map(x=>path.basename(x)),['문서-1.png','문서-3.png']);
    for(const file of result.files)assert.deepEqual(await fs.readFile(file),png);
    await assert.rejects(manager.start({documentId:'doc',pages:[1],suggestedName:'문서.hwpx'}),/이미 같은 이름/);
    assert.deepEqual(await fs.readFile(result.files[0]),png);
  } finally {await cleanup(dir);}
});

test('image export rolls back its own completed pages if another file appears', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-image-conflict-'));
  try {
    const manager=await make(dir,'png'), start=await manager.start({documentId:'doc',pages:[1,2]});
    for(const page of [1,2])await manager.add({ticket:start.ticket,documentId:'doc',page,bytes:png});
    await fs.writeFile(path.join(dir,'문서-2.png'),'existing');
    await assert.rejects(manager.finish({ticket:start.ticket,documentId:'doc'}));
    await assert.rejects(fs.access(path.join(dir,'문서-1.png')));
    assert.equal(await fs.readFile(path.join(dir,'문서-2.png'),'utf8'),'existing');
    await manager.cancel({ticket:start.ticket,documentId:'doc'});
  } finally {await cleanup(dir);}
});

test('image export converts to standard Windows image formats', {skip:process.platform!=='win32'}, async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-image-format-'));
  try {
    for(const [ext,magic] of [['bmp','424d'],['jpg','ffd8'],['gif','47494638'],['tif','49492a00']]){
      const manager=await make(dir,ext), start=await manager.start({documentId:'doc',pages:[2]});
      await manager.add({ticket:start.ticket,documentId:'doc',page:2,bytes:png});
      const result=await manager.finish({ticket:start.ticket,documentId:'doc'});
      assert.equal((await fs.readFile(result.files[0])).subarray(0,magic.length/2).toString('hex'),magic);
    }
  } finally {await cleanup(dir);}
});
