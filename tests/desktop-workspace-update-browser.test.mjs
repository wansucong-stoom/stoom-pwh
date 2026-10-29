import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {createServer} from 'node:http';

test('update button protects dirty and busy tabs and checks again after download',{
 skip:process.env.PWH_BROWSER_TESTS!=='1'?'Set PWH_BROWSER_TESTS and explicit Playwright paths':false,timeout:45000,
},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
 const root=new URL('../desktop/standalone-pwh/',import.meta.url);const files=Object.fromEntries(await Promise.all(['workspace.html','workspace.js','workspace.css'].map(async n=>[n,await fs.readFile(new URL(n,root))])));
 let checks=0,downloads=0,installs=0,waiting=null;
 const server=createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost'),send=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  if(u.pathname==='/'){res.setHeader('Content-Type','text/html');return res.end(files['workspace.html']);}
  if(u.pathname==='/workspace.js'||u.pathname==='/workspace.css'){res.setHeader('Content-Type',u.pathname.endsWith('.js')?'text/javascript':'text/css');return res.end(files[u.pathname.slice(1)]);}
  if(u.pathname==='/stoom-mark.svg'||u.pathname==='/stoom.ico'){res.statusCode=404;return res.end();}
  if(u.pathname==='/child'){res.setHeader('Content-Type','text/html');return res.end(`<script>window.documentState={ready:true,dirty:true,busy:false,name:'테스트'};addEventListener('message',e=>{if(e.data?.type==='pwh-workspace-inspect')e.source.postMessage({type:'pwh-workspace-state',requestId:e.data.requestId,...window.documentState},e.origin)});parent.postMessage({type:'pwh-workspace-state',...window.documentState},location.origin);</script>`);}
  if(u.pathname==='/tabs/initial')return send({id:'test',url:`http://127.0.0.1:${server.address().port}/child`});
  if(u.pathname==='/update/result')return send({});
  if(u.pathname==='/update/status'){checks++;return send({version:'0.1.10'});}
  if(u.pathname==='/update/download'){downloads++;if(downloads===1){waiting=()=>send({version:'0.1.10'});return;}return send({version:'0.1.10'});}
  if(u.pathname==='/update/install'){installs++;return send({started:true});}res.statusCode=404;res.end();
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,...(process.env.PWH_BROWSER_EXECUTABLE?{executablePath:process.env.PWH_BROWSER_EXECUTABLE}:{})});
 try{const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`);const button=page.locator('#workspace-update');await button.waitFor({state:'visible'});const frame=page.frameLocator('#documents iframe');
  await button.click();await page.locator('#workspace-status').filter({hasText:'저장하고'}).waitFor();await page.waitForFunction(()=>!document.querySelector('#workspace-update').disabled);assert.equal(downloads,0);
  await frame.locator('body').evaluate(()=>{window.documentState.dirty=false;window.documentState.busy=true;});await button.click();await page.waitForFunction(()=>!document.querySelector('#workspace-update').disabled);assert.match(await page.locator('#workspace-status').innerText(),/AI 작업/);assert.equal(downloads,0);
  await frame.locator('body').evaluate(()=>{window.documentState.busy=false;});await button.click();for(let i=0;i<100&&!waiting;i++)await page.waitForTimeout(20);assert.ok(waiting);await frame.locator('body').evaluate(()=>{window.documentState.dirty=true;});waiting();
  await page.locator('#workspace-status').filter({hasText:'저장하고'}).waitFor();await page.waitForFunction(()=>!document.querySelector('#workspace-update').disabled);assert.equal(installs,0,'Changes during download must stop installation');assert.equal(await page.locator('#documents').evaluate(el=>el.inert),false);
  await frame.locator('body').evaluate(()=>{window.documentState.dirty=false;});await button.click();await page.locator('#workspace-status').filter({hasText:'업데이트를 설치합니다'}).waitFor();assert.equal(downloads,2);assert.equal(installs,1);assert.equal(checks,1);assert.equal(await page.locator('#documents').evaluate(el=>el.inert),true);
 }finally{await browser.close();server.close();}
});

test('an update can start from the home screen without opening a document',{
 skip:process.env.PWH_BROWSER_TESTS!=='1'?'Set PWH_BROWSER_TESTS and explicit Playwright paths':false,timeout:45000,
},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
 const root=new URL('../desktop/standalone-pwh/',import.meta.url),files=Object.fromEntries(await Promise.all(['workspace.html','workspace.js','workspace.css'].map(async name=>[name,await fs.readFile(new URL(name,root))])));
 let downloads=0,installs=0;
 const server=createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname,send=value=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};
  if(pathname==='/'){res.setHeader('content-type','text/html');return res.end(files['workspace.html']);}
  if(pathname==='/workspace.js'||pathname==='/workspace.css'){res.setHeader('content-type',pathname.endsWith('.js')?'text/javascript':'text/css');return res.end(files[pathname.slice(1)]);}
  if(pathname==='/tabs/initial')return send({home:true});if(pathname==='/recent/list')return send({documents:[]});
  if(pathname==='/update/status')return send({version:'0.1.12'});if(pathname==='/update/result'||pathname==='/codex-plugin/status')return send({});
  if(pathname==='/update/download'){downloads++;return send({version:'0.1.12'});}if(pathname==='/update/install'){installs++;return send({started:true});}
  res.statusCode=404;res.end();
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,...(process.env.PWH_BROWSER_EXECUTABLE?{executablePath:process.env.PWH_BROWSER_EXECUTABLE}:{})});
 try{const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.getByRole('heading',{name:'어떤 문서를 작업할까요?'}).waitFor();await page.locator('#workspace-update').click();await page.locator('#workspace-status').filter({hasText:'업데이트를 설치합니다'}).waitFor();assert.equal(downloads,1);assert.equal(installs,1);assert.equal(await page.locator('#documents iframe').count(),0);}
 finally{await browser.close();server.close();}
});
