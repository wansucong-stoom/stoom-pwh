import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {centeredWrapFixture,resetBlockTableFixture,deferredBodyPictureFixture,leadingTableTextFixture,standalonePicturePageFixture} from './engine-source-ownership/page-frame-fixture.mjs';

const skip=!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM?'Requires explicit candidate core paths':false;
let candidatePromise,referencePromise;
async function load(js,wasm){const core=await import(pathToFileURL(js));await core.default({module_or_path:await fs.readFile(wasm)});return core;}
const candidate=()=>candidatePromise??=load(process.env.PWH_CORE_JS,process.env.PWH_CORE_WASM);
const reference=()=>referencePromise??=load(process.env.PWH_PAGE_FRAME_REFERENCE_JS,process.env.PWH_PAGE_FRAME_REFERENCE_WASM);
const referenceSkip=skip||(!process.env.PWH_PAGE_FRAME_REFERENCE_JS||!process.env.PWH_PAGE_FRAME_REFERENCE_WASM?'Requires PWH_PAGE_FRAME_REFERENCE_JS and PWH_PAGE_FRAME_REFERENCE_WASM':false);
function inspect(doc){return Array.from({length:doc.pageCount()},(_,page)=>({page,runs:JSON.parse(doc.getPageTextLayout(page)).runs,
 controls:JSON.parse(doc.getPageControlLayout(page)).controls,svg:doc.renderPageSvgWithProfile(page,'print')}));}
const find=(pages,text)=>pages.flatMap(page=>page.runs.filter(run=>run.text.includes(text)).map(run=>({...run,page:page.page})));
function roundtrip(core,doc){const before=inspect(doc),reopened=new core.HwpDocument(doc.exportHwpx());try{assert.deepEqual(inspect(reopened),before);}finally{reopened.free();}}

test('a positive source page-start host owns its leading table reservation once',{skip},async()=>{
 const core=await candidate(),doc=new core.HwpDocument(leadingTableTextFixture());try{
 const pages=inspect(doc);assert.equal(pages.length,2);assert.equal(find(pages,'AFTER_26')[0].page,1);
 const after=find(pages,'AFTER_0')[0];assert.ok(Math.abs(after.y-(5670+18220)/75)<.15,'The successor begins immediately after the original host text advance');
 assert.equal(pages[1].controls.filter(c=>c.type==='table').length,1);
 roundtrip(core,doc);const snapshot=doc.saveSnapshot(),before=pages.map(p=>p.svg);
 doc.insertText(0,0,0,'EDIT_');doc.pageCount();doc.restoreSnapshot(snapshot);doc.discardSnapshot(snapshot);assert.deepEqual(inspect(doc).map(p=>p.svg),before);
 }finally{doc.free();}
});
for(const height of [12000,18000,24000])for(const hostLines of [1,3])test(`leading reservation uses geometry across ${height} units and ${hostLines} text lines`,{skip},async()=>{
 const margin=500,core=await candidate(),doc=new core.HwpDocument(leadingTableTextFixture({height,margin,hostLines}));try{
 const pages=inspect(doc);assert.equal(pages.length,2);
 const after=find(pages,'AFTER_0')[0];assert.equal(after.page,1);assert.ok(Math.abs(after.y-(5670+height+2*margin+1980*hostLines)/75)<.15);
 roundtrip(core,doc);
 }finally{doc.free();}
});
for(const options of [{overlap:true},{closed:false},{pageBreak:false},{height:6000,margin:500}])test(`unproved leading table reservations preserve the existing path ${JSON.stringify(options)}`,{skip:referenceSkip},async()=>{
 const core=await candidate(),prior=await reference(),bytes=leadingTableTextFixture(options),doc=new core.HwpDocument(bytes),old=new prior.HwpDocument(bytes);
 try{assert.deepEqual(inspect(doc),inspect(old));}finally{doc.free();old.free();}
});

test('a tail flow picture gets its own page before a following explicit break',{skip},async()=>{
 const core=await candidate(),doc=new core.HwpDocument(standalonePicturePageFixture(core));try{
 const pages=inspect(doc);assert.equal(pages.length,3);assert.deepEqual(pages.map(p=>p.controls.filter(c=>c.type==='image').length),[0,1,0]);
 assert.equal(find(pages,'BEFORE_21')[0].page,0);assert.equal(find(pages,'AFTER_EXPLICIT_BREAK')[0].page,2);
 const image=pages[1].controls.find(c=>c.type==='image');assert.ok(Math.abs(image.y-5670/75)<.2);roundtrip(core,doc);
 }finally{doc.free();}
});
for(const options of [{overlap:true},{nextBreak:false},{continuous:false}])test(`unproved standalone picture pages preserve the existing path ${JSON.stringify(options)}`,{skip:referenceSkip},async()=>{
 const core=await candidate(),prior=await reference(),bytes=standalonePicturePageFixture(prior,options),doc=new core.HwpDocument(bytes),old=new prior.HwpDocument(bytes);
 try{assert.deepEqual(inspect(doc),inspect(old));}finally{doc.free();old.free();}
});

