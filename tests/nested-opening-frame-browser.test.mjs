import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyVisibleOpeningFrame} from './engine-source-ownership/nested-opening-frame-visible.mjs';
import {visibleSvgInk} from './engine-source-ownership/visible-svg-ink.mjs';

test('nested opening frame: actual browser SVG clipping preserves every opening and continuation owner',
  {skip: process.env.PWH_BROWSER_TESTS !== '1' || !process.env.PWH_CORE_JS || !process.env.PWH_CORE_WASM},
  async t => { t.diagnostic(JSON.stringify(await verifyVisibleOpeningFrame())); });

test('nested opening frame: fallback-font ink retains owners within the unchanged physical edge budget',
  {skip: process.env.PWH_BROWSER_TESTS !== '1' || !process.env.PWH_CORE_JS || !process.env.PWH_CORE_WASM},
  async t => {
    const result = await verifyVisibleOpeningFrame({fallbackFont: 'Arial'});
    t.diagnostic(JSON.stringify(result));
    assert.equal(result.dpi, 150);assert.equal(result.tolerancePixels, 2);
    assert.equal(result.hidden, 0);assert.equal(result.partial, 0);
  });

for(const [label,x,width,hidden]of [['partially clipped',0,40,false],['fully hidden',230,5,true]]){
 test(`actual SVG ink oracle rejects ${label} source text`,{skip:process.env.PWH_BROWSER_TESTS!=='1'},async()=>{
  const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
  const browser=await chromium.launch({headless:true,...process.env.PWH_BROWSER_EXECUTABLE?{executablePath:process.env.PWH_BROWSER_EXECUTABLE}:{}});
  try{
   const page=await browser.newPage({viewport:{width:600,height:400},deviceScaleFactor:150/96});
   const result=await visibleSvgInk(page,`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80"><defs><clipPath id="owner"><rect x="${x}" y="0" width="${width}" height="80"/></clipPath></defs><g clip-path="url(#owner)"><text x="10" y="35" font-family="Arial" font-size="20">SOURCE_MARKER</text></g></svg>`);
   assert.deepEqual(result.limitations,[]);assert.equal(result.total,1);
   if(hidden)assert.equal(result.hidden,1);else{assert.equal(result.hidden,0);assert.equal(result.partial,1);assert.ok(result.deepClippedInkPixels>0);}
  }finally{await browser.close();}
 });
}
