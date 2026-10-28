import test from 'node:test';
import assert from 'node:assert/strict';

test('saved clipping preference is preserved', {skip:!process.env.PWH_STANDALONE_URL||!process.env.PWH_PLAYWRIGHT_MODULE,timeout:90000},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE);const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{const page=await browser.newPage({viewport:{width:1400,height:900}});await page.addInitScript(()=>localStorage.setItem('rhwp-settings',JSON.stringify({view:{clipView:true}})));await page.goto(process.env.PWH_STANDALONE_URL);const frame=page.frameLocator('#editor');await frame.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});assert.equal(await frame.locator('[data-cmd="view:toggle-clip"]').first().evaluate(el=>el.classList.contains('active')),true);
 }finally{await browser.close();}
});

test('blank document accepts equivalent context and rejects stale changes', {skip:!process.env.PWH_STANDALONE_URL||!process.env.PWH_PLAYWRIGHT_MODULE,timeout:90000},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE);const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{const page=await browser.newPage({viewport:{width:1400,height:900}});await page.goto(process.env.PWH_STANDALONE_URL);await page.frameLocator('#editor').locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});
  const result=await page.locator('#editor').evaluate(async el=>{const editor=el.contentWindow.pwhEditor,context=editor.context(),state=context.documentState;const expected={...context,documentState:Object.fromEntries(Object.entries(state).reverse())};const changed=await editor.compose({expected,paragraphs:[{role:'title',text:'빈 문서 작성 시험'}]});let rejected=false;try{await editor.compose({expected,paragraphs:[{role:'body',text:'덮어쓰기'}]});}catch{rejected=true;}return {changed:changed.ok,rejected};});assert.deepEqual(result,{changed:true,rejected:true});
 }finally{await browser.close();}
});

test('body styling preserves text and rejects stale document state', {skip:!process.env.PWH_STANDALONE_URL||!process.env.PWH_PLAYWRIGHT_MODULE||!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM,timeout:90000},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE),fs=await import('node:fs/promises'),{pathToFileURL}=await import('node:url');const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{const page=await browser.newPage({viewport:{width:1400,height:900}});await page.goto(process.env.PWH_STANDALONE_URL);const frame=page.frameLocator('#editor');await frame.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.type('TITLE');const result=await page.locator('#editor').evaluate(async el=>{const e=el.contentWindow.pwhEditor,expected=e.context().documentState,edits=[{section:0,paragraph:0,text:'TITLE',style:{bold:true,fontSize:1800,textColor:'#113355',alignment:'center'}}];const applied=await e.desktopBodyStyle({expected,edits});let stale=false;try{await e.desktopBodyStyle({expected,edits});}catch{stale=true;}return {applied:applied.ok,stale,bytes:Array.from(e.export().bytes)};});assert.equal(result.applied,true);assert.equal(result.stale,true);const doc=new core.HwpDocument(Uint8Array.from(result.bytes));try{assert.equal(doc.getTextRange(0,0,0,doc.getParagraphLength(0,0)),'TITLE');const props=JSON.parse(doc.getCharPropertiesAt(0,0,0));assert.equal(props.bold,true);assert.equal(props.fontSize,1800);assert.equal(props.textColor.toLowerCase(),'#113355');assert.equal(JSON.parse(doc.getParaPropertiesAt(0,0)).alignment,'center');}finally{doc.free();}
 }finally{await browser.close();}
});

test('columns preserve the document body', {skip:!process.env.PWH_STANDALONE_URL||!process.env.PWH_PLAYWRIGHT_MODULE||!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM,timeout:90000},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE),fs=await import('node:fs/promises'),{pathToFileURL}=await import('node:url');const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{const page=await browser.newPage({viewport:{width:1400,height:900}});await page.goto(process.env.PWH_STANDALONE_URL);const frame=page.frameLocator('#editor');await frame.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.type('Column test');const bytes=await page.locator('#editor').evaluate(async el=>{const e=el.contentWindow.pwhEditor;await e.desktopColumns({expected:e.context().documentState,section:0,columns:2});return Array.from(e.export().bytes);});const doc=new core.HwpDocument(Uint8Array.from(bytes));try{assert.equal(JSON.parse(doc.getColumnDef(0)).columnCount,2);assert.equal(doc.getTextRange(0,0,0,doc.getParagraphLength(0,0)),'Column test');}finally{doc.free();}
 }finally{await browser.close();}
});

