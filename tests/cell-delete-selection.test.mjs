import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyCellDeleteSelection as classify} from '../src/cell-delete-selection.mjs';

test('recognizes complete rows and columns without treating partial blocks as lines',()=>{
 const cells=Array.from({length:9},(_,i)=>({row:Math.floor(i/3),col:i%3,rowSpan:1,colSpan:1}));
 const run=selected=>classify({rowCount:3,colCount:3,cells,selected});
 assert.deepEqual(run([3,4,5]),{kind:'rows',indices:[1]});
 assert.deepEqual(run([1,4,7]),{kind:'columns',indices:[1]});
 assert.deepEqual(run([0,1,3,4]),{kind:'partial'});
 assert.deepEqual(run([0,1,2,3,4,5,6,7,8]),{kind:'table'});
});

test('counts merged cells across the grid',()=>{
 const cells=[{row:0,col:0,rowSpan:1,colSpan:3},...Array.from({length:3},(_,col)=>({row:1,col,rowSpan:1,colSpan:1}))];
 assert.deepEqual(classify({rowCount:2,colCount:3,cells,selected:[0]}),{kind:'rows',indices:[0]});
 assert.deepEqual(classify({rowCount:2,colCount:3,cells,selected:[1]}),{kind:'partial'});
});

test('recognizes multiple lines and keeps incomplete or excluded selections partial',()=>{
 const cells=Array.from({length:16},(_,i)=>({row:Math.floor(i/4),col:i%4,rowSpan:1,colSpan:1}));
 const run=selected=>classify({rowCount:4,colCount:4,cells,selected});
 assert.deepEqual(run([0,1,2,3,4,5,6,7]),{kind:'rows',indices:[0,1]});
 assert.deepEqual(run([0,1,4,5,8,9,12,13]),{kind:'columns',indices:[0,1]});
 assert.deepEqual(run([0,1,2,3,4,5,7]),{kind:'partial'});
 assert.deepEqual(run([0,1,4,5,8,9,12]),{kind:'partial'});
});

test('a merged cell overlapping a line prevents a partial line from being deleted',()=>{
 const cells=[{row:0,col:0,rowSpan:2,colSpan:1},{row:0,col:1,rowSpan:1,colSpan:1},{row:1,col:1,rowSpan:1,colSpan:1},{row:2,col:0,rowSpan:1,colSpan:1},{row:2,col:1,rowSpan:1,colSpan:1}];
 assert.deepEqual(classify({rowCount:3,colCount:2,cells,selected:[1]}),{kind:'partial'});
 assert.deepEqual(classify({rowCount:3,colCount:2,cells,selected:[0,1]}),{kind:'partial'});
 assert.deepEqual(classify({rowCount:3,colCount:2,cells,selected:[0,1,2]}),{kind:'rows',indices:[0,1]});
});
