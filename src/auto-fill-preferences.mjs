import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateCustomList} from './auto-fill-lists.mjs';
const dir=process.env.PWH_AUTOFILL_PREFERENCES_DIR||path.join(os.homedir(),'.stoom-pwh','preferences');
const file=path.join(dir,'auto-fill-lists.json');
const maxFileBytes=1000000;
let queue=Promise.resolve();
async function read(){
 try{
  if((await fs.stat(file)).size>maxFileBytes)throw Error('자동 채우기 목록이 너무 큽니다.');
  const raw=await fs.readFile(file,'utf8');if(Buffer.byteLength(raw,'utf8')>maxFileBytes)throw Error('자동 채우기 목록이 너무 큽니다.');
  const data=JSON.parse(raw);if(data.version!==1||!Array.isArray(data.lists)||data.lists.length>100)throw Error('자동 채우기 목록 형식을 확인하세요.');
  return data.lists.map(validateCustomList);
 }catch(error){if(error.code==='ENOENT')return [];throw error;}
}
export function autoFillPreferences({upsert,remove}={}){
 const task=queue.then(async()=>{
  if(upsert&&remove)throw Error('목록 추가와 삭제는 따로 요청하세요.');
  let lists=await read();
  if(upsert){const value=validateCustomList(upsert);lists=[...lists.filter(list=>list.id!==value.id),value];if(lists.length>100)throw Error('사용자 정의 목록은 100개까지 저장할 수 있습니다.');}
  if(remove!==undefined){if(typeof remove!=='string')throw Error('목록을 선택하세요.');lists=lists.filter(list=>list.id!==remove);}
  if(upsert||remove!==undefined){
   const serialized=JSON.stringify({version:1,lists})+'\n';
   if(Buffer.byteLength(serialized,'utf8')>maxFileBytes)throw Error('자동 채우기 목록의 전체 저장 용량을 초과했습니다. 사용하지 않는 목록을 삭제하세요.');
   await fs.mkdir(dir,{recursive:true});const temp=path.join(dir,'.auto-fill-'+randomUUID()+'.tmp');
   try{await fs.writeFile(temp,serialized,{flag:'wx'});await fs.rename(temp,file);}
   finally{await fs.rm(temp,{force:true}).catch(()=>{});}
  }
  return {lists};
 });
 queue=task.catch(()=>{});return task;
}
