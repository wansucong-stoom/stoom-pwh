import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {storedBlockAnchorFixture} from './engine-source-ownership/stored-block-anchor-fixture.mjs';

const skip=!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM?'Requires explicit candidate core paths':false;
let loaded;
let reference;
function loadCore(){
 return loaded??=(async()=>{
  const core=await import(pathToFileURL(process.env.PWH_CORE_JS));
  await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
  return core;
 })();
}
function loadReference(){
 return reference??=(async()=>{
  const core=await import(pathToFileURL(process.env.PWH_FLOAT_FRAME_BASE_JS));
  await core.default({module_or_path:await fs.readFile(process.env.PWH_FLOAT_FRAME_BASE_WASM)});
  return core;
 })();
}
function owners(doc){
 const all=Array.from({length:doc.pageCount()},(_,page)=>JSON.parse(doc.getPageTextLayout(page)).runs.map(run=>({...run,page}))).flat();
 return Object.fromEntries(['PRELUDE','HOST_TEXT','CHILD_0','CHILD_1','CHILD_2','TAIL'].map(text=>{
  const matches=all.filter(run=>run.text===text||(text==='PRELUDE'&&run.text==='XPRELUDE'));
  assert.equal(matches.length,1,`${text} must have exactly one displayed owner`);
  return [text,matches[0]];
 }));
}
function before(a,b){
 assert.ok(a.page<b.page||(a.page===b.page&&a.y+a.h<=b.y+1.5),`${a.text} must precede ${b.text} without an overlapping line`);
}
function verify(doc){
 const own=owners(doc);
 before(own.PRELUDE,own.HOST_TEXT);
 before(own.HOST_TEXT,own.CHILD_0);
 before(own.CHILD_0,own.CHILD_1);
 before(own.CHILD_1,own.CHILD_2);
 before(own.CHILD_2,own.TAIL);
 return own;
}
for(const options of [{},{controlBefore:false},{pageHeight:6000},{pageHeight:7200},{offset:2200,pageHeight:6000},{pageHeight:3000},{editOther:true}]){
 test('stored block below its host keeps text order '+JSON.stringify(options),{skip},async()=>{
  const core=await loadCore(),doc=new core.HwpDocument(storedBlockAnchorFixture(options));
  try{
   const own=verify(doc),snapshot=doc.saveSnapshot();
   if(options.editOther){
    const run=own.PRELUDE;
    doc.insertTextInCellByPath(run.secIdx,run.parentParaIdx,JSON.stringify(run.cellPath),0,'X');
    verify(doc);
   }
   const reopened=new core.HwpDocument(doc.exportHwpx());
   try{verify(reopened);assert.equal(reopened.pageCount(),doc.pageCount());}finally{reopened.free();}
   doc.restoreSnapshot(snapshot);verify(doc);doc.discardSnapshot(snapshot);
  }finally{doc.free();}
 });
}
const fallbackSkip=skip||(!process.env.PWH_FLOAT_FRAME_BASE_JS||!process.env.PWH_FLOAT_FRAME_BASE_WASM?'Requires an explicit prior-core fallback baseline':false);
for(const options of [{openingHeight:1500,pageHeight:6000},{openingHeight:4800,pageHeight:6000},{offset:0,pageHeight:6000}]){
 test('an unproven opening frame preserves its prior order '+JSON.stringify(options),{skip:fallbackSkip},async()=>{
  const [core,priorCore]=await Promise.all([loadCore(),loadReference()]);
  const bytes=storedBlockAnchorFixture(options),doc=new core.HwpDocument(bytes),prior=new priorCore.HwpDocument(bytes);
  try{
   assert.equal(doc.pageCount(),prior.pageCount());
   for(let page=0;page<doc.pageCount();page++){
    assert.equal(doc.renderPageSvgWithProfile(page,'print'),prior.renderPageSvgWithProfile(page,'print'));
    assert.equal(doc.getPageTextLayout(page),prior.getPageTextLayout(page));
   }
   assert.equal(doc.getScanItems(),prior.getScanItems());
  }finally{doc.free();prior.free();}
 });
}
