import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {zipEntries} from '../scripts/setup.mjs';
import {mapHwpxMember} from './engine-source-ownership/hwpx-fixture-utils.mjs';

const skip=!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM?'Requires explicit candidate core paths':false;
const seed=await fs.readFile(new URL('./fixtures/rowbreak-table/synthetic-rowbreak-single-line-control.hwpx',import.meta.url));
const member=(bytes,name)=>zipEntries(Buffer.from(bytes)).find(e=>e.name===name).read().toString('utf8');
const line=(vpos,width=30000)=>`<hp:linesegarray><hp:lineseg textpos="0" vertpos="${vpos}" vertsize="1100" textheight="1100" baseline="935" spacing="500" horzpos="0" horzsize="${width}" flags="393216"/></hp:linesegarray>`;
const para=(id,text,extra='',pr=0,lines='')=>`<hp:p id="${id}" paraPrIDRef="${pr}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${extra}<hp:t>${text}</hp:t></hp:run>${lines}</hp:p>`;
function fixture({closed=true,marker=null,idRef=0}={}) {
 let bytes=mapHwpxMember(seed,'Contents/header.xml',xml=>{
  const pr=/<hh:paraPr\b[\s\S]*?<\/hh:paraPr>/.exec(xml)[0];
  const next=pr.replace('id="0"','id="1"').replace('<hh:prev value="0"','<hh:prev value="2000"');
  xml=xml.replace('</hh:paraProperties>',next+'</hh:paraProperties>').replace('<hh:paraProperties itemCnt="1"','<hh:paraProperties itemCnt="2"');
  if(marker!==null){
   xml=xml.replace(pr,pr.replace('</hh:paraPr>',`<hh:heading type="${marker}" idRef="${idRef}" level="0"/></hh:paraPr>`));
   xml=xml.replace('</hh:refList>','<hh:bullets itemCnt="1"><hh:bullet id="1" char="◆" useImg="0"><hh:paraHead align="LEFT" useInstWidth="0" autoIndent="0" widthAdjust="0" textOffsetType="PERCENT" textOffset="50" charPrIDRef="0"/></hh:bullet></hh:bullets></hh:refList>');
  }
  return xml;
 });
 return mapHwpxMember(bytes,'Contents/section0.xml',xml=>{
  const sec='<hp:secPr id="0"><hp:pagePr width="30000" height="30000" landscape="WIDELY"><hp:margin left="0" right="0" top="0" bottom="0" header="0" footer="0" gutter="0"/></hp:pagePr></hp:secPr>';
  let body;
  if(marker!==null)body=para(0,'ITEM',sec,0,line(0));
  else{
   const table='<hp:tbl id="1" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" pageBreak="CELL" rowCnt="1" colCnt="1" cellSpacing="0" borderFillIDRef="1"><hp:sz width="15000" height="6000" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE"/><hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="100" right="100" top="100" bottom="100"/><hp:inMargin left="0" right="0" top="0" bottom="0"/><hp:tr><hp:tc hasMargin="1" borderFillIDRef="1"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP">'+para(0,'CELL')+'</hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="15000" height="6000"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/></hp:tc></hp:tr></hp:tbl>';
   body=para(0,'BEFORE',sec,0,line(0))+para(1,'',table,0,line(2000,0))+para(2,'AFTER','',1,line(closed?8200:9000));
  }
  return xml.replace(/(<hs:sec\b[^>]*>)[\s\S]*<\/hs:sec>/,'$1'+body+'</hs:sec>');
 });
}
async function loadCore(){const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});return core;}
function* walk(node){yield node;for(const child of node.children||[])yield*walk(child);if(node.child)yield*walk(node.child);}
function geometry(doc){const nodes=[...walk(JSON.parse(doc.getPageLayerTree(0)).root)];return {table:nodes.find(n=>n.groupKind?.kind==='table'),after:nodes.find(n=>n.groupKind?.kind==='textLine'&&[...walk(n)].flatMap(c=>c.ops||[]).some(op=>op.text==='AFTER'))};}
test('a closed stored float frame does not add the successor leading band twice',{skip},async()=>{
 const core=await loadCore(),doc=new core.HwpDocument(fixture());
 try{
  const {table,after}=geometry(doc);assert.ok(table&&after,'Synthetic table and successor must be painted');
  assert.ok(Math.abs(table.bounds.height-80)<.05,'Declared and measured table heights must agree');
  assert.ok(Math.abs(table.bounds.y-28)<.05,'Top margin belongs to the complete object box');
  assert.ok(Math.abs(after.bounds.y-8200/75)<.05,`Successor origin drifted: ${after.bounds.y}`);
  const saved=doc.exportHwpx(),reopened=new core.HwpDocument(saved);
  try{assert.equal(JSON.parse(reopened.getScanItems()).map(x=>x.text).join(''),JSON.parse(doc.getScanItems()).map(x=>x.text).join(''));assert.equal(reopened.pageCount(),doc.pageCount());}finally{reopened.free();}
 }finally{doc.free();}
});
test('a non-closing source ladder does not authorize the closed-frame origin',{skip},async()=>{
 const core=await loadCore(),doc=new core.HwpDocument(fixture({closed:false}));
 try{const {table,after}=geometry(doc);assert.ok(table&&after);assert.ok(after.bounds.y>=table.bounds.y+table.bounds.height,'Fallback must not overlap the object');assert.ok(Math.abs(after.bounds.y-8200/75)>.5,'A mismatched successor must not reuse the closed frame');}finally{doc.free();}
});
for(const [head,id,expected] of [['BULLET',0,'●'],['BULLET',1,'◆'],['BULLET',999,null],['NONE',0,null]])test(`heading ${head}/${id} retains its marker semantics`,{skip},async()=>{
 const core=await loadCore(),doc=new core.HwpDocument(fixture({marker:head,idRef:id}));
 try{const runs=JSON.parse(doc.getPageTextLayout(0)).runs,body=runs.find(r=>r.text==='ITEM'),markers=runs.filter(r=>r.text==='●'||r.text==='◆');assert.ok(body);assert.deepEqual(markers.map(r=>r.text),expected?[expected]:[]);if(expected){assert.ok(body.x>markers[0].x);assert.equal(body.fontSize,markers[0].fontSize);}assert.ok(member(doc.exportHwpx(),'Contents/section0.xml').includes('ITEM'));}finally{doc.free();}
});
