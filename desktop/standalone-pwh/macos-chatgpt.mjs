import path from 'node:path';
import fs from 'node:fs/promises';
import {createChatgptAuth} from './chatgpt-auth.mjs';
import {createCredentialStore} from './chatgpt-store.mjs';

export function createMacChatgptAuth({dataRoot,safeStorage,openExternal}){
 const root=path.join(dataRoot,'chatgpt-auth');
 const keychainError=()=>Error('macOS 키체인에 접근하지 못했습니다. 로그인 키체인의 잠금을 풀고 다시 시도해 주세요.');
 const codec={
  async protect(bytes){
   try{
    if(!await safeStorage.isAsyncEncryptionAvailable())throw keychainError();
    return await safeStorage.encryptStringAsync(bytes.toString('utf8'));
   }catch{throw keychainError();}
  },
  async unprotect(encrypted){
   try{
    const {result}=await safeStorage.decryptStringAsync(encrypted);
    if(typeof result!=='string'||!result)throw keychainError();
    return Buffer.from(result,'utf8');
   }catch{throw keychainError();}
  },
 };
 // The single Electron instance owns all account operations for every document tab.
 let queue=Promise.resolve();
 const lock=(directory,operation)=>{
  const pending=queue.then(async()=>{
   await fs.mkdir(directory,{recursive:true,mode:0o700});
   return operation(()=>{});
  });
  queue=pending.then(()=>{},()=>{});
  return pending;
 };
 const store=createCredentialStore({root,codec,lock});
 return createChatgptAuth({dataRoot:root,store,openBrowser:openExternal});
}
