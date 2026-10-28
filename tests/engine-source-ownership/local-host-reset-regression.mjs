import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {pasteHtmlTableInCell} from '../../src/nested-table-paste.mjs';
import {mapHwpxMember,setSyntheticHostVpos} from './hwpx-fixture-utils.mjs';
import {visibleSvgText} from './visible-svg-text.mjs';

const js=process.argv[2]||process.env.PWH_CORE_JS,wasm=process.argv[3]||process.env.PWH_CORE_WASM;
if(!js||!wasm)throw Error('Usage: node local-host-reset-regression.mjs <core.js> <core.wasm>');
const core=await import(pathToFileURL(path.resolve(js)).href);await core.default({module_or_path:await fs.readFile(wasm)});
const doc=core.HwpDocument.createEmpty();doc.createBlankDocument();let bytes;
const markers=['LOCAL_A','LOCAL_B','HOST_TAIL','INNER_0','INNER_1'];
try{
 const table=JSON.parse(doc.createTable(0,0,0,1,1));doc.insertTextInCell(0,table.paraIdx,table.controlIdx,0,0,0,'LOCAL_A');doc.splitParagraphInCell(0,table.paraIdx,table.controlIdx,0,0,7);doc.insertTextInCell(0,table.paraIdx,table.controlIdx,0,1,0,'LOCAL_B');doc.splitParagraphInCell(0,table.paraIdx,table.controlIdx,0,1,7);doc.insertTextInCell(0,table.paraIdx,table.controlIdx,0,2,0,'HOST_TAIL');
 const bridge=new Proxy(doc,{get(t,k){if(k==='copyControl')return(s,p,c,cellPath='')=>t.copyControl(s,p,cellPath,c);if(k==='insertPwhScratchParagraph')return t.insertParagraph.bind(t);if(k==='deletePwhScratchParagraph')return t.deleteParagraph.bind(t);const value=t[k];return typeof value==='function'?value.bind(t):value;}});
 const cells=[0,1].map(row=>({row,column:0,paragraphs:[`INNER_${row}`]}));pasteHtmlTableInCell(bridge,{cursor:{sectionIndex:0,parentParaIndex:table.paraIdx,controlIndex:table.controlIdx,cellIndex:0,cellParaIndex:2,charOffset:0},kind:'cell_text',selection:null},'<table><tr><td>INNER_0</td></tr><tr><td>INNER_1</td></tr></table>',{rows:2,columns:1,cells});
 doc.setCellProperties(0,table.paraIdx,table.controlIdx,0,JSON.stringify({height:30000}));bytes=doc.exportHwpx();
}finally{doc.free();}
bytes=mapHwpxMember(bytes,'Contents/section0.xml',xml=>{for(const[marker,vpos]of [['LOCAL_A',0],['LOCAL_B',1600],['HOST_TAIL',0]])xml=setSyntheticHostVpos(xml,marker,vpos);return xml;});
if(process.env.PWH_ENGINE_FIXTURE_OUTPUT)await fs.writeFile(process.env.PWH_ENGINE_FIXTURE_OUTPUT,bytes);
const input=new core.HwpDocument(bytes),{chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE),browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
try{
 const page=await browser.newPage({viewport:{width:1300,height:1800}}),pages=input.pageCount(),visible=[];for(let p=0;p<pages;p++){const result=await visibleSvgText(page,input.renderPageSvg(p));assert.deepEqual(result.limitations,[]);visible.push(result.text.replace(/\s+/g,''));}
 const text=visible.join(''),failures=markers.filter(marker=>text.split(marker).length-1!==1);assert.equal(pages,1,'local host vpos restart created a physical page');assert.deepEqual(failures,[],'local host reset lost or duplicated source content');console.log(JSON.stringify({ok:true,pages,localHostReset:true,markers:markers.length,uniqueVisibleOwners:true}));
}finally{input.free();await browser.close();}
