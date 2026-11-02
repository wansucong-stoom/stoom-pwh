import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {declaredNestedFixture} from './engine-source-ownership/declared-nested-fixture.mjs';
import {zipEntries} from '../scripts/setup.mjs';

const skip=!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM?'Requires explicit candidate core paths':false;
async function loadCore(){
 const core=await import(pathToFileURL(process.env.PWH_CORE_JS));
 await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});return core;
}
const markers=['HEADER','A','B',...Array.from({length:7},(_,i)=>'FIRST_'+i),...Array.from({length:5},(_,i)=>'SECOND_'+i),...Array.from({length:4},(_,i)=>'INNER_'+i),'TAIL_MARKER'];
const scan=doc=>JSON.parse(doc.getScanItems()).map(item=>(item.text||'').replace(/\r?\n$/,'')).filter(text=>text.length>0);
const layouts=doc=>Array.from({length:doc.pageCount()},(_,page)=>JSON.parse(doc.getPageTextLayout(page)).runs);
function cellSizes(bytes){
 const xml=zipEntries(Buffer.from(bytes)).find(entry=>entry.name==='Contents/section0.xml').read().toString('utf8');
 return [...xml.matchAll(/<hp:cellSz\b[^>]*>/g)].map(match=>match[0]);
}
function assertOwners(doc,pageHeight=320){
 const pages=layouts(doc),runs=pages.flat();
 for(const marker of markers)assert.equal(runs.filter(run=>run.text===marker).length,1,marker+' must have one rendered owner');
 for(const runs of pages)for(const run of runs){
  assert.ok(run.y>=-.1&&run.y+run.h<=pageHeight+.1,'owned synthetic text must fit the physical page');
 }
 return pages;
}
test('a declared-height nested row uses remaining space and continues by child source cuts',{skip},async()=>{
 const core=await loadCore(),bytes=declaredNestedFixture(),doc=new core.HwpDocument(bytes);
 try{
  assert.equal(doc.pageCount(),2);
  const pages=assertOwners(doc);
  assert.ok(pages[0].some(run=>run.text==='SECOND_0'),'a splittable row must not be moved whole to the next page');
  assert.ok(pages[1].some(run=>run.text==='INNER_3'));
  const child=pages.flat().find(run=>run.text==='INNER_3');assert.equal(child.cellPath.length,3);
  assert.equal(doc.getTextInCellByPath(child.secIdx,child.parentParaIdx,JSON.stringify(child.cellPath),child.charStart,child.text.length),child.text);
  const saved=doc.exportHwpx();assert.deepEqual(cellSizes(saved),cellSizes(bytes),'pagination must not rewrite declared cell sizes');
  const reopened=new core.HwpDocument(saved);
  try{assert.deepEqual(scan(reopened),scan(doc));assert.equal(reopened.pageCount(),doc.pageCount());assertOwners(reopened);}finally{reopened.free();}
  const snapshot=doc.saveSnapshot(),before=scan(doc);
  doc.insertTextInCellByPath(child.secIdx,child.parentParaIdx,JSON.stringify(child.cellPath),child.charStart,'EDIT_');
  assert.notDeepEqual(scan(doc),before);assert.ok(layouts(doc).flat().some(run=>run.text.includes('EDIT_')));
  doc.restoreSnapshot(snapshot);assert.deepEqual(scan(doc),before);assertOwners(doc);doc.discardSnapshot(snapshot);
 }finally{doc.free();}
});

test('a multi-frame declared row does not charge saved page void as content a second time',{skip},async()=>{
 const core=await loadCore();
 for(const declaredSecondHeight of [40000,70000]){
  const bytes=declaredNestedFixture({declaredSecondHeight}),doc=new core.HwpDocument(bytes);
  try{
   assert.equal(doc.pageCount(),2,'stored frame void must not create additional pages');
   const pages=assertOwners(doc);
   assert.ok(pages[0].some(run=>run.text==='SECOND_0'),'the next row must use available page space');
   const saved=doc.exportHwpx();assert.deepEqual(cellSizes(saved),cellSizes(bytes));
   const reopened=new core.HwpDocument(saved);
   try{assert.equal(reopened.pageCount(),2);assert.deepEqual(scan(reopened),scan(doc));assertOwners(reopened);}finally{reopened.free();}
  }finally{doc.free();}
 }
});

test('CELL rows without a saved page reset still split by remaining capacity',{skip},async()=>{
 const core=await loadCore(),doc=new core.HwpDocument(declaredNestedFixture({savedFrame:false}));
 try{
  assert.equal(doc.pageCount(),2);const pages=assertOwners(doc);
  assert.ok(pages[0].some(run=>run.text==='SECOND_0'),'CELL is splittable without inventing a saved physical frame boundary');
 }finally{doc.free();}
 const roomy=new core.HwpDocument(declaredNestedFixture({savedFrame:false,pageHeight:64000}));
 try{assert.equal(roomy.pageCount(),1,'capacity projection must not force a stored page break');assertOwners(roomy,64000/75);}finally{roomy.free();}
});

test('a complete saved inline table moves as one object line instead of splitting its first rows',{skip},async()=>{
 const core=await loadCore(),doc=new core.HwpDocument(declaredNestedFixture({inlineInner:true,objectFirst:true,pageHeight:22000}));
 try{
  const pages=assertOwners(doc,22000/75);
  assert.ok(pages[0].some(run=>run.text==='SECOND_0'));
  const owners=pages.flatMap((runs,page)=>runs.filter(run=>/^INNER_\d$/.test(run.text)).map(()=>page));
  assert.equal(owners.length,4);assert.equal(new Set(owners).size,1,'one saved object line must have one page owner');
  assert.ok(owners[0]>0,'an inline object that cannot fit must continue on the next page');
 }finally{doc.free();}
});

test('an incomplete saved inline line cannot suppress the child continuation ledger',{skip},async()=>{
 const core=await loadCore(),doc=new core.HwpDocument(declaredNestedFixture({inlineInner:true,objectFirst:true,innerFrame:1100,innerRows:20,pageHeight:22000}));
 try{
  const pages=assertOwners(doc,22000/75);
  const owners=pages.flatMap((runs,page)=>runs.filter(run=>/^INNER_\d+$/.test(run.text)).map(()=>page));
  assert.equal(owners.length,20);assert.ok(new Set(owners).size>1,'a partial placeholder line must preserve recursive child cuts');
 }finally{doc.free();}
});
