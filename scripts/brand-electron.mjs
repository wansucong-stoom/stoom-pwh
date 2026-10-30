import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';

// Build-time tool only; no resource editor is installed on users' computers.
export const RCEDIT_URL='https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe';
export const RCEDIT_SHA256='3e7801db1a5edbec91b49a24a094aad776cb4515488ea5a4ca2289c400eade2a';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function brandElectron(directory,icon,version){
 if(process.platform!=='win32'||!path.isAbsolute(directory)||!path.isAbsolute(icon)||!/^\d+\.\d+\.\d+$/.test(version))throw Error('Pwh Windows 실행 파일 빌드 정보를 확인해 주세요.');
 let tool=process.env.PWH_RCEDIT_PATH,temp;
 try{
  if(tool){if(!path.isAbsolute(tool))throw Error('리소스 편집 도구 경로는 절대 경로여야 합니다.');}
  else{
   temp=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-resource-editor-'));tool=path.join(temp,'rcedit.exe');
   const response=await fetch(RCEDIT_URL,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('공식 Windows 리소스 편집 도구를 내려받지 못했습니다.');
   const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length!==1360384||hash(bytes)!==RCEDIT_SHA256)throw Error('Windows 리소스 편집 도구의 무결성이 일치하지 않습니다.');
   await fs.writeFile(tool,bytes,{flag:'wx'});
  }
  const bytes=await fs.readFile(tool);if(bytes.length!==1360384||hash(bytes)!==RCEDIT_SHA256)throw Error('Windows 리소스 편집 도구의 무결성이 일치하지 않습니다.');
  const executable=path.join(directory,'PwhDesktopShell.exe');await fs.access(path.join(directory,'electron.exe'));
  try{await fs.access(executable);throw Error('Pwh 실행 파일이 이미 있습니다. 새 빌드 폴더를 사용하세요.');}catch(error){if(error.code!=='ENOENT')throw error;}
  await fs.rename(path.join(directory,'electron.exe'),executable);
  const args=[executable,'--set-icon',icon,'--set-file-version',version+'.0','--set-product-version',version,
   '--set-version-string','ProductName','Pwh Desktop','--set-version-string','FileDescription','Pwh Desktop',
   '--set-version-string','CompanyName','Wansucong the STOOM','--set-version-string','InternalName','PwhDesktopShell',
   '--set-version-string','OriginalFilename','PwhDesktopShell.exe'];
  await new Promise((resolve,reject)=>{const child=spawn(tool,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let diagnostic='';for(const stream of [child.stdout,child.stderr])stream.on('data',part=>{diagnostic=(diagnostic+part).slice(-4000);});child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('Pwh 실행 파일 이름·아이콘 적용 실패: '+diagnostic)));});
  const record={schema:1,product:'Pwh Desktop',version,executable:'PwhDesktopShell.exe',executableSha256:hash(await fs.readFile(executable)),iconSha256:hash(await fs.readFile(icon)),resourceEditor:{url:RCEDIT_URL,sha256:RCEDIT_SHA256}};
  await fs.writeFile(path.join(directory,'pwh-branding.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});return record;
 }finally{if(temp)await fs.rm(temp,{recursive:true,force:true});}
}
