import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {insertStructuredTable} from '../release-source/src/table-content.mjs';
import {inspectTablePlan,resolveTablePlan} from '../release-source/src/table-style.mjs';
import {inspectDesktopTablePlan,resolveDesktopTablePlan} from './table-plan.mjs';

test('duplicate tables currently cause an ambiguous plan refusal', {skip:!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM},async()=>{
 const {default:init,HwpDocument}=await import(pathToFileURL(process.env.PWH_CORE_JS));await init({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const doc=HwpDocument.createEmpty();doc.createBlankDocument();
 try{const spec={rows:1,columns:1,cells:[{row:0,column:0,paragraphs:['동일']}]};insertStructuredTable(doc,{sectionIndex:0,paragraphIndex:0,charOffset:0},spec);doc.insertParagraph(0,1);insertStructuredTable(doc,{sectionIndex:0,paragraphIndex:1,charOffset:0},spec);const context={documentState:{documentEpoch:1}},plan=await inspectTablePlan(doc,context);assert.equal(plan.refs.length,2);assert.equal(plan.refs[0].sha256,plan.refs[1].sha256);await assert.rejects(resolveTablePlan(doc,plan,context,'document'),/ambiguous/);}finally{doc.free();}
});

test('desktop plan distinguishes duplicate tables and rejects a changed revision', {skip:!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM},async()=>{
 const {default:init,HwpDocument}=await import(pathToFileURL(process.env.PWH_CORE_JS));await init({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});const doc=HwpDocument.createEmpty();doc.createBlankDocument();
 try{const spec={rows:1,columns:1,cells:[{row:0,column:0,paragraphs:['동일']}]};insertStructuredTable(doc,{sectionIndex:0,paragraphIndex:0,charOffset:0},spec);doc.insertParagraph(0,1);insertStructuredTable(doc,{sectionIndex:0,paragraphIndex:1,charOffset:0},spec);const context={documentState:{documentEpoch:1,changeSeq:2,documentSha256:'test'}};const plan=await inspectDesktopTablePlan(doc,context);const all=await resolveDesktopTablePlan(doc,plan,context,'document');assert.equal(all.length,2);assert.notEqual(all[0].ppi,all[1].ppi);const single=await resolveDesktopTablePlan(doc,plan,context,'table',1);assert.equal(single[0].ppi,all[1].ppi);await assert.rejects(resolveDesktopTablePlan(doc,plan,{documentState:{...context.documentState,changeSeq:3}},'document'),/changed/);}
 finally{doc.free();}
});
