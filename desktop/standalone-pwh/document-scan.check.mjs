import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {pasteHtmlTableInCell} from '../release-source/src/nested-table-paste.mjs';
import {scanDocumentText} from './document-scan.mjs';

test('structure scan reads more than 64 tables and nested cell text', {skip:!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM,timeout:90000},async()=>{
 const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});const doc=core.HwpDocument.createEmpty();doc.createBlankDocument();
 try{const body=JSON.parse(doc.createTable(0,0,0,1,1));doc.insertTextInCell(0,body.paraIdx,body.controlIdx,0,0,0,'OUTER');const bridge=new Proxy(doc,{get(t,k){if(k==='copyControl')return (s,p,c,path='')=>t.copyControl(s,p,path,c);if(k==='insertPwhScratchParagraph')return t.insertParagraph.bind(t);if(k==='deletePwhScratchParagraph')return t.deleteParagraph.bind(t);const v=t[k];return typeof v==='function'?v.bind(t):v;}});const context={cursor:{sectionIndex:0,parentParaIndex:body.paraIdx,controlIndex:body.controlIdx,cellIndex:0,cellParaIndex:0,charOffset:5},kind:'cell_text',selection:null};pasteHtmlTableInCell(bridge,context,'<table><tr><td>NESTED-MARKER</td></tr></table>',{rows:1,columns:1,cells:[{row:0,column:0,paragraphs:['NESTED-MARKER']}]});
  for(let i=0;i<78;i++){const p=doc.getParagraphCount(0);doc.insertParagraph(0,p);const t=JSON.parse(doc.createTable(0,p,0,1,1));doc.insertTextInCell(0,t.paraIdx,t.controlIdx,0,0,0,'TABLE-'+String(i).padStart(3,'0'));}
  const reopened=new core.HwpDocument(doc.exportHwpx());try{const result=scanDocumentText(reopened),text=result.items.map(x=>x.text).join('');assert.equal(result.truncated,false);assert.match(text,/OUTER/);assert.match(text,/NESTED-MARKER/);assert.match(text,/TABLE-077/);}finally{reopened.free();}
 }finally{doc.free();}
});

test('scan reports truncation without breaking surrogate pairs',()=>{const result=scanDocumentText({getScanItems:()=>JSON.stringify([{state:2,text:'a😀b'}])},{maxCharacters:2,maxItems:5});assert.equal(result.truncated,true);assert.equal(result.items.map(x=>x.text).join(''),'a');});