for(const spaces of [1,3])test(`centered wrapped text excludes ${spaces} trailing spaces on the first line`,{skip},async()=>{
 const core=await candidate(),doc=new core.HwpDocument(centeredWrapFixture({spaces}));try{
 const run=find(inspect(doc),'CENTERED SAMPLE')[0],visibleRight=run.x+run.charX['CENTERED SAMPLE'.length];
 assert.ok(Math.abs((run.x+visibleRight)/2-59528/150)<.15,'Visible first-line text owns the same page center as its final line');
 roundtrip(core,doc);
 }finally{doc.free();}
});
test('underlined trailing spaces keep their visible width in centered text',{skip},async()=>{
 const core=await candidate(),doc=new core.HwpDocument(centeredWrapFixture({spaces:3,underline:true}));try{
 const run=find(inspect(doc),'CENTERED SAMPLE')[0];assert.ok(run.underline);assert.ok(Math.abs(run.x+run.w/2-59528/150)<.15);
 }finally{doc.free();}
});
for(const guide of [false,true])test(`missing-line synthesis preserves a source-closed table page restart (${guide?'leading guide':'direct host'})`,{skip},async()=>{
 const core=await candidate(),doc=new core.HwpDocument(resetBlockTableFixture({guide}));try{
 const pages=inspect(doc);assert.equal(pages.length,2);assert.equal(pages[0].controls.filter(c=>c.type==='table').length,0);
 assert.equal(pages[1].controls.filter(c=>c.type==='table').length,1);
 const before=find(pages,'BEFORE_33'),tail=find(pages,'AFTER_TABLE');assert.equal(before.length,1);assert.equal(before[0].page,0);assert.equal(tail.length,1);assert.equal(tail[0].page,1);
 for(const page of pages)for(const run of page.runs.filter(r=>r.text.trim()))assert.ok(run.y+run.h<84186/75,'Every line fits the physical paper');
 roundtrip(core,doc);const snapshot=doc.saveSnapshot(),original=pages.map(p=>p.svg);
 doc.insertText(0,0,0,'EDIT_');doc.pageCount();doc.restoreSnapshot(snapshot);doc.discardSnapshot(snapshot);assert.deepEqual(inspect(doc).map(p=>p.svg),original);
 }finally{doc.free();}
});
for(const caption of [true,false])test(`a deferred picture ${caption?'with':'without'} a caption shares the restart frame with text`,{skip},async()=>{
 const core=await candidate(),doc=new core.HwpDocument(deferredBodyPictureFixture(core,{caption}));try{
 const pages=inspect(doc);assert.equal(pages.length,2);assert.deepEqual(pages.map(p=>p.controls.filter(c=>c.type==='image').length),[0,1]);
 for(const prefix of ['SPLIT A','SPLIT B','SPLIT C','SPLIT D']){const runs=find(pages,prefix);assert.equal(runs.length,1);assert.equal(runs[0].page,0);}
 assert.equal(find(pages,'RESUMED')[0].page,1);assert.equal(find(pages,'AFTER_PICTURE')[0].page,1);
 const image=pages[1].controls.find(c=>c.type==='image'),resumed=find(pages,'RESUMED')[0];assert.ok(image.y+image.h<=resumed.y+.2);
 const caret=JSON.parse(doc.getCursorRect(resumed.secIdx,resumed.paraIdx,resumed.charStart+1));
 assert.equal(caret.pageIndex,1,'The cursor shares the text restart page');
 roundtrip(core,doc);
 }finally{doc.free();}
});
for(const options of [{relativeTo:'PAPER'},{overlap:true},{closed:false}])test(`unproved picture frames preserve the existing path ${JSON.stringify(options)}`,{skip:referenceSkip},async()=>{
 const core=await candidate(),prior=await reference(),bytes=deferredBodyPictureFixture(prior,options),doc=new core.HwpDocument(bytes),old=new prior.HwpDocument(bytes);
 try{assert.deepEqual(inspect(doc),inspect(old));}finally{doc.free();old.free();}
});
for(const options of [{relativeTo:'PAGE'},{flow:false},{reset:4000}])test(`unproved table restarts preserve the existing path ${JSON.stringify(options)}`,{skip:referenceSkip},async()=>{
 const core=await candidate(),prior=await reference(),bytes=resetBlockTableFixture(options),doc=new core.HwpDocument(bytes),old=new prior.HwpDocument(bytes);
 try{assert.deepEqual(inspect(doc),inspect(old));}finally{doc.free();old.free();}
});
