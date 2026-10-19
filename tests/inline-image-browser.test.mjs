import test from 'node:test';
import assert from 'node:assert/strict';
import {pwhEmbeddedImageDataUrl} from '../src/inline-image-urls.mjs';

// Optional real-browser regression; the ordinary suite has no browser dependency.
test('image-only CSP rejects the old object URL and decodes identical embedded bytes',{
  skip:process.env.PWH_BROWSER_TESTS!=='1'&&'Set PWH_BROWSER_TESTS=1 and PWH_PLAYWRIGHT_MODULE to run the browser regression.',
  timeout:30000,
},async()=>{
  const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
  const browser=await chromium.launch({headless:true,...(process.env.PWH_BROWSER_EXECUTABLE?{executablePath:process.env.PWH_BROWSER_EXECUTABLE}:{})});
  try{
    const page=await browser.newPage();
    await page.setContent('<meta http-equiv="Content-Security-Policy" content="img-src data:"><div id="images"></div>');
    const data='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9kAAAAASUVORK5CYII=';
    const url=pwhEmbeddedImageDataUrl(Uint8Array.from(Buffer.from(data,'base64')),'image/png');
    const r=await page.evaluate(async({data,url})=>{
      const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
      const old=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
      async function check(src){const img=new Image();document.getElementById('images').append(img);img.src=src;try{await img.decode();return{decoded:true,width:img.naturalWidth};}catch{return{decoded:false,width:img.naturalWidth};}}
      try{return{before:await check(old),after:await check(url)};}finally{URL.revokeObjectURL(old);}
    },{data,url});
    assert.deepEqual(r.before,{decoded:false,width:0});
    assert.deepEqual(r.after,{decoded:true,width:1});
  }finally{await browser.close();}
});
