import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentReveal} from '../src/agent-reveal.mjs';

test('reveals a nested-cell edit without changing the document or caret',()=>{
 const listeners={},scroll=[],markers=[],calls=[];
 const container={clientHeight:500,addEventListener:(name,fn)=>listeners[name]=fn,scrollTo:options=>scroll.push(options)};
 const content={clientWidth:900,append:element=>markers.push(element)};
 const document={getElementById:id=>id==='scroll-container'?container:content,createElement:()=>({style:{},setAttribute(){},remove(){this.removed=true;},animate(){}})};
 const window={matchMedia:()=>({matches:true}),setTimeout:fn=>{window.next=fn;return 1;},clearTimeout(){}};
 const wasm={getCursorRectByPath:(...args)=>{calls.push(args);return {pageIndex:2,x:40,y:60,height:14};}};
 const canvas={getVirtualScroll:()=>({getPageLeftResolved:()=>100,getPageOffset:()=>1800}),getViewportManager:()=>({getZoom:()=>1.5})};
 const reveal=createAgentReveal({wasm,getCanvasView:()=>canvas,document,window});
 const cellPath=[{controlIndex:3,cellIndex:4,cellParaIndex:5}];reveal.show([{sectionIndex:0,parentParaIndex:2,charOffset:6,cellPath}]);
 assert.deepEqual(calls[0],[0,2,JSON.stringify(cellPath),6]);assert.equal(scroll[0].top,1700);assert.equal(scroll[0].behavior,'auto');assert.equal(markers.length,1);
 listeners.wheel();assert.equal(markers[0].removed,true);
});

test('skips clipped and unavailable positions without scrolling',()=>{
 const scroll=[],container={clientHeight:500,addEventListener(){},scrollTo:v=>scroll.push(v)};
 const document={getElementById:id=>id==='scroll-container'?container:{clientWidth:900},createElement(){throw Error('no marker expected');}};
 const window={clearTimeout(){},setTimeout(){}};
 const wasm={getCursorRect:()=>({pageIndex:1,x:0,y:0,height:10,cellOverflowed:true})};
 const canvas={getVirtualScroll:()=>({}),getViewportManager:()=>({})};
 createAgentReveal({wasm,getCanvasView:()=>canvas,document,window}).show([{sectionIndex:0,paragraphIndex:0,charOffset:0}]);assert.equal(scroll.length,0);
});
