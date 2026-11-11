import test from 'node:test';
import assert from 'node:assert/strict';
import {tablePropertiesAtPoint,tableBorderAtPagePoint} from '../src/table-properties-hit.mjs';

function pointer({selected=null,nested=false,flat=false,hit}={}){
  return {container:{querySelector:()=>({clientWidth:1000,getBoundingClientRect:()=>({left:10,top:20})})},
    viewportManager:{getZoom:()=>2},virtualScroll:{getPageAtPoint:()=>3,getPageLeftResolved:()=>100,getPageOffset:()=>200},
    cursor:{isInTableObjectSelection:()=>!!selected,getSelectedTableRef:()=>selected},wasm:{hitTest:(page,x,y)=>{assert.deepEqual([page,x,y],[3,20,30]);return hit;}},
    isTableBorderClick:()=>flat,isNestedTableBorderClick:()=>nested,findTableByOuterClick:()=>null};
}
test('a border double-click resolves the inner table before a selected outer table',()=>{
  const cellPath=[{controlIndex:2,cellIndex:3,cellParaIndex:1},{controlIndex:0,cellIndex:1,cellParaIndex:0}];
  const selected={sec:0,ppi:5,ci:2},hit={sectionIndex:0,parentParaIndex:5,controlIndex:2,paragraphIndex:5,cellPath};
  assert.deepEqual(tablePropertiesAtPoint(pointer({selected,hit,nested:true,flat:true}),150,280),{...selected,cellPath});
});
test('unselected table borders open properties while text double-click stays with word selection',()=>{
  const hit={sectionIndex:0,parentParaIndex:5,controlIndex:2,paragraphIndex:5};
  assert.deepEqual(tablePropertiesAtPoint(pointer({hit,flat:true}),150,280),{sec:0,ppi:5,ci:2});
  assert.equal(tablePropertiesAtPoint(pointer({hit,flat:false}),150,280),null);
  assert.equal(tablePropertiesAtPoint(pointer({selected:{sec:0,ppi:5,ci:2},hit,flat:false}),150,280),null);
});

test('outside nested borders resolve their own full address without relying on nearest text',()=>{
  const cellPath=[{controlIndex:4,cellIndex:2,cellParaIndex:3},{controlIndex:1,cellIndex:0,cellParaIndex:0}];
  const controls=[{type:'table',secIdx:0,paraIdx:7,controlIdx:4,x:100,y:100,w:500,h:400},
    {type:'table',secIdx:0,paraIdx:3,controlIdx:1,parentParaIdx:7,outerTableControlIdx:4,cellPath,x:130,y:150,w:200,h:100}];
  const input={viewportManager:{getZoom:()=>2},wasm:{getPageControlLayout:()=>({controls}),getTableCellBboxesByPath:()=>{throw Error('must not scan all pages');}}};
  assert.deepEqual(tableBorderAtPagePoint(input,0,200,254),{sec:0,ppi:7,ci:4,cellPath});
  assert.equal(tableBorderAtPagePoint(input,0,200,256),null,'outer screen allowance stays bounded');
  assert.equal(tableBorderAtPagePoint(input,0,200,200),null,'cell text keeps word selection');
  cellPath[0].cellIndex=99;
  assert.equal(tableBorderAtPagePoint(input,0,200,254).cellPath[0].cellIndex,99);
});

test('nearest border wins and equal overlapping borders prefer the inner owner',()=>{
  const path=[{controlIndex:2,cellIndex:0,cellParaIndex:0},{controlIndex:0,cellIndex:0,cellParaIndex:0}];
  const controls=[{type:'table',secIdx:0,paraIdx:5,controlIdx:2,x:100,y:100,w:300,h:200},
    {type:'table',secIdx:0,paraIdx:0,controlIdx:0,parentParaIdx:5,outerTableControlIdx:2,cellPath:path,x:104,y:104,w:200,h:100}];
  const input={viewportManager:{getZoom:()=>1},wasm:{getPageControlLayout:()=>({controls})}};
  assert.deepEqual(tableBorderAtPagePoint(input,0,200,100),{sec:0,ppi:5,ci:2});
  assert.equal(tableBorderAtPagePoint(input,0,200,104).cellPath.length,2);
  controls[1].y=100;assert.equal(tableBorderAtPagePoint(input,0,200,100).cellPath.length,2);
  for(const field of ['headerFooter','noteRef','isTextBox']){controls[1][field]=true;assert.deepEqual(tableBorderAtPagePoint(input,0,200,100),{sec:0,ppi:5,ci:2});delete controls[1][field];}
});
