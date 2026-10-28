import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createAppServer} from './host.mjs';
test('file menu saves to the open document and saves a copy', {skip:!process.env.PWH_PLAYWRIGHT_MODULE||!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM,timeout:90000},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE),core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-file-ui-')),source=path.join(dir,'원본.hwpx'),copy=path.join(dir,'복사본.hwpx');const doc=core.HwpDocument.createEmpty();doc.createBlankDocument();await fs.writeFile(source,doc.exportHwpx());doc.free();
 const app=await createAppServer({initialPath:source,chooseFile:async({mode})=>({cancelled:false,path:mode==='Open'?source:copy})});const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{const page=await browser.newPage({viewport:{width:1400,height:900}});await page.goto(app.url);const frame=page.frameLocator('#editor');await frame.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});await page.locator('#status').filter({hasText:'조판기 준비 완료'}).waitFor({timeout:15000});assert.equal(await frame.locator('#pwh-save').isVisible(),false);assert.equal(await page.locator('.stoom-word').innerText(),'STOOM');assert.equal(await page.locator('.stoom-mark').evaluate(el=>getComputedStyle(el).width),'29px');
  await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.type('SAVE TEST');await frame.locator('[data-menu="file"] .menu-title').click();await frame.locator('[data-pwh-file="save"]').click();await page.locator('#status').filter({hasText:'저장했습니다'}).waitFor({timeout:30000});const saved=await fs.readFile(source);const reopened=new core.HwpDocument(saved);try{assert.match(reopened.getTextRange(0,0,0,reopened.getParagraphLength(0,0)),/SAVE TEST/);}finally{reopened.free();}
  await frame.locator('[data-menu="file"] .menu-title').click();await frame.locator('[data-pwh-file="save-as"]').click();await page.waitForFunction(()=>document.querySelector('#editor').contentWindow.document.querySelector('#pwh-title')?.textContent==='복사본.hwpx',null,{timeout:30000});assert.deepEqual(await fs.readFile(source),saved);assert.ok((await fs.readdir(dir)).includes('복사본.hwpx'),`directory=${(await fs.readdir(dir)).join(',')} status=${await page.locator('#status').innerText()}`);
  const before=await page.locator('#editor').getAttribute('src');await frame.locator('[data-menu="file"] .menu-title').click();await frame.locator('[data-pwh-file="open"]').click();await page.waitForFunction(old=>document.querySelector('#editor').getAttribute('src')!==old,before);await frame.locator('#pwh-title').filter({hasText:'원본.hwpx'}).waitFor({timeout:30000});
 }finally{await browser.close();await new Promise(resolve=>app.server.close(resolve));await fs.rm(dir,{recursive:true,force:true});}
});
