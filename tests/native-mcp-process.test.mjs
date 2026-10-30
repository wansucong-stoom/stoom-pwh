import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

async function run(t,source,{missing=false}={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-native-wrapper-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const config=path.join(root,'config.json');await fs.writeFile(config,'{}');await fs.writeFile(path.join(root,'mcp-serve'),source);
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[fileURLToPath(new URL('../src/native-mcp.mjs',import.meta.url))],{cwd:root,windowsHide:true,env:{...process.env,PWH_CONFIG:config,PWH_RHWP_PATH:missing?path.join(root,'not-an-engine.exe'):process.execPath},stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('exit',code=>resolve({code,stdout,stderr}));child.stdin.end();
  });
}
test('native MCP wrapper preserves child stdout and nonzero exit status',async t=>{
  const result=await run(t,'process.stdout.write("child protocol\\n");process.stderr.write("child diagnostic\\n");process.exitCode=23;');
  assert.equal(result.code,23);assert.equal(result.stdout,'child protocol\n');assert.equal(result.stderr,'child diagnostic\n');
});
test('native MCP spawn failure emits only a diagnostic and returns failure',async t=>{
  const result=await run(t,'',{missing:true});assert.equal(result.code,1);assert.equal(result.stdout,'');assert.match(result.stderr,/cannot start the configured rhwp MCP engine/);
});
