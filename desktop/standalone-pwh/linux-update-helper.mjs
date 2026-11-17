import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {spawn,execFile} from 'node:child_process';import {promisify} from 'node:util';import {createHash} from 'node:crypto';
import {installLinux} from './linux-install.mjs';
const exec=promisify(execFile),alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}};
const detached=exe=>{const child=spawn(exe,[],{detached:true,stdio:'ignore'});child.on('error',()=>{});child.unref();};
export async function applyLinuxUpdate({installer,sha256,size,pids,resultFile,oldApp},{launch=detached,isAlive=alive,timeoutMs=120000,graceMs=5000}={}){
 let work;try{
  if(!path.isAbsolute(installer)||!/^[a-f0-9]{64}$/.test(sha256)||!Number.isSafeInteger(size)||!Array.isArray(pids)||pids.some(p=>!Number.isSafeInteger(p)||p<2||p===process.pid))throw Error('업데이트 요청이 올바르지 않습니다.');
  const bytes=await fs.readFile(installer);if(bytes.length!==size||createHash('sha256').update(bytes).digest('hex')!==sha256)throw Error('설치 파일 검증에 실패했습니다.');
  const {stdout}=await exec('tar',['-tzf',installer],{maxBuffer:8*1024*1024});const names=stdout.trim().split('\n');
  if(names.length>10000||names.some(n=>!/^PwhDesktop\//.test(n)||n.includes('\\')||n.split('/').includes('..')||/[\x00-\x1f]/.test(n)))throw Error('설치 파일 경로가 올바르지 않습니다.');
  const listing=await exec('tar',['-tvzf',installer],{maxBuffer:8*1024*1024});if(listing.stdout.trim().split('\n').some(line=>!/^[-d]/.test(line)))throw Error('설치 파일에 링크나 특수 파일이 포함되어 있습니다.');
  work=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-update-'));await exec('tar',['-xzf',installer,'-C',work,'--no-same-owner','--no-same-permissions']);
  const source=path.join(work,'PwhDesktop');
  // Generated release archives contain only regular files and directories.
  async function safe(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isSymbolicLink()||(!e.isFile()&&!e.isDirectory()))throw Error('설치 파일 유형이 올바르지 않습니다.');if(e.isDirectory())await safe(file);}}
  await safe(source);
  const started=Date.now();while(pids.some(isAlive)){if(Date.now()-started>timeoutMs)throw Error('앱이 종료되지 않아 업데이트를 취소했습니다. 문서를 저장한 뒤 다시 시도해 주세요.');await new Promise(r=>setTimeout(r,Math.min(250,timeoutMs)));}
  const installed=await installLinux(source);await fs.writeFile(resultFile,JSON.stringify({status:'success',message:'Pwh Desktop을 업데이트했습니다.'}));
  launch(installed.launcher);return installed;
 }catch(error){await fs.writeFile(resultFile,JSON.stringify({status:'error',message:error.message}));
  if(oldApp&&path.isAbsolute(oldApp)&&Array.isArray(pids)){const until=Date.now()+graceMs;while(pids.some(isAlive)&&Date.now()<until)await new Promise(r=>setTimeout(r,100));if(!pids.some(isAlive))launch(oldApp);}
  throw error;}
 finally{if(work)await fs.rm(work,{recursive:true,force:true});}
}
if(process.argv[1]&&path.basename(process.argv[1])==='linux-update-helper.mjs'&&process.argv[2]){const input=JSON.parse(await fs.readFile(process.argv[2],'utf8'));await applyLinuxUpdate(input);}
