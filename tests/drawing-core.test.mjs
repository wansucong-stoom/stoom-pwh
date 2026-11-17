import test from 'node:test';import assert from 'node:assert/strict';
import {loadCore} from './engine-source-ownership/shape-transparency-fixture.mjs';
import {drawingTools,connectorTools} from '../src/drawing-tools.mjs';
import {tableResizeGridFixture,resizeGridOwner} from './engine-source-ownership/table-resize-grid-fixture.mjs';
const skip=!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM?'Requires actual core paths':false;
const ok=value=>{const result=JSON.parse(value);assert.equal(result.ok,true);return result;};
const svg=doc=>Array.from({length:doc.pageCount()},(_,p)=>doc.renderPageSvgWithProfile(p,'print'));
const params=type=>({sectionIdx:0,paraIdx:0,charOffset:0,shapeType:type,width:9000,height:6000,horzOffset:7200,vertOffset:13000,treatAsChar:false,textWrap:'InFrontOfText',polygonPoints:[{x:0,y:0},{x:9000,y:2500},{x:4000,y:6000}]});
for(const {type}of [...drawingTools,...connectorTools])test(`drawing creation, serialization and exact snapshot restoration: ${type}`,{skip},async()=>{
 const core=await loadCore(),doc=core.HwpDocument.createEmpty();doc.createBlankDocument();
 const before=svg(doc),snapshot=doc.saveSnapshot();
 try{
  const result=ok(doc.createShapeControl(JSON.stringify(params(type))));
  const properties=()=>JSON.parse(doc.getShapeProperties(0,result.paraIdx,result.controlIdx));
  assert.equal(properties().width,9000);assert.equal(properties().height,6000);
  if(type==='textbox')assert.ok(properties().tbMarginLeft!==undefined);
  if(type.startsWith('connector-')){
   assert.equal(properties().connectorType,connectorTools.findIndex(t=>t.type===type));
   assert.equal(properties().arrowStart,type.endsWith('-both')?1:0);
   assert.equal(properties().arrowEnd,type.endsWith('-both')||type.endsWith('-arrow')?1:0);
  }
  assert.notDeepEqual(svg(doc),before);
  for(const exportMethod of ['exportHwpx','exportHwp']){
   const reopened=new core.HwpDocument(doc[exportMethod]());
   try{
    const actual=JSON.parse(reopened.getShapeProperties(0,result.paraIdx,result.controlIdx));
    for(const key of ['width','height','connectorType','arrowStart','arrowEnd','arrowStartSize','arrowEndSize'])assert.equal(actual[key],properties()[key],`${exportMethod}: ${key}`);
   }finally{reopened.free();}
  }
  doc.restoreSnapshot(snapshot);assert.deepEqual(svg(doc),before);
 }finally{doc.discardSnapshot(snapshot);doc.free();}
});
test('moving and resizing a connected shape updates endpoints and restores them with the same snapshot',{skip},async()=>{
 const core=await loadCore(),doc=core.HwpDocument.createEmpty();doc.createBlankDocument();doc.insertParagraph(0,1);doc.insertParagraph(0,2);
 const make=(para,x,y,type='rectangle',extra={})=>ok(doc.createShapeControl(JSON.stringify({...params(type),paraIdx:para,width:7500,height:7500,horzOffset:x,vertOffset:y,...extra})));
 const props=ref=>JSON.parse(doc.getShapeProperties(0,ref.paraIdx,ref.controlIdx));
 let snapshot;
 try{
  const a=make(1,7500,7500),b=make(2,30000,22500);
  const c=make(0,15000,11250,'connector-straight-arrow',{width:15000,height:15000,startSubjectID:props(a).scInstId,startSubjectIndex:1,endSubjectID:props(b).scInstId,endSubjectIndex:3});
  const before=props(c),rendered=svg(doc);snapshot=doc.saveSnapshot();
  ok(doc.setShapeProperties(0,a.paraIdx,a.controlIdx,JSON.stringify({horzOffset:15000,width:10000})));
  const after=props(c);assert.notEqual(after.horzOffset,before.horzOffset);assert.notEqual(after.width,before.width);
  assert.equal(after.horzOffset,25000);assert.equal(after.width,5000);
  doc.restoreSnapshot(snapshot);assert.deepEqual(props(c),before);assert.deepEqual(svg(doc),rendered);
 }finally{if(snapshot!==undefined)doc.discardSnapshot(snapshot);doc.free();}
});
for(const route of ['straight','stroke','arc'])test(`connector line properties survive rendering and HWPX/HWP reopening: ${route}`,{skip},async()=>{
 const core=await loadCore(),doc=core.HwpDocument.createEmpty();doc.createBlankDocument();
 try{
  const ref=ok(doc.createShapeControl(JSON.stringify(params('connector-'+route+'-arrow'))));
  const edits={borderColor:0x2244bb,borderWidth:142,lineType:3,lineEndShape:1,arrowStart:3,arrowEnd:4,arrowStartSize:8,arrowEndSize:1};
  ok(doc.setShapeProperties(0,ref.paraIdx,ref.controlIdx,JSON.stringify(edits)));
  const rendered=svg(doc);
  for(const method of ['exportHwpx','exportHwp']){
   const reopened=new core.HwpDocument(doc[method]());
   try{
    const actual=JSON.parse(reopened.getShapeProperties(0,ref.paraIdx,ref.controlIdx));
    for(const [key,value]of Object.entries(edits))assert.equal(actual[key],value,`${method}: ${key}`);
    assert.deepEqual(svg(reopened),rendered,`${method}: selected arrows, widths and colors are visible`);
   }finally{reopened.free();}
  }
  ok(doc.setShapeProperties(0,ref.paraIdx,ref.controlIdx,JSON.stringify({arrowStart:0,arrowEnd:0})));
  const props=JSON.parse(doc.getShapeProperties(0,ref.paraIdx,ref.controlIdx));assert.equal(props.arrowStart,0);assert.equal(props.arrowEnd,0);assert.equal(props.connectorType%3,0);
  assert.notDeepEqual(svg(doc),rendered);
 }finally{doc.free();}
});
for(const nested of [false,true])for(const type of ['rectangle','textbox','curve','connector-stroke-arrow'])test(`cell drawing insertion owns the exact paragraph: nested=${nested}, ${type}`,{skip},async()=>{
 const core=await loadCore(),doc=new core.HwpDocument(tableResizeGridFixture({nested})),owner=resizeGridOwner(doc),path=JSON.parse(owner[2]),snapshot=doc.saveSnapshot(),before=svg(doc),text=doc.getScanItems();
 const tableCount=JSON.parse(doc.getControls()).filter(c=>c.ctrlId==='tbl').length;
 try{
  const p={...params(type),sectionIdx:owner[0],paraIdx:owner[1],parentParaIdx:owner[1],cellPath:path,horzOffset:500,vertOffset:1000};
  const ref=ok(doc.createShapeControl(JSON.stringify(p)));
  const props=JSON.parse(doc.getCellShapePropertiesByPath(...owner,ref.controlIdx));assert.equal(props.width,9000);assert.equal(props.height,6000);
  const control=Array.from({length:doc.pageCount()},(_,p)=>JSON.parse(doc.getPageControlLayout(p)).controls).flat().find(c=>c.controlIdx===ref.controlIdx&&['shape','line'].includes(c.type)&&c.cellPath?.length===path.length&&c.cellPath.every((entry,n)=>['controlIndex','cellIndex','cellParaIndex'].every(key=>entry[key]===path[n][key])));
  assert.ok(control,'control layout preserves the full source cell path');assert.equal(control.paraIdx,owner[1]);
  assert.equal(JSON.parse(doc.getControls()).filter(c=>c.ctrlId==='tbl').length,tableCount);
  const reopened=new core.HwpDocument(doc.exportHwpx());
  try{assert.equal(JSON.parse(reopened.getCellShapePropertiesByPath(...resizeGridOwner(reopened),ref.controlIdx)).width,9000);}finally{reopened.free();}
  doc.restoreSnapshot(snapshot);assert.deepEqual(svg(doc),before);assert.equal(doc.getScanItems(),text);
 }finally{doc.discardSnapshot(snapshot);doc.free();}
});
