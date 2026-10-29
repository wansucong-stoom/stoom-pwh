import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {createServer} from 'node:http';

test('ChatGPT settings require a user click, show plan disclosure and support account controls', {skip:process.env.PWH_BROWSER_TESTS!=='1',timeout:60000},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');const root=new URL('../desktop/standalone-pwh/',import.meta.url);
 const files=Object.fromEntries(await Promise.all(['app.html','app.js','app.css','stoom-mark.svg','stoom.ico'].map(async name=>[name,await fs.readFile(new URL(name,root))])));
 let begins=0,welcomed=false,active=false;const settings={provider:'chatgpt',localBaseUrl:'http://127.0.0.1:11434/v1',localModel:'',codexModel:'',codexReasoningEffort:''};
 const server=createServer(async(req,res)=>{const u=new URL(req.url,'http://localhost');const send=data=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(data));};
  if(req.method==='GET'&&u.pathname==='/'){res.setHeader('content-type','text/html');return res.end(files['app.html']);}
  if(req.method==='GET'&&u.pathname==='/editor'){res.setHeader('content-type','text/html');return res.end('<div id="editor-area"></div>');}
  if(req.method==='GET'&&files[u.pathname.slice(1)]){res.setHeader('content-type',u.pathname.endsWith('.js')?'text/javascript':u.pathname.endsWith('.css')?'text/css':u.pathname.endsWith('.svg')?'image/svg+xml':'image/x-icon');return res.end(files[u.pathname.slice(1)]);}
  let text='';for await(const part of req)text+=part;const body=JSON.parse(text||'{}');
  if(u.pathname==='/initialize')return send({document:{name:'document.hwpx'}});
  if(u.pathname==='/settings/read')return send(settings);
  if(u.pathname==='/settings/write'){Object.assign(settings,body);return send(settings);}
  if(u.pathname==='/chatgpt/status')return send({active:active?'account123456':null,accounts:active?[{id:'account123456',email:'test@example.test',connected:true}]:[],pending:false,needsWelcome:active&&!welcomed,error:''});
  if(u.pathname==='/chatgpt/begin'){begins++;active=true;return send({started:true});}
  if(u.pathname==='/chatgpt/welcome'){welcomed=true;return send({ok:true});}
  if(u.pathname==='/chatgpt/signout'){active=false;return send({remoteRevocationConfirmed:true});}
  if(u.pathname==='/codex/disconnect'){if(settings.provider==='codex')settings.provider='chatgpt';return send({ok:true});}
  if(u.pathname==='/ai/check')return send(body.provider==='codex'||body.provider==='chatgpt'&&active?{ready:true,installed:true,models:[{id:'test-model',name:'시험 모델',reasoningEfforts:['low','high']}]}:{ready:false,models:[]});
  res.statusCode=404;return send({error:'unexpected request'});
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,...(process.env.PWH_BROWSER_EXECUTABLE?{executablePath:process.env.PWH_BROWSER_EXECUTABLE}:{})});
 try{const page=await browser.newPage({viewport:{width:1400,height:900}});const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.getByText('AI 설정에서 ChatGPT 계정을 연결하면', {exact:false}).waitFor();assert.equal(begins,0);
  await page.getByRole('button',{name:'대화 설정 열기'}).click();assert.equal(await page.locator('.provider-card').count(),3);await page.getByRole('radio',{name:'로컬 AI'}).check();assert.equal(await page.locator('[data-provider-card="local"]').getAttribute('data-selected'),'true');await page.getByRole('radio',{name:'ChatGPT',exact:true}).check();if(process.env.PWH_TEST_SCREENSHOT)await page.screenshot({path:process.env.PWH_TEST_SCREENSHOT});await page.locator('#connection-chatgpt-login').click();
  const welcome=page.getByRole('dialog',{name:'ChatGPT 요금제를 사용합니다'});await welcome.waitFor();assert.equal(begins,1);await welcome.getByRole('button',{name:'확인'}).click();assert.equal(welcomed,true);await page.locator('#chatgpt-plan-hint').waitFor();
  await page.getByRole('tab',{name:'ChatGPT 계정'}).click();if(process.env.PWH_TEST_SCREENSHOT_ACCOUNT)await page.screenshot({path:process.env.PWH_TEST_SCREENSHOT_ACCOUNT});await page.locator('#chatgpt-signout').click();await page.locator('#chatgpt-plan-hint').waitFor({state:'hidden'});assert.equal(active,false);
  await page.getByRole('tab',{name:'AI 연결'}).click();await page.getByRole('radio',{name:'설치된 Codex'}).check();await page.locator('#save-settings').click();await page.locator('#settings-dialog').waitFor({state:'hidden'});assert.equal(settings.provider,'codex');
  await page.getByRole('button',{name:'대화 설정 열기'}).click();await page.locator('#connection-codex-disconnect').click();await page.locator('#connection-status').filter({hasText:'Codex 앱의 로그인은 유지됩니다'}).waitFor();assert.equal(settings.provider,'chatgpt');
  await page.getByRole('button',{name:'설정 닫기'}).click();assert.deepEqual(pageErrors,[]);
 }finally{await browser.close();server.close();}
});
