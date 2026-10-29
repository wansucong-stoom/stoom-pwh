// A locally supplied reference only; no user document or content is committed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

if(!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM||!process.env.PWH_LETTER_HWP)throw Error('Set core paths and PWH_LETTER_HWP to a local reference document');
const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
const sourceBytes=await fs.readFile(process.env.PWH_LETTER_HWP),document=new core.HwpDocument(sourceBytes);
const text=doc=>JSON.parse(doc.getScanItems()).map(item=>item.text||'').join('');
function verify(doc){
 const runs=JSON.parse(doc.getPageTextLayout(0)).runs.filter(run=>run.w>0&&run.h>0);
 const table=runs.filter(run=>run.cellPath?.length),body=runs.filter(run=>!run.cellPath?.length&&run.paraIdx===1);
 assert.ok(table.length&&body.length,'reference must expose table and following body text');
 const overlap=(a,b)=>Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>2&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>2;
 let count=0;for(const a of table)for(const b of body)if(overlap(a,b))count++;
 assert.equal(count,0,'following body text overlaps the anchored table');
 return {pageCount:doc.pageCount(),tableRuns:table.length,bodyRuns:body.length,crossOverlaps:count};
}
try{
 const original=text(document),hwp=verify(document),hwpxBytes=document.exportHwpx(),reopened=new core.HwpDocument(hwpxBytes);
 try{const hwpx=verify(reopened);assert.equal(text(reopened),original,'HWPX roundtrip changed text');console.log(JSON.stringify({hwp,hwpx,textPreserved:true}));}finally{reopened.free();}
}finally{document.free();}