test('attached PNG inserts as a picture at the body cursor', {skip:!process.env.PWH_STANDALONE_URL||!process.env.PWH_PLAYWRIGHT_MODULE||!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM||!process.env.PWH_TEST_IMAGE,timeout:90000},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE),fs=await import('node:fs/promises'),{pathToFileURL}=await import('node:url');const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{const page=await browser.newPage({viewport:{width:1400,height:900}});await page.goto(process.env.PWH_STANDALONE_URL);const frame=page.frameLocator('#editor');await frame.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();const input=Array.from(await fs.readFile(process.env.PWH_TEST_IMAGE));const bytes=await page.locator('#editor').evaluate(async(el,data)=>{const e=el.contentWindow.pwhEditor,buffer=Uint8Array.from(data),bitmap=await createImageBitmap(new Blob([buffer],{type:'image/png'})),image={width:bitmap.width,height:bitmap.height,extension:'png'};bitmap.close();await e.desktopInsertImage({expected:e.context(),image,widthMm:60},buffer);return Array.from(e.export().bytes);},input);const doc=new core.HwpDocument(Uint8Array.from(bytes));try{assert.ok(JSON.parse(doc.getControls()).some(c=>c.ctrlId==='gso'),'그림 개체가 저장되지 않았습니다.');}finally{doc.free();}await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.press('Control+z');const undo=await page.locator('#editor').evaluate(el=>Array.from(el.contentWindow.pwhEditor.export().bytes));const restored=new core.HwpDocument(Uint8Array.from(undo));try{assert.equal(JSON.parse(restored.getControls()).some(c=>c.ctrlId==='gso'),false,'그림 삽입 실행 취소에 실패했습니다.');}finally{restored.free();}
 }finally{await browser.close();}
});

test('Codex inserts an attached image in the editor', {skip:!process.env.PWH_STANDALONE_URL||!process.env.PWH_PLAYWRIGHT_MODULE||!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM||!process.env.PWH_TEST_IMAGE||process.env.PWH_CODEX_LIVE!=='1',timeout:240000},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE),fs=await import('node:fs/promises'),{pathToFileURL}=await import('node:url');const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{const page=await browser.newPage({viewport:{width:1400,height:900}});await page.goto(process.env.PWH_STANDALONE_URL);const frame=page.frameLocator('#editor');await frame.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});await page.waitForTimeout(2000);await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.locator('#image-file').setInputFiles(process.env.PWH_TEST_IMAGE);await page.locator('#attached-image').waitFor({state:'visible'});await page.locator('#prompt').fill('첨부한 이미지를 현재 본문 커서에 너비 60mm로 삽입하고 실제 결과를 확인해 주세요.');await page.locator('#send').click();await page.waitForFunction(()=>!document.querySelector('#send').disabled,null,{timeout:200000});const content=await page.locator('#conversation').innerText();const bytes=await page.locator('#editor').evaluate(el=>Array.from(el.contentWindow.pwhEditor.export().bytes));const doc=new core.HwpDocument(Uint8Array.from(bytes));try{assert.ok(JSON.parse(doc.getControls()).some(c=>c.ctrlId==='gso'),content);}finally{doc.free();}
 }finally{await browser.close();}
});

