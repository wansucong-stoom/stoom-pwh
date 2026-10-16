import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {sfntFaces,createFontChunkReader} from '../src/system-fonts.mjs';
test('system font metadata preserves family aliases weight and TTC face identity',()=>{
 const encoded=s=>{const b=Buffer.from(s,'utf16le');b.swap16();return b;};const names=[[1,'Test Family'],[4,'Test Family Bold'],[6,'TestFamily-Bold']];const strings=names.map(([,v])=>encoded(v)),header=6+12*names.length;const name=Buffer.alloc(header+strings.reduce((n,b)=>n+b.length,0));name.writeUInt16BE(names.length,2);name.writeUInt16BE(header,4);let off=0;
 names.forEach(([id],i)=>{const p=6+i*12;name.writeUInt16BE(3,p);name.writeUInt16BE(1,p+2);name.writeUInt16BE(0x409,p+4);name.writeUInt16BE(id,p+6);name.writeUInt16BE(strings[i].length,p+8);name.writeUInt16BE(off,p+10);strings[i].copy(name,header+off);off+=strings[i].length;});
 const os2=Buffer.alloc(64);os2.writeUInt16BE(700,4);const data=Buffer.alloc(44+name.length+64);data.writeUInt32BE(0x10000,0);data.writeUInt16BE(2,4);data.write('name',12);data.writeUInt32BE(44,20);data.writeUInt32BE(name.length,24);data.write('OS/2',28);data.writeUInt32BE(44+name.length,36);data.writeUInt32BE(64,40);name.copy(data,44);os2.copy(data,44+name.length);
 const faces=sfntFaces(data);assert.equal(faces.length,1);assert.equal(faces[0].family,'Test Family');assert.equal(faces[0].weight,700);assert.equal(faces[0].faceIndex,0);assert.ok(faces[0].aliases.includes('TestFamily-Bold'));assert.deepEqual(sfntFaces(Buffer.alloc(0)),[]);
});

const fileStat=(size,mtimeMs=1)=>({size,mtimeMs,isFile:()=>true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('font chunks share one verified file read across concurrent requests and expose no mutable bytes',async()=>{
 const bytes=Buffer.alloc(3*512*1024+11,27);let reads=0,stats=0;
 const read=createFontChunkReader({readFile:async()=>{reads++;await new Promise(resolve=>setTimeout(resolve,10));return bytes;},statFile:async()=>{stats++;return fileStat(bytes.length);}});
 const results=await Promise.all([0,512*1024,2*512*1024,3*512*1024].map(offset=>read('font.ttc',`${bytes.length}:1`,offset)));
 assert.equal(reads,1);assert.equal(stats,5);assert.deepEqual(Buffer.concat(results.map(r=>Buffer.from(r.base64,'base64'))),bytes);
 for(const result of results){assert.equal(result.sha256,sha(bytes));assert.equal(result.totalBytes,bytes.length);assert.ok(Object.values(result).every(value=>!Buffer.isBuffer(value)));}
 // Neither the readFile owner's buffer nor a decoded caller chunk owns cache bytes.
 bytes.fill(9);Buffer.from(results[0].base64,'base64').fill(0);
 const again=await read('font.ttc',`${bytes.length}:1`,0);assert.equal(reads,1);assert.equal(stats,6);
 assert.equal(Buffer.from(again.base64,'base64')[0],27);assert.equal(again.sha256,results[0].sha256);
});

test('font cache rechecks changed stamps, short reads and changes during reads before publishing',async()=>{
 let stamp=1,reads=0;const bytes=Buffer.from('font');
 const read=createFontChunkReader({readFile:async()=>{reads++;return bytes;},statFile:async()=>fileStat(bytes.length,stamp)});
 await read('font.ttf','4:1',0);stamp=2;
 await assert.rejects(read('font.ttf','4:1',0),/변경/);assert.equal(reads,1);
 const newer=await read('font.ttf','4:2',0);assert.equal(newer.sha256,sha(bytes));assert.equal(reads,2);
 const changedDuringRead=createFontChunkReader({readFile:async()=>{stamp=3;return bytes;},statFile:async()=>fileStat(bytes.length,stamp)});
 await assert.rejects(changedDuringRead('font.ttf','4:2',0),/변경/);
 const short=createFontChunkReader({readFile:async()=>Buffer.from('bad'),statFile:async()=>fileStat(4)});
 await assert.rejects(short('font.ttf','4:1',0),/변경/);
});

test('font cache evicts least recently used bytes within its budget and retries failed reads',async()=>{
 const reads=new Map(),files=new Map([['a',Buffer.from('aaaa')],['b',Buffer.from('bbbb')],['c',Buffer.from('cccc')]]);
 const read=createFontChunkReader({maxBytes:8,readFile:async file=>{reads.set(file,(reads.get(file)||0)+1);return files.get(file);},statFile:async()=>fileStat(4)});
 for(const file of ['a','b','a','c','b'])await read(file,'4:1',0);
 assert.equal(reads.get('a'),1);assert.equal(reads.get('b'),2);assert.equal(reads.get('c'),1);
 let attempt=0;const retry=createFontChunkReader({readFile:async()=>{if(++attempt===1)throw Error('read failed');return Buffer.from('data');},statFile:async()=>fileStat(4)});
 await assert.rejects(retry('font','4:1',0),/read failed/);assert.equal((await retry('font','4:1',0)).sha256,sha(Buffer.from('data')));assert.equal(attempt,2);
 const uncached=createFontChunkReader({maxBytes:0,readFile:async()=>{attempt++;return Buffer.from('data');},statFile:async()=>fileStat(4)});
 await uncached('font','4:1',0);await uncached('font','4:1',0);assert.equal(attempt,4);
});

test('font cache rejects invalid offsets and over-limit files before reading bytes',async()=>{
 let reads=0;const read=createFontChunkReader({readFile:async()=>{reads++;return Buffer.from('font');},statFile:async()=>fileStat(4)});
 for(const offset of [-1,4,0.5,NaN])await assert.rejects(read('font','4:1',offset),/위치/);
 const oversized=createFontChunkReader({readFile:async()=>{reads++;return Buffer.alloc(0);},statFile:async()=>fileStat(64*1024*1024+1)});
 await assert.rejects(oversized('font',`${64*1024*1024+1}:1`,0),/변경/);assert.equal(reads,0);
});
