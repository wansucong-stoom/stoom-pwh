import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assertRequestStateCurrent,normalizeRequestContext} from '../src/request-state.mjs';

const source=await readFile(new URL('../src/inline-host.js',import.meta.url),'utf8');
const marker="window.addEventListener('pwh-ai-request',event=>{";
const start=source.indexOf(marker),end=source.indexOf('\n async function replacementBytes',start);
assert.ok(start>=0&&end>start);
const body=source.slice(start+marker.length,end).replace(/\s*\}\);\s*$/,'');
// Execute the production dialog handler with a tiny DOM and a fake host. No
// user document, app state or external chat is changed by this regression.
const openDialog=new Function('event','state','document','window','tool','rpc','status','assertRequestStateCurrent','normalizeRequestContext',body);
const fresh={schemaVersion:1,format:'hwpx',documentEpoch:1,changeSeq:0,dirty:false,pageCount:1,documentSha256:'a'.repeat(64)};
const cached={schemaVersion:1,documentEpoch:1,changeSeq:0,format:'hwpx',pageCount:1,dirty:false,documentSha256:'a'.repeat(64)};
function context(state=fresh){return {ready:true,kind:'body_text',requestScope:'document',blankDocument:false,documentState:state,selection:null,objects:[],target:null};}
function harness(frozen,current,{captureError}={}){
 const calls=[],messages=[],statuses=[];let captureCalls=0,dialog;
 const element=()=>({style:{},setAttribute(){},addEventListener(){},after(){},focus(){}});
 const keyHandlers={},note={...element(),value:'  간격을 조정해 주세요.  ',addEventListener(type,handler){keyHandlers[type]=handler;}},notice=element(),submit={...element(),disabled:false},form={};
 const nodes={textarea:note,'.notice':notice,'.send':submit,form,'.selection':element(),'.cancel':element()};
 const document={getElementById:()=>null,body:{appendChild(){}},createElement(tag){
  if(tag!=='dialog')return element();
  dialog={...element(),querySelector:key=>nodes[key],showModal(){},close(){this.closed=true;}};return dialog;
 }};
 const window={pwhEditor:{context(){throw Error('A cached polling context must not guard submission');},async capture(){captureCalls++;if(captureError)throw Error(captureError);return structuredClone(current);}}};
 openDialog({detail:frozen},{loaded:true,host:{message:{text:{}}},sessionId:'test-session',source:'fixture.hwpx'},document,window,
  async(name,args)=>{calls.push({name,args});return {structuredContent:{requestId:'request-1'}};},async(method,args)=>{messages.push({method,args});return {};},text=>statuses.push(text),assertRequestStateCurrent,normalizeRequestContext);
 return {note,notice,submit,dialog,calls,messages,statuses,captureCalls:()=>captureCalls,send:()=>submit.onclick(),key:event=>keyHandlers.keydown(event)};
}

test('the real dialog submit reads fresh state, captures the frozen request, and reaches host chat',async()=>{
 const f=harness(context(fresh),context(cached));await f.send();
 assert.equal(f.captureCalls(),1);assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'pwh_editor_capture');
 assert.equal(f.calls[0].args.note,'간격을 조정해 주세요.');
 assert.equal('target' in f.calls[0].args.context,false);
 assert.equal(f.messages.length,1);assert.equal(f.messages[0].method,'ui/message');
 assert.ok(f.messages[0].args.content[0].text.includes('request-1'));
 assert.equal(f.dialog.closed,true);assert.equal(f.submit.disabled,false);
});

test('same-revision unsignaled SHA changes and fresh export failures send nothing and permit retry',async()=>{
 for(const options of [{current:context({...cached,documentSha256:'b'.repeat(64)})},{captureError:'fresh export failed'}]){
  const f=harness(context(fresh),options.current||context(cached),options);await f.send();
  assert.equal(f.captureCalls(),1);assert.equal(f.calls.length,0);assert.equal(f.messages.length,0);
  assert.equal(f.submit.disabled,false);assert.ok(f.notice.textContent);assert.notEqual(f.dialog.closed,true);
 }
});

test('tracked requests keep their original target across unrelated edits, but reopened documents reject',async()=>{
 const frozen={...context(fresh),target:{kind:'body_text',epoch:1,segments:[{id:'original-target'}]}};
 const f=harness(frozen,context({...cached,changeSeq:1,documentSha256:'b'.repeat(64)}));await f.send();
 assert.equal(f.messages.length,1);assert.deepEqual(f.calls[0].args.context.target,frozen.target);
 const reopened=harness(frozen,context({...cached,documentEpoch:2}));await reopened.send();
 assert.equal(reopened.calls.length,0);assert.equal(reopened.messages.length,0);
});

test('Ctrl+Enter uses the direct RPC handler and composition/repeat never sends a duplicate',async()=>{
 const f=harness(context(fresh),context(cached));
 const key={key:'Enter',ctrlKey:true,preventDefault(){},stopPropagation(){}};
 f.key({...key,isComposing:true});f.key({...key,repeat:true});
 assert.equal(f.captureCalls(),0);
 f.key(key);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.messages.length,1);assert.equal(f.captureCalls(),1);
});
