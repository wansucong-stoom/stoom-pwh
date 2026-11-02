import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {floatingHostLineFixture} from './engine-source-ownership/floating-host-line-fixture.mjs';
import {mapHwpxMember} from './engine-source-ownership/hwpx-fixture-utils.mjs';

const skip=process.env.PWH_CANDIDATE_CORE_TESTS!=='1'?'Set PWH_CANDIDATE_CORE_TESTS=1 to qualify the explicit r14 candidate':
 (!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM?'Requires PWH_CORE_JS and PWH_CORE_WASM candidate paths':false);
const fallbackSkip=skip||(!process.env.PWH_FLOAT_FRAME_BASE_JS||!process.env.PWH_FLOAT_FRAME_BASE_WASM?'Requires an explicit prior-core fallback baseline':false);
let candidatePromise,baselinePromise;
async function load(js,wasm){const core=await import(pathToFileURL(js));await core.default({module_or_path:await fs.readFile(wasm)});return core;}
const candidate=()=>candidatePromise??=load(process.env.PWH_CORE_JS,process.env.PWH_CORE_WASM);
const baseline=()=>baselinePromise??=load(process.env.PWH_FLOAT_FRAME_BASE_JS,process.env.PWH_FLOAT_FRAME_BASE_WASM);
const markers=['PRELUDE','ANCHOR_HOST','CHILD_0','CHILD_1','CHILD_2','TAIL'];
const scan=doc=>JSON.parse(doc.getScanItems()).map(item=>item.text).join('');
const allRuns=doc=>Array.from({length:doc.pageCount()},(_,page)=>JSON.parse(doc.getPageTextLayout(page)).runs.map(run=>({...run,page}))).flat();
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function owners(doc){
 const runs=allRuns(doc);
 return markers.map(text=>{const matches=runs.filter(run=>run.text===text);assert.equal(matches.length,1,text+' must have exactly one source owner');return matches[0];});
}
function assertOrder(runs){for(let i=1;i<runs.length;i++){const a=runs[i-1],b=runs[i];assert.ok(a.page<b.page||(a.page===b.page&&a.y+a.h<=b.y+0.2),a.text+' must precede '+b.text);}}
function spacingFixture(spacing){
 return mapHwpxMember(floatingHostLineFixture(),'Contents/section0.xml',xml=>{
  const marker='<hp:t>ANCHOR_HOST</hp:t></hp:run><hp:linesegarray>',start=xml.indexOf(marker);assert.ok(start>=0);
  const end=xml.indexOf('</hp:linesegarray>',start),host=xml.slice(start,end);assert.ok(host.includes('spacing="0"'));
  return xml.slice(0,start)+host.replace('spacing="0"',`spacing="${spacing}"`)+xml.slice(end);
 });
}
function paperFixture(height){return mapHwpxMember(floatingHostLineFixture(),'Contents/section0.xml',xml=>{assert.equal(xml.split('height="9300"').length,2);return xml.replace('height="9300"',`height="${height}"`);});}
function checkRoundtrip(core,doc){const reopened=new core.HwpDocument(doc.exportHwpx());try{assert.equal(scan(reopened),scan(doc));assert.equal(reopened.pageCount(),doc.pageCount());owners(reopened);}finally{reopened.free();}}

for(const spacing of [0,100,233,600,4000])test(`a source-closed float does not consume trailing line spacing twice (${spacing} HU)`,{skip},async()=>{
 const core=await candidate(),doc=new core.HwpDocument(spacingFixture(spacing)),reference=new core.HwpDocument(spacingFixture(0));
 try{
  const own=owners(doc);assertOrder(own);
  const geometry=runs=>runs.map(({text,page,y,h})=>({text,page,y,h}));
  assert.deepEqual(geometry(own),geometry(owners(reference)));assert.equal(doc.pageCount(),1);checkRoundtrip(core,doc);
 }finally{doc.free();reference.free();}
});
for(const height of [7100,7200,9300])test(`the complete original float frame fits the physical body (${height} HU)`,{skip},async()=>{
 const core=await candidate(),doc=new core.HwpDocument(paperFixture(height));
 try{
  const own=owners(doc);assertOrder(own);assert.equal(own[1].page,own[2].page);assert.ok(Math.abs(own[2].y-own[1].y-16)<=0.1);
  if(height<9300){assert.equal(own[5].page,1);assert.equal(own[5].y,0,'The successor belongs once to the next physical page');}
  checkRoundtrip(core,doc);
 }finally{doc.free();}
});
for(const options of [{offset:0,hostBefore:false},{offset:1200,hostBefore:false}])test(`an unclosed source keeps table-before-host order (offset ${options.offset})`,{skip},async()=>{
 const core=await candidate(),doc=new core.HwpDocument(floatingHostLineFixture(options));
 try{
  const own=owners(doc),host=own[1],last=own[4];assert.ok(last.page<host.page||(last.page===host.page&&last.y+last.h<=host.y+0.2));checkRoundtrip(core,doc);
 }finally{doc.free();}
});
test('editing a nested source owner and undoing restores the exact original float frame',{skip},async()=>{
 const core=await candidate(),doc=new core.HwpDocument(spacingFixture(600));
 try{
  const child=owners(doc)[4],original=scan(doc),svg=doc.renderPageSvgWithProfile(0,'print'),snapshot=doc.saveSnapshot();
  doc.insertTextInCellByPath(child.secIdx,child.parentParaIdx,JSON.stringify(child.cellPath),child.charStart,'EDIT_');
  assert.equal(scan(doc),original.replace('CHILD_2','EDIT_CHILD_2'));doc.pageCount();
  doc.restoreSnapshot(snapshot);assert.equal(scan(doc),original);assert.equal(doc.renderPageSvgWithProfile(0,'print'),svg);owners(doc);doc.discardSnapshot(snapshot);
 }finally{doc.free();}
});
for(const height of [2500,4000,6000])test(`a stored frame contradicting smaller paper retains the prior fallback (${height} HU)`,{skip:fallbackSkip},async()=>{
 const core=await candidate(),priorCore=await baseline(),bytes=paperFixture(height),doc=new core.HwpDocument(bytes),prior=new priorCore.HwpDocument(bytes);
 try{
  const hashes=subject=>Array.from({length:subject.pageCount()},(_,page)=>digest(subject.renderPageSvgWithProfile(page,'print')));
  assert.deepEqual(hashes(doc),hashes(prior));assert.equal(scan(doc),scan(prior));
  // This is a preservation check, not acceptance of existing oversized-frame
  // continuation quality. Source-ineligible legacy duplicates remain separate.
 }finally{doc.free();prior.free();}
});