test('Codex combines document creation, columns and an attached image', {skip:!process.env.PWH_STANDALONE_URL||!process.env.PWH_PLAYWRIGHT_MODULE||!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM||!process.env.PWH_TEST_IMAGE||process.env.PWH_CODEX_LIVE!=='1',timeout:300000},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE),fs=await import('node:fs/promises'),{pathToFileURL}=await import('node:url');const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{const page=await browser.newPage({viewport:{width:1400,height:900}});await page.goto(process.env.PWH_STANDALONE_URL);const frame=page.frameLocator('#editor');await frame.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});await page.waitForTimeout(2000);await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.locator('#image-file').setInputFiles(process.env.PWH_TEST_IMAGE);await page.locator('#attached-image').waitFor({state:'visible'});await page.locator('#prompt').fill('빈 문서에 제목 AI 안내와 본문 함께 일하는 방법을 작성하세요. 그 다음 첫 구역을 2단으로 하고 첨부한 그림을 본문 커서에 삽입하세요. 각 작업 완료를 확인해 주세요.');await page.locator('#send').click();await page.waitForFunction(()=>!document.querySelector('#send').disabled,null,{timeout:270000});const content=await page.locator('#conversation').innerText();const bytes=await page.locator('#editor').evaluate(el=>Array.from(el.contentWindow.pwhEditor.export().bytes));const doc=new core.HwpDocument(Uint8Array.from(bytes));try{assert.equal(JSON.parse(doc.getColumnDef(0)).columnCount,2,content);assert.ok(JSON.parse(doc.getControls()).some(c=>c.ctrlId==='gso'),content);assert.match(doc.getTextRange(0,0,0,doc.getParagraphLength(0,0)),/AI/,content);}finally{doc.free();}
 }finally{await browser.close();}
});

test('Codex styles a body paragraph through the document tool', {skip:!process.env.PWH_STANDALONE_URL||!process.env.PWH_PLAYWRIGHT_MODULE||!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM||process.env.PWH_CODEX_LIVE!=='1',timeout:240000},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE),fs=await import('node:fs/promises'),{pathToFileURL}=await import('node:url');const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{const page=await browser.newPage({viewport:{width:1400,height:900}});await page.goto(process.env.PWH_STANDALONE_URL);const frame=page.frameLocator('#editor');await frame.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.type('TITLE');await page.waitForTimeout(2000);await page.locator('#prompt').fill('현재 문서의 TITLE 문단 글자를 진하게, 크기는 18pt, 색상은 #113355로 적용하고 결과를 확인해 주세요.');await page.locator('#send').click();await page.waitForFunction(()=>!document.querySelector('#send').disabled,null,{timeout:200000});const content=await page.locator('#conversation').innerText();const bytes=await page.locator('#editor').evaluate(el=>Array.from(el.contentWindow.pwhEditor.export().bytes));const doc=new core.HwpDocument(Uint8Array.from(bytes));try{const props=JSON.parse(doc.getCharPropertiesAt(0,0,0));assert.equal(props.bold,true,content);assert.equal(props.fontSize,1800,content);assert.equal(props.textColor.toLowerCase(),'#113355',content);}finally{doc.free();}
 }finally{await browser.close();}
});

test('Codex applies two columns through the document tool', {skip:!process.env.PWH_STANDALONE_URL||!process.env.PWH_PLAYWRIGHT_MODULE||!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM||process.env.PWH_CODEX_LIVE!=='1',timeout:240000},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE),fs=await import('node:fs/promises'),{pathToFileURL}=await import('node:url');const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{const page=await browser.newPage({viewport:{width:1400,height:900}});await page.goto(process.env.PWH_STANDALONE_URL);const frame=page.frameLocator('#editor');await frame.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.type('Column test');await page.waitForTimeout(2000);await page.locator('#prompt').fill('이 문서의 첫 구역을 2단으로 설정해 주고 결과를 확인해 주세요.');await page.locator('#send').click();await page.waitForFunction(()=>!document.querySelector('#send').disabled,null,{timeout:200000});const content=await page.locator('#conversation').innerText();const bytes=await page.locator('#editor').evaluate(el=>Array.from(el.contentWindow.pwhEditor.export().bytes));const doc=new core.HwpDocument(Uint8Array.from(bytes));try{assert.equal(JSON.parse(doc.getColumnDef(0)).columnCount,2,content);assert.equal(doc.getTextRange(0,0,0,doc.getParagraphLength(0,0)),'Column test',content);}finally{doc.free();}
 }finally{await browser.close();}
});

