import test from 'node:test';
import assert from 'node:assert/strict';
import {handleTableCreateChord} from '../src/table-create-shortcut.mjs';

const key=(code,key,extra={})=>({code,key,ctrlKey:false,metaKey:false,shiftKey:false,altKey:false,repeat:false,preventDefault(){this.prevented=true;},...extra});
test('Ctrl+N then T opens the detailed table dialog without entering text',()=>{
 const calls=[],owner={dispatcher:{dispatch:(...x)=>calls.push(x)},_cellBlockLetterImeGuard:{arm:e=>calls.push(['guard',e.code])}};
 const n=key('KeyN','n',{ctrlKey:true}),t=key('KeyT','ㅅ');
 assert.equal(handleTableCreateChord(owner,n,100),true);assert.equal(handleTableCreateChord(owner,t,150),true);
 assert.equal(n.prevented,true);assert.equal(t.prevented,true);
 assert.deepEqual(calls,[['guard','KeyT'],['table:create',{pwhDetailed:true}]]);
});
test('unrelated keys, expired chords and other modifiers retain their normal behavior',()=>{
 const calls=[],owner={dispatcher:{dispatch:(...x)=>calls.push(x)}};
 assert.equal(handleTableCreateChord(owner,key('KeyN','n',{ctrlKey:true}),100),true);
 const other=key('KeyA','a');assert.equal(handleTableCreateChord(owner,other,101),false);assert.equal(other.prevented,undefined);
 assert.equal(handleTableCreateChord(owner,key('KeyN','n',{ctrlKey:true}),200),true);
 const late=key('KeyT','t');assert.equal(handleTableCreateChord(owner,late,3000),false);assert.equal(late.prevented,undefined);
 assert.equal(handleTableCreateChord(owner,key('KeyN','n',{ctrlKey:true,shiftKey:true}),4000),false);
 assert.deepEqual(calls,[]);
});
