import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('a file drop without native path access opens a visible work-copy warning',{
 skip:process.env.PWH_BROWSER_TESTS!=='1'||!process.env.PWH_DESKTOP_SOURCE_ROOT||!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM?'Set Desktop build, core and browser paths':false,timeout:120000,
},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright'),core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-drop-copy-'));process.env.PWH_STANDALONE_DATA=path.join(temp,'data');const fixture=path.join(temp,'끌어온 문서.hwpx');
 const doc=core.HwpDocument.createEmpty();doc.createBlankDocument();doc.insertText(0,0,0,'Synthetic drop fixture');await fs.writeFile(fixture,doc.exportHwpx());doc.free();
 const {createWorkspaceServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'workspace-shell.mjs')));
 const app=await createWorkspaceServer({nativeBranding:{token:'1234567890abcdef1234567890abcdef',complete:true,resolveDroppedFiles:async()=>{throw Error('native path unavailable');}},updateServices:{check:async()=>null}});
 const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});await page.goto(app.url);await page.getByRole('heading',{name:'어떤 문서를 작업할까요?'}).waitFor();
  const target=await page.locator('#home-view').boundingBox(),cdp=await page.context().newCDPSession(page),data={items:[],files:[fixture],dragOperationsMask:1},x=target.x+target.width/2,y=target.y+target.height/2;
  for(const type of ['dragEnter','dragOver','drop'])await cdp.send('Input.dispatchDragEvent',{type,x,y,data});await page.waitForFunction(()=>document.querySelectorAll('#documents iframe').length===1,null,{timeout:60000});
  const child=page.frameLocator('#documents iframe').first(),editor=child.frameLocator('#editor');await editor.getByRole('button',{name:'끌어온 문서.hwpx',exact:true}).waitFor({timeout:60000});if(!await child.locator('#ai-pane').isVisible())await editor.getByRole('button',{name:'AI 대화 열기'}).click();await child.locator('#conversation .document-notification').filter({hasText:'저장 위치 선택 필요'}).waitFor();
  const info=await child.locator('body').evaluate(async()=>{const r=await fetch('initialize',{method:'POST',headers:{'x-pwh-request':'1','content-type':'application/json'},body:'{}'});return (await r.json()).document;});assert.equal(info.imported,true);assert.notEqual(info.source,fixture,'the fallback must not treat an internal copy as the source file');
 }finally{await browser.close();await new Promise(resolve=>app.server.close(resolve));}
});
