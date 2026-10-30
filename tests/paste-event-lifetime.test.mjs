import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the shipped interceptor with a clipboard store that expires at the
// end of event dispatch, as real ClipboardEvents are permitted to do.
class Transfer {
 constructor(values={}) { this.values=new Map(Object.entries(values));this.files=[];this.readable=true; }
 get types() { return this.readable?[...this.values.keys(),...(this.files.length?['Files']:[])]:[]; }
 get items() { const result=this.readable?[...this.files]:[];result.add=file=>this.files.push({kind:'file',type:file.type,getAsFile:()=>file});return result; }
 getData(type) { return this.readable?this.values.get(type)||'':''; }
 setData(type,value) { this.values.set(type,String(value)); }
 expire() { this.readable=false; }
}
class Event {
 constructor(type,opts={}) {Object.assign(this,{type,defaultPrevented:false,stopped:false},opts);}
 preventDefault(){this.defaultPrevented=true;}
 stopImmediatePropagation(){this.stopped=true;}
}
const source=await readFile(new URL('../src/table-clipboard.mjs',import.meta.url),'utf8');
const code=source.slice(source.indexOf('export function installTableClipboard')).replace('export function installTableClipboard','function installTableClipboard')+'\n;installTableClipboard;';
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function harness({values={},inCell=false,parseTable=false}={}) {
 const listeners={},seen=[],notices=[],mutations=[];
 const state={ready:true,cursor:{sectionIndex:0,paragraphIndex:0,charOffset:6,...inCell?{parentParaIndex:0}:{}},selection:{start:0,end:6},documentState:{documentEpoch:1,changeSeq:0}};
 const doc={activeElement:null,hasFocus:()=>true};
 const target={isConnected:true,ownerDocument:doc,dispatchEvent(event){event.target=target;listeners.paste(event);if(!event.defaultPrevented)seen.push(event.clipboardData);}};
 doc.activeElement=target;
 let resolveNative,rejectNative,nativeReads=0;
 const waiting=new Promise((resolve,reject)=>{resolveNative=resolve;rejectNative=reject;});
 const spec={rows:1,columns:1,cells:[{row:0,column:0,rowSpan:1,columnSpan:1,paragraphs:['value']}]};
 const sandbox={document:{addEventListener:(type,fn)=>{listeners[type]=fn;}},window:{addEventListener(){}},DataTransfer:Transfer,ClipboardEvent:Event,structuredClone,
  crypto:{randomUUID:()=> 'fixture'},hasHancomModel:html=>html?.includes('[data-hwpjson]')||false,
  extractHancomTableModel:html=>html?.includes('[data-hwpjson]')?{fixture:true}:null,
  tableFromClipboardHtml:html=>parseTable&&html?.includes('<table')?spec:null,tableFromClipboardText:()=>null,
  insertStructuredTable:()=>({source:{sec:0,ppi:0,ci:0},cellIndices:[0]}),tableSnapshot:()=>({}),applyTableStyles:()=>{},
  pasteHancomTableInCell:()=>{},pasteInternalTableInCell:()=>{},pasteHtmlTableInCell:()=>{}};
 const install=vm.runInNewContext(code,sandbox);
 install({wasm:{clipboardHasControl:()=>false},read:()=>structuredClone(state),getInput:()=>null,notice:(message,isError)=>notices.push({message,isError}),
  nativeRead:()=>{nativeReads++;return waiting;},chooseTablePaste:async()=>null,
  mutate:async(expected,fn)=>{mutations.push(structuredClone(expected));return fn({});}});
 const data=new Transfer(values);
 function dispatch(){const event=new Event('paste',{isTrusted:true,clipboardData:data});target.dispatchEvent(event);data.expire();return event;}
 return {data,dispatch,state,seen,notices,mutations,resolveNative,rejectNative,nativeReads:()=>nativeReads,blur:()=>{doc.activeElement={};}};
}

