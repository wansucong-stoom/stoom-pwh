import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

// Repack the approved, common Pwh/SST identity's original PNG frames. This
// changes no artwork, glow, font or pixel; the output is deterministic.
const root=path.dirname(fileURLToPath(import.meta.url));
const framesRoot=path.resolve(root,'../../assets/branding/pwh');
const sizes=[16,20,24,32,40,48,64,96,128,256];
const args=process.argv.slice(2);
if(args.length&&!(args.length===2&&args[0]==='--output'))throw Error('Usage: node build-stoom-icon.mjs [--output <path>]');
const output=args.length?path.resolve(args[1]):path.join(root,'stoom.ico');
const pngSignature=Buffer.from('89504e470d0a1a0a','hex');
const frames=[];
for(const size of sizes){
 const png=await fs.readFile(path.join(framesRoot,`icon-${size}.png`));
 if(!png.subarray(0,8).equals(pngSignature)||png.readUInt32BE(16)!==size||png.readUInt32BE(20)!==size)throw Error(`Invalid approved ${size}px PNG frame`);
 frames.push(png);
}
const directory=Buffer.alloc(6+16*sizes.length);directory.writeUInt16LE(1,2);directory.writeUInt16LE(sizes.length,4);
let offset=directory.length;
for(const [index,size] of sizes.entries()){
 const entry=6+index*16,frame=frames[index];directory[entry]=directory[entry+1]=size===256?0:size;
 directory.writeUInt16LE(1,entry+4);directory.writeUInt16LE(32,entry+6);directory.writeUInt32LE(frame.length,entry+8);directory.writeUInt32LE(offset,entry+12);offset+=frame.length;
}
const ico=Buffer.concat([directory,...frames]);
await fs.writeFile(output,ico);
console.log(JSON.stringify({sha256:createHash('sha256').update(ico).digest('hex'),sizes,bytes:ico.length}));
