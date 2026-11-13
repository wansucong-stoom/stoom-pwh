import test from 'node:test';
import assert from 'node:assert/strict';
import {handleTableCreateChord} from '../src/table-create-shortcut.mjs';

const key=(letter,extra={})=>({key:letter,code:letter.length===1?'Key'+letter.toUpperCase():letter,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,repeat:false,preventDefault(){this.prevented=true;},...extra});
function context(){const calls=[],target=new EventTarget(),window=new EventTarget();target.ownerDocument={defaultView:window};return {calls,target,window,owner:{textarea:target,dispatcher:{dispatch:(...args)=>calls.push(args)},_cellBlockLetterImeGuard:{arm(){}}}};}
test('view and link chords resolve physical keys during Korean composition',()=>{
 for(const[prefix,letter,command]of [['g','t','view:para-mark'],['g','c','view:ctrl-mark'],['g','p','view:zoom-fit-page'],['k','h','insert:hyperlink'],['k','b','insert:bookmark'],['m','r','format:quick-color-r']]){
  const c=context();assert.equal(handleTableCreateChord(c.owner,key('Process',{code:'Key'+prefix.toUpperCase(),ctrlKey:true,keyCode:229,isComposing:true}),10),true,prefix);
  assert.equal(handleTableCreateChord(c.owner,key('Process',{code:'Key'+letter.toUpperCase(),keyCode:229,isComposing:true}),20),true,prefix+','+letter);
  assert.deepEqual(c.calls,[[command]]);
 }
});
test('holding the prefix modifier can complete a repeated-letter chord once',()=>{
 for(const[prefix,command]of [['n','insert:footnote'],['m','insert:equation']]){const c=context();handleTableCreateChord(c.owner,key(prefix,{ctrlKey:true}),10);handleTableCreateChord(c.owner,key(prefix,{ctrlKey:true}),20);assert.deepEqual(c.calls,[[command]]);}
});
test('Korean fallback letters distinguish P from V for page fit',()=>{
 const c=context();handleTableCreateChord(c.owner,key('ㅎ',{code:'',ctrlKey:true}),10);assert.equal(handleTableCreateChord(c.owner,key('ㅔ',{code:''}),20),true);assert.deepEqual(c.calls,[['view:zoom-fit-page']]);
 const d=context();handleTableCreateChord(d.owner,key('g',{ctrlKey:true}),10);const v=key('ㅍ',{code:''});assert.equal(handleTableCreateChord(d.owner,v,20),false);assert.equal(v.prevented,undefined);
});
test('Alt+V and Command+K keep their existing modifier ownership',()=>{
 const c=context();handleTableCreateChord(c.owner,key('Process',{code:'KeyV',altKey:true,keyCode:229}),10);handleTableCreateChord(c.owner,key('t',{altKey:true}),20);assert.deepEqual(c.calls,[['view:border-transparent']]);
 const d=context();handleTableCreateChord(d.owner,key('k',{metaKey:true}),10);handleTableCreateChord(d.owner,key('h',{metaKey:true}),20);assert.deepEqual(d.calls,[['insert:hyperlink']]);
});
test('another modified shortcut is not mistaken for a chord continuation',()=>{
 const c=context();handleTableCreateChord(c.owner,key('g',{ctrlKey:true}),10);const align=key('c',{ctrlKey:true,shiftKey:true});assert.equal(handleTableCreateChord(c.owner,align,20),false);assert.equal(align.prevented,undefined);assert.deepEqual(c.calls,[]);
});
test('a prefix expires and auto-repeat does not extend its deadline',()=>{
 const c=context();handleTableCreateChord(c.owner,key('g',{ctrlKey:true}),0);handleTableCreateChord(c.owner,key('g',{ctrlKey:true,repeat:true}),2400);const t=key('t');assert.equal(handleTableCreateChord(c.owner,t,2600),false);assert.equal(t.prevented,undefined);assert.deepEqual(c.calls,[]);
});
test('leaving the editor or window cancels an unfinished chord',()=>{
 for(const surface of ['target','window']){const c=context();handleTableCreateChord(c.owner,key('n',{ctrlKey:true}),10);c[surface].dispatchEvent(new Event('blur'));const t=key('t');assert.equal(handleTableCreateChord(c.owner,t,20),false,surface);assert.equal(t.prevented,undefined);assert.deepEqual(c.calls,[]);}
});
test('chords do not open editing commands during object placement',()=>{
 for(const mode of ['connectorDrawingMode','polygonDrawingMode','imagePlacementMode','textboxPlacementMode']){const c=context();c.owner[mode]=true;assert.equal(handleTableCreateChord(c.owner,key('n',{ctrlKey:true}),10),false,mode);assert.equal(handleTableCreateChord(c.owner,key('t'),20),false);assert.deepEqual(c.calls,[]);}
});
