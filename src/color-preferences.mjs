import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

// Both hosts use the same user preference, independent of each document/tab.
const dir=process.env.PWH_COLOR_PREFERENCES_DIR||path.join(os.homedir(),'.stoom-pwh','preferences');
const file=path.join(dir,'recent-colors.json');
const normalize=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)?value.toLowerCase():null;
let queue=Promise.resolve();
async function read(){
 try{
  const raw=await fs.readFile(file,'utf8');if(raw.length>4096)throw Error('Color preferences are too large');
  const data=JSON.parse(raw);if(data?.version!==1||!Array.isArray(data.colors))throw Error('Invalid color preferences');
  return [...new Set(data.colors.map(normalize).filter(Boolean))].slice(0,12);
 }catch(error){if(error.code==='ENOENT')return [];throw error;}
}
export function recentColors({color}={}){
 if(color!==undefined&&!normalize(color))return Promise.reject(Error('색상 코드를 확인해 주세요.'));
 const operation=queue.then(async()=>{
  const colors=await read();if(color===undefined)return {colors};
  const value=normalize(color),updated=[value,...colors.filter(c=>c!==value)].slice(0,12);
  await fs.mkdir(dir,{recursive:true});const temp=path.join(dir,`.recent-colors-${randomUUID()}.tmp`);
  try{await fs.writeFile(temp,JSON.stringify({version:1,colors:updated})+'\n',{flag:'wx'});await fs.rename(temp,file);}
  finally{await fs.rm(temp,{force:true}).catch(()=>{});}
  return {colors:updated};
 });
 queue=operation.catch(()=>{});return operation;
}
