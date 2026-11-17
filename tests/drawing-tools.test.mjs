import test from 'node:test';import assert from 'node:assert/strict';
import {drawingTools,connectorTools,drawingGeometry,constrainDrawingEnd,appendDrawingSample,connectorPath} from '../src/drawing-tools.mjs';
import {initialPageArrangement} from '../src/auto-page-arrangement.mjs';
test('palette includes textboxes and every connector routing/arrow combination',()=>{
 assert.ok(drawingTools.some(t=>t.type==='textbox'));assert.equal(connectorTools.length,9);
 assert.equal(new Set([...drawingTools,...connectorTools].map(t=>t.type)).size,17);
});
test('drawing geometry preserves four drag directions at any display zoom',()=>{
 for(const [x,y]of [[90,60],[-90,60],[90,-60],[-90,-60]]){
  const p=drawingGeometry('line',{x:150,y:150},{x:150+x,y:150+y});
  assert.equal(p.width,6750);assert.equal(p.height,4500);assert.equal(p.lineFlipX,x<0);assert.equal(p.lineFlipY,y<0);
  assert.equal(p.horzOffset,Math.min(150,150+x)*75);assert.equal(p.vertOffset,Math.min(150,150+y)*75);
 }
});
test('Shift constraints use the same final points for preview and inserted shape',()=>{
 const start={x:40,y:50},end={x:180,y:105};
 const p=constrainDrawingEnd('rectangle',start,end,true);assert.deepEqual(p,{x:180,y:190});
 const geometry=drawingGeometry('rectangle',start,end,{shift:true});assert.equal(geometry.width,geometry.height);
 const line=constrainDrawingEnd('line',start,end,true);assert.ok(Math.abs(line.y-start.y)<.001);
});
test('point drawings retain their vertices and freehand samples stay bounded',()=>{
 const points=[{x:20,y:30},{x:100,y:70},{x:55,y:100}];
 const g=drawingGeometry('polygon',points[0],points.at(-1),{points});
 assert.deepEqual(g.polygonPoints,[{x:0,y:0},{x:6000,y:3000},{x:2625,y:5250}]);
 const samples=[];for(let i=0;i<10000;i++)appendDrawingSample(samples,{x:i,y:i},0);
 assert.ok(samples.length<=2048);assert.deepEqual(samples[0],{x:0,y:0});assert.deepEqual(samples.at(-1),{x:9999,y:9999});
 assert.match(connectorPath('connector-stroke',1,2,3,4),/H3V4/);assert.match(connectorPath('connector-arc',1,2,3,4),/C/);
});
test('automatic page rows migrate the old default and retain explicit layout choices',()=>{
 assert.deepEqual(initialPageArrangement(),{kind:'auto'});
 assert.deepEqual(initialPageArrangement({pageArrangement:{kind:'single'}}),{kind:'auto'});
 for(const kind of ['single','double','facing','multiple'])assert.equal(initialPageArrangement({pageArrangement:{kind},pageArrangementChosen:true}).kind,kind);
 assert.deepEqual(initialPageArrangement({pageArrangement:{kind:'single'},pageMovement:{direction:'horizontal'}}),{kind:'single'});
});