test('chat splitter and inline model selector are usable', {skip:!process.env.PWH_STANDALONE_URL||!process.env.PWH_PLAYWRIGHT_MODULE,timeout:90000},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE);const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{const page=await browser.newPage({viewport:{width:1400,height:900}});await page.goto(process.env.PWH_STANDALONE_URL);await page.frameLocator('#editor').locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});
  const before=await page.locator('aside').boundingBox();const split=await page.locator('#splitter').boundingBox();await page.mouse.move(split.x+3,split.y+100);await page.mouse.down();await page.mouse.move(split.x+103,split.y+100);await page.mouse.up();const after=await page.locator('aside').boundingBox();assert.ok(after.width>before.width+50);
  await page.locator('#composer-model').click();await page.waitForFunction(()=>document.querySelectorAll('#quick-model option').length>1,null,{timeout:30000});
  const candidate=await page.locator('#quick-model option').nth(1).getAttribute('value');await page.locator('#quick-model').selectOption(candidate);assert.ok(await page.locator('#quick-effort option').count()>1,'추론 강도 목록을 읽지 못했습니다');
 }finally{await browser.close();}
});

test('model menu remains open while an AI request is running', {skip:!process.env.PWH_STANDALONE_URL||!process.env.PWH_PLAYWRIGHT_MODULE,timeout:90000},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE);const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{const page=await browser.newPage({viewport:{width:1400,height:900}});await page.route('**/ai/send',async route=>{await new Promise(r=>setTimeout(r,6000));await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({text:'시험 답변',applied:false})});});await page.goto(process.env.PWH_STANDALONE_URL);await page.frameLocator('#editor').locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});await page.waitForTimeout(2000);await page.locator('#prompt').fill('시험');await page.locator('#send').click();await page.locator('#send:disabled').waitFor();await page.locator('#composer-model').click();await page.waitForTimeout(1500);assert.equal(await page.locator('#model-menu').evaluate(el=>el.open),true);await page.waitForFunction(()=>!document.querySelector('#send').disabled,null,{timeout:30000});
 }finally{await browser.close();}
});

test('identical tables can receive one document-wide style', {skip:!process.env.PWH_STANDALONE_URL||!process.env.PWH_PLAYWRIGHT_MODULE,timeout:90000},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE);const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{const page=await browser.newPage({viewport:{width:1400,height:900}});await page.goto(process.env.PWH_STANDALONE_URL);await page.frameLocator('#editor').locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});
  const result=await page.locator('#editor').evaluate(async el=>{const editor=el.contentWindow.pwhEditor,table={rows:1,columns:1,cells:[{row:0,column:0,paragraphs:['동일']}]};await editor.tableInsert({expected:editor.context(),table});await editor.tableInsert({expected:editor.context(),table});const inspected=await editor.tables({expected:editor.context()});const plan=inspected.tablePlan;if(plan.tables.length!==2)throw Error('표 두 개를 만들지 못했습니다: '+plan.tables.length);const theme=structuredClone(plan.tables[0].theme);theme.header.fillColor='#336699';const changed=await editor.tableStyle({expected:editor.context(),planId:plan.planId,scope:'document',theme});const after=await editor.tables({expected:editor.context()});return {count:changed.changes.length,tables:after.tablePlan.tables};});assert.equal(result.count,2);for(const table of result.tables){assert.equal(table.theme.header.fillColor.toLowerCase(),'#336699');assert.equal(table.cells[0].paragraphs[0],'동일');}
 }finally{await browser.close();}
});

