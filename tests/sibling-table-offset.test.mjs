import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {siblingTableHostFixture} from './engine-source-ownership/sibling-table-fixture.mjs';
import {mapHwpxMember} from './engine-source-ownership/hwpx-fixture-utils.mjs';

const skip=process.env.PWH_CANDIDATE_CORE_TESTS!=='1'?'Set PWH_CANDIDATE_CORE_TESTS=1 to qualify the explicit r14 candidate':
 (!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM?'Requires PWH_CORE_JS and PWH_CORE_WASM candidate paths':false);
let promise;
async function load(){return promise??=(async()=>{const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});return core;})();}
function changeTable(xml,id,transform){const start=xml.indexOf(`<hp:tbl id="${id}"`),end=xml.indexOf('</hp:tbl>',start)+9;assert.ok(start>=0&&end>start);return xml.slice(0,start)+transform(xml.slice(start,end))+xml.slice(end);}
function variant({firstOffset=0,secondOffset=1800,shortFirst=false,shortSecond=false}={}){
 return mapHwpxMember(siblingTableHostFixture({placement:'before'}),'Contents/section0.xml',xml=>{
  xml=changeTable(xml,10,table=>{
   table=table.replace('vertOffset="0"',`vertOffset="${firstOffset}"`);
   if(shortFirst){const rows=table.match(/<hp:tr>[\s\S]*?<\/hp:tr>/g);table=table.replace('rowCnt="6"','rowCnt="1"').replace('height="10800"','height="1800"');for(const row of rows.slice(1))table=table.replace(row,'');}
   return table;
  });
  return changeTable(xml,20,table=>{
   table=table.replace('vertOffset="0"',`vertOffset="${secondOffset}"`);
   if(shortSecond){const rows=table.match(/<hp:tr>[\s\S]*?<\/hp:tr>/g);table=table.replace('rowCnt="6"','rowCnt="2"').replace('height="10800"','height="3600"');for(const row of rows.slice(2))table=table.replace(row,'');}
   return table;
  });
 });
}
function* walk(node){yield node;if(node.child)yield*walk(node.child);for(const child of node.children||[])yield*walk(child);}
function inspect(core,bytes){
 const doc=new core.HwpDocument(bytes);
 try{
  const pages=Array.from({length:doc.pageCount()},(_,page)=>({page,runs:JSON.parse(doc.getPageTextLayout(page)).runs,tree:JSON.parse(doc.getPageLayerTree(page))}));
  const state={pages:pages.length};
  for(const prefix of ['FIRST','SECOND']){
   const first=pages.find(page=>page.runs.some(run=>run.text===prefix+'_0'));assert.ok(first);
   const tables=[...walk(first.tree.root)].filter(node=>node.groupKind?.kind==='table'),run=first.runs.find(run=>run.text===prefix+'_0');
   const table=tables.find(node=>node.bounds.y<=run.y+.5&&node.bounds.y+node.bounds.height>=run.y+run.h-.5);assert.ok(table);
   state[prefix]={firstPage:first.page,top:table.bounds.y};
  }
  const secondPages=pages.filter(page=>page.runs.some(run=>run.text.startsWith('SECOND_')));
  state.secondContinuationTop=secondPages.length>1?[...walk(secondPages[1].tree.root)].find(node=>node.groupKind?.kind==='table')?.bounds.y:null;
  return state;
 }finally{doc.free();}
}
test('the first table retains its own paragraph offset',{skip},async()=>{
 const state=inspect(await load(),variant({firstOffset:1800}));assert.ok(Math.abs(state.FIRST.top-24)<.05);
});
test('a later sibling on a fresh page does not spend the same paragraph offset twice',{skip},async()=>{
 const state=inspect(await load(),variant());assert.ok(state.SECOND.firstPage>state.FIRST.firstPage);assert.ok(Math.abs(state.SECOND.top)<.05);
});
test('a later table on an occupied page retains its ordinary offset',{skip},async()=>{
 const state=inspect(await load(),variant({shortFirst:true,shortSecond:true}));assert.equal(state.SECOND.firstPage,state.FIRST.firstPage);assert.ok(Math.abs(state.SECOND.top-24)<.05);
});
test('continuation keeps its separate existing zero-offset rule',{skip},async()=>{
 const state=inspect(await load(),variant());assert.ok(Math.abs(state.secondContinuationTop??NaN)<.05);
});
