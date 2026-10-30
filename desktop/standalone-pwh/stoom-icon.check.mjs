import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('Pwh icons use the approved STOOM product identity at every native size',async()=>{
 const ico=await fs.readFile(new URL('./stoom.ico',import.meta.url));
 const original=await fs.readFile(new URL('./stoom-mark-original.css',import.meta.url),'utf8');
 const product=await fs.readFile(new URL('./stoom-product-marks.css',import.meta.url),'utf8');
 assert.match(original,/border:\s*2px solid #e3faff/i);
 assert.match(original,/box-shadow:\s*0 0 18px rgb\(103 216 255 \/ 38%\)/i);
 assert.match(original,/transform:\s*rotate\(-35deg\)/i);
 assert.match(product,/font-size:10\.5px/);assert.match(product,/font-weight:850/);
 const sizes=[16,20,24,32,40,48,64,96,128,256];
 assert.equal(hash(ico),'dbf6747c80fb86da182e67ab81e7bfdcfe21fc68dc4855dd8902b87030d51f6e');
 assert.equal(ico.readUInt16LE(0),0);assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),sizes.length);
 let offset=6+16*sizes.length;
 for(const [index,size] of sizes.entries()){
  const entry=6+16*index,width=ico[entry]||256,height=ico[entry+1]||256,length=ico.readUInt32LE(entry+8);
  assert.equal(width,size);assert.equal(height,size);assert.equal(ico.readUInt16LE(entry+4),1);assert.equal(ico.readUInt16LE(entry+6),32);assert.equal(ico.readUInt32LE(entry+12),offset);
  const frame=await fs.readFile(new URL(`../../assets/branding/pwh/icon-${size}.png`,import.meta.url));
  assert.deepEqual(ico.subarray(offset,offset+length),frame,`Icon ${size}px diverged from the approved frame`);offset+=length;
 }
 assert.equal(offset,ico.length);
 const listing=await fs.readFile(new URL('../../assets/stoom.png',import.meta.url));
 const largest=await fs.readFile(new URL('../../assets/branding/pwh/icon-256.png',import.meta.url));
 assert.deepEqual(listing,largest);
 const app=await fs.readFile(new URL('./app.html',import.meta.url),'utf8');assert.match(app,/>Pwh<\/span>/);
 const workspace=await fs.readFile(new URL('./workspace.html',import.meta.url),'utf8');assert.match(workspace,/href="stoom.ico"/);assert.doesNotMatch(workspace,/<button[^>]*id="workspace-home"[^>]*>[\s\S]*?class="stoom-badge"[\s\S]*?<\/button>/);
});
