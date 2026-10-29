import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';import {createServer} from 'node:http';
import {clientViewerHtml,registerClientDocument} from '../src/client-assets.mjs';import {handleRequest} from '../src/server.mjs';

test('shared palette applies text and highlight colors and restores recent colors in another editor',{
 skip:process.env.PWH_BROWSER_TESTS!=='1'?'Set PWH_BROWSER_TESTS and explicit WASM/Playwright paths':false,timeout:90000,
},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright'),{default:init,HwpDocument}=await import(pathToFileURL(process.env.PWH_CORE_JS));await init({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-color-browser-'));process.env.PWH_COLOR_PREFERENCES_DIR=path.join(temp,'preferences');
 const filename=path.join(temp,'blank.hwpx'),doc=HwpDocument.createEmpty();doc.createBlankDocument();await fs.writeFile(filename,doc.exportHwpx());doc.free();
 const registered=await registerClientDocument(filename),html=await clientViewerHtml();
 const server=createServer(async(req,res)=>{try{
  if(req.url==='/editor'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  if(req.url==='/rpc'){let body='';for await(const part of req)body+=part;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await handleRequest(JSON.parse(body))));return;}
  res.setHeader('Content-Type','text/html');res.end(`<style>html,body,iframe{width:100%;height:100%;margin:0;border:0}</style><iframe src="/editor"></iframe><script>addEventListener('message',async e=>{const m=e.data;if(m?.jsonrpc!=='2.0')return;if(m.method==='ui/notifications/initialized'){e.source.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:${JSON.stringify(registered)}}},location.origin);return;}if(m.id===undefined)return;const r=m.method==='ui/initialize'?{jsonrpc:'2.0',id:m.id,result:{hostCapabilities:{}}}:await(await fetch('/rpc',{method:'POST',body:JSON.stringify(m)})).json();e.source.postMessage(r,location.origin);});</script>`);
 }catch(error){res.statusCode=500;res.end(String(error.stack));}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true,...(process.env.PWH_BROWSER_EXECUTABLE?{executablePath:process.env.PWH_BROWSER_EXECUTABLE}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1100,height:850}});await page.goto(`http://127.0.0.1:${server.address().port}`);const frame=page.frames().find(f=>f.url().endsWith('/editor'));
  await frame.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:30000});const input=frame.getByRole('textbox',{name:'문서 편집 입력'});await input.focus();await page.keyboard.type('abc');await page.keyboard.press('Shift+Home');
  await frame.locator('#btn-text-color').click();const palette=frame.getByRole('dialog',{name:'색상 선택'});await palette.waitFor({state:'visible'});
  assert.equal(await palette.locator('.pwh-color-themes button').count(),60);assert.equal(await palette.locator('.pwh-color-themes button').nth(2).getAttribute('data-color'),'#faf3db');assert.equal(await palette.locator('.pwh-color-themes button').nth(45).getAttribute('data-color'),'#eb5800');assert.equal(await palette.locator('.pwh-color-standards button').count(),10);
  if(process.env.PWH_COLOR_SCREENSHOT)await palette.screenshot({path:process.env.PWH_COLOR_SCREENSHOT});await palette.locator('.pwh-color-standards button[data-color="#ff0000"]').click();
  const saved=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));try{assert.equal(JSON.parse(saved.getCharPropertiesAt(0,0,0)).textColor.toLowerCase(),'#ff0000','Text color applies to the selection');}finally{saved.free();}
  await frame.locator('#btn-highlight').click();await palette.waitFor({state:'visible'});await palette.locator('.pwh-color-recents button[data-color="#ff0000"]').waitFor();
  await palette.getByLabel('색상 코드').fill('#1234AB');await palette.getByRole('button',{name:'적용',exact:true}).click();
  const highlighted=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));try{assert.equal(JSON.parse(highlighted.getCharPropertiesAt(0,0,0)).shadeColor.toLowerCase(),'#1234ab','Highlight uses exact custom color');}finally{highlighted.free();}
  await frame.waitForFunction(async()=>{try{return (await window.pwhRecentColors()).includes('#1234ab');}catch{return false;}});
  await frame.locator('#tb-char-format').click();const charDialog=frame.locator('.modal-overlay .dialog-wrap').last();await charDialog.waitFor({state:'visible'});
  await charDialog.locator('input[type="color"]:visible').first().click();await palette.locator('.pwh-color-recents button[data-color="#1234ab"]').waitFor();
  await page.keyboard.press('Escape');assert.equal(await palette.count(),0);assert.equal(await charDialog.isVisible(),true);await page.keyboard.press('Escape');
  const secondContext=await browser.newContext({viewport:{width:1100,height:850}});try{const second=await secondContext.newPage();await second.goto(`http://127.0.0.1:${server.address().port}`);const editor=second.frames().find(f=>f.url().endsWith('/editor'));await editor.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:30000});await editor.locator('#btn-text-color').click();const colors=editor.getByRole('dialog',{name:'색상 선택'});await colors.locator('.pwh-color-recents button[data-color="#1234ab"]').waitFor({timeout:10000});await second.keyboard.press('Escape');}finally{await secondContext.close();}
 }finally{await browser.close();server.close();await fs.rm(temp,{recursive:true,force:true});}
});
