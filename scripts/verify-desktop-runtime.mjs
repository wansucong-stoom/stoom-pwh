import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {writeZipMembers} from './zip-writer.mjs';

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

async function documentTab(root,data,input,exercise){
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
    const request=async(route,body={},headers={})=>{
      const response=await fetch(new URL(route,url),{method:'POST',headers:{origin:url.origin,'x-pwh-request':'1',...headers},
        body:Buffer.isBuffer(body)?body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error('Packaged document check failed at '+route+' (HTTP '+response.status+')');
      return response.json();
    };
    const state=await request('initialize');
    if(!state.document?.documentId||!state.document.source)throw Error('Packaged document initialization failed');
    const file=state.document.source,bytes=await fs.readFile(file);if(bytes.subarray(0,2).toString()!=='PK')throw Error('Document tab did not prepare HWPX');
    if(exercise)await exercise(request,state.document,bytes);
    return {source:file,bytes};
  }finally{
    clearTimeout(timer);child.stdin.end();
    const stop=setTimeout(()=>child.kill(),3000);await exit;clearTimeout(stop);
  }
}

const originalWordText='Pwh package document';
const editedWordText='Pwh edit '+originalWordText;
function wordFixture(){
  const entries={
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>'+originalWordText+'</w:t></w:r></w:p><w:sectPr/></w:body></w:document>',
  };
  return writeZipMembers(Object.entries(entries).map(([name,xml])=>({name,bytes:Buffer.from(xml)})));
}
async function verifyWordRoundTrip(root,work,HwpDocument){
  const data=path.join(work,'word-data'),input=path.join(work,'package-sample.docx');
  await fs.mkdir(data);
  const original=wordFixture();
  await fs.writeFile(input,original,{flag:'wx'});
  await documentTab(root,data,input,async(request,document,bytes)=>{
    if(document.docxWarnings?.length)throw Error('The packaged DOCX reader did not preserve the smoke fixture');
    const doc=new HwpDocument(bytes);
    let edited;
    try{doc.insertText(0,0,0,'Pwh edit ');edited=Buffer.from(doc.exportHwpx());}
    finally{doc.free();}
    const choice=await request('file/prepare',{mode:'save',documentId:document.documentId});
    if(!choice.ticket||choice.cancelled)throw Error('The packaged DOCX save target could not be selected');
    await request('file/write',edited,{'x-pwh-document':document.documentId,'x-pwh-ticket':choice.ticket});
  });
  const saved=await fs.readFile(input);
  if(saved.equals(original))throw Error('The packaged DOCX save did not replace the edited fixture');
  const reopened=await documentTab(root,data,input);
  const doc=new HwpDocument(reopened.bytes);
  try{if(doc.getTextRange(0,0,0,200)!==editedWordText)throw Error('The packaged DOCX round trip changed the edited text');}
  finally{doc.free();}
}

export async function verifyDesktopRuntime(root,{sectionEditing=false,runtimeId}={}){
  let HwpDocument,coreEvidence;
  if(sectionEditing){
    const core=path.join(root,'engine','core');
    const marker=JSON.parse(await fs.readFile(path.join(core,'.pwh-install.json'),'utf8'));
    if(runtimeId&&marker.pwhRevision!==runtimeId)throw Error('The packaged core revision differs from runtime-lock.json');
    const revision=/^rhwp-0\.8\.7-pwh-r(\d+)$/.exec(marker.pwhRevision??'');
    if(!revision||Number(revision[1])<33){
      throw Error('구역 편집에 필요한 공통 코어 r33 이상을 패키지에 포함해 주세요.');
    }
    const wasm=await import(pathToFileURL(path.join(core,'rhwp.js')));
    const wasmBytes=await fs.readFile(path.join(core,'rhwp_bg.wasm'));
    coreEvidence={coreRevision:marker.pwhRevision,coreSha256:createHash('sha256').update(wasmBytes).digest('hex')};
    if(marker.files?.['rhwp_bg.wasm']!==coreEvidence.coreSha256)throw Error('The packaged WASM differs from the core manifest');
    await wasm.default({module_or_path:wasmBytes});
    HwpDocument=wasm.HwpDocument;
    const doc=HwpDocument.createEmpty();
    try{
      doc.createBlankDocument();
      doc.breakAtCursor(0,0,0,'pwhSection');
      if(doc.getSectionCount()!==2)throw Error('패키지의 공통 코어에서 구역을 만들지 못했습니다.');
    }finally{doc.free();}
  }
  await verifyPackagedImports(root);
  const work=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-package-tabs-'));
  try{
    const blankData=path.join(work,'blank'),existingData=path.join(work,'existing');await fs.mkdir(blankData);await fs.mkdir(existingData);
    const blank=await documentTab(root,blankData),input=path.join(work,'existing.hwpx');await fs.writeFile(input,blank.bytes,{flag:'wx'});
    const existing=await documentTab(root,existingData,input);
    if(!existing.bytes.equals(blank.bytes)||!(await fs.readFile(input)).equals(blank.bytes))throw Error('Opening an existing document changed its bytes');
    if(HwpDocument)await verifyWordRoundTrip(root,work,HwpDocument);
    return {imports:true,newDocument:true,existingHwpx:true,originalPreserved:true,
      ...(sectionEditing?{...coreEvidence,sectionEditing:true,docxRoundTrip:true}:{}),platform:process.platform};
  }finally{await removeOwnedTemporary(work);}
}
