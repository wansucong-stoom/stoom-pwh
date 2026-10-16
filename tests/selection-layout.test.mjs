import test from 'node:test';import assert from 'node:assert/strict';
import {rectanglesFromRuns,renderedBodySelectionRects} from '../src/selection-layout.mjs';
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
