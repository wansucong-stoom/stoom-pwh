import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createTextSearchPlan} from '../release-source/src/text-edit.mjs';
import {zipEntries} from '../release-source/scripts/setup.mjs';

const configured=Boolean(process.env.PWH_STANDALONE_URL&&process.env.PWH_PLAYWRIGHT_MODULE&&process.env.PWH_CORE_JS&&process.env.PWH_CORE_WASM);
const enabled={skip:configured?false:'Set PWH_STANDALONE_URL, PWH_PLAYWRIGHT_MODULE, PWH_CORE_JS and PWH_CORE_WASM.',timeout:120000};
let corePromise;
async function core(){return corePromise??=(async()=>{const m=await import(pathToFileURL(path.resolve(process.env.PWH_CORE_JS)).href);await m.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});return m;})();}
const query='주간 보고 초안',replacement='주간 보고 확정',revision={documentEpoch:1,changeSeq:0,documentSha256:'synthetic'};
const parsed=v=>typeof v==='string'?JSON.parse(v):v;
const ok=v=>{const r=parsed(v);assert.equal(r?.ok,true,JSON.stringify(r));return r;};
const text=d=>parsed(d.getScanItems()).map(item=>item.text||'').join('');
const semantic=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!['charShapeId','borderFillId'].includes(key)));
function properties(d,source,offset){return semantic(parsed(source.cellPath?d.getCellCharPropertiesAtByPath(source.section,source.paragraph,JSON.stringify(source.cellPath),offset):d.getCharPropertiesAt(source.section,source.paragraph,offset)));}
function pictureSource(bytes){const entries=zipEntries(Buffer.from(bytes)),xml=entries.find(e=>e.name==='Contents/section0.xml').read().toString('utf8');return {pictures:[...xml.matchAll(/<hp:pic\b[\s\S]*?<\/hp:pic>/g)].map(m=>m[0]),binaries:entries.filter(e=>e.name.startsWith('BinData/')).map(e=>[e.name,Buffer.from(e.read()).toString('base64')])};}
async function fixture(){
 const {HwpDocument}=await core(),d=HwpDocument.createEmpty();d.createBlankDocument();try{
  ok(d.pasteHtml(0,0,0,`<p>본문 보존: ${query}</p><table><tr><td>바깥 셀: ${query}<table><tr><td>이중 셀: ${query}<table><tr><td>삼중 셀: ${query}</td></tr></table>이중 꼬리 보존</td><td>안쪽 형제 셀 보존</td></tr></table>바깥 꼬리 보존</td><td>바깥 형제 셀 보존</td></tr></table><p>마지막 본문 보존</p>`));
  const plan=createTextSearchPlan(d,revision,query);assert.deepEqual(plan.refs.map(r=>r.source.cellPath?.length||0),[0,1,2,3]);
  for(const ref of plan.refs){const format=(start,end,value)=>ok(ref.source.cellPath?d.applyCharFormatInCellByPath(0,ref.source.paragraph,JSON.stringify(ref.source.cellPath),ref.start+start,ref.start+end,JSON.stringify(value)):d.applyCharFormat(0,ref.source.paragraph,ref.start+start,ref.start+end,JSON.stringify(value)));format(0,2,{italic:true,textColor:'#a12638'});format(3,5,{bold:true,textColor:'#17394c'});}
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=','base64');ok(d.insertPicture(0,0,0,'[]',png,1200,900,1,1,'png','synthetic one pixel'));
  return d.exportHwpx();
 }finally{d.free();}
}
async function inspect(bytes){
 const {HwpDocument}=await core(),d=new HwpDocument(Uint8Array.from(bytes));try{
  const refs=[...createTextSearchPlan(d,revision,query).refs,...createTextSearchPlan(d,revision,replacement).refs].sort((a,b)=>(a.source.cellPath?.length||0)-(b.source.cellPath?.length||0));
  return {text:text(d),matches:refs.map(ref=>({depth:ref.source.cellPath?.length||0,source:ref.source,text:ref.original,retainedStyles:Array.from({length:6},(_,i)=>properties(d,ref.source,ref.start+i))})),tableCount:parsed(d.getControls()).filter(c=>c.ctrlId==='tbl').length,pictureSource:pictureSource(bytes)};
 }finally{d.free();}
}
async function openFixture(page,file){
 await page.goto(process.env.PWH_STANDALONE_URL);let frame=page.frameLocator('#editor');await frame.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:90000});
 const previous=await page.locator('#editor').getAttribute('src');await page.locator('#file').setInputFiles(file);await page.waitForFunction(old=>document.querySelector('#editor').getAttribute('src')!==old,previous);
 const next=await page.locator('#editor').getAttribute('src');await page.waitForFunction(value=>document.querySelector('#editor').contentWindow.location.search===new URL(value,location.href).search,next);
 frame=page.frameLocator('#editor');await frame.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:90000});await page.locator('#status').filter({hasText:'조판기 준비 완료'}).waitFor({timeout:90000});return frame;
}
const exported=page=>page.locator('#editor').evaluate(el=>Array.from(el.contentWindow.pwhEditor.export().bytes));
async function assertChangeAndUndo(page,frame,before){
 const after=await inspect(await exported(page));assert.equal(after.matches.length,4);assert.deepEqual(after.matches.map(r=>[r.depth,r.text]),[[0,query],[1,query],[2,replacement],[3,replacement]]);
 const expectedText=before.text.replace(`이중 셀: ${query}`,`이중 셀: ${replacement}`).replace(`삼중 셀: ${query}`,`삼중 셀: ${replacement}`);assert.equal(after.text,expectedText,'non-target source text changed');
 assert.equal(after.tableCount,before.tableCount);assert.deepEqual(after.pictureSource,before.pictureSource);
 for(let i=0;i<before.matches.length;i++){assert.deepEqual(after.matches[i].source,before.matches[i].source);assert.deepEqual(after.matches[i].retainedStyles,before.matches[i].retainedStyles,'retained bold/color/italic formatting changed');}
 await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.press('Control+z');await page.waitForTimeout(200);
 assert.deepEqual(await inspect(await exported(page)),before,'one undo must restore both nested-cell changes together');return after;
}
async function run(mode,fn){
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE),browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE}),dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-desktop-text-edit-'));
 try{const file=path.join(dir,'synthetic-nested-text.hwpx');await fs.writeFile(file,await fixture());const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));const frame=await openFixture(page,file),before=await inspect(await exported(page));await fn(page,frame,before);assert.deepEqual(errors,[]);
 }finally{await browser.close();const resolved=path.resolve(dir);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(resolved).startsWith('pwh-desktop-text-edit-'));await fs.rm(resolved,{recursive:true,force:true});}
}

