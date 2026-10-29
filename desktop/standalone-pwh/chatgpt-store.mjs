import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const helper=fileURLToPath(new URL('./chatgpt-credentials.ps1',import.meta.url));
const powershell=()=>path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
const spawnHelper=(action,extra=[],spawnImpl=spawn)=>spawnImpl(powershell(),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper,'-Action',action,...extra],{windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});

export function windowsCredentialCodec({spawnImpl=spawn,platform=process.platform}={}){
 async function transform(action,bytes){
  if(platform!=='win32'||!Buffer.isBuffer(bytes)||bytes.length>512*1024)throw Error('Windows 계정 보호 저장소를 사용할 수 없습니다.');
  const child=spawnHelper(action,[],spawnImpl);let output='',failed=false;child.stderr.resume();
  const finished=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{failed=true;child.kill();reject(Error('계정 보호 저장소 응답 시간이 초과되었습니다.'));},20000);timer.unref?.();
   child.on('error',()=>{clearTimeout(timer);reject(Error('계정 보호 저장소를 실행하지 못했습니다.'));});
   child.stdout.on('data',chunk=>{output+=chunk.toString('ascii');if(output.length>1024*1024){failed=true;child.kill();}});
   child.on('close',code=>{clearTimeout(timer);if(failed||code!==0||!output||!/^[A-Za-z0-9+/]+={0,2}$/.test(output))return reject(Error('계정 정보를 안전하게 처리하지 못했습니다.'));resolve(Buffer.from(output,'base64'));});
  });
  child.stdin.on('error',()=>{});child.stdin.end(bytes.toString('base64'));return finished;
 }
 return {protect:bytes=>transform('protect',bytes),unprotect:bytes=>transform('unprotect',bytes)};
}

// The Windows helper holds an exclusive OS file handle for the full operation.
// Windows releases it if either side exits; no stale marker is removed or stolen.
export async function withWindowsCredentialLock(root,operation,{spawnImpl=spawn,platform=process.platform}={}){
 if(platform!=='win32')throw Error('Windows 계정 잠금을 사용할 수 없습니다.');
 await fs.mkdir(root,{recursive:true});const child=spawnHelper('lock',['-LockFile',path.join(root,'credentials.lock')],spawnImpl);child.stderr.resume();let alive=true,output='';
 child.once('exit',()=>{alive=false;});child.stdin.on('error',()=>{});
 await new Promise((resolve,reject)=>{let finished=false;const done=(error)=>{if(finished)return;finished=true;clearTimeout(timer);error?reject(error):resolve();};const timer=setTimeout(()=>{try{child.kill();}catch{}done(Error('계정 저장소가 사용 중입니다. 잠시 후 다시 시도하세요.'));},18000);timer.unref?.();
  child.once('error',()=>done(Error('계정 잠금을 실행하지 못했습니다.')));child.once('exit',()=>done(Error('계정 잠금을 얻지 못했습니다.')));
  child.stdout.on('data',chunk=>{output+=chunk.toString('utf8');if(output.length>64){try{child.kill();}catch{}done(Error('계정 잠금 응답이 올바르지 않습니다.'));}else if(output.includes('\n'))output.trim()==='locked'?done():done(Error('계정 잠금 응답이 올바르지 않습니다.'));});
 });
 const guard=()=>{if(!alive||child.exitCode!==null||child.stdin.destroyed)throw Error('계정 잠금이 해제되어 작업을 중단했습니다.');};
 try{guard();return await operation(guard);}finally{child.stdin.end();if(child.exitCode===null)await new Promise(resolve=>{const timer=setTimeout(()=>{try{child.kill();}catch{}resolve();},3000);timer.unref?.();child.once('exit',()=>{clearTimeout(timer);resolve();});});}
}

export function createCredentialStore({root,codec=windowsCredentialCodec(),lock=withWindowsCredentialLock}={}){
 if(!root||!path.isAbsolute(root))throw Error('계정 저장 경로가 올바르지 않습니다.');
 const file=path.join(root,'credentials.dat');
 return {async transaction(fn){return lock(root,async guard=>{
  let state,created=false;try{const encrypted=await fs.readFile(file);if(encrypted.length>512*1024)throw Error('계정 저장소 크기가 올바르지 않습니다.');state=JSON.parse((await codec.unprotect(encrypted)).toString('utf8'));}
  catch(error){if(error.code==='ENOENT'){created=true;state={schemaVersion:1,hostId:'urn:uuid:'+randomUUID(),active:null,accounts:[]};}else throw error;}
  if(state?.schemaVersion!==1||typeof state.hostId!=='string'||!/^urn:uuid:[0-9a-f-]{36}$/i.test(state.hostId)||!Array.isArray(state.accounts))throw Error('저장된 계정 정보를 확인하지 못했습니다.');
  const outcome=await fn(state,guard);guard();
  if(outcome?.write||created){const bytes=Buffer.from(JSON.stringify(state),'utf8'),encrypted=await codec.protect(bytes);guard();const temporary=path.join(root,'.credentials-'+randomUUID()+'.tmp');
   try{await fs.writeFile(temporary,encrypted,{flag:'wx',mode:0o600});guard();await fs.rename(temporary,file);}finally{await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}}
  return outcome?.value;
 });}};
}
