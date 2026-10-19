import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {pwhEmbeddedImageDataUrl,inlineEditorImageUrls} from '../src/inline-image-urls.mjs';

const cache=`//#region build/rhwp-studio/src/view/flow-image-url-cache.ts
var Cache=class {
  urls=new Map();
  urlFor(key,mime,read){
    if(this.urls.has(key))return this.urls.get(key);
    const bytes=read(key);
    const url=URL.createObjectURL(new Blob([bytes], { type: mime }));
    this.urls.set(key,url);return url;
  }
};
//#endregion`;

test('embedded image URLs retain exact bytes without blob URLs, including chunk boundaries',()=>{
  for(const size of [1,8192,8193,180000]){
    const bytes=Uint8Array.from({length:size},(_,i)=>i%256);
    const url=pwhEmbeddedImageDataUrl(bytes,'image/png');
    assert.match(url,/^data:image\/png;base64,/);
    assert.deepEqual(Buffer.from(url.split(',')[1],'base64'),Buffer.from(bytes));
  }
  for(const mime of ['',null,undefined,'text/html','image/png;bad','image/png\n'])
    assert.equal(pwhEmbeddedImageDataUrl(new Uint8Array([1]),mime),null);
  assert.equal(pwhEmbeddedImageDataUrl(new Uint8Array(),'image/png'),null);
});

test('verified flow cache uses data URLs once per image without changing unrelated object URLs',()=>{
  const other='const unrelated=()=>URL.createObjectURL(new Blob([x], { type: y }));';
  const source=inlineEditorImageUrls(cache+'\n'+other);
  assert.ok(source.includes(other));
  const context={Uint8Array,btoa,URL:{createObjectURL(){throw Error('Host blocks object URLs');}}};
  vm.createContext(context);vm.runInContext(source,context);
  let reads=0;context.image=new Uint8Array([137,80,78,71]);context.read=()=>{reads++;return context.image;};
  vm.runInContext('const c=new Cache();this.a=c.urlFor("one","image/png",read);this.b=c.urlFor("one","image/png",read);',context);
  assert.equal(context.a,context.b);assert.equal(reads,1);
  assert.deepEqual(Buffer.from(context.a.split(',')[1],'base64'),Buffer.from(context.image));
});

test('changed or ambiguous preserved bundles fail explicitly before serving a broken editor',()=>{
  for(const source of ['',cache+cache,cache.replace('URL.createObjectURL','otherFactory'),cache.replace('this.urls.set','URL.createObjectURL(new Blob([bytes], { type: mime }));this.urls.set')])
    assert.throws(()=>inlineEditorImageUrls(source),/Unsupported inline image/);
});