test('Desktop adapter searches nested text, preserves mixed styles and undoes one batch',enabled,async()=>run('adapter',async(page,frame,before)=>{
 const response=await page.locator('#editor').evaluate(async(el,{query,replacement})=>{const e=el.contentWindow.pwhEditor,result=await e.textSearch({expected:e.context(),query}),search=result.textSearch;const hits=search.hits.filter(hit=>hit.depth>=2);const applied=await e.textEdit({expected:e.context(),edits:hits.map(hit=>({searchId:search.searchId,matchId:hit.id,replacement}))});return {depths:search.hits.map(hit=>hit.depth),applied};},{query,replacement});
 assert.deepEqual(response.depths,[0,1,2,3]);assert.equal(response.applied.ok,true);assert.equal(response.applied.undoSteps,1);assert.deepEqual(response.applied.changes,{ranges:2,paragraphs:2});await assertChangeAndUndo(page,frame,before);
}));

test('Desktop text edits leave valid end cursors and preserve a non-target source cursor',enabled,async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE),browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE}),{HwpDocument}=await core(),results=[];
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});await page.goto(process.env.PWH_STANDALONE_URL);const frame=page.frameLocator('#editor');await frame.locator('#pwh-status').filter({hasText:'본문에서 직접 편집하세요'}).waitFor({timeout:90000});
  const bytes=html=>{const d=HwpDocument.createEmpty();d.createBlankDocument();try{ok(d.pasteHtml(0,0,0,html));for(const table of parsed(d.getControls()).filter(c=>c.ctrlId==='tbl'&&c.list===0))ok(d.setCellProperties(0,table.para,table.controlIndex,0,JSON.stringify({height:10000})));return Array.from(d.exportHwpx());}finally{d.free();}};
  const read=async()=>{const output=await exported(page),d=new HwpDocument(Uint8Array.from(output));try{return text(d);}finally{d.free();}};
  const apply=async replacement=>page.locator('#editor').evaluate(async(el,replacement)=>{const e=el.contentWindow.pwhEditor,before=e.context().cursor,p=await e.textSearch({expected:e.context(),query:'abcdefghij'});if(p.textSearch.hits.length!==1)throw Error('Expected a unique synthetic phrase');const result=await e.textEdit({expected:e.context(),edits:[{searchId:p.textSearch.searchId,matchId:p.textSearch.hits[0].id,replacement}]});return {before,after:e.context().cursor,ok:result.ok};},replacement);
  for(const value of ['x','abcdefghijMORE']){
   await page.locator('#editor').evaluate(async(el,input)=>{await el.contentWindow.pwhEditor.load(Uint8Array.from(input),'synthetic-cursor.hwpx');},bytes('<p>abcdefghij</p>'));
   await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.press('Control+End');const result=await apply(value);assert.equal(result.before.charOffset,10);assert.equal(result.after.charOffset,Array.from(value).length);
   await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.type('Z');assert.equal((await page.locator('#editor').evaluate(el=>el.contentWindow.pwhEditor.context().cursor)).charOffset,Array.from(value).length+1);assert.equal((await read()).trim(),value+'Z');results.push({kind:value==='x'?'body-shortening':'body-expansion',afterOffset:result.after.charOffset,typing:true});
  }
  await page.locator('#editor').evaluate(async(el,input)=>{await el.contentWindow.pwhEditor.load(Uint8Array.from(input),'synthetic-nested-cursor.hwpx');},bytes('<p>body untouched</p><table><tr><td><table><tr><td>abcdefghij</td></tr></table></td></tr></table>'));
  await frame.locator('#sb-zoom-fit').click();await page.waitForTimeout(200);
  const point=await page.locator('#editor').evaluate(async el=>{const w=el.contentWindow,e=w.pwhEditor,plan=await e.textSearch({expected:e.context(),query:'abcdefghij'}),target=plan.textSearch.hits[0].source,pathKey=p=>JSON.stringify((p||[]).map(v=>[v.controlIndex,v.cellIndex,v.cellParaIndex])),canvas=el.contentDocument.querySelector('canvas.document-page-canvas'),box=canvas.getBoundingClientRect();for(let y=Math.max(0,box.top);y<Math.min(w.innerHeight,box.bottom);y+=4)for(let x=Math.max(0,box.left);x<Math.min(w.innerWidth,box.right);x+=4){const p=w.rhwpStudio.collaboration.hitTest({clientX:x,clientY:y}).position;if(p?.charOffset===10&&p.parentParaIndex===target.paragraph&&pathKey(p.cellPath)===pathKey(target.cellPath))return{x,y};}return null;});assert.ok(point,'the exact nested paragraph end must be reachable');
  const box=await page.locator('#editor').boundingBox();await page.mouse.click(box.x+point.x,box.y+point.y);const nested=await apply('x');assert.equal(nested.before.cellPath.length,2);assert.equal(nested.before.charOffset,10,JSON.stringify(nested));assert.equal(nested.after.charOffset,1);
  await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.type('Z');assert.equal((await page.locator('#editor').evaluate(el=>el.contentWindow.pwhEditor.context().cursor)).charOffset,2);assert.ok((await read()).includes('xZ'));results.push({kind:'nested-shortening',depth:2,afterOffset:1,typing:true});
  await page.locator('#editor').evaluate(async(el,input)=>{await el.contentWindow.pwhEditor.load(Uint8Array.from(input),'synthetic-other-cursor.hwpx');},bytes('<p>abcdefghij</p><p>KEEPHERE</p>'));
  await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.press('Control+End');const other=await apply('x');assert.equal(other.before.paragraphIndex,1);assert.deepEqual(other.after,other.before,'editing another source paragraph must not move the cursor');results.push({kind:'non-target-body',paragraph:1,offset:other.after.charOffset});
  if(process.env.PWH_TEST_ARTIFACT_DIR){await fs.mkdir(process.env.PWH_TEST_ARTIFACT_DIR,{recursive:true});await fs.writeFile(path.join(process.env.PWH_TEST_ARTIFACT_DIR,'text-cursor-results.json'),JSON.stringify(results,null,2)+'\n');}
 }finally{await browser.close();}
});

