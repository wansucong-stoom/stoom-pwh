import {promises as fs} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const app=path.dirname(fileURLToPath(import.meta.url));
export async function buildNativeLauncher(output){
 if(process.platform!=='win32')throw Error('Pwh Windows 실행 파일은 Windows에서 빌드해야 합니다.');
 const compiler=path.join(process.env.WINDIR||'C:/Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
 await fs.access(compiler);await fs.mkdir(path.dirname(output),{recursive:true});
 const args=['/nologo','/target:winexe','/platform:x64','/optimize+','/reference:System.Windows.Forms.dll',`/win32icon:${path.join(app,'stoom.ico')}`,`/out:${path.resolve(output)}`,path.join(app,'native-launcher.cs')];
 await new Promise((resolve,reject)=>{const child=spawn(compiler,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>log+=chunk);child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('Windows 실행 파일 빌드 실패: '+log)));});
 return path.resolve(output);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(!process.argv[2])throw Error('출력 실행 파일 경로가 필요합니다.');
 console.log(await buildNativeLauncher(process.argv[2]));
}
