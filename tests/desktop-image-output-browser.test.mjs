import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {deflateSync} from 'node:zlib';

test('selected pages are saved as numbered image files with page content', {
  skip: process.env.PWH_BROWSER_TESTS !== '1' || !process.env.PWH_DESKTOP_SOURCE_ROOT ? 'Set Desktop build and browser paths' : false,
  timeout: 120000,
}, async () => {
  const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE || 'playwright');
  const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-image-output-'));process.env.PWH_STANDALONE_DATA=path.join(dir,'data');
  const crc=bytes=>{let value=0xffffffff;for(const byte of bytes){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;};
  const chunk=(name,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(name,4);data.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,-4)),b.length-4);return b;};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(2);ihdr.writeUInt32BE(2,4);ihdr[8]=8;ihdr[9]=2;
  const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.from([0,255,0,0,255,0,0,0,255,0,0,255,0,0]))),chunk('IEND',Buffer.alloc(0))]);
  const doc=core.HwpDocument.createEmpty();doc.createBlankDocument();const ok=x=>{const r=JSON.parse(x);assert.equal(r.ok,true,JSON.stringify(r));return r;};
  ok(doc.insertText(0,0,0,'first page'));const pic=ok(doc.insertPicture(0,0,0,'[]',png,9000,4500,2,2,'png','red picture'));ok(doc.setPictureProperties(0,0,pic.controlIdx,JSON.stringify({treatAsChar:true})));
  const pos=ok(doc.insertPageBreak(0,0,6));ok(doc.insertText(0,pos.paraIdx,0,'second page'));
  const sample=path.join(dir,'source.hwpx');await fs.writeFile(sample,doc.exportHwpx());doc.free();
  const {createAppServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'host.mjs')));
  const app=await createAppServer({initialPath:sample,chooseFile:async choice=>{assert.equal(choice.mode,'Image');return {cancelled:false,path:path.join(dir,'결과.png')};}});
  const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
  try{
    const page=await browser.newPage({viewport:{width:1200,height:850}});await page.goto(app.url);const editor=page.frameLocator('#editor');
    await editor.locator('textarea[aria-label="문서 편집 입력"]').waitFor({state:'attached',timeout:60000});
    await editor.locator('body').evaluate(async()=>{for(let i=0;i<600;i++){if(window.pwhRecoveryReady?.())return;await new Promise(r=>setTimeout(r,100));}throw Error('editor not ready');});
    await editor.locator('[data-menu="file"] .menu-title').click();await editor.locator('[data-pwh-file="image-export"]').click();
    const dialog=page.getByRole('dialog',{name:'그림으로 저장'});await dialog.waitFor();
    await dialog.getByRole('button',{name:'저장',exact:true}).click();
    await page.locator('#status').filter({hasText:'2쪽을 그림으로 저장했습니다.'}).waitFor({timeout:60000});
    const first=await fs.readFile(path.join(dir,'결과-1.png')),second=await fs.readFile(path.join(dir,'결과-2.png'));
    assert.equal(first.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(second.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    const red=await page.evaluate(async data=>{const img=await createImageBitmap(new Blob([Uint8Array.from(data)],{type:'image/png'}));const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let count=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>190&&pixels[i+1]<70&&pixels[i+2]<70)count++;return count;},Array.from(first));
    assert.ok(red>100,'saved image includes the embedded red picture');
  }finally{await browser.close();await new Promise(r=>app.server.close(r));const base=await fs.realpath(os.tmpdir()),target=await fs.realpath(dir),relative=path.relative(base,target);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(target,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
