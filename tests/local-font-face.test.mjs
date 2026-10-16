import test from 'node:test';
import assert from 'node:assert/strict';
import {tryLoadExactLocalFont} from '../src/local-font-face.mjs';

test('local font lookup uses exact face names and preserves weight and slant',async()=>{
 let seen;
 class MockFontFace{constructor(alias,source,descriptors){seen={alias,source,descriptors};this.status='unloaded';}async load(){this.status='loaded';return this;}}
 const font=await tryLoadExactLocalFont('__host_1',{family:'Never Search Family',fullName:'Exact Bold Italic',postscriptName:'Exact-BoldItalic',weight:700,slant:'italic'},MockFontFace);
 assert.ok(font instanceof MockFontFace);assert.equal(font.status,'loaded');
 assert.deepEqual(seen,{alias:'__host_1',source:'local("Exact Bold Italic"), local("Exact-BoldItalic")',descriptors:{weight:'700',style:'italic'}});
});

test('local font names are CSS quoted, including quotes, slashes and controls',async()=>{
 let source;
 class MockFontFace{constructor(alias,value){source=value;this.status='loaded';}async load(){return this;}}
 await tryLoadExactLocalFont('alias',{fullName:'Face"\\\n\r\f\u0001\u007f 9',postscriptName:'PS'},MockFontFace);
 assert.equal(source,'local("Face\\"\\\\\\a \\d \\c \\1 \\7f  9"), local("PS")');
 assert.ok(!source.includes('\n'));assert.ok(!source.includes('\r'));
});

test('duplicate names are removed and absent exact names never fall back to a family',async()=>{
 let calls=0,source;
 class MockFontFace{constructor(alias,value){calls++;source=value;this.status='loaded';}async load(){return this;}}
 assert.equal(await tryLoadExactLocalFont('alias',{family:'Family Only'},MockFontFace),null);assert.equal(calls,0);
 assert.ok(await tryLoadExactLocalFont('alias',{fullName:'Same',postscriptName:'Same'},MockFontFace));assert.equal(source,'local("Same")');
 assert.equal(await tryLoadExactLocalFont('alias',{fullName:'Face'},null),null);
 for(const face of [{fullName:'Face',weight:1001},{fullName:'Face',weight:NaN},{fullName:'Face',slant:'sideways'}])assert.equal(await tryLoadExactLocalFont('alias',face,MockFontFace),null);
 assert.equal(calls,1);
});

test('constructor, loading and unusable results return null for byte fallback',async()=>{
 class ThrowingFont{constructor(){throw Error('unsupported');}}
 class RejectedFont{async load(){throw Error('local face unavailable');}}
 class UnloadedFont{constructor(){this.status='unloaded';}async load(){return this;}}
 for(const FontClass of [ThrowingFont,RejectedFont,UnloadedFont])assert.equal(await tryLoadExactLocalFont('alias',{fullName:'Face'},FontClass),null);
});

test('a stalled local load has a bounded timeout and a late rejection is handled',async()=>{
 let rejectLoad;class StalledFont{constructor(){this.status='unloaded';}load(){return new Promise((resolve,reject)=>{rejectLoad=reject;});}}
 const start=performance.now();assert.equal(await tryLoadExactLocalFont('alias',{fullName:'Face'},StalledFont),null);
 assert.ok(performance.now()-start>=900);assert.ok(performance.now()-start<5000);
 rejectLoad(Error('late font failure'));await new Promise(resolve=>setTimeout(resolve,0));
});
