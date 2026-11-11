import test from 'node:test';
import assert from 'node:assert/strict';
import {isPointNearBoxBorder} from '../src/table-border-selection.mjs';

test('table borders have the same screen allowance at small and large zoom',()=>{
  const box={x:100,y:100,width:300,height:200};
  for(const zoom of [0.5,1,1.6,2.5]){
    assert.equal(isPointNearBoxBorder(100-9/zoom,150,box,zoom),true,'outer edge is easy to select');
    assert.equal(isPointNearBoxBorder(100-11/zoom,150,box,zoom),false,'distant page space stays ordinary');
    assert.equal(isPointNearBoxBorder(100+2/zoom,150,box,zoom),true);
    assert.equal(isPointNearBoxBorder(100+4/zoom,150,box,zoom),false,'cell text is not a table border');
    assert.equal(isPointNearBoxBorder(250,300+9/zoom,box,zoom),true);
    assert.equal(isPointNearBoxBorder(250,300+11/zoom,box,zoom),false);
  }
});
test('shared border hit rules reject interior text and invalid page geometry',()=>{
  assert.equal(isPointNearBoxBorder(250,200,{x:100,y:100,width:300,height:200}),false);
  for(const box of [{x:0,y:0,width:0,height:5},{x:NaN,y:0,width:10,height:10},null])assert.equal(isPointNearBoxBorder(0,0,box),false);
  assert.equal(isPointNearBoxBorder(0,0,{x:0,y:0,width:10,height:10},0),false);
});
