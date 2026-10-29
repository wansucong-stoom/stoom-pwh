import test from 'node:test';import assert from 'node:assert/strict';
import {wordRange,selectMulticlick} from '../src/multiclick-selection.mjs';

test('word bounds use document Unicode offsets, including astral characters',()=>{
 const text='첫째 😀 second 단어';
 for(const [point,expected] of [[1,'첫째'],[3,'😀'],[6,'second'],[14,'단어']]){
  const {start,end}=wordRange(text,point);assert.equal(Array.from(text).slice(start,end).join(''),expected);
 }
 assert.equal(wordRange('',0),null);
});

test('two and three clicks stay in the exact nested cell paragraph',()=>{
 const original={sectionIndex:2,paragraphIndex:7,parentParaIndex:7,controlIndex:1,cellIndex:4,cellParaIndex:0,charOffset:4,cursorRect:{x:10},cellPath:[{controlIndex:1,cellIndex:4,cellParaIndex:2},{controlIndex:3,cellIndex:5,cellParaIndex:1}]};
 const text='앞글자 선택 단어';let position={...original},anchor=null,requested=[];
 const cursor={getPosition:()=>position,isInHeaderFooter:()=>false,isInFootnote:()=>false,isInTextBox:()=>false,isInCellSelectionMode:()=>false,clearSelection:()=>{anchor=null;},moveTo:p=>{position=p;},setAnchor:()=>{anchor={...position};}};
 const wasm={getCellParagraphLengthByPath:(sec,ppi,path)=>{requested.push([sec,ppi,JSON.parse(path)]);return Array.from(text).length;},getTextInCellByPath:()=>text};
 assert.equal(selectMulticlick(cursor,wasm,2),true);assert.equal(Array.from(text).slice(anchor.charOffset,position.charOffset).join(''),'선택');
 for(const side of [anchor,position]){assert.deepEqual(side.cellPath,original.cellPath);assert.equal(side.parentParaIndex,7);assert.equal(side.cellIndex,4);assert.equal(side.cellParaIndex,0);assert.equal(side.cursorRect,undefined);}
 position={...original};assert.equal(selectMulticlick(cursor,wasm,3),true);assert.equal(anchor.charOffset,0);assert.equal(position.charOffset,Array.from(text).length);assert.deepEqual(requested[0][2],original.cellPath);
});

test('body paragraph selection does not cross into another paragraph',()=>{
 let position={sectionIndex:0,paragraphIndex:4,charOffset:2},anchor;
 const cursor={getPosition:()=>position,isInHeaderFooter:()=>false,isInFootnote:()=>false,isInTextBox:()=>false,isInCellSelectionMode:()=>false,clearSelection(){},moveTo:p=>{position=p;},setAnchor:()=>{anchor={...position};}};
 const wasm={getParagraphLength:(s,p)=>{assert.equal(p,4);return 5;},getTextRange:()=> 'hello'};
 assert.equal(selectMulticlick(cursor,wasm,3),true);assert.equal(anchor.paragraphIndex,4);assert.equal(position.paragraphIndex,4);assert.equal(anchor.charOffset,0);assert.equal(position.charOffset,5);
});
