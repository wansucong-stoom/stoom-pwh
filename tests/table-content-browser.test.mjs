import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {setTimeout as pause} from 'node:timers/promises';
import {clientViewerHtml,registerClientDocument} from '../src/client-assets.mjs';
import {handleRequest} from '../src/server.mjs';
import {editorState,editorTables,editorTableFill,editorTableInsert,editorResult} from '../src/editor-session.mjs';

test('full editor imports and fills a merged table through MCP queue, renders, and undoes in one step',{
 skip:process.env.PWH_BROWSER_TESTS!=='1'?'Set PWH_BROWSER_TESTS and explicit WASM/Playwright paths':false,timeout:90000,
},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
 const {default:init,HwpDocument}=await import(pathToFileURL(process.env.PWH_CORE_JS));await init({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-table-browser-')),filename=path.join(temp,'synthetic.hwpx');
 const doc=HwpDocument.createEmpty();doc.createBlankDocument();await fs.writeFile(filename,doc.exportHwpx());doc.free();
 const registered=await registerClientDocument(filename),html=await clientViewerHtml();
 let sessionId;
 const server=createServer(async(req,res)=>{
  try{
   if(req.url==='/editor'){res.setHeader('Content-Type','text/html');res.end(html);return;}
   if(req.url==='/rpc'){
    let body='';for await(const part of req)body+=part;const request=JSON.parse(body);
    if(request.params?.name==='pwh_editor_poll')sessionId=request.params.arguments.sessionId;
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await handleRequest(request)));return;
   }
   res.setHeader('Content-Type','text/html');res.end(`<style>html,body,iframe{width:100%;height:100%;margin:0;border:0}</style><iframe src="/editor"></iframe><script>
   addEventListener('message',async e=>{const m=e.data;if(m?.jsonrpc!=='2.0')return;
    if(m.method==='ui/notifications/initialized'){e.source.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:${JSON.stringify(registered)}}},location.origin);return;}
    if(m.id===undefined)return;let r;
    if(m.method==='ui/initialize')r={jsonrpc:'2.0',id:m.id,result:{hostCapabilities:{}}};
    else r=await(await fetch('/rpc',{method:'POST',body:JSON.stringify(m)})).json();
    e.source.postMessage(r,location.origin);
   });</script>`);
  }catch(error){res.statusCode=500;res.end(String(error.stack));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,...(process.env.PWH_BROWSER_EXECUTABLE?{executablePath:process.env.PWH_BROWSER_EXECUTABLE}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1100,height:1000}});await page.goto(`http://127.0.0.1:${server.address().port}`);
  const frame=page.frames().find(f=>f.url().endsWith('/editor'));
  const wait=async(ticket)=>{for(let i=0;i<400;i++){const r=editorResult(ticket);if(r.status!=='pending'){assert.equal(r.status,'applied',JSON.stringify(r));return r;}await pause(100);}throw Error('Editor receipt timed out');};
  for(let i=0;i<400&&!sessionId;i++)await pause(100);assert.ok(sessionId,'Editor loaded and polled');
  let current=editorState({sessionId});assert.equal(current.context.blankDocument,true);assert.equal(current.capabilities.tableContent,true);
  const animals=['말','소','돼지','양','염소','닭','오리','거위','토끼','개','고양이','햄스터','사자','호랑이','표범','코끼리','기린','얼룩말','원숭이','고릴라','침팬지','곰','여우','늑대','사슴','고라니','노루','캥거루','코알라','판다'];
  const table={rows:11,columns:3,cells:[{row:0,column:0,columnSpan:3,paragraphs:['동물']},...animals.map((a,i)=>({row:1+Math.floor(i/3),column:i%3,paragraphs:[a]}))]};
  let receipt=await wait(await editorTableInsert({sessionId,expected:current.context,table}));assert.equal(receipt.result.undoSteps,1);assert.equal(receipt.result.changes.cellCount,31);
  current=editorState({sessionId});assert.equal(current.context.blankDocument,false);
  const plan=(await wait(editorTables({sessionId,expected:current.context}))).result.tablePlan;assert.equal(plan.tables[0].cells[0].colSpan,3);assert.equal(plan.tables[0].cells[30].paragraphs[0],'판다');
  await wait(await editorTableFill({sessionId,expected:editorState({sessionId}).context,planId:plan.planId,tableIndex:0,edits:[{cellIndex:0,paragraphs:['동물 목록']},{cellIndex:1,paragraphs:['얼룩말']}]}));
  const inspect=async()=>{const state=editorState({sessionId});return (await wait(editorTables({sessionId,expected:state.context}))).result.tablePlan.tables[0];};
  assert.equal((await inspect()).cells[0].paragraphs[0],'동물 목록');
  if(process.env.PWH_TABLE_SCREENSHOT)await page.screenshot({path:process.env.PWH_TABLE_SCREENSHOT});
  const input=frame.getByRole('textbox',{name:'문서 편집 입력'});await input.focus();await page.keyboard.press('Control+z');
  // Direct capture reads the actual UI state; poll waits until the undo is published.
  for(let i=0;i<100;i++){const c=await frame.evaluate(()=>window.pwhEditor.context());if(c.documentState.changeSeq!==editorState({sessionId}).context.documentState.changeSeq){await pause(100);continue;}break;}
  const undo=(await frame.evaluate(()=>window.pwhEditor.export().bytes)).length;assert.ok(undo>0);
  const bytes=await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes));const reopened=new HwpDocument(Uint8Array.from(bytes));
  try{const ref=plan.tables[0].source;assert.equal(reopened.getTextInCell(ref.sec,ref.ppi,ref.ci,0,0,0,2),'동물');assert.equal(reopened.getTextInCell(ref.sec,ref.ppi,ref.ci,1,0,0,1),'말');}finally{reopened.free();}
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));await fs.rm(temp,{recursive:true,force:true});}
});
