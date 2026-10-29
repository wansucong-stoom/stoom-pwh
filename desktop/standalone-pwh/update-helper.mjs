// Runs from a separate user-data directory after the Pwh window has closed.
import {promises as fs,createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function verifyInstaller(installer,digest,size){
 const hash=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(installer)){bytes+=chunk.length;if(bytes>size)throw Error('설치 파일 크기가 다릅니다.');hash.update(chunk);}
 if(bytes!==size||hash.digest('hex')!==digest)throw Error('설치 파일의 무결성을 확인하지 못했습니다.');
}
export async function runUpdate({installer,digest,size,appExe,resultFile,pids},{platform=process.platform,spawnImpl=spawn,isAlive=alive,sleep=pause,now=Date.now,timeoutMs=90000,env=process.env}={}){
 if(platform!=='win32'||!path.isAbsolute(installer)||path.extname(installer).toLowerCase()!=='.msi'||!path.isAbsolute(appExe)||path.basename(appExe).toLowerCase()!=='pwhdesktop.exe'||!path.isAbsolute(resultFile)||!/^[0-9a-f]{64}$/.test(digest)||!Number.isSafeInteger(size)||size<1||size>256*1024*1024||!pids.length||pids.some(pid=>!Number.isSafeInteger(pid)||pid<=0))throw Error('업데이트 실행 정보를 확인하지 못했습니다.');
 const result=async(status,message)=>{await fs.mkdir(path.dirname(resultFile),{recursive:true});await fs.writeFile(resultFile,JSON.stringify({status,message})+'\n');};
 const relaunch=()=>{const child=spawnImpl(appExe,[],{detached:true,windowsHide:false,stdio:'ignore'});child.on('error',()=>{});child.unref();};
 const deadline=now()+timeoutMs;while(pids.some(isAlive)&&now()<deadline)await sleep(500);
 if(pids.some(isAlive)){await result('blocked','Pwh 창이 닫히지 않아 업데이트를 시작하지 않았습니다.');return 'blocked';}
 try{
  await verifyInstaller(installer,digest,size);
  const msiexec=path.join(env.SystemRoot||'C:\\Windows','System32','msiexec.exe');
  const code=await new Promise((resolve,reject)=>{const child=spawnImpl(msiexec,['/i',installer,'/passive','/norestart','MSIRESTARTMANAGERCONTROL=Disable'],{windowsHide:false,stdio:'ignore'});child.once('error',reject);child.once('exit',resolve);});
  if(code===0){await result('installed','Pwh Desktop 업데이트를 설치했습니다.');relaunch();return 'installed';}
  if(code===3010){await result('restart','업데이트를 마치려면 Windows를 다시 시작해 주세요.');relaunch();return 'restart';}
  throw Error('Windows 설치가 완료되지 않았습니다. 설치 코드: '+code);
 }catch(error){await result('failed',error.message||'업데이트 설치에 실패했습니다.');relaunch();return 'failed';}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const [installer,digest,sizeText,appExe,resultFile,...pidArgs]=process.argv.slice(2),size=Number(sizeText),pids=[...new Set(pidArgs.map(Number))];
 runUpdate({installer,digest,size,appExe,resultFile,pids}).catch(async error=>{try{await fs.mkdir(path.dirname(resultFile),{recursive:true});await fs.writeFile(resultFile,JSON.stringify({status:'failed',message:error.message||'업데이트 설치에 실패했습니다.'})+'\n');}catch{}});
}