test('actual Codex uses shared text tools to update only 2/3-depth cells and one undo restores them',{...enabled,skip:!configured||process.env.PWH_CODEX_LIVE!=='1',timeout:300000},async()=>run('codex',async(page,frame,before)=>{
 const events=[],pending=[];page.on('response',response=>{if(response.url().endsWith('/ai/progress'))pending.push(response.json().then(body=>events.push(...(body.events||[]))).catch(()=>{}));});
 await page.locator('#prompt').fill(`현재 문서에서 원문 '${query}'를 '${replacement}'로 바꿔 주세요. 표 안의 표에 있는 이중 셀과 삼중 셀, 즉 source.cellPath 깊이가 2 이상인 검색 결과 두 개만 대상입니다. 본문과 바깥 셀의 같은 문구, 모든 다른 글과 표·그림은 그대로 두세요. 두 대상을 text_edit 한 번의 일괄 작업으로 수정하여 실행 취소 한 번으로 복원되게 하고, 반영 상태와 원문 재검색 결과도 확인해 주세요.`);
 await page.locator('#send').click();await page.waitForFunction(()=>!document.querySelector('#send').disabled,null,{timeout:270000});await Promise.all(pending);
 const conversation=await page.locator('#conversation').innerText(),tools=events.filter(event=>event.type==='tool').map(event=>event.name);const artifactRoot=process.env.PWH_TEST_ARTIFACT_DIR;
 if(artifactRoot){await fs.mkdir(artifactRoot,{recursive:true});await fs.writeFile(path.join(artifactRoot,'text-edit-codex-result.json'),JSON.stringify({tools,conversation,status:await page.locator('#status').innerText()},null,2)+'\n');await page.screenshot({path:path.join(artifactRoot,'text-edit-codex.png')});}
 assert.ok(tools.some(name=>name.includes('pwh_editor_text_search')),JSON.stringify({tools,conversation}));assert.equal(tools.filter(name=>name.includes('pwh_editor_text_edit')).length,1,JSON.stringify({tools,conversation}));await assertChangeAndUndo(page,frame,before);
}));
