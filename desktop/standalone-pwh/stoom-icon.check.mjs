import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('STOOM ICO has complete transparent native DIB frames with safe canvas margins',async()=>{
 const ico=await fs.readFile(new URL('./stoom.ico',import.meta.url)),svg=await fs.readFile(new URL('./stoom-mark.svg',import.meta.url),'utf8');
 const colors=new Set([...svg.matchAll(/stroke="(#[\da-f]{6})"/gi)].map(match=>match[1].toLowerCase()));assert.equal(colors.size,1);
 const color=[...colors][0].slice(1),expected=[0,2,4].map(offset=>parseInt(color.slice(offset,offset+2),16)),sizes=[16,24,32,48,64,128,256];
 assert.equal(ico.readUInt16LE(0),0);assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),sizes.length);
 let previousEnd=6+16*sizes.length;
 for(const [index,size]of sizes.entries()){
  const entry=6+16*index,width=ico[entry]||256,height=ico[entry+1]||256,bytes=ico.readUInt32LE(entry+8),offset=ico.readUInt32LE(entry+12),maskStride=Math.ceil(size/32)*4;
  assert.equal(width,size);assert.equal(height,size);assert.equal(ico.readUInt16LE(entry+4),1);assert.equal(ico.readUInt16LE(entry+6),32);assert.equal(offset,previousEnd);assert.equal(bytes,40+size*size*4+maskStride*size);assert.ok(offset+bytes<=ico.length);previousEnd=offset+bytes;
  const dib=ico.subarray(offset,offset+bytes);assert.equal(dib.readUInt32LE(0),40);assert.equal(dib.readInt32LE(4),size);assert.equal(dib.readInt32LE(8),size*2);assert.equal(dib.readUInt16LE(12),1);assert.equal(dib.readUInt16LE(14),32);assert.equal(dib.readUInt32LE(16),0);
  let minX=size,minY=size,maxX=-1,maxY=-1,inkPixels=0;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const p=40+((size-1-y)*size+x)*4,alpha=dib[p+3],masked=Boolean(dib[40+size*size*4+(size-1-y)*maskStride+(x>>3)]&(0x80>>(x&7)));
   assert.equal(masked,alpha===0,`AND mask mismatch at ${size}:${x},${y}`);
   if(alpha){inkPixels++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
   if(alpha>=128){const rgb=[dib[p+2],dib[p+1],dib[p]];for(let c=0;c<3;c++)assert.ok(Math.abs(rgb[c]-expected[c])<=2,`STOOM color changed at ${size}`);}
  }
  assert.ok(inkPixels>0);assert.ok(minX>=1&&minY>=1&&maxX<size-1&&maxY<size-1,`Frame ${size} touches an edge`);
 }
 assert.equal(previousEnd,ico.length);
});
