import test from 'node:test';
import assert from 'node:assert/strict';

test('isolated Desktop preview keeps the editor usable and presents the ChatGPT connection', {skip:!process.env.PWH_STANDALONE_URL||!process.env.PWH_PLAYWRIGHT_MODULE,timeout:90000},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE);const browser=await chromium.launch({headless:true,...(process.env.PWH_BROWSER_EXECUTABLE?{executablePath:process.env.PWH_BROWSER_EXECUTABLE}:{})});
 try{const page=await browser.newPage({viewport:{width:1400,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(process.env.PWH_STANDALONE_URL);
  const editor=page.frameLocator('#editor');await editor.getByRole('textbox',{name:'문서 편집 입력'}).waitFor({state:'visible',timeout:60000});
  await page.waitForFunction(()=>{const f=document.querySelector('#editor');return !!f?.contentWindow?.pwhEditor?.context?.()?.ready&&f.contentDocument.activeElement?.getAttribute('aria-label')==='문서 편집 입력';},null,{timeout:60000});
  await page.keyboard.type('Pwh test');assert.equal(await page.locator('#editor').evaluate(e=>e.contentWindow.pwhEditor.context().documentState.dirty),true);
  await page.getByRole('button',{name:'대화 설정 열기'}).click();await page.getByRole('radio',{name:'ChatGPT',exact:true}).waitFor();assert.equal(await page.locator('.provider-card').count(),3);assert.equal(await page.getByRole('radio',{name:'ChatGPT',exact:true}).isChecked(),true);
  await page.locator('#chatgpt-card-status').filter({hasText:'로그인 필요'}).waitFor({timeout:20000});assert.equal(await page.locator('#connection-chatgpt-login').isVisible(),true);
  await page.getByRole('tab',{name:'로컬 AI'}).click();await page.locator('#local-url').waitFor();assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
