import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import config from './config.mjs';
const assets=new Map();
export async function registerReplacementImage(filename,sessionId){
 if(typeof filename!=='string'||!path.isAbsolute(filename))throw Error('교체 이미지의 절대 경로가 필요합니다.');
 const stat=await fs.stat(filename);if(!stat.isFile()||stat.size>8*1024*1024)throw Error('이미지는 최대 8 MiB입니다.');
 const bytes=await fs.readFile(filename);if(!bytes.length||bytes.length>8*1024*1024)throw Error('이미지 크기를 확인하세요.');
 const info=await new Promise((resolve,reject)=>{
  const child=spawn(config.pythonPath,['-B',fileURLToPath(new URL('../scripts/inspect_image.py',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']});let output='',errors='';
  const timer=setTimeout(()=>{child.kill();reject(Error('이미지 검사 시간 초과'));},30000);
  child.on('error',e=>{clearTimeout(timer);reject(e);});child.stdin.on('error',()=>{});
  child.stdout.on('data',b=>{output+=b;if(output.length>65536)child.kill();});child.stderr.on('data',b=>{if(errors.length<4096)errors+=b;});
  child.on('close',code=>{clearTimeout(timer);try{const info=JSON.parse(output);if(code||info.error)throw Error(info.error||errors);resolve(info);}catch(e){reject(e);}});child.stdin.end(bytes);
 });
 for(const [id,item]of assets)if(Date.now()-item.createdAt>600000)assets.delete(id);
 if(assets.size>=8)assets.delete(assets.keys().next().value);
 const assetId=randomUUID(),metadata={assetId,sha256:createHash('sha256').update(bytes).digest('hex'),totalBytes:bytes.length,width:info.width,height:info.height,mediaType:info.mediaType,extension:{PNG:'png',JPEG:'jpg',BMP:'bmp'}[info.format]};
 assets.set(assetId,{bytes,sessionId,metadata,createdAt:Date.now()});return metadata;
}
export function replacementImageChunk(args){
 const item=assets.get(args.assetId);if(!item||item.sessionId!==args.sessionId||Date.now()-item.createdAt>600000)throw Error('교체 이미지가 만료됐습니다. 다시 요청하세요.');
 if(!Number.isSafeInteger(args.offset)||args.offset<0||args.offset>=item.bytes.length)throw Error('이미지 청크 위치 오류');
 const end=Math.min(item.bytes.length,args.offset+512*1024);
 return {content:[{type:'text',text:'Replacement image chunk'}],structuredContent:{...item.metadata,offset:args.offset,nextOffset:end<item.bytes.length?end:null},_meta:{'pwh/image-bytes':item.bytes.subarray(args.offset,end).toString('base64')}};
}
