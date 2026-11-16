import test from 'node:test';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadCore} from './engine-source-ownership/shape-transparency-fixture.mjs';
import {cellPictureFloorFixture} from './engine-source-ownership/cell-picture-floor-fixture.mjs';
import {zipEntries} from '../scripts/setup.mjs';
const skip=!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM?'Requires actual core paths':false;
const sha=b=>createHash('sha256').update(b).digest('hex');
function bitmap(seed){const width=64,height=32,pixels=width*height*3,b=Buffer.alloc(54+pixels);b.write('BM');b.writeUInt32LE(b.length,2);b.writeUInt32LE(54,10);b.writeUInt32LE(40,14);b.writeInt32LE(width,18);b.writeInt32LE(height,22);b.writeUInt16LE(1,26);b.writeUInt16LE(24,28);b.writeUInt32LE(pixels,34);for(let i=54;i<b.length;i++)b[i]=(i*17+Math.floor(i/51)+seed)%256;return b;}
const binaries=bytes=>zipEntries(Buffer.from(bytes)).filter(e=>e.name.startsWith('BinData/')).map(e=>[e.name,sha(e.read())]);
const layout=doc=>Array.from({length:doc.pageCount()},(_,p)=>[doc.getPageTextLayout(p),doc.getPageControlLayout(p)]);
const ok=value=>assert.equal(JSON.parse(value).ok,true);
test('repeated binary exports survive cell movement, asset replacement, Undo and reopen',{skip},async()=>{
 const core=await loadCore(),fixture=cellPictureFloorFixture(core,{nested:true}),doc=new core.HwpDocument(fixture.bytes),a=bitmap(0),b=bitmap(1);
 let snapshot;
 try{
  ok(doc.assignPictureImage(...fixture.args,a,64,32,'bmp'));
  const original=doc.exportHwpx(),before=layout(doc),assets=binaries(original);assert.ok(assets.some(([,hash])=>hash===sha(a)));
  for(let i=0;i<3;i++)assert.equal(sha(doc.exportHwpx()),sha(original),'Warm cache must preserve complete deterministic ZIP bytes');
  snapshot=doc.saveSnapshot();ok(doc.setCellPicturePropertiesByPath(...fixture.args,JSON.stringify({vertOffset:4500})));
  const moved=doc.exportHwpx();assert.notEqual(sha(moved),sha(original));assert.deepEqual(binaries(moved),assets,'Geometry edits preserve every binary asset');
  ok(doc.assignPictureImage(...fixture.args,b,64,32,'bmp'));const replaced=doc.exportHwpx();assert.ok(binaries(replaced).some(([,hash])=>hash===sha(b)),'A changed payload must not use an old compressed entry');
  const reopened=new core.HwpDocument(replaced);try{assert.deepEqual(binaries(reopened.exportHwpx()),binaries(replaced));assert.deepEqual(layout(reopened),layout(doc));}finally{reopened.free();}
  doc.restoreSnapshot(snapshot);assert.equal(sha(doc.exportHwpx()),sha(original));assert.deepEqual(layout(doc),before);
 }finally{if(snapshot!==undefined)doc.discardSnapshot(snapshot);doc.free();}
});
test('different documents with the same binary name retain their own bytes',{skip},async()=>{
 const core=await loadCore(),fixture=cellPictureFloorFixture(core),a=bitmap(3),b=bitmap(4),docs=[new core.HwpDocument(fixture.bytes),new core.HwpDocument(fixture.bytes)];
 try{
  for(const [index,doc]of docs.entries())ok(doc.assignPictureImage(...fixture.args,index?a:b,64,32,'bmp'));
  const expected=docs.map(d=>binaries(d.exportHwpx()));assert.notDeepEqual(expected[0],expected[1]);
  for(let i=0;i<4;i++)for(const [index,doc]of docs.entries())assert.deepEqual(binaries(doc.exportHwpx()),expected[index]);
 }finally{docs.forEach(d=>d.free());}
});
