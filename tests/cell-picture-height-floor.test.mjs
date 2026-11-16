import test from 'node:test';import assert from 'node:assert/strict';
import {loadCore} from './engine-source-ownership/shape-transparency-fixture.mjs';
import {cellPictureFloorFixture,sourceCellHeights} from './engine-source-ownership/cell-picture-floor-fixture.mjs';
const skip=!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM?'Requires actual core paths':false;
const ok=value=>assert.equal(JSON.parse(value).ok,true);
for(const nested of [false,true])test(`moving a picture retains cell whitespace and previous expansion: ${nested?'nested':'flat'}`,{skip},async()=>{
 const core=await loadCore(),fixture=cellPictureFloorFixture(core,{nested}),doc=new core.HwpDocument(fixture.bytes),[sec,para,path]=fixture.args;
 const own=target=>JSON.parse(target.getCellOwnPropertiesByPath(sec,para,path,fixture.cellIndex));
 const move=offset=>ok(doc.setCellPicturePropertiesByPath(...fixture.args,JSON.stringify({vertOffset:offset})));
 const before=sourceCellHeights(doc),original=own(doc),beforeId=doc.saveSnapshot();
 try{
  assert.equal(original.height,12000);
  move(1000);assert.equal(own(doc).height,12000,'moving up retains the authored blank area');assert.deepEqual(sourceCellHeights(doc),before);
  move(15000);const grown=own(doc).height;assert.ok(grown>=18200,'moving beyond the cell bottom expands the owning cell');
  move(1000);assert.equal(own(doc).height,grown,'moving back up retains the expanded blank area');
  assert.equal(own(doc).width,original.width);
  const reopened=new core.HwpDocument(doc.exportHwpx());try{assert.equal(own(reopened).height,grown,'the blank area survives save and reopen');}finally{reopened.free();}
  doc.restoreSnapshot(beforeId);assert.deepEqual(sourceCellHeights(doc),before,'Undo restores all authored cell sizes');
 }finally{doc.discardSnapshot(beforeId);doc.free();}
});
test('explicit cell resizing can reduce a retained picture cell height',{skip},async()=>{
 const core=await loadCore(),fixture=cellPictureFloorFixture(core),doc=new core.HwpDocument(fixture.bytes),[sec,para,path]=fixture.args;
 try{ok(doc.setCellPropertiesByPath(sec,para,path,fixture.cellIndex,JSON.stringify({height:7000})));assert.equal(JSON.parse(doc.getCellOwnPropertiesByPath(sec,para,path,fixture.cellIndex)).height,7000);}finally{doc.free();}
});
