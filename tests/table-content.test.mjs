import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {applyCellEdits,insertStructuredTable,validateTableSpec,validateCellEdits} from '../src/table-content.mjs';
import {tableSnapshot,inspectTablePlan,resolveTablePlan} from '../src/table-style.mjs';
import {editorPoll,editorTableFill,editorTableInsert,editorResult} from '../src/editor-session.mjs';

const spec={rows:3,columns:3,cells:[{row:0,column:0,columnSpan:3,paragraphs:['동물']},...['말','소','돼지','양','염소','토끼'].map((text,i)=>({row:1+Math.floor(i/3),column:i%3,paragraphs:[text]}))]};
test('structured import rejects overlapping, missing, oversized and unsafe cells before mutation',()=>{
 assert.equal(validateTableSpec(spec),spec);
 for(const s of [{...spec,cells:spec.cells.slice(1)},{...spec,cells:[...spec.cells,spec.cells[0]]},{...spec,rows:100,columns:100},{...spec,cells:[{row:0,column:0,rowSpan:3,columnSpan:3,paragraphs:['a\u0001']}]}])assert.throws(()=>validateTableSpec(s));
 assert.throws(()=>validateCellEdits([{cellIndex:1,paragraphs:['x']}],[0]));
 assert.throws(()=>validateCellEdits([{cellIndex:0,paragraphs:['x']},{cellIndex:0,paragraphs:['y']}]));
});
test('table tools require a capable editor, preserve payloads and acknowledge actual receipts',async()=>{
 const sessionId=randomUUID(),context={ready:true,kind:'body_text',cursor:{sectionIndex:0,paragraphIndex:0,charOffset:0},documentState:{documentEpoch:1,changeSeq:0},selection:null};
 editorPoll({sessionId,context});await assert.rejects(editorTableInsert({sessionId,expected:context,table:spec}),/updated/);
 editorPoll({sessionId,context,capabilities:{tableContent:true}});
 const table=structuredClone(spec),insert=await editorTableInsert({sessionId,expected:context,table});table.cells[0].paragraphs[0]='changed';
 const command=editorPoll({sessionId,context}).commands[0];assert.equal(command.type,'tableInsert');assert.equal(command.table.cells[0].paragraphs[0],'동물');assert.equal(editorResult(insert).status,'pending');
 editorPoll({sessionId,context,receipt:{ticketId:insert.ticketId,ok:true,undoSteps:1}});assert.equal(editorResult(insert).status,'applied');
 const fill=await editorTableFill({sessionId,expected:context,planId:'plan',tableIndex:0,edits:[{cellIndex:0,paragraphs:['새 제목']}]});assert.equal(editorPoll({sessionId,context}).commands[0].type,'tableFill');
 editorPoll({sessionId,context,receipt:{ticketId:fill.ticketId,ok:false,error:'changed'}});assert.equal(editorResult(fill).status,'rejected');
 await assert.rejects(editorTableFill({sessionId,expected:{...context,target:{kind:'table_cells',cells:[0]}},edits:[{cellIndex:1,paragraphs:['wrong']}]}),/unselected/);
 editorPoll({sessionId,context:{...context,cursor:{...context.cursor,charOffset:1}}});await assert.rejects(editorTableInsert({sessionId,expected:context,table:spec}),/cursor/);
});

test('real WASM imports merges, fills existing cells, preserves style, reopens, and restores snapshots',{
 skip:!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM?'Set explicit real WASM paths':false,
},async()=>{
 const {default:init,HwpDocument}=await import(pathToFileURL(process.env.PWH_CORE_JS));await init({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const doc=HwpDocument.createEmpty();doc.createBlankDocument();
 try{
  const before=doc.saveSnapshot(),result=insertStructuredTable(doc,{sectionIndex:0,paragraphIndex:0,charOffset:0},spec),ref=result.source;
  let snapshot=tableSnapshot(doc,ref.sec,ref.ppi,ref.ci);assert.equal(snapshot.cells.length,7);assert.equal(snapshot.cells[0].geometry.colSpan,3);assert.equal(snapshot.cells[1].paragraphs[0].text,'말');
  const inserted=doc.saveSnapshot();
  doc.restoreSnapshot(before);assert.equal(JSON.parse(doc.getControls()).filter(c=>c.ctrlId==='tbl').length,0);
  doc.restoreSnapshot(inserted);const baseline=tableSnapshot(doc,ref.sec,ref.ppi,ref.ci);
  const filled=applyCellEdits(doc,ref,[{cellIndex:0,paragraphs:['동물 목록']},{cellIndex:1,paragraphs:['얼룩말 🦓']}]);assert.equal(filled.structurePreserved,true);
  snapshot=tableSnapshot(doc,ref.sec,ref.ppi,ref.ci);assert.equal(snapshot.cells[1].paragraphs[0].text,'얼룩말 🦓');assert.deepEqual(snapshot.cells[2],baseline.cells[2]);assert.deepEqual(snapshot.cells[0].geometry,baseline.cells[0].geometry);
  const reopen=new HwpDocument(doc.exportHwpx());try{assert.equal(reopen.getTextInCell(ref.sec,ref.ppi,ref.ci,0,0,0,5),'동물 목록');}finally{reopen.free();}
  doc.restoreSnapshot(inserted);assert.deepEqual(tableSnapshot(doc,ref.sec,ref.ppi,ref.ci),baseline);
  const plan=await inspectTablePlan(doc,{documentState:{documentEpoch:1}});
  applyCellEdits(doc,ref,[{cellIndex:0,paragraphs:['사용자 변경']}]);await assert.rejects(resolveTablePlan(doc,plan,{documentState:{documentEpoch:1}},'table',0),/changed/);
  doc.restoreSnapshot(inserted);
  const bytes=doc.exportHwpx();assert.throws(()=>applyCellEdits(doc,ref,[{cellIndex:0,paragraphs:['would change']},{cellIndex:1,paragraphs:['one','two']}]),/paragraph count/);assert.deepEqual(doc.exportHwpx(),bytes);
  doc.applyCharFormatInCell(ref.sec,ref.ppi,ref.ci,0,0,0,1,JSON.stringify({bold:true}));assert.throws(()=>applyCellEdits(doc,ref,[{cellIndex:0,paragraphs:['mixed']}]),/mixed/);
  doc.restoreSnapshot(before);
  const multi=insertStructuredTable(doc,{sectionIndex:0,paragraphIndex:0,charOffset:0},{rows:2,columns:2,cells:[{row:0,column:0,rowSpan:2,paragraphs:['첫 문단','둘째 문단']},{row:0,column:1,paragraphs:['위']},{row:1,column:1,paragraphs:['아래']}]});
  const vertical=tableSnapshot(doc,multi.source.sec,multi.source.ppi,multi.source.ci);assert.equal(vertical.cells[0].geometry.rowSpan,2);assert.deepEqual(vertical.cells[0].paragraphs.map(p=>p.text),['첫 문단','둘째 문단']);
  doc.discardSnapshot(before);doc.discardSnapshot(inserted);
 }finally{doc.free();}
});
