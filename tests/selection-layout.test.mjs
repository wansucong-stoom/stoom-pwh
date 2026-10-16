import test from 'node:test';import assert from 'node:assert/strict';
import {rectanglesFromRuns,renderedBodySelectionRects,createBodySelectionLayoutCache} from '../src/selection-layout.mjs';
const run=(text,charStart,y,extra={})=>({text,charStart,y,x:10,h:12,charX:Array.from({length:text.length+1},(_,i)=>i*8),secIdx:0,paraIdx:0,...extra});
test('wrapped selection uses every visual line and clips first/last character boundaries',()=>{
 const result=rectanglesFromRuns([run('abcd',0,20),run('efgh',4,40),run('ij',8,60)],2,0,0,2,0,9);
 assert.deepEqual(result.rects,[{pageIndex:2,x:26,y:20,width:16,height:12},{pageIndex:2,x:10,y:40,width:32,height:12},{pageIndex:2,x:10,y:60,width:8,height:12}]);
});
test('UTF16 boundaries map to scalar char positions and cell text cannot leak into body selection',()=>{
 const r=run('가😀나',0,20,{charX:[0,8,18,26]});
 assert.equal(rectanglesFromRuns([r,run('cell',0,99,{parentParaIdx:2})],0,0,0,1,0,3).rects[0].width,10);
 assert.equal(rectanglesFromRuns([r],0,0,0,2,0,3).rects.length,0);
});
test('selection spans page boundaries and retains native fallback on incomplete source coverage',()=>{
 const fallback=[{pageIndex:0,x:10,y:20,width:1,height:12}];
 const doc={pageCount:()=>2,getParagraphLength:()=>8,getPageTextLayout:p=>({runs:p===0?[run('abcd',0,20)]:[run('efgh',4,20)]})};
 const rects=renderedBodySelectionRects(doc,0,0,1,0,7,fallback);assert.equal(rects.length,2);assert.equal(rects[1].pageIndex,1);
 assert.equal(renderedBodySelectionRects({...doc,getPageTextLayout:()=>({runs:[run('abcd',0,20)]})},0,0,1,0,7,fallback),fallback);
 assert.equal(renderedBodySelectionRects({...doc,getControlTextPositions:()=>[{}]},0,0,1,0,7,fallback),fallback);
});
test('unrelated or mismatched rendered source text cannot masquerade as selected body text',()=>{
 const fallback=[{pageIndex:0,x:10,y:20,width:1,height:12}],doc={pageCount:()=>1,getParagraphLength:()=>4,getTextRange:()=> 'body',getPageTextLayout:()=>({runs:[run('head',0,20)]})};
 assert.equal(renderedBodySelectionRects(doc,0,0,0,0,4,fallback),fallback);
});
test('pointer gesture reuses native page layout while recomputing changing selection boundaries',()=>{
 const fallback=[{pageIndex:0,x:10,y:20,width:1,height:12}],cache=createBodySelectionLayoutCache();let reads=0;
 const doc={pageCount:()=>1,getParagraphLength:()=>4,getTextRange:()=> 'body',getPageTextLayout:()=>{reads++;return JSON.stringify({runs:[run('body',0,20)]});}};
 const select=end=>renderedBodySelectionRects(doc,0,0,0,0,end,fallback,cache);
 select(1);select(2);assert.equal(reads,2,'no reuse outside a pointer gesture');
 cache.begin();assert.equal(select(1)[0].width,8);assert.equal(select(3)[0].width,24);assert.equal(reads,3);
 cache.invalidate();select(2);assert.equal(reads,4,'edit/font invalidation reloads immediately');
 cache.end();select(2);select(3);assert.equal(reads,6,'ending gesture releases all retained layouts');
 cache.begin();select(4);assert.equal(reads,7,'next pointer gesture starts fresh');
});
test('gesture layout cache does not reuse a replaced document or silently accept stale source text',()=>{
 const fallback=[{pageIndex:0,x:10,y:20,width:1,height:12}],cache=createBodySelectionLayoutCache();let y=20,text='body',reads=0;
 const makeDoc=()=>({pageCount:()=>1,getParagraphLength:()=>4,getTextRange:()=>text,getPageTextLayout:()=>{reads++;return {runs:[run(text,0,y)]};}});
 const doc=makeDoc();cache.begin();assert.equal(renderedBodySelectionRects(doc,0,0,0,0,4,fallback,cache)[0].y,20);
 text='new!';assert.equal(renderedBodySelectionRects(doc,0,0,0,0,4,fallback,cache),fallback,'source mismatch retains native fallback');
 cache.invalidate();y=40;assert.equal(renderedBodySelectionRects(doc,0,0,0,0,4,fallback,cache)[0].y,40);
 y=60;assert.equal(renderedBodySelectionRects(makeDoc(),0,0,0,0,4,fallback,cache)[0].y,60);assert.equal(reads,3);
});
test('gesture cache bounds retained pages and does not retain malformed or throwing results',()=>{
 const cache=createBodySelectionLayoutCache({maxPages:2}),doc={};let reads=0;
 const load=()=>{reads++;return {runs:[]};};cache.begin();
 cache.read(doc,0,load);cache.read(doc,1,load);cache.read(doc,0,load);cache.read(doc,2,load);cache.read(doc,1,load);assert.equal(reads,4,'least recently used page is evicted');
 const malformed=()=>{reads++;return {};};cache.read(doc,3,malformed);cache.read(doc,3,malformed);assert.equal(reads,6);
 const fail=()=>{throw new Error('native layout failure');};assert.throws(()=>cache.read(doc,4,fail),/native layout failure/);assert.deepEqual(cache.read(doc,4,load),{runs:[]});
 assert.throws(()=>createBodySelectionLayoutCache({maxPages:0}),RangeError);
});
