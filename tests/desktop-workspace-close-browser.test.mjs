import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {createServer} from 'node:http';

test('window and tab close honor save, discard and cancel without losing other tabs',{
 skip:process.env.PWH_BROWSER_TESTS!=='1'?'Set PWH_BROWSER_TESTS and Playwright paths':false,timeout:90000,
},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');const root=new URL('../desktop/standalone-pwh/',import.meta.url);
 const files=Object.fromEntries(await Promise.all(['workspace.html','workspace.js','workspace.css'].map(async n=>[n,await fs.readFile(new URL(n,root))])));
 let next=1,windowRequests=0,closed=[],nativeFails=false;
 const server=createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost'),send=data=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(data));};
  if(u.pathname==='/'){res.setHeader('content-type','text/html');return res.end(files['workspace.html']);}
  if(['/workspace.js','/workspace.css'].includes(u.pathname)){res.setHeader('content-type',u.pathname.endsWith('.js')?'text/javascript':'text/css');return res.end(files[u.pathname.slice(1)]);}
  if(u.pathname==='/child'){const id=u.searchParams.get('id');res.setHeader('content-type','text/html');return res.end(`<script>
   window.doc={ready:true,dirty:true,busy:false,name:'문서 ${id}',documentState:{documentEpoch:${id},changeSeq:1,dirty:true}};window.commands=[];window.saveSucceeds=true;window.prepareFails=false;
   const report=(e,id)=>e.source.postMessage({type:'pwh-workspace-state',requestId:id,...window.doc},e.origin);
   addEventListener('message',e=>{const m=e.data;if(m?.type==='pwh-workspace-inspect')return report(e,m.requestId);if(m?.type!=='pwh-workspace-command')return;
    window.commands.push(m.action);let ok=true;if(m.action==='save'){ok=window.saveSucceeds;if(ok){window.doc.dirty=false;window.doc.documentState.dirty=false;}}
    if(m.action==='prepare-close'){if(window.prepareFails||JSON.stringify(m.expected)!==JSON.stringify(window.doc.documentState))ok=false;else{window.oldDirty=window.doc.dirty;window.doc.dirty=false;window.doc.documentState.dirty=false;}}
    if(m.action==='abort-close'&&window.oldDirty!==undefined){window.doc.dirty=!!window.oldDirty;window.doc.documentState.dirty=!!window.oldDirty;delete window.oldDirty;}
    e.source.postMessage({type:'pwh-workspace-command-result',requestId:m.requestId,ok},e.origin);report(e);});
   parent.postMessage({type:'pwh-workspace-state',...window.doc},location.origin);
  </script>`);}
  if(u.pathname==='/tabs/initial')return send({id:'1',url:`http://127.0.0.1:${server.address().port}/child?id=1`});
  if(u.pathname==='/tabs/new'){const id=String(++next);return send({id,url:`http://127.0.0.1:${server.address().port}/child?id=${id}`});}
  if(u.pathname==='/tabs/close'){let body='';for await(const part of req)body+=part;closed.push(JSON.parse(body).id);return send({ok:true});}
  if(u.pathname==='/native/request-close'){windowRequests++;if(nativeFails){res.statusCode=500;return send({error:'창 닫기 실패'});}return send({requested:true});}
  if(['/update/status','/update/result','/codex-plugin/status'].includes(u.pathname))return send({});res.statusCode=404;res.end();
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,...(process.env.PWH_BROWSER_EXECUTABLE?{executablePath:process.env.PWH_BROWSER_EXECUTABLE}:{})});
 try{
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.locator('#documents iframe').first().waitFor();
  const dialog=page.getByRole('dialog',{name:'변경 내용 저장'}),nativeClose=()=>page.evaluate(()=>window.dispatchEvent(new Event('pwh-native-close-request')));
  await nativeClose();await dialog.waitFor();await dialog.getByRole('button',{name:'취소',exact:true}).click();assert.equal(windowRequests,0);assert.equal(await page.locator('#documents').evaluate(e=>e.inert),false);
  await page.locator('#new-tab').click();await page.waitForFunction(()=>document.querySelectorAll('#documents iframe').length===2);
  await nativeClose();await dialog.getByText('문서 1',{exact:false}).waitFor();await dialog.getByRole('button',{name:'저장하지 않음'}).click();await dialog.getByText('문서 2',{exact:false}).waitFor();await dialog.getByRole('button',{name:'취소',exact:true}).click();
  const first=page.locator('#documents iframe').nth(0),second=page.locator('#documents iframe').nth(1);
  assert.deepEqual(await first.evaluate(e=>e.contentWindow.commands),[],'Discard must wait until every tab has a decision');assert.equal(await first.evaluate(e=>e.contentWindow.doc.dirty),true);assert.equal(windowRequests,0);
  await second.evaluate(e=>{e.contentWindow.doc.busy=true;});await nativeClose();await dialog.getByText('문서 1',{exact:false}).waitFor();await dialog.getByRole('button',{name:'저장하지 않음'}).click();await page.locator('#workspace-status').filter({hasText:'AI 작업이나 저장'}).waitFor();assert.equal(windowRequests,0);
  await second.evaluate(e=>{e.contentWindow.doc.busy=false;e.contentWindow.saveSucceeds=false;});await nativeClose();await dialog.getByText('문서 1',{exact:false}).waitFor();await dialog.getByRole('button',{name:'저장하지 않음'}).click();await dialog.getByText('문서 2',{exact:false}).waitFor();await dialog.getByRole('button',{name:'저장',exact:true}).click();await page.locator('#workspace-status').filter({hasText:'저장이 취소되었거나'}).waitFor();await page.waitForFunction(()=>!document.querySelector('#documents').inert);assert.equal(windowRequests,0);assert.equal(await first.evaluate(e=>e.contentWindow.doc.dirty),true);
  await second.evaluate(e=>{e.contentWindow.saveSucceeds=true;e.contentWindow.prepareFails=true;});await nativeClose();await dialog.getByText('문서 1',{exact:false}).waitFor();await dialog.getByRole('button',{name:'저장하지 않음'}).click();await dialog.getByText('문서 2',{exact:false}).waitFor();await dialog.getByRole('button',{name:'저장하지 않음'}).click();await page.locator('#workspace-status').filter({hasText:'복구 상태'}).waitFor();assert.equal(await first.evaluate(e=>e.contentWindow.doc.dirty),true,'failed later prepare rolls back first tab');assert.equal(await second.evaluate(e=>e.contentWindow.doc.dirty),true);assert.equal(windowRequests,0);
  await second.evaluate(e=>{e.contentWindow.prepareFails=false;});nativeFails=true;await nativeClose();await dialog.getByText('문서 1',{exact:false}).waitFor();await dialog.getByRole('button',{name:'저장하지 않음'}).click();await dialog.getByText('문서 2',{exact:false}).waitFor();await dialog.getByRole('button',{name:'저장하지 않음'}).click();await page.locator('#workspace-status').filter({hasText:'창 닫기 실패'}).waitFor();assert.equal(await first.evaluate(e=>e.contentWindow.doc.dirty),true);assert.equal(await second.evaluate(e=>e.contentWindow.doc.dirty),true,'failed native close rolls back both tabs');assert.equal(windowRequests,1);windowRequests=0;nativeFails=false;
  await second.evaluate(e=>{e.contentWindow.doc.ready=false;e.contentWindow.commands=[];});await nativeClose();await dialog.getByText('문서 1',{exact:false}).waitFor();await dialog.getByRole('button',{name:'저장하지 않음'}).click();const unavailable=page.getByRole('dialog',{name:'문서 상태 확인 불가'});await unavailable.waitFor();await unavailable.getByRole('button',{name:'취소'}).click();assert.equal(windowRequests,0);assert.equal(await first.evaluate(e=>e.contentWindow.doc.dirty),true,'cancel preserves earlier choices');
  await nativeClose();await dialog.getByText('문서 1',{exact:false}).waitFor();await dialog.getByRole('button',{name:'저장하지 않음'}).click();await unavailable.getByRole('button',{name:'그래도 닫기'}).click();for(let i=0;i<100&&windowRequests===0;i++)await page.waitForTimeout(20);assert.equal(windowRequests,1,'an unavailable editor can be closed explicitly');assert.deepEqual(await second.evaluate(e=>e.contentWindow.commands),[],'unavailable document recovery is untouched');
  await page.waitForFunction(()=>!document.querySelector('#documents').inert,null,{timeout:8000});windowRequests=0;await second.evaluate(e=>{e.contentWindow.doc.ready=true;});
  await second.evaluate(e=>{e.contentWindow.saveSucceeds=true;});await nativeClose();await dialog.getByText('문서 1',{exact:false}).waitFor();await dialog.getByRole('button',{name:'저장하지 않음'}).click();await dialog.getByText('문서 2',{exact:false}).waitFor();await dialog.getByRole('button',{name:'저장',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#documents').inert===true);for(let i=0;i<100&&windowRequests===0;i++)await page.waitForTimeout(20);
  assert.equal(windowRequests,1);assert.ok((await first.evaluate(e=>e.contentWindow.commands)).includes('prepare-close'));assert.ok((await second.evaluate(e=>e.contentWindow.commands)).includes('prepare-close'));assert.deepEqual(closed,[]);
 }finally{await browser.close();server.close();}
});
