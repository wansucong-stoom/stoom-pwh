import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import config from './config.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const cached=new Map();let inventory=null,pending=null;
const FONT_CHUNK_BYTES=512*1024,MAX_FONT_BYTES=64*1024*1024;
const fontStamp=stat=>`${stat.size}:${stat.mtimeMs}`;
/** Own verified file bytes; expose only immutable chunk strings to callers. */
export function createFontChunkReader({maxBytes=MAX_FONT_BYTES,readFile=fs.readFile,statFile=fs.stat}={}){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<0)throw Error('Invalid font cache limit');
 const entries=new Map(),reads=new Map();let cachedBytes=0;
 const validate=(stat,expectedStamp)=>{
  if(!stat.isFile()||!Number.isSafeInteger(stat.size)||stat.size<1||stat.size>MAX_FONT_BYTES||fontStamp(stat)!==expectedStamp)throw Error('글꼴 파일이 변경됐습니다.');
 };
 async function verifiedFile(file,expectedStamp){
  const existing=entries.get(file);
  if(existing?.stamp===expectedStamp){entries.delete(file);entries.set(file,existing);return existing;}
  if(existing){entries.delete(file);cachedBytes-=existing.bytes.length;}
  const key=JSON.stringify([file,expectedStamp]);let pendingRead=reads.get(key);
  if(!pendingRead){
   pendingRead=(async()=>{
    const bytes=Buffer.from(await readFile(file));
    const after=await statFile(file);validate(after,expectedStamp);
    if(bytes.length!==after.size)throw Error('글꼴 파일이 변경됐습니다.');
    const entry={stamp:expectedStamp,bytes,sha256:hash(bytes)};
    // A large one-off face may be served without displacing a bounded cache.
    if(bytes.length<=maxBytes){
     const replaced=entries.get(file);if(replaced){entries.delete(file);cachedBytes-=replaced.bytes.length;}
     for(const [oldFile,old] of entries){if(cachedBytes+bytes.length<=maxBytes)break;entries.delete(oldFile);cachedBytes-=old.bytes.length;}
     entries.set(file,entry);cachedBytes+=bytes.length;
    }
    return entry;
   })().finally(()=>{if(reads.get(key)===pendingRead)reads.delete(key);});
   reads.set(key,pendingRead);
  }
  return pendingRead;
 }
 return async(file,expectedStamp,offset)=>{
  // Check the authorized catalog's file stamp on every chunk, including hits.
  const stat=await statFile(file);validate(stat,expectedStamp);
  if(!Number.isSafeInteger(offset)||offset<0||offset>=stat.size)throw Error('글꼴 청크 위치 오류');
  const {bytes,sha256}=await verifiedFile(file,expectedStamp),end=Math.min(bytes.length,offset+FONT_CHUNK_BYTES);
  return {offset,totalBytes:bytes.length,sha256,nextOffset:end<bytes.length?end:null,base64:bytes.subarray(offset,end).toString('base64')};
 };
}
const readFontChunk=createFontChunkReader();
function utf16be(bytes){const b=Buffer.from(bytes);if(b.length%2)return '';b.swap16();return b.toString('utf16le').replace(/\0/g,'').trim();}
export function sfntFaces(bytes){
 const faces=[];const starts=bytes.toString('ascii',0,4)==='ttcf'?Array.from({length:Math.min(bytes.readUInt32BE(8),256)},(_,i)=>bytes.readUInt32BE(12+i*4)):[0];
 for(let faceIndex=0;faceIndex<starts.length;faceIndex++){
  const base=starts[faceIndex];if(base+12>bytes.length)continue;const count=bytes.readUInt16BE(base+4);if(count>256||base+12+count*16>bytes.length)continue;
  const tables=new Map();for(let i=0;i<count;i++){const at=base+12+i*16,offset=bytes.readUInt32BE(at+8),length=bytes.readUInt32BE(at+12);if(offset+length<=bytes.length)tables.set(bytes.toString('ascii',at,at+4),bytes.subarray(offset,offset+length));}
  const name=tables.get('name');if(!name||name.length<6)continue;const n=name.readUInt16BE(2),start=name.readUInt16BE(4),names=new Map(),aliases=[];
  for(let i=0;i<n&&i<4096;i++){const at=6+i*12;if(at+12>name.length)break;const platform=name.readUInt16BE(at),language=name.readUInt16BE(at+4),id=name.readUInt16BE(at+6),length=name.readUInt16BE(at+8),off=start+name.readUInt16BE(at+10);if(off+length>name.length||length>4096)continue;
   const value=(platform===0||platform===3)?utf16be(name.subarray(off,off+length)):platform===1?name.toString('latin1',off,off+length).replace(/\0/g,'').trim():'';
   if(!value||value.length>1024)continue;if([1,4,6,16].includes(id)&&aliases.length<32&&!aliases.includes(value))aliases.push(value);
   const rank=language===0x412?3:language===0x409?2:1;if(!names.has(id)||names.get(id).rank<rank)names.set(id,{value,rank});
  }
  const get=id=>names.get(id)?.value||'',family=get(16)||get(1);if(!family)continue;const os2=tables.get('OS/2');const weight=os2?.length>=6?Math.min(1000,Math.max(1,os2.readUInt16BE(4))):400;
  faces.push({family,fullName:get(4)||family,postscriptName:get(6),style:get(17)||get(2),aliases,weight,slant:os2?.length>=64&&(os2.readUInt16BE(62)&1)?'italic':'normal',faceIndex});
 }
 return faces;
}
async function scan(){
 const files=new Set();const walk=async(dir,depth=0)=>{if(depth>3)return;let entries;try{entries=await fs.readdir(dir,{withFileTypes:true});}catch{return;}for(const e of entries){if(files.size>=10000)break;const file=path.join(dir,e.name);if(e.isDirectory())await walk(file,depth+1);else if(e.isFile()&&/\.(ttf|otf|ttc|otc)$/i.test(e.name))files.add(file);}};
 const roots=[...config.fontPaths];if(process.platform==='win32'){if(process.env.WINDIR)roots.push(path.join(process.env.WINDIR,'Fonts'));if(process.env.LOCALAPPDATA)roots.push(path.join(process.env.LOCALAPPDATA,'Microsoft','Windows','Fonts'));}
 for(const dir of new Set(roots))await walk(dir);
 for(const item of config.documentFonts)files.add(item.path);
 const records=new Map();
 for(const file of [...files].sort())try{const stat=await fs.stat(file);if(!stat.isFile()||!stat.size||stat.size>64*1024*1024)continue;const stamp=`${stat.size}:${stat.mtimeMs}`,old=cached.get(file);let faces;
  if(old?.stamp===stamp)faces=old.faces;else{faces=sfntFaces(await fs.readFile(file));cached.set(file,{stamp,faces});}
  for(const face of faces){const id=hash(`${file}:${face.faceIndex}`);records.set(id,{...face,id,file,stamp});}
 }catch{/* Broken or unsupported fonts must not prevent editor startup. */}
 for(const file of cached.keys())if(!files.has(file))cached.delete(file);
 const revision=hash(JSON.stringify([...records.values()].map(({id,stamp,family,weight,slant})=>({id,stamp,family,weight,slant}))));inventory={records,revision};return inventory;
}
export async function systemFontSnapshot(){pending??=scan().finally(()=>{pending=null;});await pending;return {revision:inventory.revision,faces:[...inventory.records.values()].map(({file,stamp,faceIndex,...face})=>face)};}
export async function systemFontChunk(args){
 if(!inventory)await systemFontSnapshot();if(args.revision!==inventory.revision)throw Error('설치 글꼴 목록이 변경됐습니다. 다시 불러오세요.');const face=inventory.records.get(args.id);if(!face)throw Error('등록되지 않은 글꼴입니다.');
 const {base64,...metadata}=await readFontChunk(face.file,face.stamp,args.offset);
 return {content:[{type:'text',text:'System font chunk'}],structuredContent:{...metadata,faceIndex:face.faceIndex},_meta:{'pwh/font-bytes':base64}};
}
