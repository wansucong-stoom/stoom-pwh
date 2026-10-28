import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createAppServer} from './host.mjs';

test('same local port and profile recover an unsaved edit after restarting', {skip:!process.env.PWH_PLAYWRIGHT_MODULE||!process.env.PWH_RECOVERY_FIXTURE,timeout:90000},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE),dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-desktop-recovery-'));
 const fixture=process.env.PWH_RECOVERY_FIXTURE,hash=b=>createHash('sha256').update(b).digest('hex'),before=hash(await fs.readFile(fixture));
 let instance,context;
 try{
  instance=await createAppServer({initialPath:fixture});const port=instance.server.address().port;
  context=await chromium.launchPersistentContext(path.join(dir,'profile'),{headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
  let page=await context.newPage();await page.goto(instance.url);let frame=page.frameLocator('#editor');
  await frame.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});
  await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.type('recovery-check');
  for(let i=0;i<40;i++){const n=await page.locator('#editor').evaluate(el=>new Promise((resolve,reject)=>{const w=el.contentWindow,r=w.indexedDB.open('pwh-inline-recovery',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('drafts','readonly'),q=tx.objectStore('drafts').count();q.onsuccess=()=>{resolve(q.result);db.close();};q.onerror=()=>reject(q.error);};}));if(n>0)break;if(i===39)throw Error('Recovery checkpoint was not written');await new Promise(r=>setTimeout(r,500));}
  await context.close();context=null;await new Promise(resolve=>instance.server.close(resolve));instance=null;
  instance=await createAppServer({initialPath:fixture,port});context=await chromium.launchPersistentContext(path.join(dir,'profile'),{headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});page=await context.newPage();await page.goto(instance.url);frame=page.frameLocator('#editor');
  await frame.getByRole('heading',{name:'미저장 편집 내용 복구'}).waitFor({timeout:60000});await frame.getByRole('button',{name:'복구하기'}).click();
  await page.waitForFunction(()=>document.querySelector('#editor').contentWindow.pwhEditor?.context()?.documentState?.dirty===true,null,{timeout:30000});
  const restored=await page.locator('#editor').evaluate(el=>Array.from(el.contentWindow.pwhEditor.export().bytes));assert.notEqual(hash(Buffer.from(restored)),before);assert.equal(hash(await fs.readFile(fixture)),before);
 }finally{if(context)await context.close();if(instance)await new Promise(resolve=>instance.server.close(resolve));await fs.rm(dir,{recursive:true,force:true});}
});
