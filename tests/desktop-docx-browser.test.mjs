import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeZipMembers} from '../scripts/zip-writer.mjs';
import {zipEntries} from '../scripts/setup.mjs';

function sampleDocx() {
  const relation='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const parts={
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="'+relation+'/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+
      '<w:p><w:r><w:rPr><w:b/><w:color w:val="284666"/><w:highlight w:val="yellow"/></w:rPr><w:t>Start</w:t></w:r></w:p>'+
      '<w:tbl><w:tblGrid><w:gridCol w:w="1440"/><w:gridCol w:w="1440"/></w:tblGrid>'+
      '<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Merged</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'+
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>',
  };
  return writeZipMembers(Object.entries(parts).map(([name,xml])=>({name,bytes:Buffer.from(xml)})));
}

test('Desktop opens, edits, saves and reopens DOCX with editable Word table structure',{
  skip:process.env.PWH_BROWSER_TESTS!=='1'||!process.env.PWH_DESKTOP_SOURCE_ROOT?'Set Desktop build and browser paths':false,
  timeout:120000,
},async(t)=>{
  const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE);
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-docx-browser-'));
  const original=path.join(temp,'source.docx'),copy=path.join(temp,'edit.docx');
  await fs.writeFile(original,sampleDocx());
  process.env.PWH_STANDALONE_DATA=path.join(temp,'profile');
  const {createWorkspaceServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'workspace-shell.mjs')));
  const app=await createWorkspaceServer({distribution:'macos-preview',
    chooseFile:async ({mode})=>({path:mode==='Open'?original:copy}),updateServices:{check:async()=>null}});
  t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.goto(app.url);
  await page.getByRole('button',{name:/문서 열기/}).click();
  const tab=page.frameLocator('#documents iframe').first(), editor=tab.frameLocator('#editor');
  const context=await editor.locator('#pwh-title').evaluate(async title=>{
    for(let i=0;i<300;i++){
      if(window.pwhRecoveryReady?.())return {name:title.textContent,sectionEdit:window.__PWH_SECTION_EDIT__};
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw Error('DOCX did not finish opening');
  });
  assert.equal(context.name,'source.docx');
  if(process.env.PWH_EXPECT_SECTION_EDIT==='1') assert.equal(context.sectionEdit,true);
  await editor.getByRole('textbox',{name:'문서 편집 입력'}).focus();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('Edited ');
  if(context.sectionEdit){
    const count=()=>editor.locator('body').evaluate(()=>window.rhwpStudio.plugins.deps.wasm.getSectionCount());
    await page.keyboard.press('Alt+Shift+Enter');
    assert.equal(await count(),2);
    await page.keyboard.press('Control+z');
    assert.equal(await count(),1);
    await page.keyboard.press('Alt+Shift+Enter');
    assert.equal(await count(),2);
  }
  await page.keyboard.press('Control+s');
  const deadline=Date.now()+10000;
  let changed;
  while(Date.now()<deadline){
    changed=await fs.readFile(original);
    if(!changed.equals(sampleDocx()))break;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  const xml=zipEntries(changed).find(part=>part.name==='word/document.xml').read().toString();
  assert.match(xml,/Edited /);
  assert.match(xml,/w:gridSpan w:val="2"/);
  assert.match(xml,/284666/);
  assert.match(xml,/<w:highlight w:val="yellow"\/>/);
  assert.equal((xml.match(/<w:sectPr>/g)||[]).length,context.sectionEdit?2:1);
  await editor.getByRole('textbox',{name:'문서 편집 입력'}).focus();
  await tab.locator('#status').filter({hasText:'저장했습니다.'}).waitFor({state:'attached',timeout:10000});
  await editor.locator('[data-menu="file"] .menu-title').click();
  await editor.locator('[data-pwh-file="save-as"]').click();
  while(Date.now()<deadline+10000){
    try{assert.deepEqual(await fs.readFile(copy),changed);break;}
    catch(error){if(error.code!=='ENOENT')throw error;await new Promise(resolve=>setTimeout(resolve,50));}
  }
  assert.deepEqual(await fs.readFile(copy),changed);
  await editor.getByRole('button',{name:'시작 화면',exact:true}).click();
  await page.getByRole('button',{name:'edit.docx 열기',exact:true}).click();
  const reopened=page.frameLocator('#documents iframe').last().frameLocator('#editor');
  const reopenedText=await reopened.locator('#pwh-title').evaluate(async title=>{
    for(let i=0;i<300;i++){
      if(window.pwhRecoveryReady?.())return {
        name:title.textContent,content:window.rhwpStudio.plugins.deps.wasm.getTextRange(0,0,0,100),
      };
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw Error('Saved DOCX did not finish reopening');
  });
  assert.equal(reopenedText.name,'edit.docx');
  assert.match(reopenedText.content,/^Edited /);
});

test('a DOCX recovery draft survives reopening through a different document port',{
  skip:process.env.PWH_BROWSER_TESTS!=='1'||!process.env.PWH_DESKTOP_SOURCE_ROOT?'Set Desktop build and browser paths':false,
  timeout:90000,
},async()=>{
  const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE);
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-docx-recovery-'));
  const original=path.join(temp,'recovery.docx'), source=sampleDocx();
  await fs.writeFile(original,source);
  process.env.PWH_STANDALONE_DATA=path.join(temp,'profile');
  const {createAppServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'host.mjs')));
  const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
  let first,second;
  try{
    first=await createAppServer({initialPath:original});
    const page=await browser.newPage();
    await page.goto(first.url);
    const editor=page.frameLocator('#editor');
    await editor.getByRole('textbox',{name:'문서 편집 입력'}).waitFor({state:'attached'});
    const ready=await editor.locator('body').evaluate(async()=>{
      for(let i=0;i<300;i++){
        if(window.pwhRecoveryReady?.())return true;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      return false;
    });
    assert.equal(ready,true);
    await editor.getByRole('textbox',{name:'문서 편집 입력'}).focus();
    await page.keyboard.press('Control+Home');
    await page.keyboard.type('Recovered draft ');
    assert.equal(await editor.locator('body').evaluate(async()=>{
      for(let i=0;i<180;i++){
        if(window.pwhRecoveryCheckpointCurrent?.())return true;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      return false;
    }),true);
    second=await createAppServer({initialPath:original});
    assert.notEqual(new URL(first.url).port,new URL(second.url).port);
    await page.close({runBeforeUnload:false});
    await new Promise(resolve=>first.server.close(resolve));first=null;
    const reopened=await browser.newPage();
    await reopened.goto(second.url);
    const next=reopened.frameLocator('#editor');
    await next.getByRole('button',{name:'복구하기',exact:true}).click();
    assert.match(await next.locator('body').evaluate(async()=>{
      for(let i=0;i<300;i++){
        if(window.pwhRecoveryReady?.())return window.rhwpStudio.plugins.deps.wasm.getTextRange(0,0,0,100);
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      return '';
    }),/^Recovered draft /);
    assert.deepEqual(await fs.readFile(original),source);
  }finally{
    await browser.close();
    for(const app of [first,second])if(app)await new Promise(resolve=>app.server.close(resolve));
  }
});
