import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadStoomRuntime} from '../bridge/hwp-codex-host.mjs';
import {generateCodexImage,validateGeneratedPng} from '../bridge/codex-image-host.mjs';

export function assertSameImageAccount(account,native){
 const selected=account?.accounts?.find(a=>a.id===account.active&&a.connected);
 if(native?.type!=='chatgpt'||!selected?.email||!native.email||selected.email.trim().toLowerCase()!==native.email.trim().toLowerCase())throw Error('Pwh에 연결한 계정과 기존 그림 생성용 Codex 계정이 다릅니다. 같은 계정으로 연결한 뒤 다시 요청하세요.');
 return account.active;
}

export async function generateDesktopImage({prompt,settings,auth,runtimeRoot,home,outputDirectory,stoomModule,signal,onDiagnostic,generate=generateCodexImage}){
 if(typeof prompt!=='string'||!prompt.trim()||prompt.length>12000)throw Error('그림에 넣을 장면을 확인하세요.');
 const {runtime}=await loadStoomRuntime(stoomModule);
 await fs.mkdir(outputDirectory,{recursive:true});
 const executable=await runtime.discoverCodex();
 if(!executable)throw Error('이 계정 연결은 이미지 생성을 지원하지 않습니다. 기존 그림 생성 기능을 사용하려면 이 PC에 Codex가 설치되어 있어야 합니다.');
 const client=new runtime.CodexConnection(executable);let native;
 try{await client.initialize();native=(await client.request('account/read',{refreshToken:false}))?.account;}finally{client.close();}
 if(native?.type!=='chatgpt')throw Error('기존 그림 생성용 Codex의 계정 연결을 확인하세요.');
 const value=[native.accountId,native.id,native.email].find(v=>typeof v==='string'&&v.trim());
 if(!value)throw Error('그림 생성 계정을 확인하지 못했습니다.');
 const options={accountId:createHash('sha256').update('stoom-hwp-account-v1\0'+value.trim().toLowerCase()).digest('hex')};
 if(settings.provider==='chatgpt'){
  const account=await auth.status();assertSameImageAccount(account,native);
  options.verifyAccount=async()=>{const current=await auth.status();try{return current.active===account.active&&assertSameImageAccount(current,native)===account.active;}catch{return false;}};
 }else if(settings.provider!=='codex')throw Error('그림 생성은 ChatGPT 또는 Codex 연결에서 사용할 수 있습니다.');
 const image=await generate({runtime,accountId:options.accountId,prompt,outputDirectory,signal,onDiagnostic,model:settings.codexModel||undefined,reasoningEffort:settings.codexReasoningEffort||undefined,imageKind:'illustration'});
 if(signal?.aborted)throw Error('그림 생성을 중지했습니다.');
 if(options.verifyAccount&&!await options.verifyAccount())throw Error('그림 생성 중 계정이 변경되었습니다. 다시 요청해 주세요.');
 const root=await fs.realpath(outputDirectory),file=await fs.realpath(image.path),relative=path.relative(root,file);
 if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('생성된 그림 경로를 확인하지 못했습니다.');
 const stat=await fs.lstat(file);if(!stat.isFile()||stat.size>8*1024*1024)throw Error('생성된 그림 크기를 확인하세요.');
 const bytes=await fs.readFile(file),dimensions=validateGeneratedPng(bytes),sha256=createHash('sha256').update(bytes).digest('hex');
 if(sha256!==image.sha256)throw Error('생성된 그림이 변경되었습니다.');
 return {bytes,metadata:{sha256,totalBytes:bytes.length,...dimensions,extension:'png',mediaType:'image/png'}};
}
