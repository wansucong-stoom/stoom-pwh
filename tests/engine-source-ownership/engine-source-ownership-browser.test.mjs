import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const missing=['PWH_CORE_JS','PWH_CORE_WASM','PWH_PLAYWRIGHT_MODULE'].filter(name=>!process.env[name]);
const skip=missing.length?'Set '+missing.join(', ')+' to test a real engine build.':false;
function run(script,env={}){return new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[fileURLToPath(new URL(script,import.meta.url))],{env:{...process.env,...env},windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';
 child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);child.once('error',reject);child.once('close',code=>{try{assert.equal(code,0,output);resolve();}catch(error){reject(error);}});
});}
for(const tableFirst of [false,true])for(const spacing of [false,true]){
 test(`engine source ownership: mixed nested table ${tableFirst?'before':'after'} text with ${spacing?'12pt/8pt':'default'} host spacing`,{skip,timeout:120000},()=>run('synthetic-nested-regression.mjs',{PWH_SYNTHETIC_TABLE_FIRST:tableFirst?'1':'0',PWH_SYNTHETIC_HOST_SPACING:spacing?'1':'0'}));
}
test('engine source ownership: local host vpos reset does not create a physical page',{skip,timeout:120000},()=>run('local-host-reset-regression.mjs'));
