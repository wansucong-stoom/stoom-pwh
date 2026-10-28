import {promises as fs} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const exec=promisify(execFile),hash=data=>createHash('sha256').update(data).digest('hex');
export async function chooseDesktopFile({mode,suggestedName='문서.hwpx'}){
 const {stdout}=await exec('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','RemoteSigned','-File',fileURLToPath(new URL('./file-dialog.ps1',import.meta.url)),'-Mode',mode,'-SuggestedName',suggestedName],{windowsHide:true,timeout:300000,maxBuffer:65536,encoding:'utf8'});
 return JSON.parse(stdout.trim());
}
async function state(file){try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('일반 파일을 선택하세요.');if(stat.size>64*1024*1024)throw Error('64 MiB 이하의 문서를 선택하세요.');return hash(await fs.readFile(file));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
export function createDesktopFileManager({choose=chooseDesktopFile,verify,register}){
 const tickets=new Map();let target=null,dialogBusy=false;
 async function select(options){if(dialogBusy)throw Error('파일 선택창이 이미 열려 있습니다.');dialogBusy=true;try{return await choose(options);}finally{dialogBusy=false;}}
 return {
  setTarget(file,sha256){target=file?{file,sha256}:null;},clear(){target=null;tickets.clear();},
  async open(){const picked=await select({mode:'Open'});if(picked.cancelled)return null;const file=path.resolve(picked.path);if(!/\.hwpx?$/i.test(file))throw Error('HWP 또는 HWPX 파일을 선택하세요.');const digest=await state(file);if(!digest)throw Error('파일을 찾을 수 없습니다.');return {file,digest};},
  async prepare({mode,documentId,suggestedName}){
   if(!['save','save-as'].includes(mode))throw Error('저장 방식이 올바르지 않습니다.');let chosen=target;
   if(mode==='save-as'||!chosen){const result=await select({mode:'Save',suggestedName:suggestedName||'문서.hwpx'});if(result.cancelled)return {cancelled:true};const file=path.resolve(result.path);if(!/\.hwpx$/i.test(file))throw Error('HWPX 파일 이름을 선택하세요.');chosen={file,sha256:await state(file)};}
   else if(await state(chosen.file)!==chosen.sha256)throw Error('파일이 다른 곳에서 변경되었습니다. 다른 이름으로 저장하세요.');
   const id=randomUUID();tickets.set(id,{...chosen,documentId,createdAt:Date.now()});return {cancelled:false,ticket:id,name:path.basename(chosen.file)};
  },
  async write({ticket,documentId,bytes}){
   const t=tickets.get(ticket);tickets.delete(ticket);if(!t||t.documentId!==documentId||Date.now()-t.createdAt>600000)throw Error('저장 요청이 만료되었습니다. 다시 저장하세요.');
   if(bytes.length<8||bytes.length>64*1024*1024||bytes.subarray(0,2).toString()!=='PK')throw Error('HWPX 문서 데이터가 올바르지 않습니다.');
   const temporary=path.join(path.dirname(t.file),`.pwh-save-${randomUUID()}.hwpx`);let created=false;
   try{await fs.writeFile(temporary,bytes,{flag:'wx'});created=true;const info=await verify(temporary);if(info?.format!=='hwpx')throw Error('저장할 문서를 검증하지 못했습니다.');if(await state(t.file)!==t.sha256)throw Error('파일이 다른 곳에서 변경되었습니다. 다른 이름으로 저장하세요.');
    if(t.sha256===null){await fs.link(temporary,t.file);await fs.unlink(temporary);created=false;}else{await fs.rename(temporary,t.file);created=false;}
    const document=await register(t.file);target={file:document.source,sha256:document.sourceSha256};return document;
   }finally{if(created)await fs.unlink(temporary).catch(()=>{});}
  }
 };
}
