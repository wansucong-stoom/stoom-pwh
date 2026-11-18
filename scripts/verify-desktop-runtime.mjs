import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const nodeFor=root=>path.join(root,'node',process.platform==='win32'?'node.exe':'node');
async function removeOwnedTemporary(directory){
  if(path.dirname(path.resolve(directory))!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('pwh-package-'))throw Error('Unexpected package verification temporary directory');
  await fs.rm(directory,{recursive:true,force:true});
}
function cleanEnvironment(root,data){
  const env={...process.env,PWH_RUNTIME_ROOT:path.join(root,'engine'),PWH_STANDALONE_DATA:data,PWH_OUTPUT_ROOT:path.join(data,'outputs'),PWH_FONT_ROOT:path.join(data,'fonts')};
  for(const key of ['PWH_CONFIG','PWH_RHWP_PATH','HWPXYZ_RHWP_PATH','PWH_STOOM_MODULE','HWPXYZ_OUTPUT_ROOT'])delete env[key];
  return env;
}
const missingMessage=stderr=>stderr.match(/Cannot find (?:module|package) ['"]([^'"]+)['"]/)?.[0]||stderr.trim().slice(-1600);

export async function verifyPackagedImports(root,{node=nodeFor(root)}={}){
  const work=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-package-imports-'));
  try{
    const entry=pathToFileURL(path.join(root,'standalone-pwh','host.mjs')).href;
    const child=spawn(node,['--input-type=module','-e','await import('+JSON.stringify(entry)+')'],{cwd:work,env:cleanEnvironment(root,work),windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stderr='';child.stderr.on('data',b=>{stderr=(stderr+String(b)).slice(-16000);});child.stdout.resume();
    const timer=setTimeout(()=>child.kill(),30000);
    try{const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});if(code!==0)throw Error('Packaged Desktop imports failed: '+missingMessage(stderr));}
    finally{clearTimeout(timer);}
    return {imports:true};
  }finally{await removeOwnedTemporary(work);}
}

async function documentTab(root,data,input){
  const child=spawn(nodeFor(root),[path.join(root,'standalone-pwh','workspace-child.mjs'),'0',...(input?[input]:[])],{cwd:data,env:cleanEnvironment(root,data),windowsHide:true,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='',settled=false;
  const exit=new Promise(resolve=>{child.once('exit',resolve);child.once('error',()=>resolve(null));});
  const timer=setTimeout(()=>child.kill(),45000);
  try{
    const line=await new Promise((resolve,reject)=>{
      const fail=e=>{if(!settled){settled=true;reject(e);}};
      child.once('error',fail);child.once('exit',()=>fail(Error('Packaged document tab failed: '+missingMessage(stderr))));
      child.stderr.on('data',b=>{stderr=(stderr+String(b)).slice(-16000);});
      child.stdout.on('data',b=>{stdout+=b;if(stdout.length>100000)return fail(Error('Invalid document tab response'));if(!settled&&stdout.includes('\n')){settled=true;resolve(stdout.slice(0,stdout.indexOf('\n')));}});
    });
    const started=JSON.parse(line);if(!started.url)throw Error('Packaged document tab did not start: '+JSON.stringify(started));
    const url=new URL(started.url);if(url.hostname!=='127.0.0.1'||url.protocol!=='http:')throw Error('Unexpected document tab origin');
    const response=await fetch(new URL('initialize',url),{method:'POST',headers:{origin:url.origin,'x-pwh-request':'1','content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
    const state=await response.json();if(!response.ok||!state.document?.documentId||!state.document.source)throw Error('Packaged document initialization failed: '+JSON.stringify(state));
    const file=state.document.source,bytes=await fs.readFile(file);if(bytes.subarray(0,2).toString()!=='PK')throw Error('Document tab did not prepare HWPX');
    return {source:file,bytes};
  }finally{
    clearTimeout(timer);child.stdin.end();
    const stop=setTimeout(()=>child.kill(),3000);await exit;clearTimeout(stop);
  }
}

export async function verifyDesktopRuntime(root){
  await verifyPackagedImports(root);
  const work=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-package-tabs-'));
  try{
    const blankData=path.join(work,'blank'),existingData=path.join(work,'existing');await fs.mkdir(blankData);await fs.mkdir(existingData);
    const blank=await documentTab(root,blankData),input=path.join(work,'existing.hwpx');await fs.writeFile(input,blank.bytes,{flag:'wx'});
    const existing=await documentTab(root,existingData,input);
    if(!existing.bytes.equals(blank.bytes)||!(await fs.readFile(input)).equals(blank.bytes))throw Error('Opening an existing document changed its bytes');
    return {imports:true,newDocument:true,existingHwpx:true,originalPreserved:true,platform:process.platform};
  }finally{await removeOwnedTemporary(work);}
}
