import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const run=promisify(execFile);
const skip=!process.env.PWH_ENGINE_SOURCE?'Requires an explicit engine source root and Rust compiler':false;
for(const [script,cases]of [['closed-float-source-frame',33],['sibling-table-offset',9]]){
 test(`stored float source contract: ${script} (${cases} extracted Rust cases)`,{skip,timeout:120000},async()=>{
  const file=fileURLToPath(new URL(`./engine-source-ownership/${script}.mjs`,import.meta.url));
  const {stdout}=await run(process.execPath,[file,process.env.PWH_ENGINE_SOURCE],{env:process.env,windowsHide:true,maxBuffer:2*1024*1024});
  assert.match(stdout,new RegExp(`test result: ok\\. ${cases} passed; 0 failed;`));
 });
}