for(const [name,values] of [
 ['plain text',{'text/plain':'translated'}],
 ['rich text and RTF',{'text/plain':'translated','text/html':'<p>translated</p>','text/rtf':'{\\rtf1 translated}'}],
]) test(`${name} uses the original event synchronously without a native read`,()=>{
 const h=harness({values});const event=h.dispatch();assert.equal(event.defaultPrevented,false);assert.equal(h.nativeReads(),0);assert.equal(h.seen.length,1);
});

test('an image file is not replaced by a later native clipboard image',()=>{
 const h=harness();const file={name:'fixture.png',type:'image/png'};h.data.items.add(file);h.dispatch();assert.equal(h.nativeReads(),0);assert.equal(h.seen.length,1);
});

test('an unavailable trusted clipboard is not read later and explains the table import option',()=>{
 const h=harness();const event=h.dispatch();assert.equal(h.nativeReads(),0);assert.equal(event.defaultPrevented,false);assert.equal(h.notices.length,1);assert.match(h.notices[0].message,/한글 표·셀 가져오기/);
});

test('table fallback uses copied event HTML and RTF after a delayed clipboard read',async()=>{
 const h=harness({values:{'text/plain':'one','text/html':'<table>one</table>','text/rtf':'{\\rtf1 one}'}});
 h.dispatch();assert.equal(h.nativeReads(),1);h.resolveNative({html:'',text:'one'});await settle();
 assert.equal(h.seen.length,1);assert.notEqual(h.seen[0],h.data);assert.equal(h.seen[0].getData('text/html'),'<table>one</table>');assert.equal(h.seen[0].getData('text/rtf'),'{\\rtf1 one}');
});

test('later unrelated Hancom model or image cannot replace the original table event',async()=>{
 const h=harness({values:{'text/plain':'one','text/html':'<table>one</table>'}});h.dispatch();
 h.resolveNative({html:'<!--[data-hwpjson]{"changed":true}-->',text:'different',png:'AA=='});await settle();
 assert.equal(h.seen.length,1);assert.equal(h.seen[0].getData('text/plain'),'one');assert.equal(h.seen[0].getData('text/html'),'<table>one</table>');
});

test('matching Hancom table model can retain rich source properties',async()=>{
 const h=harness({values:{'text/plain':'one','text/html':'<table>one</table>'}});h.dispatch();
 h.resolveNative({html:'<!--[data-hwpjson]{"fixture":true}-->',text:'one'});await settle();
 assert.equal(h.seen.length,1);assert.match(h.seen[0].getData('text/html'),/data-hwpjson/);
});

test('native read failure falls back to the event snapshot',async()=>{
 const h=harness({values:{'text/plain':'one','text/html':'<table>one</table>'}});h.dispatch();h.rejectNative(Error('unavailable'));await settle();
 assert.equal(h.seen.length,1);assert.equal(h.seen[0].getData('text/plain'),'one');
});

for(const [name,change] of [['focus',h=>h.blur()],['selection',h=>{h.state.selection=null;}],['document revision',h=>{h.state.documentState.changeSeq++;}]])
 test(`delayed table read cancels after ${name} changes`,async()=>{
  const h=harness({values:{'text/plain':'one','text/html':'<table>one</table>'}});h.dispatch();change(h);h.resolveNative({html:'',text:'one'});await settle();
  assert.equal(h.seen.length,0);assert.equal(h.mutations.length,0);assert.equal(h.notices.length,1);assert.equal(h.notices[0].isError,true);
 });

test('failed delayed paste does not leave a bypass flag on the next paste',async()=>{
 const h=harness({values:{'text/plain':'one','text/html':'<table>one</table>'}});h.dispatch();h.blur();h.resolveNative({html:'',text:'one'});await settle();
 assert.equal(h.notices.length,1);const before=h.nativeReads();h.data.readable=true;h.dispatch();assert.equal(h.nativeReads(),before+1);
});
