import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {zipEntries} from '../scripts/setup.mjs';

test('existing image insertion, quiet search and undo work after opening a document from home', {
  skip:process.env.PWH_BROWSER_TESTS!=='1'||!process.env.PWH_DESKTOP_SOURCE_ROOT||!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM,
  timeout:120000,
}, async () => {
  const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
  const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
  const data=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-home-image-'));process.env.PWH_STANDALONE_DATA=data;
  const {createWorkspaceServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'workspace-shell.mjs')));
  const app=await createWorkspaceServer({updateServices:{check:async()=>null}}),browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
  try {
    const page=await browser.newPage({viewport:{width:1280,height:850}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(app.url);await page.getByRole('button',{name:'새 문서 빈 문서에서 시작하기'}).click();
    const child=page.frameLocator('#documents iframe').first(),editor=child.frameLocator('#editor');
    await editor.locator('#pwh-desktop-tabbar').waitFor({timeout:60000});await child.locator('#status').waitFor({state:'hidden',timeout:60000});
    assert.equal(await child.locator('#settings').isVisible(),false);assert.equal(await child.locator('#composer-settings').isVisible(),true);
    let injected=false,received=false;
    await page.route('**/rpc',async route=>{
      const request=route.request(),body=request.postDataJSON();if(body.params?.name!=='pwh_editor_poll')return route.continue();
      if(body.params.arguments.receipt?.ticketId==='synthetic-search'){received=!!body.params.arguments.receipt.textSearch;delete body.params.arguments.receipt;}
      const response=await route.fetch({postData:JSON.stringify(body)}),value=await response.json();
      if(!injected&&body.params.arguments.context?.ready&&value.result?.structuredContent){injected=true;value.result.structuredContent.commands??=[];value.result.structuredContent.commands.push({ticketId:'synthetic-search',type:'textSearch',query:'synthetic-search-term',expected:body.params.arguments.context});}
      await route.fulfill({response,json:value});
    });
    for(let i=0;i<100&&!received;i++)await page.waitForTimeout(100);
    assert.equal(received,true,'search result is delivered');assert.equal(await editor.locator('#pwh-status').textContent(),'','search does not add a completion banner');
    const crc=bytes=>{let value=0xffffffff;for(const byte of bytes){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;};
    const chunk=(name,data)=>{const buffer=Buffer.alloc(data.length+12);buffer.writeUInt32BE(data.length);buffer.write(name,4);data.copy(buffer,8);buffer.writeUInt32BE(crc(buffer.subarray(4,-4)),buffer.length-4);return buffer;};
    const header=Buffer.alloc(13);header.writeUInt32BE(2);header.writeUInt32BE(2,4);header[8]=8;header[9]=6;
    const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(18))),chunk('IEND',Buffer.alloc(0))]);
    const exported=await child.locator('#editor').evaluate(async(element,input)=>{
      const editor=element.contentWindow.pwhEditor,expected=editor.context(),bytes=Uint8Array.from(input);
      await editor.desktopInsertImage({expected,image:{width:2,height:2,extension:'png'},widthMm:100},bytes);
      let staleRejected=false;try{await editor.desktopInsertImage({expected,image:{width:2,height:2,extension:'png'},widthMm:100},bytes);}catch{staleRejected=true;}
      return {bytes:Array.from(editor.export().bytes),staleRejected};
    },Array.from(png));
    assert.equal(exported.staleRejected,true);
    const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
    assert.ok(zipEntries(Buffer.from(exported.bytes)).some(entry=>/BinData\//i.test(entry.name)&&sha(entry.read())===sha(png)),'exported document keeps the image bytes');
    const reopened=new core.HwpDocument(Uint8Array.from(exported.bytes));try{assert.ok(JSON.parse(reopened.getControls()).some(control=>control.ctrlId==='gso'));}finally{reopened.free();}
    await editor.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.press('Control+z');
    const undo=await child.locator('#editor').evaluate(element=>Array.from(element.contentWindow.pwhEditor.export().bytes));
    const restored=new core.HwpDocument(Uint8Array.from(undo));try{assert.equal(JSON.parse(restored.getControls()).some(control=>control.ctrlId==='gso'),false);}finally{restored.free();}
    assert.deepEqual(errors,[]);
  } finally {
    await browser.close();await new Promise(resolve=>app.server.close(resolve));
    await fs.rm(data,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});
