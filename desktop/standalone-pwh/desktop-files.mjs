import {promises as fs} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {canonicalSavePath,regularFileState as state,withFileTransaction} from './file-transaction.mjs';
const exec=promisify(execFile),hash=data=>createHash('sha256').update(data).digest('hex');
export async function chooseDesktopFile({mode,suggestedName='문서.hwpx',hancomOnly=false}){
 if(process.platform==='linux'){
  if(!['Open','Save','Image'].includes(mode))throw Error('파일 선택 방식이 올바르지 않습니다.');
  const args=['--file-selection','--title=Pwh Desktop'];
  if(mode!=='Open')args.push('--save','--confirm-overwrite','--filename='+path.basename(suggestedName));
  args.push(mode==='Image'?'--file-filter=그림 | *.png *.jpg *.jpeg *.gif *.webp *.bmp':
   mode==='Save'?'--file-filter=HWPX 또는 DOCX | *.hwpx *.docx':
   hancomOnly?'--file-filter=한글 문서 | *.hwpx *.hwp':'--file-filter=한글·Word 문서 | *.hwpx *.hwp *.docx','--file-filter=모든 파일 | *');
  try{const {stdout}=await exec('zenity',args,{timeout:300000,maxBuffer:65536,encoding:'utf8'});const file=stdout.trimEnd();if(!path.isAbsolute(file)||file.includes('\n'))throw Error('파일 경로가 올바르지 않습니다.');return {cancelled:false,path:file};}
  catch(error){if(error.code===1)return {cancelled:true};throw error;}
 }
 const {stdout}=await exec('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','RemoteSigned','-File',fileURLToPath(new URL('./file-dialog.ps1',import.meta.url)),'-Mode',mode,'-SuggestedName',suggestedName,...(hancomOnly?['-HancomOnly']:[])],{windowsHide:true,timeout:300000,maxBuffer:65536,encoding:'utf8'});
 return JSON.parse(stdout.trim());
}
export function createDesktopFileManager({choose=chooseDesktopFile,verify,register,prepareDocx}){
 const tickets=new Map();let target=null,protectedSource=null,dialogBusy=false;
 async function select(options){if(dialogBusy)throw Error('파일 선택창이 이미 열려 있습니다.');dialogBusy=true;try{return await choose(options);}finally{dialogBusy=false;}}
 return {
  setTarget(file,sha256,{protect=false}={}){
   protectedSource=protect?{file,sha256}:null;
   target=file&&!protect?{file,sha256}:null;
  },clear(){target=null;protectedSource=null;tickets.clear();},
  async open(){const picked=await select({mode:'Open'});if(picked.cancelled)return null;const file=path.resolve(picked.path);if(!/\.(?:hwpx?|docx)$/i.test(file))throw Error('HWP, HWPX 또는 DOCX 파일을 선택하세요.');const digest=await state(file);if(!digest)throw Error('파일을 찾을 수 없습니다.');return {file,digest};},
  async prepare({mode,documentId,suggestedName}){
   if(!['save','save-as'].includes(mode))throw Error('저장 방식이 올바르지 않습니다.');let chosen=target;
   if(mode==='save-as'||!chosen){
    const result=await select({mode:'Save',suggestedName:suggestedName||'문서.hwpx'});
    if(result.cancelled)return {cancelled:true};
    const selected=path.resolve(path.extname(result.path)?result.path:result.path+(path.extname(suggestedName||'')||'.hwpx'));
    const file=await canonicalSavePath(selected);
    if(!/\.(?:hwpx|docx)$/i.test(file))throw Error('확장자가 .hwpx 또는 .docx인 파일 이름을 지정하세요.');
    const sha256=await state(file);
    if(protectedSource&&(sha256===protectedSource.sha256
        || file.normalize('NFC').toLowerCase()===protectedSource.file.normalize('NFC').toLowerCase())) {
     throw Error('원본 DOCX에 변환되지 않은 요소가 있어 덮어쓸 수 없습니다. 다른 이름으로 저장하세요.');
    }
    chosen={file,sha256};
   }
   else if(await state(chosen.file)!==chosen.sha256)throw Error('파일이 다른 곳에서 변경되었습니다. 다른 이름으로 저장하세요.');
   const id=randomUUID();tickets.set(id,{...chosen,documentId,createdAt:Date.now()});return {cancelled:false,ticket:id,name:path.basename(chosen.file)};
  },
  async write({ticket,documentId,bytes}){
   const t=tickets.get(ticket);tickets.delete(ticket);if(!t||t.documentId!==documentId||Date.now()-t.createdAt>600000)throw Error('저장 요청이 만료되었습니다. 다시 저장하세요.');
   if(bytes.length<8||bytes[0]!==0x50||bytes[1]!==0x4b)throw Error('HWPX 문서 데이터가 올바르지 않습니다.');
   const docx=path.extname(t.file).toLowerCase()==='.docx';
   const staged=docx?await prepareDocx(bytes,t.file):null;
   const temporary=path.join(path.dirname(t.file),`.pwh-save-${randomUUID()}${docx?'.docx':'.hwpx'}`);
   let committed=false;
   try{
    await fs.writeFile(temporary,staged?.bytes??bytes,{flag:'wx',flush:true});
    if(!docx&&(await verify(temporary))?.format!=='hwpx')throw Error('저장할 문서를 검증하지 못했습니다.');
    return await withFileTransaction(t.file,async file=>{
     if(await state(file)!==t.sha256)throw Error('파일이 다른 곳에서 변경되었습니다. 다른 이름으로 저장하세요.');
     if(t.sha256===null)await fs.link(temporary,file);
     else await fs.rename(temporary,file);
     committed=true;
     const document=staged?.document??await register(file);
     target={file,sha256:staged?hash(staged.bytes):document.sourceSha256};
     return document;
    });
   }finally{
    await fs.unlink(temporary).catch(()=>{});
    if(!committed)await staged?.dispose?.();
   }
  }
 };
}
