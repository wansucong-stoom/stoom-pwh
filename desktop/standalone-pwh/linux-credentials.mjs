import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';

// Keep the encryption key in the desktop Secret Service, never next to tokens.
// A missing/locked keyring fails closed; there is no plaintext fallback.
function secret(args,input){return new Promise((resolve,reject)=>{
 const child=spawn('secret-tool',args,{stdio:['pipe','pipe','pipe'],shell:false});let out='',ended=false;
 const finish=(error,value)=>{if(ended)return;ended=true;clearTimeout(timer);error?reject(error):resolve(value);};
 const timer=setTimeout(()=>{child.kill();finish(Error('Linux 키 모음을 잠금 해제한 뒤 다시 시도해 주세요.'));},20000);
 child.stderr.resume();child.stdout.on('data',b=>{out+=b;if(out.length>4096){child.kill();finish(Error('키 모음 응답이 올바르지 않습니다.'));}});
 child.on('error',()=>finish(Error('Linux Secret Service를 사용할 수 없습니다.')));child.on('close',code=>finish(code!==0?Error('Linux 키 모음을 잠금 해제한 뒤 다시 시도해 주세요.'):null,out.trim()));child.stdin.on('error',()=>{});child.stdin.end(input);
});}
export function linuxCredentialCodec(){
 async function key(create){
  let encoded;try{encoded=await secret(['lookup','application','stoom-pwh-desktop','purpose','credential-key']);}catch(error){if(!create)throw error;}
  if(!encoded&&create){encoded=randomBytes(32).toString('base64');await secret(['store','--label=Pwh Desktop','application','stoom-pwh-desktop','purpose','credential-key'],encoded);}
  if(!/^[A-Za-z0-9+/]{43}=$/.test(encoded||''))throw Error('Pwh 계정 암호화 키를 확인하지 못했습니다.');return Buffer.from(encoded,'base64');
 }
 return {async protect(bytes){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',await key(true),iv);return Buffer.concat([Buffer.from('PWH1'),iv,cipher.update(bytes),cipher.final(),cipher.getAuthTag()]);},async unprotect(bytes){if(bytes.length<32||bytes.subarray(0,4).toString()!=='PWH1')throw Error('계정 저장소 형식이 올바르지 않습니다.');const cipher=createDecipheriv('aes-256-gcm',await key(false),bytes.subarray(4,16));cipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([cipher.update(bytes.subarray(16,-16)),cipher.final()]);}};
}
export async function withLinuxCredentialLock(root,operation){
 await fs.mkdir(root,{recursive:true,mode:0o700});await fs.chmod(root,0o700);
 const child=spawn('flock',['--exclusive','--wait','15',path.join(root,'credentials.lock'),'sh','-c','printf "locked\\n"; cat >/dev/null'],{stdio:['pipe','pipe','pipe'],shell:false});child.stderr.resume();child.stdin.on('error',()=>{});let alive=true;child.once('exit',()=>{alive=false;});
 await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>{child.kill();reject(Error('계정 저장소가 사용 중입니다.'));},18000);child.once('error',()=>{clearTimeout(timer);reject(Error('계정 잠금을 실행하지 못했습니다.'));});child.once('exit',()=>{clearTimeout(timer);reject(Error('계정 잠금을 얻지 못했습니다.'));});child.stdout.on('data',b=>{out+=b;if(out==='locked\n'){clearTimeout(timer);resolve();}else if(out.length>64){child.kill();clearTimeout(timer);reject(Error('계정 잠금 응답 오류'));}});});
 const guard=()=>{if(!alive||child.exitCode!==null)throw Error('계정 잠금이 해제되었습니다.');};try{guard();return await operation(guard);}finally{child.stdin.end();}
}
