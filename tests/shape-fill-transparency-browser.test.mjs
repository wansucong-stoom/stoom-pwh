import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import {loadCore, fixture} from './engine-source-ownership/shape-transparency-fixture.mjs';

const js=process.env.PWH_CORE_JS,wasm=process.env.PWH_CORE_WASM;
const skip=!js||!wasm?'Requires explicit core paths':false;

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
