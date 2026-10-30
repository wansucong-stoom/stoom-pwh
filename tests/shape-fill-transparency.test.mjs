import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {mapHwpxMember} from './engine-source-ownership/hwpx-fixture-utils.mjs';
import {zipEntries} from '../scripts/setup.mjs';

const js=process.env.PWH_CORE_JS,wasm=process.env.PWH_CORE_WASM;
const skip=!js||!wasm?'Requires explicit candidate core paths':false;
async function loadCore(){const core=await import(pathToFileURL(js));await core.default({module_or_path:await fs.readFile(wasm)});return core;}
function fixture(core,alpha,shape='rectangle',round=0){
 const doc=core.HwpDocument.createEmpty();doc.createBlankDocument();
 try{
  const result=JSON.parse(doc.createShapeControl(JSON.stringify({shapeType:shape,width:12000,height:6000,horzOffset:7200,vertOffset:7200,treatAsChar:false,textWrap:'InFrontOfText'})));
  doc.setShapeProperties(0,result.paraIdx,result.controlIdx,JSON.stringify({borderColor:0,borderWidth:300,fillBgColor:255,roundRate:round}));
  return mapHwpxMember(doc.exportHwpx(),'Contents/section0.xml',xml=>xml.replace(/(<hc:winBrush\b[^>]*\balpha=")[^"]*(")/,'$1'+alpha+'$2'));
 }finally{doc.free();}
}
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
test('native Canvas and SVG both paint a transparent fill with an opaque outline',{
 skip:skip||(!process.env.PWH_PLAYWRIGHT_MODULE?'Requires browser module':false),timeout:120000,
},async()=>{
 const core=await loadCore(),bytes=fixture(core,204),jsBytes=await fs.readFile(js),wasmBytes=await fs.readFile(wasm);
 const server=http.createServer((req,res)=>{if(req.url==='/core.js'){res.setHeader('content-type','text/javascript');res.end(jsBytes);}else if(req.url==='/core_bg.wasm'){res.setHeader('content-type','application/wasm');res.end(wasmBytes);}else if(req.url==='/'){res.setHeader('content-type','text/html');res.end('<canvas id="native"></canvas><canvas id="svg"></canvas>');}else{res.statusCode=404;res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE);browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result=await page.evaluate(async data=>{
   const core=await import('/core.js');await core.default({module_or_path:'/core_bg.wasm'});const doc=new core.HwpDocument(Uint8Array.from(data));
   try{
    const svg=doc.renderPageSvg(0),shape=new DOMParser().parseFromString(svg,'image/svg+xml').querySelector('rect[stroke="#000000"]'),box=['x','y','width','height'].map(k=>Number(shape.getAttribute(k)));
    const native=document.querySelector('#native');doc.renderPageToCanvas(0,native,1);
    const image=new Image(),url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));image.src=url;await image.decode();const canvas=document.querySelector('#svg');canvas.width=native.width;canvas.height=native.height;canvas.getContext('2d').drawImage(image,0,0);URL.revokeObjectURL(url);
    return [native,canvas].map(c=>{const ctx=c.getContext('2d'),[x,y,w,h]=box;const rgb=(a,b)=>[...ctx.getImageData(Math.round(a),Math.round(b),1,1).data].slice(0,3);return {fill:rgb(x+w/2,y+h/2),outline:rgb(x,y+h/2),alpha:ctx.globalAlpha};});
   }finally{doc.free();}
  },[...bytes]);
  for(const pixels of result){assert.ok(pixels.fill[0]>245&&Math.abs(pixels.fill[1]-204)<4&&Math.abs(pixels.fill[2]-204)<4,JSON.stringify(pixels));assert.ok(pixels.outline.every(c=>c<20),JSON.stringify(pixels));assert.equal(pixels.alpha,1,'Canvas alpha state must be restored');}
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
