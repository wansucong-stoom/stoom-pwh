import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {autoFillTableAccess} from '../src/auto-fill-table.mjs';
const enabled=!!process.env.PWH_CORE_JS&&!!process.env.PWH_CORE_WASM;
const ok=result=>{const value=JSON.parse(result);assert.equal(value.ok,true);return value;};
test('real table auto-fill keeps cell formats, fills all directions and survives undo/save/reopen',{skip:!enabled},async()=>{
 const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 for(const [indices,range] of [
  [[1,5],{startRow:0,endRow:3,startCol:1,endCol:1}],
  [[13,9],{startRow:0,endRow:3,startCol:1,endCol:1}],
  [[4,5],{startRow:1,endRow:1,startCol:0,endCol:3}],
  [[7,6],{startRow:1,endRow:1,startCol:0,endCol:3}],
 ]){
  let doc=core.HwpDocument.createEmpty();doc.createBlankDocument();
  try{
   const table=ok(doc.createTable(0,0,0,4,4));
   for(let i=0;i<indices.length;i++)ok(doc.insertTextInCell(0,table.paraIdx,table.controlIdx,indices[i],0,0,String(i+1)));
   const bytes=doc.exportHwpx();doc.free();doc=new core.HwpDocument(bytes);
   const position={sectionIndex:0,parentParaIndex:table.paraIdx,controlIndex:table.controlIdx,cellIndex:indices[0]};
   const anchor={row:Math.floor(indices[0]/4),col:indices[0]%4};
   const focus={row:anchor.row===range.startRow?range.endRow:range.startRow,col:anchor.col===range.startCol?range.endCol:range.startCol};
   const before=doc.saveSnapshot(),access=autoFillTableAccess(doc,position),plan=access.plan(range,{selection:{anchor,focus}}),prepared=access.prepare(plan);
   const styles=plan.edits.map(edit=>doc.getCellProperties(0,table.paraIdx,table.controlIdx,edit.cellIndex));
   access.apply(prepared);
   assert.deepEqual(plan.edits.map(edit=>access.read(edit.cellIndex).text),['3','4']);
   assert.deepEqual(plan.edits.map(edit=>doc.getCellProperties(0,table.paraIdx,table.controlIdx,edit.cellIndex)),styles);
   const reopen=new core.HwpDocument(doc.exportHwpx());
   try{const actual=autoFillTableAccess(reopen,position);for(const edit of plan.edits)assert.equal(actual.read(edit.cellIndex).text,edit.text);}
   finally{reopen.free();}
   doc.restoreSnapshot(before);doc.discardSnapshot(before);
   const restored=autoFillTableAccess(doc,position);for(const edit of plan.edits)assert.equal(restored.read(edit.cellIndex).text,'');
   for(let i=0;i<indices.length;i++)assert.equal(restored.read(indices[i]).text,String(i+1));
  }finally{doc.free();}
 }
});
test('nested auto-fill changes only the addressed inner cells',{skip:!enabled},async()=>{
 const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 let doc=core.HwpDocument.createEmpty();doc.createBlankDocument();
 try{
  const outer=ok(doc.createTable(0,0,0,2,2));ok(doc.insertTextInCell(0,0,outer.controlIdx,1,0,0,'outside'));
  ok(doc.insertParagraph(0,1));const inner=ok(doc.createTable(0,1,0,4,2));
  ok(doc.insertTextInCell(0,1,inner.controlIdx,1,0,0,'10'));ok(doc.insertTextInCell(0,1,inner.controlIdx,3,0,0,'20'));
  ok(doc.copyControl(0,1,'[]',inner.controlIdx));ok(doc.deleteTableControl(0,1,inner.controlIdx));ok(doc.pasteInternalInCell(0,0,outer.controlIdx,0,0,0));
  const bytes=doc.exportHwpx();doc.free();doc=new core.HwpDocument(bytes);
  const position={sectionIndex:0,parentParaIndex:0,controlIndex:outer.controlIdx,cellIndex:1,
   cellPath:[{controlIndex:outer.controlIdx,cellIndex:0,cellParaIndex:0},{controlIndex:0,cellIndex:1,cellParaIndex:0}]};
  const access=autoFillTableAccess(doc,position),plan=access.plan({startRow:0,endRow:3,startCol:1,endCol:1});
  access.apply(access.prepare(plan));
  assert.deepEqual(plan.edits.map(edit=>access.read(edit.cellIndex).text),['30','40']);
  assert.equal(doc.getTextInCell(0,0,outer.controlIdx,1,0,0,7),'outside');
  const reopened=new core.HwpDocument(doc.exportHwpx());
  try{assert.equal(autoFillTableAccess(reopened,position).read(7).text,'40');}finally{reopened.free();}
 }finally{doc.free();}
});
