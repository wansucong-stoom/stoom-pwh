import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {pathToFileURL} from 'node:url';

test('authorized ChatGPT plan edits and verifies a separate blank Pwh document', {skip:process.env.PWH_CHATGPT_LIVE!=='1'||!process.env.PWH_STANDALONE_URL||!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM||!process.env.PWH_PLAYWRIGHT_MODULE,timeout:300000},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE),core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const browser=await chromium.launch({headless:true,...(process.env.PWH_BROWSER_EXECUTABLE?{executablePath:process.env.PWH_BROWSER_EXECUTABLE}:{})});
 try{const page=await browser.newPage({viewport:{width:1400,height:900}});if(process.env.PWH_TEST_DEBUG==='1'){browser.on('disconnected',()=>console.error('시험 브라우저 연결이 종료됨'));page.on('crash',()=>console.error('시험 페이지가 충돌함'));page.on('close',()=>console.error('시험 페이지가 닫힘'));}await page.goto(process.env.PWH_STANDALONE_URL);const editor=page.frameLocator('#editor');await editor.getByRole('textbox',{name:'문서 편집 입력'}).waitFor({timeout:60000});
  await page.waitForFunction(()=>document.querySelector('#editor')?.contentWindow?.pwhEditor?.context?.()?.ready,null,{timeout:60000});await page.locator('#status').waitFor({state:'hidden',timeout:60000});await page.locator('#prompt').fill('빈 문서 첫 문단에 Pwh 연결 확인 이라는 글자를 직접 작성하고 반영 결과를 확인해 주세요.');await page.locator('#send').click();await page.waitForFunction(()=>document.querySelector('#stop').hidden&&[...document.querySelectorAll('#conversation .message')].some(node=>!node.classList.contains('user')),null,{timeout:240000});
  const chat=await page.locator('#conversation').innerText();const bytes=await page.locator('#editor').evaluate(e=>Array.from(e.contentWindow.pwhEditor.export().bytes));const doc=new core.HwpDocument(Uint8Array.from(bytes));try{let body='';for(let s=0;s<doc.getSectionCount();s++)for(let p=0;p<doc.getParagraphCount(s);p++)body+=doc.getTextRange(s,p,0,doc.getParagraphLength(s,p));assert.match(body,/Pwh 연결 확인/,chat);}finally{doc.free();}
 }finally{await browser.close();}
});
