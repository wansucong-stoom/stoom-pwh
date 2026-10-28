import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {promises as fs} from 'node:fs';

const execute=promisify(execFile);
export async function convertHwp({executable,source,output,exec=execute}){
 let stdout,stderr='',code=0;
 try{({stdout,stderr}=await exec(executable,['export-hwpx',source,output,'--verify','--json'],{windowsHide:true,timeout:120000,maxBuffer:4*1024*1024,encoding:'utf8'}));}
 catch(error){if(error.code!==3)throw Error('HWP를 HWPX로 안전하게 변환하지 못했습니다. 원본은 변경되지 않았습니다.');code=3;stdout=error.stdout;stderr=error.stderr;}
 let result;try{result=JSON.parse(stdout.trim());}catch{throw Error('HWP 변환 검증 결과를 읽지 못했습니다.');}
 const differences=String(stderr).split(/\r?\n/).filter(line=>/^\s*\[차이\]/.test(line));
 const layoutOnly=code===3&&Number.isInteger(result.verify?.diffCount)&&result.verify.diffCount>0&&differences.length===result.verify.diffCount&&differences.every(line=>/ linesegs: /.test(line));
 if(result.format!=='hwpx'||(code===0&&!result.verify?.identical)||(code===3&&!layoutOnly))throw Error('HWP 변환 시 문서 구조 차이가 확인되어 열기를 중단했습니다. 원본은 변경되지 않았습니다.');
 const st=await fs.lstat(output);if(!st.isFile()||st.isSymbolicLink()||st.size>64*1024*1024)throw Error('변환된 HWPX를 확인하지 못했습니다.');
 const bytes=await fs.readFile(output);if(bytes.subarray(0,2).toString()!=='PK')throw Error('변환된 HWPX 형식이 올바르지 않습니다.');
 return {layoutWarning:layoutOnly};
}
