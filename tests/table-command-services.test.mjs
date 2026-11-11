import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeTableCommandServices} from '../src/table-command-services.mjs';

function fixture() {
  const path=[{controlIndex:7,cellIndex:3,cellParaIndex:2},{controlIndex:2,cellIndex:5,cellParaIndex:0}];
  const calls=[];
  const wasm={};
  for(const name of ['getTablePropertiesByPath','setTablePropertiesByPath','getCellPropertiesByPath','setCellPropertiesByPath','getCellOwnPropertiesByPath','setCellZonePropertiesByPath','getTextInCellByPath','deleteTextInCellByPath','insertTextInCellByPath'])wasm[name]=function(...args){assert.equal(this,wasm);calls.push({name,args});return {ok:true};};
  wasm.getCellInfoByPath=()=>({row:2,col:1});
  wasm.getTableDimensionsByPath=()=>({rowCount:2,colCount:2,cellCount:4});
  wasm.getCellParagraphLengthByPath=()=>2;
  wasm.getTableCellLayout=()=>[{cellIdx:3,row:1,col:1,rowSpan:1,colSpan:1}];
  wasm.editTableStructureByPath=function(...args){calls.push({name:'structure',args});return {ok:true,rowCount:2,colCount:2,cellCount:4};};
  let lastSpec,result,exited=false;
  const position={sectionIndex:0,parentParaIndex:8,controlIndex:7,cellIndex:5,cellParaIndex:0,charOffset:3,cellPath:path};
  const input={getCellTableContext:()=>({cellPath:path}),getCursorPosition:()=>position,
    executeOperation(spec){assert.equal(this,input);lastSpec=spec;result=spec.operation(wasm);return result;},
    exitCellSelectionMode(){exited=true;},cursor:{captureCellSelection:()=>({anchor:{row:2,col:1}})}};
  return {path,calls,wasm,input,position,services:{wasm,getInputHandler:()=>input},last:()=>({lastSpec,result,exited})};
}

test('nested snapshot callbacks and dialog reads share an immutable path; structural cursor retains ancestor',()=>{
  const f=fixture(),bound=scopeTableCommandServices(f.services);
  f.path[0].cellIndex=99;
  bound.wasm.getTableProperties(0,8,7);
  bound.getInputHandler().executeOperation({kind:'snapshot',operationType:'deleteTableRow',operation:wasm=>{
    wasm.deleteTableRow(0,8,7,2);return f.position;
  }});
  const {lastSpec,result,exited}=f.last();
  assert.equal(f.calls[0].args[2],f.calls[1].args[2]);
  assert.equal(JSON.parse(f.calls[1].args[2])[0].cellIndex,3);
  assert.equal(f.calls[1].args[3].operation,'delete-row');
  assert.equal(result.cellPath[0].cellIndex,3);assert.equal(result.cellPath[0].cellParaIndex,2);
  assert.equal(result.cellPath[1].cellIndex,3);assert.equal(result.cellIndex,3);assert.equal(result.charOffset,0);
  assert.ok(lastSpec.selectionBefore);assert.equal(exited,true);
});

test('numeric text and zone changes use the owned cell paragraph; flat bridge is unchanged',()=>{
  const f=fixture(),bound=scopeTableCommandServices(f.services);
  bound.getInputHandler().executeOperation({kind:'snapshot',operationType:'cellNumberFormat',operation:wasm=>{
    wasm.getTextInCell(0,8,7,4,2,0,10);wasm.deleteTextInCell(0,8,7,4,2,0,10);wasm.insertTextInCell(0,8,7,4,2,0,'1,000');
    wasm.setCellZoneProperties(0,8,7,{startRow:0,startCol:0,endRow:0,endCol:1},{fillType:'none'});return f.position;
  }});
  for(const call of f.calls.slice(0,3))assert.deepEqual(JSON.parse(call.args[2]),[{controlIndex:7,cellIndex:3,cellParaIndex:2},{controlIndex:2,cellIndex:4,cellParaIndex:2}]);
  assert.equal(f.last().exited,false);
  assert.equal(f.last().result.charOffset,2);
  const flat={...f.services,getInputHandler:()=>({getCursorPosition:()=>({cellPath:[f.path[0]]})})};
  assert.equal(scopeTableCommandServices(flat),flat);
  assert.throws(()=>bound.getInputHandler().executeOperation({kind:'command'}),/실행 취소/);
});
