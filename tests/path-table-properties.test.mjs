import test from 'node:test';
import assert from 'node:assert/strict';
import {createPathTablePropertiesBridge,tablePropertiesPathKey} from '../src/path-table-properties.mjs';

test('nested dialog methods always use the captured path and bind ordinary bridge receivers',()=>{
  const path=[{controlIndex:4,cellIndex:2,cellParaIndex:1},{controlIndex:0,cellIndex:3,cellParaIndex:2}];
  const calls=[];
  const wasm={
    getTableProperties(){throw Error('outer table was accessed');},setTableProperties(){throw Error('outer table was modified');},
    getCellProperties(){throw Error('outer cell was accessed');},setCellProperties(){throw Error('outer cell was modified');},
    runInBatch(fn){assert.equal(this,wasm);return fn();},
  };
  for(const name of ['getTablePropertiesByPath','setTablePropertiesByPath','getCellPropertiesByPath','setCellPropertiesByPath'])wasm[name]=function(...args){assert.equal(this,wasm);calls.push({name,args});return {ok:true};};
  const expected=tablePropertiesPathKey(path),bound=createPathTablePropertiesBridge(wasm,path);
  path[0].cellIndex=99;
  bound.runInBatch(()=>{bound.getTableProperties(1,2,4);bound.getCellProperties(1,2,4,5);bound.setTableProperties(1,2,4,{paddingLeft:100});bound.setCellProperties(1,2,4,5,{height:2000});});
  assert.equal(calls.length,4);
  assert.ok(calls.every(call=>call.args[0]===1&&call.args[1]===2&&call.args[2]===expected));
  assert.deepEqual(calls[3].args.slice(3),[5,{height:2000}]);
  assert.equal(bound.pwhTablePropertiesPath,expected);
});
test('path identity ignores only the final cursor cell, and rejects unsupported cores or malformed paths',()=>{
  const a=[{controlIndex:2,cellIndex:4,cellParaIndex:3},{controlIndex:1,cellIndex:5,cellParaIndex:8}];
  const b=a.map(entry=>({...entry}));b[1].cellIndex=0;b[1].cellParaIndex=0;
  assert.equal(tablePropertiesPathKey(a),tablePropertiesPathKey(b));
  assert.equal(tablePropertiesPathKey(a),tablePropertiesPathKey(a.map(e=>({cellParaIndex:e.cellParaIndex,cellIndex:e.cellIndex,controlIndex:e.controlIndex}))), 'JSON field order is not table identity');
  b[0].cellIndex=5;assert.notEqual(tablePropertiesPathKey(a),tablePropertiesPathKey(b));
  assert.throws(()=>createPathTablePropertiesBridge({},a),/코어/);
  for(const invalid of [null,[],[a[0]],[a[0],{...a[1],controlIndex:-1}],[a[0],{...a[1],cellParaIndex:NaN}]])assert.throws(()=>tablePropertiesPathKey(invalid),/path/);
});