test('Codex applies styling to identical tables in the editor', {skip:!process.env.PWH_STANDALONE_URL||!process.env.PWH_PLAYWRIGHT_MODULE||process.env.PWH_CODEX_LIVE!=='1',timeout:240000},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE);const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{const page=await browser.newPage({viewport:{width:1400,height:900}});await page.goto(process.env.PWH_STANDALONE_URL);const frame=page.frameLocator('#editor');await frame.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});await page.locator('#editor').evaluate(async el=>{const e=el.contentWindow.pwhEditor,t={rows:1,columns:1,cells:[{row:0,column:0,paragraphs:['동일']}]};await e.tableInsert({expected:e.context(),table:t});await e.tableInsert({expected:e.context(),table:t});});await page.waitForTimeout(2500);await page.locator('#prompt').fill('현재 문서의 모든 표를 통일하세요. 첫 표 디자인을 기준으로 하되 머리 셀 배경을 #336699로 지정하고 두 표 모두 적용한 뒤 결과를 확인하세요.');await page.locator('#send').click();await page.waitForFunction(()=>!document.querySelector('#send').disabled,null,{timeout:200000});const content=await page.locator('#conversation').innerText();const tables=await page.locator('#editor').evaluate(async el=>(await el.contentWindow.pwhEditor.tables({expected:el.contentWindow.pwhEditor.context()})).tablePlan.tables);assert.equal(tables.length,2,content);for(const t of tables)assert.equal(t.theme.header.fillColor.toLowerCase(),'#336699',content);
 }finally{await browser.close();}
});

test('independent window loads real pwh and retains manual text editing', {skip:!process.env.PWH_STANDALONE_URL||!process.env.PWH_PLAYWRIGHT_MODULE,timeout:90000}, async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE);
 const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:900}});
  await page.goto(process.env.PWH_STANDALONE_URL);
  const frame=page.frameLocator('#editor');
  await frame.getByRole('textbox',{name:'문서 편집 입력'}).waitFor({state:'visible',timeout:60000});
  await frame.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});
  await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();
  await page.keyboard.type('Hello pwh');
  const state=await page.locator('#editor').evaluate(el=>el.contentWindow.pwhEditor.context());
  assert.equal(state.documentState.dirty,true);
  await page.getByRole('button',{name:'AI 설정'}).click();
  await page.locator('#provider').selectOption('local');
  assert.equal(await page.locator('#local-url').inputValue(),'http://127.0.0.1:11434/v1');
 }finally{await browser.close();}
});

test('opens an HWP as a new verified HWPX without modifying the source', {skip:!process.env.PWH_STANDALONE_URL||!process.env.PWH_PLAYWRIGHT_MODULE||!process.env.PWH_TEST_HWP,timeout:90000}, async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE),fs=await import('node:fs/promises'),{createHash}=await import('node:crypto');
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),before=hash(await fs.readFile(process.env.PWH_TEST_HWP));
 const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:900}});await page.goto(process.env.PWH_STANDALONE_URL);
  await page.frameLocator('#editor').locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});
  await page.locator('#file').setInputFiles(process.env.PWH_TEST_HWP);
  await page.getByText('HWP 원본을 보존하고 HWPX 작업본으로 열었습니다.',{exact:false}).waitFor({timeout:60000});
  await page.frameLocator('#editor').locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});
  assert.equal(hash(await fs.readFile(process.env.PWH_TEST_HWP)),before);
 }finally{await browser.close();}
});

