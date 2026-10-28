import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root=path.dirname(fileURLToPath(import.meta.url)),sizes=[16,24,32,48,64,128,256];
const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const source=path.resolve(value('--svg')||path.join(root,'stoom-mark.svg'));
const output=path.resolve(value('--output')||path.join(root,'stoom.ico'));
const preview=value('--preview-dir')?path.resolve(value('--preview-dir')):null;
const sharpModule=process.env.PWH_SHARP_MODULE||'sharp';
const {default:sharp}=await import(path.isAbsolute(sharpModule)?pathToFileURL(sharpModule):sharpModule);
const svg=await fs.readFile(source,'utf8'),viewBox=svg.match(/\bviewBox="([^"]+)"/)?.[1],contents=svg.replace(/^\s*<svg\b[^>]*>/,'').replace(/<\/svg>\s*$/,'');
if(!viewBox||contents===svg)throw Error('A canonical SVG with a viewBox is required');
if(preview)await fs.mkdir(preview,{recursive:true});

function dib(size,rgba){
  const maskStride=Math.ceil(size/32)*4,bytes=Buffer.alloc(40+size*size*4+maskStride*size);
  bytes.writeUInt32LE(40,0);bytes.writeInt32LE(size,4);bytes.writeInt32LE(size*2,8);bytes.writeUInt16LE(1,12);bytes.writeUInt16LE(32,14);bytes.writeUInt32LE(size*size*4,20);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const src=(y*size+x)*4,dst=40+((size-1-y)*size+x)*4;
    bytes[dst]=rgba[src+2];bytes[dst+1]=rgba[src+1];bytes[dst+2]=rgba[src];bytes[dst+3]=rgba[src+3];
    if(rgba[src+3]===0)bytes[40+size*size*4+(size-1-y)*maskStride+(x>>3)]|=0x80>>(x&7);
  }
  return bytes;
}
function bounds(size,rgba){let minX=size,minY=size,maxX=-1,maxY=-1;for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(rgba[(y*size+x)*4+3]){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}return {minX,minY,maxX,maxY};}
const frames=[],report=[];
for(const size of sizes){
  const padding=Math.max(1,Math.round(size*.08)),inner=size-padding*2;
  // Only the transparent canvas changes. The canonical geometry, aspect ratio,
  // stroke width, stroke caps and color remain unmodified.
  const padded=`<svg xmlns="http://www.w3.org/2000/svg" width="${size*8}" height="${size*8}" viewBox="0 0 ${size} ${size}"><svg x="${padding}" y="${padding}" width="${inner}" height="${inner}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">${contents}</svg></svg>`;
  const rgba=await sharp(Buffer.from(padded)).resize(size,size,{kernel:'lanczos3'}).ensureAlpha().raw().toBuffer();
  const ink=bounds(size,rgba);if(ink.minX<1||ink.minY<1||ink.maxX>=size-1||ink.maxY>=size-1)throw Error(`Icon ${size} touches the canvas edge`);
  // DIB frames also work with the legacy System.Drawing/WinForms icon loader.
  // A PNG-only 256px frame may be skipped there in favor of a smaller frame.
  const png=await sharp(rgba,{raw:{width:size,height:size,channels:4}}).png().toBuffer(),bytes=dib(size,rgba);
  frames.push({size,bytes});report.push({size,padding,format:'dib',bounds:ink});
  if(preview)await fs.writeFile(path.join(preview,`stoom-${size}.png`),png);
}
const directory=Buffer.alloc(6+16*frames.length);directory.writeUInt16LE(1,2);directory.writeUInt16LE(frames.length,4);let offset=directory.length;
frames.forEach(({size,bytes},index)=>{const p=6+index*16;directory[p]=directory[p+1]=size===256?0:size;directory.writeUInt16LE(1,p+4);directory.writeUInt16LE(32,p+6);directory.writeUInt32LE(bytes.length,p+8);directory.writeUInt32LE(offset,p+12);offset+=bytes.length;});
const ico=Buffer.concat([directory,...frames.map(frame=>frame.bytes)]);await fs.writeFile(output,ico);
const result={sourceSha256:createHash('sha256').update(svg).digest('hex'),icoSha256:createHash('sha256').update(ico).digest('hex'),bytes:ico.length,frames:report};
if(preview)await fs.writeFile(path.join(preview,'icon-report.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
