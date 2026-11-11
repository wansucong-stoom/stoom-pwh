import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {inlineShapeSpacingFixture} from './helpers/inline-shape-spacing-fixture.mjs';

test('an original inline shape row retains the trailing spacing witnessed by the following row',{
 skip:!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM?'Set PWH_CORE_JS and PWH_CORE_WASM':false,
},async()=>{
 const c=await import(pathToFileURL(process.env.PWH_CORE_JS));await c.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 for(const [height,spacing]of [[2000,400],[3000,900],[4200,1200]]){
  const docs=[height,height+spacing].map(advance=>new c.HwpDocument(inlineShapeSpacingFixture(c.HwpDocument,{height,spacing,advance})));
  const title=d=>JSON.parse(d.getPageTextLayout(0)).runs.find(r=>r.text==='FOLLOWING_TITLE');
  try{
   assert.ok(title(docs[0])&&title(docs[1]));assert.ok(Math.abs(title(docs[1]).y-title(docs[0]).y-spacing*96/7200)<.2,'saved source row gap advances the next owner exactly once');
   for(const d of docs){const reopened=new c.HwpDocument(d.exportHwpx());try{assert.equal(reopened.pageCount(),d.pageCount());assert.ok(Math.abs(title(reopened).y-title(d).y)<.2);}finally{reopened.free();}}
  }finally{docs.forEach(d=>d.free());}
 }
});
