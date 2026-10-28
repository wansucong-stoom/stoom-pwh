import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {pasteHtmlTableInCell} from '../../src/nested-table-paste.mjs';
import {visibleSvgText} from './visible-svg-text.mjs';

const js=process.argv[2]||process.env.PWH_CORE_JS,wasm=process.argv[3]||process.env.PWH_CORE_WASM;
if(!js||!wasm)throw Error('Usage: node synthetic-nested-regression.mjs <core.js> <core.wasm> (or set PWH_CORE_JS/PWH_CORE_WASM)');
if(!process.env.PWH_PLAYWRIGHT_MODULE)throw Error('Set PWH_PLAYWRIGHT_MODULE to the Playwright ESM entry URL.');
const core=await import(pathToFileURL(path.resolve(js)).href);await core.default({module_or_path:await fs.readFile(wasm)});
const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE);const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
const doc=core.HwpDocument.createEmpty();doc.createBlankDocument();
const scan=d=>JSON.parse(d.getScanItems()).map(x=>x.text||'').join('');
try{
 const table=JSON.parse(doc.createTable(0,0,0,90,3));const outer=[];
 for(let row=0;row<90;row++)for(let column=0;column<3;column++){const marker=`O${String(row).padStart(3,'0')}C${column}`;outer.push(marker);doc.insertTextInCell(0,table.paraIdx,table.controlIdx,row*3+column,0,0,marker);}
 const nested=Array.from({length:10},(_,row)=>({row,column:0,paragraphs:[`N${String(row).padStart(3,'0')}X`]}));
 const bridge=new Proxy(doc,{get(t,k){if(k==='copyControl')return(s,p,c,cellPath='')=>t.copyControl(s,p,cellPath,c);if(k==='insertPwhScratchParagraph')return t.insertParagraph.bind(t);if(k==='deletePwhScratchParagraph')return t.deleteParagraph.bind(t);const value=t[k];return typeof value==='function'?value.bind(t):value;}});
 const tableFirst=process.env.PWH_SYNTHETIC_TABLE_FIRST==='1';
 pasteHtmlTableInCell(bridge,{cursor:{sectionIndex:0,parentParaIndex:table.paraIdx,controlIndex:table.controlIdx,cellIndex:269,cellParaIndex:0,charOffset:tableFirst?0:6},kind:'cell_text',selection:null},`<table>${nested.map(c=>`<tr><td>${c.paragraphs[0]}</td></tr>`).join('')}</table>`,{rows:10,columns:1,cells:nested});
 const hostSpacing=process.env.PWH_SYNTHETIC_HOST_SPACING==='1';
 if(hostSpacing){
  // Public formatting API units are HWPUNIT: 100 HWPUNIT = 1 pt.
  doc.applyParaFormatInCell(0,table.paraIdx,table.controlIdx,269,0,JSON.stringify({spacingBefore:1200,spacingAfter:800}));
  const actual=JSON.parse(doc.getCellParaPropertiesAt(0,table.paraIdx,table.controlIdx,269,0));
  assert.ok(Math.abs(actual.spacingBefore-16)<0.1,'12 pt host spacingBefore was not applied');
  assert.ok(Math.abs(actual.spacingAfter-800/75)<0.1,'8 pt host spacingAfter was not applied');
 }
 // Leave ample room for the inner table. The product deliberately preserves
 // clipped content in an undersized cell, so an overflow-only case must not
 // masquerade as a loss-of-source regression.
 for(let column=0;column<3;column++)doc.setCellProperties(0,table.paraIdx,table.controlIdx,267+column,JSON.stringify({height:30000}));
 const bytes=doc.exportHwpx();if(process.env.PWH_ENGINE_FIXTURE_OUTPUT)await fs.writeFile(process.env.PWH_ENGINE_FIXTURE_OUTPUT,bytes);
 const source=scan(doc);for(const marker of [...outer,...nested.map(c=>c.paragraphs[0])])assert.equal(source.split(marker).length-1,1,'synthetic source construction failed');
 const exported=new core.HwpDocument(bytes);try{assert.equal(scan(exported),source,'export/reopen source text changed');if(hostSpacing){const actual=JSON.parse(exported.getCellParaPropertiesAt(0,table.paraIdx,table.controlIdx,269,0));assert.ok(Math.abs(actual.spacingBefore-16)<0.1,'export/reopen changed host spacingBefore');assert.ok(Math.abs(actual.spacingAfter-800/75)<0.1,'export/reopen changed host spacingAfter');}}finally{exported.free();}
 const pages=doc.pageCount(),page=await browser.newPage({viewport:{width:1300,height:1800}}),visible=[],layouts=[];let hidden=0,partial=0;
 for(let p=0;p<pages;p++){const result=await visibleSvgText(page,doc.renderPageSvg(p));assert.deepEqual(result.limitations,[],'oracle cannot evaluate this clip');visible.push(result.text.replace(/\s+/g,''));hidden+=result.hidden;partial+=result.partial;layouts.push(...JSON.parse(doc.getPageTextLayout(p)).runs);}
 const all=visible.join(''),markers=[...outer,...nested.map(c=>c.paragraphs[0])],failures=markers.map(marker=>({marker,count:all.split(marker).length-1})).filter(x=>x.count!==1);
 const hit=layouts.find(r=>/^N\d{3}X$/.test(r.text||''));assert.ok(hit,'all nested source runs missing');assert.equal(hit.cellPath.length,2,'nested cursor path was flattened');
 const pathJson=JSON.stringify(hit.cellPath),original=doc.getTextInCellByPath(hit.secIdx,hit.parentParaIdx,pathJson,hit.charStart,5);assert.equal(original,hit.text,'rendered cursor targets another source paragraph');
 const snapshot=doc.saveSnapshot();doc.insertTextInCellByPath(hit.secIdx,hit.parentParaIdx,pathJson,hit.charStart,'EDIT');assert.notEqual(scan(doc),source);doc.restoreSnapshot(snapshot);assert.equal(scan(doc),source,'snapshot restore failed');doc.discardSnapshot(snapshot);
 console.log(JSON.stringify({ok:failures.length===0,pages,tableFirst,hostSpacing,markers:280,uniqueVisibleOwners:failures.length===0,failures,nestedCursorSource:true,exportReopen:true,snapshotRestore:true,hiddenRuns:hidden,partiallyClippedRuns:partial}));
 assert.deepEqual(failures,[],'one or more synthetic source markers have no unique visible page owner');
}finally{doc.free();await browser.close();}