test('Codex uses document tools to write in the same editor', {skip:!process.env.PWH_STANDALONE_URL||!process.env.PWH_PLAYWRIGHT_MODULE||process.env.PWH_CODEX_LIVE!=='1',timeout:240000}, async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE);
 const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:900}});await page.goto(process.env.PWH_STANDALONE_URL);
  const frame=page.frameLocator('#editor');await frame.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});
  const prior=await page.locator('#editor').getAttribute('src');await page.locator('#new').evaluate(el=>el.click());await page.waitForFunction(value=>document.querySelector('#editor').getAttribute('src')!==value,prior);const next=await page.locator('#editor').getAttribute('src');await page.waitForFunction(value=>document.querySelector('#editor').contentWindow.location.search===new URL(value,location.href).search,next);await frame.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});
  await page.waitForTimeout(2000);
  await page.locator('#prompt').fill('빈 문서에 테스트 문장 하나만 작성해 줘. 문장은 독립 조판기 시험입니다.');
  await page.locator('#send').click();
  await page.waitForFunction(()=>!document.querySelector('#send').disabled,null,{timeout:200000});
  const status=await page.locator('#status').innerText();
  assert.equal(status,'AI 작업 결과를 확인하세요.',await page.locator('#conversation').innerText());
  const state=await page.locator('#editor').evaluate(el=>el.contentWindow.pwhEditor.context());
  assert.equal(state.documentState.dirty,true,await page.locator('#conversation').innerText());
 }finally{await browser.close();}
});

test('Codex reads unsaved document body from the editor', {skip:!process.env.PWH_STANDALONE_URL||!process.env.PWH_PLAYWRIGHT_MODULE||process.env.PWH_CODEX_LIVE!=='1',timeout:240000},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE);const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{const page=await browser.newPage({viewport:{width:1400,height:900}});await page.goto(process.env.PWH_STANDALONE_URL);const frame=page.frameLocator('#editor');await frame.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});
  await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.type('The secret project is BLUEAPPLE.');await page.waitForTimeout(2500);
  await page.locator('#prompt').fill('pwh_desktop_read_document 도구로 현재 문서 본문을 읽고 project 이름만 답하세요.');await page.locator('#send').click();await page.waitForFunction(()=>!document.querySelector('#send').disabled,null,{timeout:200000});
  assert.match(await page.locator('#conversation').innerText(),/BLUEAPPLE/);assert.match(await page.locator('#status').innerText(),/결과를 확인/);
 }finally{await browser.close();}
});

test('Codex reads a nested table after more than 64 tables', {skip:!process.env.PWH_STANDALONE_URL||!process.env.PWH_PLAYWRIGHT_MODULE||!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM||process.env.PWH_CODEX_LIVE!=='1',timeout:300000},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE),fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{pathToFileURL}=await import('node:url'),{pasteHtmlTableInCell}=await import('../release-source/src/nested-table-paste.mjs');const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-scan-browser-')),file=path.join(dir,'synthetic.hwpx'),d=core.HwpDocument.createEmpty();d.createBlankDocument();
 try{for(let i=0;i<78;i++){if(i>0)d.insertParagraph(0,d.getParagraphCount(0));const p=d.getParagraphCount(0)-1,t=JSON.parse(d.createTable(0,p,0,1,1));d.insertTextInCell(0,t.paraIdx,t.controlIdx,0,0,0,'TABLE-'+String(i).padStart(3,'0'));}d.insertParagraph(0,d.getParagraphCount(0));const p=d.getParagraphCount(0)-1,outer=JSON.parse(d.createTable(0,p,0,1,1)),bridge=new Proxy(d,{get(t,k){if(k==='copyControl')return(s,para,ci,path='')=>t.copyControl(s,para,path,ci);if(k==='insertPwhScratchParagraph')return t.insertParagraph.bind(t);if(k==='deletePwhScratchParagraph')return t.deleteParagraph.bind(t);const v=t[k];return typeof v==='function'?v.bind(t):v;}});pasteHtmlTableInCell(bridge,{cursor:{sectionIndex:0,parentParaIndex:outer.paraIdx,controlIndex:outer.controlIdx,cellIndex:0,cellParaIndex:0,charOffset:0},kind:'cell_text',selection:null},'<table><tr><td>NESTED-MARKER</td></tr></table>',{rows:1,columns:1,cells:[{row:0,column:0,paragraphs:['NESTED-MARKER']}]});await fs.writeFile(file,d.exportHwpx());}finally{d.free();}
 const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});try{const page=await browser.newPage({viewport:{width:1400,height:900}});await page.goto(process.env.PWH_STANDALONE_URL);let frame=page.frameLocator('#editor');await frame.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});const old=await page.locator('#editor').getAttribute('src');await page.locator('#file').setInputFiles(file);await page.waitForFunction(previous=>document.querySelector('#editor').getAttribute('src')!==previous,old);const next=await page.locator('#editor').getAttribute('src');await page.waitForFunction(value=>document.querySelector('#editor').contentWindow.location.search===new URL(value,location.href).search,next);frame=page.frameLocator('#editor');await frame.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:90000});await page.locator('#status').filter({hasText:'조판기 준비 완료'}).waitFor({timeout:90000});await page.locator('#prompt').fill('문서 구조 스캔을 끝까지 읽고, 마지막 표의 영문 표식 두 개를 그대로 알려 주세요.');await page.locator('#send').click();await page.waitForFunction(()=>!document.querySelector('#send').disabled,null,{timeout:240000});const content=await page.locator('#conversation').innerText();assert.match(content,/TABLE-077/,content);assert.match(content,/NESTED-MARKER/,content);
 }finally{await browser.close();await fs.rm(dir,{recursive:true,force:true});}
});

