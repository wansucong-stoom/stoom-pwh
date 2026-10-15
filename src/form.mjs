import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {runEngine} from './engine.mjs';
import config from './config.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const outputRoot=config.outputRoot;
const python=config.pythonPath;

export async function fillInstitutionForm(request){
  if(!request||typeof request!=='object'||Array.isArray(request))throw new Error('양식 채우기 명세가 필요합니다.');
  if(typeof request.input!=='string'||!path.isAbsolute(request.input)||!/\.hwpx$/i.test(request.input))throw new Error('원본 HWPX 절대 경로가 필요합니다.');
  const output=request.output||path.join(outputRoot,'composed',`${Date.now()}-${randomUUID().slice(0,8)}.hwpx`);
  if(!path.isAbsolute(output)||!/\.hwpx$/i.test(output))throw new Error('새 HWPX 출력 경로가 필요합니다.');
  const directory=path.join(outputRoot,'form-requests');
  await fs.mkdir(directory,{recursive:true});
  const specPath=path.join(directory,`${randomUUID()}.json`);
  const spec={...request,output};
  await fs.writeFile(specPath,JSON.stringify(spec),{flag:'wx'});
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(python,['-B',path.join(root,'scripts','fill_form.py'),'--spec',specPath],{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',done=false;
    const timer=setTimeout(()=>{child.kill();finish(new Error('양식 채우기가 90초를 넘었습니다.'));},90000);
    function finish(error,value){if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);}
    child.on('error',error=>finish(error));
    for(const [stream,isError]of [[child.stdout,false],[child.stderr,true]]){
      stream.setEncoding('utf8');stream.on('data',chunk=>{
        if(isError)stderr+=chunk;else stdout+=chunk;
        if(stdout.length+stderr.length>4*1024*1024){child.kill();finish(new Error('양식 채우기 응답 크기를 초과했습니다.'));}
      });
    }
    child.on('close',code=>{
      if(done)return;
      let parsed;try{parsed=JSON.parse(stdout.replace(/^\uFEFF/,''));}catch{return finish(new Error(`양식 채우기 결과를 읽지 못했습니다: ${stderr.slice(0,2000)}`));}
      if(code!==0||parsed.ok===false)return finish(new Error(parsed.error||stderr.slice(0,2000)||`종료 코드 ${code}`));
      finish(null,parsed);
    });
  });
  // Read-only verification: do not round-trip the file through an engine writer.
  const info=(await runEngine(['info',output,'--json'])).data;
  return {...result,path:output,specPath,info,requiresVisualReview:true};
}
