import test from 'node:test';
import assert from 'node:assert/strict';
import {zipEntries} from '../scripts/setup.mjs';
import {loadCore, fixture} from './engine-source-ownership/shape-transparency-fixture.mjs';

const skip=!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM?'Requires explicit candidate core paths':false;
const member=(bytes)=>zipEntries(Buffer.from(bytes)).find(e=>e.name==='Contents/section0.xml').read().toString('utf8');
for(const shape of ['rectangle','ellipse'])for(const alpha of [0,1,128,204,255])test(`${shape} transparency byte ${alpha} preserves its outline and roundtrip`,{skip},async()=>{
 const core=await loadCore(),doc=new core.HwpDocument(fixture(core,alpha,shape));
 try{
  const svg=doc.renderPageSvg(0),tag=new RegExp('<'+(shape==='rectangle'?'rect':'ellipse')+'\\b[^>]*stroke="#000000"[^>]*>').exec(svg)?.[0];
  assert.ok(tag,'The shape outline must be present');assert.ok(!/\sopacity="/.test(tag),'Fill transparency must not suppress the outline');
  if(alpha)assert.ok(tag.includes(`fill-opacity="${(1-alpha/255).toFixed(3)}"`),tag);
  const saved=doc.exportHwpx();assert.ok(member(saved).includes(`alpha="${alpha}"`),'The byte must not be serialized as a fraction');
  const reopened=new core.HwpDocument(saved);try{assert.equal(reopened.renderPageSvg(0),svg);}finally{reopened.free();}
 }finally{doc.free();}
});
for(const rate of [0,4,20,50,100])test(`rectangle round rate ${rate} uses the short side and caps at half`,{skip},async()=>{
 const core=await loadCore(),doc=new core.HwpDocument(fixture(core,0,'rectangle',rate));
 try{const tag=/<rect\b[^>]*stroke="#000000"[^>]*>/.exec(doc.renderPageSvg(0))?.[0];assert.ok(tag);const radius=Number(/\brx="([^"]*)"/.exec(tag)?.[1]||0);assert.ok(Math.abs(radius-Math.min(80*rate/100,40))<.01,tag);}finally{doc.free();}
});