test('editor AI dialog sends its request to the connected conversation', {skip:!process.env.PWH_STANDALONE_URL||!process.env.PWH_PLAYWRIGHT_MODULE||process.env.PWH_CODEX_LIVE!=='1',timeout:240000},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE);const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{const page=await browser.newPage({viewport:{width:1400,height:900}});await page.goto(process.env.PWH_STANDALONE_URL);const frame=page.frameLocator('#editor');await frame.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});await page.waitForTimeout(2000);
  await page.locator('#editor').evaluate(async el=>{const w=el.contentWindow;const context=await w.pwhEditor.capture();w.dispatchEvent(new w.CustomEvent('pwh-ai-request',{detail:context}));});
  await frame.getByRole('textbox',{name:'수정 요청 내용'}).fill('문서에 새로 작성할 수 있는지 짧게 알려 주세요.');await frame.locator('#pwh-ai-dialog .send').click();await frame.locator('#pwh-ai-dialog').waitFor({state:'hidden',timeout:30000});
  await page.waitForFunction(()=>!document.querySelector('#send').disabled,null,{timeout:200000});assert.match(await page.locator('#conversation').innerText(),/문서에 새로 작성할 수 있는지/);assert.doesNotMatch(await page.locator('#conversation').innerText(),/현재 문서와 일치하지|연결이 없습니다|전달 기능을 제공하지/);
 }finally{await browser.close();}
});

test('Codex adds a merged title row to an existing table', {skip:!process.env.PWH_STANDALONE_URL||!process.env.PWH_PLAYWRIGHT_MODULE||process.env.PWH_CODEX_LIVE!=='1'||!process.env.PWH_CORE_JS,timeout:240000}, async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE),fs=await import('node:fs/promises'),{pathToFileURL}=await import('node:url');
 const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:900}});await page.goto(process.env.PWH_STANDALONE_URL);
  const frame=page.frameLocator('#editor');await frame.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});
  const prior=await page.locator('#editor').getAttribute('src');await page.locator('#new').evaluate(el=>el.click());await page.waitForFunction(value=>document.querySelector('#editor').getAttribute('src')!==value,prior);const next=await page.locator('#editor').getAttribute('src');await page.waitForFunction(value=>document.querySelector('#editor').contentWindow.location.search===new URL(value,location.href).search,next);await frame.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});
  await page.locator('#editor').evaluate(async el=>{const editor=el.contentWindow.pwhEditor;await editor.tableInsert({expected:editor.context(),table:{rows:2,columns:2,cells:[{row:0,column:0,paragraphs:['항목']},{row:0,column:1,paragraphs:['내용']},{row:1,column:0,paragraphs:['가']},{row:1,column:1,paragraphs:['나']}]}});});
  await page.waitForTimeout(2500);await page.locator('#prompt').fill('현재 문서의 첫 번째 표 맨 위에 기존 행을 유지하면서 전체 칸을 합친 제목 행을 추가하고 제목을 동물 소개로 넣어 줘.');await page.locator('#send').click();
  await page.waitForFunction(()=>!document.querySelector('#send').disabled,null,{timeout:200000});
  const content=await page.locator('#conversation').innerText();
  const bytes=await page.locator('#editor').evaluate(el=>Array.from(el.contentWindow.pwhEditor.export().bytes));const document=new core.HwpDocument(Uint8Array.from(bytes));
  try{const table=JSON.parse(document.getControls()).find(c=>c.ctrlId==='tbl');assert.ok(table,content);const d=JSON.parse(document.getTableDimensions(0,table.para,table.controlIndex));assert.equal(d.rowCount,3,content);const cell=JSON.parse(document.getCellInfo(0,table.para,table.controlIndex,0));assert.equal(cell.colSpan,2,content);assert.equal(document.getTextInCell(0,table.para,table.controlIndex,0,0,0,5),'동물 소개',content);}finally{document.free();}
 }finally{await browser.close();}
});

