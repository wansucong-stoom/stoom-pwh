import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrintPlan,parsePrintPages,selectedPrintPages} from '../src/print-plan.mjs';
import {createRequire} from 'node:module';
const {printOptions}=createRequire(import.meta.url)('../desktop/standalone-pwh/print-options.cjs');
const pages=Array.from({length:6},(_,i)=>({widthMm:210,heightMm:297,sectionIndex:i<3?0:1}));
test('print page ranges reject invalid input and retain original page numbers',()=>{
 assert.deepEqual(parsePrintPages('1, 3, 5-6, 3',6),[0,2,4,5]);
 for(const value of ['',0,'2-1','1-7','1,','<script>','-2','Infinity','2.5'])assert.throws(()=>parsePrintPages(value,6));
});
test('current, section, selection and relative print ranges use the editor context',()=>{
 const context={pages,currentPage:4,selectedPages:[5,3,5]};
 assert.deepEqual(selectedPrintPages('current',context),[4]);
 assert.deepEqual(selectedPrintPages('section',context),[3,4,5]);
 assert.deepEqual(selectedPrintPages('through',context),[0,1,2,3,4]);
 assert.deepEqual(selectedPrintPages('from',context),[4,5]);
 assert.deepEqual(selectedPrintPages('selected',context),[3,5]);
 assert.throws(()=>selectedPrintPages('selected',{pages}));
});
test('preview and print share centered paper, scaling, orientation and N-up geometry',()=>{
 const plan=createPrintPlan(pages,[0,2,5],{paper:'A4',orientation:'landscape',perSheet:2});
 assert.equal(plan.widthMm,297);assert.equal(plan.heightMm,210);assert.equal(plan.sheets.length,2);
 assert.deepEqual(plan.sheets.flatMap(s=>s.placements.map(p=>p.pageIndex)),[0,2,5]);
 for(const sheet of plan.sheets)for(const p of sheet.placements){assert.ok(p.leftMm>=0);assert.ok(p.topMm>=0);assert.ok(p.leftMm+p.widthMm*p.scale<=sheet.widthMm+.001);assert.ok(p.topMm+p.heightMm*p.scale<=sheet.heightMm+.001);}
 const actual=createPrintPlan(pages,[0],{paper:'A5',fit:'actual'});assert.equal(actual.sheets[0].placements[0].scale,1);assert.ok(actual.sheets[0].placements[0].leftMm<0);
 assert.throws(()=>createPrintPlan(pages,[6]));assert.throws(()=>createPrintPlan(pages,[0],{perSheet:3}));
});
test('native print accepts installed devices and whitelisted bounded per-job settings',()=>{
 const value={printer:'test',copies:2,collate:true,color:false,duplexMode:'longEdge',paper:{width:297000,height:210000},silent:false};
 const options=printOptions(value,[{name:'test'}]);assert.equal(options.silent,true);assert.equal(options.deviceName,'test');assert.equal(options.landscape,true);assert.deepEqual(options.pageSize,{width:210000,height:297000});assert.equal(options.pagesPerSheet,1);
 for(const change of [{printer:'unknown'},{copies:0},{copies:1.5},{copies:1000},{color:1},{duplexMode:'x'},{paper:{width:0,height:297000}}])assert.throws(()=>printOptions({...value,...change},[{name:'test'}]));
});
