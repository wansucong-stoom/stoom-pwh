import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {mixedBlockFixture} from './engine-source-ownership/mixed-block-fixture.mjs';

const skip=!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM?'Requires explicit candidate core paths':false;
async function loadCore(){
 const core=await import(pathToFileURL(process.env.PWH_CORE_JS));
 await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});return core;
}
const scan=doc=>JSON.parse(doc.getScanItems()).map(item=>item.text||'').filter(text=>text.length>0);
const runs=doc=>Array.from({length:doc.pageCount()},(_,page)=>JSON.parse(doc.getPageTextLayout(page)).runs.map(run=>({...run,page})));
function owners(doc,hostText){
 const pages=runs(doc),lines=new Map(),markers=['PRELUDE',hostText,'CHILD_0','CHILD_1','CHILD_2','TAIL'];
 // Font fallback may emit an emoji as a separate run on the same source line.
 for(const run of pages.flat().filter(run=>run.text.length>0)){
  const key=JSON.stringify([run.page,run.secIdx,run.parentParaIdx,run.cellPath,run.y]);
  if(!lines.has(key))lines.set(key,[]);lines.get(key).push(run);
 }
 const all=[...lines.values()].map(parts=>{
  parts.sort((a,b)=>a.charStart-b.charStart);
  return {...parts[0],text:parts.map(run=>run.text).join(''),h:Math.max(...parts.map(run=>run.h))};
 });
 for(const text of markers)assert.equal(all.filter(run=>run.text===text).length,1,text+' must have exactly one rendered owner');
 return Object.fromEntries(markers.map(text=>[text,all.find(run=>run.text===text)]));
}
function before(a,b){
 assert.ok(a.page<b.page||(a.page===b.page&&a.y+a.h<=b.y+1.5),`${a.text} must precede ${b.text} without an overlapping line`);
}

for(const tableFirst of [true,false])for(const hostText of ['HOST_TEXT','HOST_😀']){
 test(`mixed block flow keeps ${tableFirst?'table then text':'text then table'} in source order (${hostText})`,{skip},async()=>{
  const core=await loadCore(),bytes=mixedBlockFixture({tableFirst,hostText}),doc=new core.HwpDocument(bytes);
  try{
   assert.equal(doc.pageCount(),1,'a following saved text position must not count the table twice');
   const own=owners(doc,hostText);
   if(tableFirst){before(own.PRELUDE,own.CHILD_0);before(own.CHILD_2,own[hostText]);before(own[hostText],own.TAIL);}
   else{before(own.PRELUDE,own[hostText]);before(own[hostText],own.CHILD_0);before(own.CHILD_2,own.TAIL);}
   const saved=doc.exportHwpx(),reopened=new core.HwpDocument(saved);
   try{assert.equal(reopened.pageCount(),1);assert.deepEqual(scan(reopened),scan(doc));owners(reopened,hostText);}finally{reopened.free();}
  }finally{doc.free();}
 });
}

test('a split mixed paragraph gives child rows and its following text separate page owners',{skip},async()=>{
 const core=await loadCore(),doc=new core.HwpDocument(mixedBlockFixture({pageHeight:6000}));
 try{
  assert.equal(doc.pageCount(),2);const own=owners(doc,'HOST_TEXT');
  before(own.PRELUDE,own.CHILD_0);before(own.CHILD_2,own.HOST_TEXT);before(own.HOST_TEXT,own.TAIL);
  const snapshot=doc.saveSnapshot(),original=scan(doc),child=own.CHILD_2;
  doc.insertTextInCellByPath(child.secIdx,child.parentParaIdx,JSON.stringify(child.cellPath),child.charStart,'EDIT_');
  assert.notDeepEqual(scan(doc),original);assert.ok(runs(doc).flat().some(run=>run.text.includes('EDIT_')));
  doc.restoreSnapshot(snapshot);assert.deepEqual(scan(doc),original);owners(doc,'HOST_TEXT');doc.discardSnapshot(snapshot);
 }finally{doc.free();}
});
