import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
export async function buildStoreUpdateCheck(output){
  if(process.platform!=='win32'||!path.isAbsolute(output))throw Error('Store update helper requires Windows and an absolute output path');
  const compiler=path.join(process.env.WINDIR||'C:/Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  await fs.mkdir(path.dirname(output),{recursive:true});
  const staging=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-store-check-'));
  if(path.dirname(staging)!==os.tmpdir()||!path.basename(staging).startsWith('pwh-store-check-'))throw Error('Invalid helper staging path');
  try{
  await fs.copyFile(fileURLToPath(new URL('./store-update-check.cs',import.meta.url)),path.join(staging,'StoreUpdateCheck.cs'));
  await fs.copyFile(fileURLToPath(new URL('./stoom.ico',import.meta.url)),path.join(staging,'stoom.ico'));
  await new Promise((resolve,reject)=>{
    const child=spawn(compiler,['/nologo','/target:exe','/platform:x64','/optimize+','/win32icon:stoom.ico','/out:StoreUpdateCheck.exe','StoreUpdateCheck.cs'],{cwd:staging,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let diagnostic='';for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>diagnostic=(diagnostic+bytes).slice(-4000));
    child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Store update helper build failed: '+diagnostic)));
  });await fs.copyFile(path.join(staging,'StoreUpdateCheck.exe'),output,fs.constants.COPYFILE_EXCL);
  }finally{await fs.rm(staging,{recursive:true,force:true});}
}
