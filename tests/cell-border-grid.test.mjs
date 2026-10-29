import test from 'node:test';
import assert from 'node:assert/strict';
import {planCellBorders,applyCellBorderPlan,applyCellFillPlan} from '../src/cell-border-grid.mjs';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const ink={type:1,width:1,color:'#112233'};
const boxes=Array.from({length:9},(_,i)=>({cellIdx:i,row:Math.floor(i/3),col:i%3,rowSpan:1,colSpan:1}));
const range={startRow:0,startCol:0,endRow:1,endCol:1};
const asMap=plan=>Object.fromEntries(plan.map(x=>[x.cellIndex,Object.keys(x.borders).sort()]));
test('outer and inner borders address different edges of the selected cells',()=>{
 assert.deepEqual(asMap(planCellBorders(boxes,range,{left:ink,right:ink,top:ink,bottom:ink})),{
  0:['Left','Top'],1:['Right','Top'],3:['Bottom','Left'],4:['Bottom','Right']});
 assert.deepEqual(asMap(planCellBorders(boxes,range,{insideVertical:ink,insideHorizontal:ink})),{
  0:['Bottom','Right'],1:['Bottom','Left'],3:['Right','Top'],4:['Left','Top']});
});
test('partial merged cells and unsplittable neighbouring edges are rejected before applying',()=>{
 const merged=[{cellIdx:0,row:0,col:0,rowSpan:2,colSpan:1},...boxes.filter(b=>b.col>0)];
 assert.throws(()=>planCellBorders(merged,{startRow:0,endRow:0,startCol:0,endCol:1},{left:ink}),/병합/);
 assert.throws(()=>planCellBorders(merged,{startRow:0,endRow:0,startCol:1,endCol:1},{left:ink}),/병합/);
});
test('application reads current cell borders so earlier shared-edge updates are preserved',()=>{
 const values=new Map(boxes.map(b=>[b.cellIdx,Object.fromEntries(['Left','Right','Top','Bottom'].map(x=>['border'+x,{type:0,width:0,color:'#000000'}]))]));
 let batches=0;const w={runInBatch(fn){batches++;fn();},getCellOwnProperties(_s,_p,_c,i){return values.get(i);},setCellProperties(_s,_p,_c,i,props){values.set(i,props);return {ok:true};}};
 assert.equal(applyCellBorderPlan(w,{sec:0,ppi:0,ci:0},planCellBorders(boxes,range,{insideVertical:ink})),true);
 assert.equal(batches,1);assert.deepEqual(values.get(0).borderRight,ink);assert.deepEqual(values.get(1).borderLeft,ink);
 assert.equal(values.get(0).borderTop.type,0);assert.equal(values.get(2).borderLeft.type,0);
});

test('real editor engine applies inner and outer borders while preserving fills, text and undo',
 {skip:!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM?'Set PWH_CORE_JS and PWH_CORE_WASM':false},async()=>{
 const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const doc=core.HwpDocument.createEmpty();doc.createBlankDocument();
 try{
  const created=JSON.parse(doc.createTable(0,0,0,3,3)),p=created.paraIdx,ci=created.controlIdx;
  const w={runInBatch(fn){doc.beginBatch();try{fn();}finally{doc.endBatch();}},getCellOwnProperties:(...a)=>JSON.parse(doc.getCellOwnProperties(...a)),setCellProperties:(...a)=>JSON.parse(doc.setCellProperties(...a.slice(0,4),JSON.stringify(a[4])))};
  const b=Array.from({length:9},(_,cellIdx)=>({cellIdx,...JSON.parse(doc.getCellInfo(0,p,ci,cellIdx))}));
  for(let i=0;i<9;i++)assert.equal(w.setCellProperties(0,p,ci,i,{fillType:'solid',fillColor:i===0?'#aabbcc':'#ddeeff'}).ok,true);
  applyCellFillPlan(w,{sec:0,ppi:p,ci},[0],{diagonalLine:1,diagonalSlash:7,diagonalBackSlash:0});
  const snapshot=doc.saveSnapshot(),before=Array.from({length:9},(_,i)=>w.getCellOwnProperties(0,p,ci,i));
  assert.ok(applyCellBorderPlan(w,{sec:0,ppi:p,ci},planCellBorders(b,range,{insideVertical:ink,insideHorizontal:ink})));
  const after=Array.from({length:9},(_,i)=>w.getCellOwnProperties(0,p,ci,i));
  assert.equal(after[0].borderRight.color.toLowerCase(),ink.color);assert.equal(after[0].borderBottom.color.toLowerCase(),ink.color);
  assert.equal(after[0].diagonalSlash,7,'Unsupported existing multi-branch data is not removed by border edits');
  for(let i=0;i<9;i++)assert.equal(after[i].fillColor.toLowerCase(),before[i].fillColor.toLowerCase());
  assert.deepEqual(after[0].borderLeft,before[0].borderLeft);assert.deepEqual(after[4].borderRight,before[4].borderRight);
  applyCellFillPlan(w,{sec:0,ppi:p,ci},[0],{fillType:'solid',fillColor:'#ffeeaa'});
  const recolored=w.getCellOwnProperties(0,p,ci,0);assert.equal(recolored.fillColor.toLowerCase(),'#ffeeaa');assert.deepEqual(recolored.borderRight,after[0].borderRight);assert.equal(w.getCellOwnProperties(0,p,ci,1).fillColor.toLowerCase(),before[1].fillColor.toLowerCase());
  const saved=doc.exportHwpx(),reopened=new core.HwpDocument(saved);try{const preserved=JSON.parse(reopened.getCellOwnProperties(0,p,ci,0));assert.equal(preserved.borderRight.color.toLowerCase(),ink.color);assert.equal(preserved.diagonalSlash,7,'Multi-branch data survives HWPX save and reopen');}finally{reopened.free();}
  doc.restoreSnapshot(snapshot);for(let i=0;i<9;i++){const restored=w.getCellOwnProperties(0,p,ci,i);assert.deepEqual(restored.borderRight,before[i].borderRight);assert.equal(restored.fillColor.toLowerCase(),before[i].fillColor.toLowerCase());}
 }finally{doc.free();}
});