test('local OpenAI-compatible server answers from the desktop chat', {skip:!process.env.PWH_STANDALONE_URL||!process.env.PWH_PLAYWRIGHT_MODULE,timeout:90000},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE),{createServer}=await import('node:http');
 const server=createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/v1/models')res.end(JSON.stringify({data:[{id:'fake-model'}]}));else if(req.url==='/v1/chat/completions')res.end(JSON.stringify({choices:[{message:{content:'수정된 문장'}}]}));else{res.statusCode=404;res.end('{}');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});let page;
 try{
  page=await browser.newPage({viewport:{width:1400,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(process.env.PWH_STANDALONE_URL);
  const frame=page.frameLocator('#editor');await frame.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});
  const prior=await page.locator('#editor').getAttribute('src');await page.locator('#new').evaluate(el=>el.click());await page.waitForFunction(value=>document.querySelector('#editor').getAttribute('src')!==value,prior);const next=await page.locator('#editor').getAttribute('src');await page.waitForFunction(value=>document.querySelector('#editor').contentWindow.location.search===new URL(value,location.href).search,next);await frame.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:60000});
  await page.getByRole('button',{name:'AI 설정'}).click();await page.locator('#provider').selectOption('local');await page.locator('#local-url').fill(`http://127.0.0.1:${server.address().port}/v1`);await page.locator('#local-model').fill('fake-model');await page.locator('#save-settings').click();await page.locator('#settings-dialog').waitFor({state:'hidden'});
  await page.locator('#prompt').fill('인사해 줘');await page.locator('#send').click();try{await page.locator('#conversation').getByText('수정된 문장').waitFor({timeout:15000});}catch(error){throw Error(`status=${await page.locator('#status').innerText()} chat=${await page.locator('#conversation').innerText()} errors=${errors.join(';')}`);}
  assert.equal(await page.locator('#status').innerText(),'AI 답변만 받았습니다. 문서는 변경되지 않았습니다.',await page.locator('#conversation').innerText());assert.match(await page.locator('#conversation').innerText(),/수정된 문장/);
  await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.type('Hello');for(let i=0;i<5;i++)await page.keyboard.press('Shift+ArrowLeft');
  const selected=await page.locator('#editor').evaluate(async el=>await el.contentWindow.pwhEditor.capture());assert.equal(selected.selectedText.text,'Hello');
  await page.locator('#prompt').fill('선택한 글을 다듬어 줘');await page.locator('#send').click();await page.locator('#status').filter({hasText:'선택한 글에 적용했습니다.'}).waitFor({timeout:60000});
 }finally{if(page)await page.evaluate(()=>fetch('settings/write',{method:'POST',headers:{'x-pwh-request':'1','content-type':'application/json'},body:JSON.stringify({provider:'codex',localBaseUrl:'http://127.0.0.1:11434/v1',localModel:'',codexModel:''})})).catch(()=>{});await browser.close();await new Promise(resolve=>server.close(resolve));}
});
