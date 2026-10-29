import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import {compareVersions,releaseInstaller,checkForDesktopUpdate,downloadInstaller,scheduleDesktopUpdate} from '../desktop/standalone-pwh/update-check.mjs';
import {createWorkspaceServer} from '../desktop/standalone-pwh/workspace-shell.mjs';
import {runUpdate} from '../desktop/standalone-pwh/update-helper.mjs';

const bytes=Buffer.from('synthetic installer'),digest=createHash('sha256').update(bytes).digest('hex');
const asset=(version='0.1.10')=>({name:`PwhDesktop-${version}.msi`,size:bytes.length,digest:`sha256:${digest}`,browser_download_url:`https://github.com/wansucong-stoom/stoom-pwh/releases/download/v0.6.31/PwhDesktop-${version}.msi`});
const release={tag_name:'v0.6.31',draft:false,prerelease:false,assets:[asset('0.1.8'),asset()]};
test('only a newer versioned installer from the expected GitHub release with a digest is offered',async()=>{
 assert.equal(compareVersions('0.1.10','0.1.9'),1);assert.equal(compareVersions('0.2.0','0.1.99'),1);assert.throws(()=>compareVersions('1.2','1.2.0'));
 assert.equal(releaseInstaller(release,'0.1.9').version,'0.1.10');assert.equal(releaseInstaller({...release,prerelease:true},'0.1.9'),null);
 for(const bad of [{...asset(),digest:null},{...asset(),browser_download_url:'https://example.com/PwhDesktop-0.1.10.msi'},{...asset(),size:300*1024*1024}])assert.equal(releaseInstaller({...release,assets:[bad]},'0.1.9'),null);
 let calls=0;const result=await checkForDesktopUpdate('0.1.9',{fetchImpl:async(url,options)=>{calls++;assert.match(url,/\/releases\/latest$/);assert.equal(options.redirect,'error');return new Response(JSON.stringify(release));}});assert.equal(calls,1);assert.equal(result.version,'0.1.10');
});
test('download follows only approved HTTPS hosts and verifies size and SHA before returning a file',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-update-')),chosen=releaseInstaller(release,'0.1.9');
 try{
  let calls=0;const result=await downloadInstaller(chosen,dir,{fetchImpl:async()=>{calls++;return calls===1?new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/download'}}):new Response(bytes);}});
  assert.equal(calls,2);assert.deepEqual(await fs.readFile(result),bytes);
  await assert.rejects(downloadInstaller(chosen,dir,{fetchImpl:async()=>new Response(Buffer.from('malicious bytes'))}),/크기|무결성/);
  await assert.rejects(downloadInstaller(chosen,dir,{fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://example.com/evil'}})}),/허용되지 않은/);
  assert.equal((await fs.readdir(dir)).length,1,'Failed downloads do not leave a candidate installer');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('workspace checks once and starts only the verified prepared installer',async()=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-update-workspace-'));const old=process.env.PWH_STANDALONE_DATA;process.env.PWH_STANDALONE_DATA=data;
 const children=[],spawnImpl=(_exe,args)=>{const child=new EventEmitter();child.pid=1200+children.length;child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>child.emit('exit',0);child.stdin.on('end',()=>child.emit('exit',0));children.push(child);setImmediate(()=>child.stdout.write(JSON.stringify({url:`http://127.0.0.1:${args[1]}/test/`})+'\n'));return child;};
 let checks=0,downloads=0,schedules=0,closed=0;const candidate=releaseInstaller(release,'0.1.9'),branding={token:'b'.repeat(32),complete:true,helperPid:999,requestClose:()=>closed++};
 const services={check:async()=>{checks++;return candidate;},download:async a=>{downloads++;assert.equal(a,candidate);return path.join(data,'test.msi');},schedule:async args=>{schedules++;assert.equal(args.asset,candidate);assert.ok(args.pids.includes(process.pid));}};
 const app=await createWorkspaceServer({spawnImpl,nativeBranding:branding,updateServices:services});try{
  const origin=new URL(app.url).origin,post=async(route)=>{const r=await fetch(app.url+route,{method:'POST',headers:{origin,'x-pwh-request':'1','content-type':'application/json'},body:'{}'});return {ok:r.ok,value:await r.json()};};
  assert.equal((await post('update/install')).ok,false);assert.equal((await post('update/status')).value.version,'0.1.10');await post('update/status');assert.equal(checks,1);
  await post('update/download');await post('update/download');assert.equal(downloads,1);assert.equal((await post('update/install')).value.started,true);await new Promise(r=>setTimeout(r,350));assert.equal(schedules,1);assert.equal(closed,1);assert.equal((await post('update/install')).ok,false);
 }finally{app.server.close();if(old===undefined)delete process.env.PWH_STANDALONE_DATA;else process.env.PWH_STANDALONE_DATA=old;await fs.rm(data,{recursive:true,force:true});}
});
test('update helper waits for app exit, rechecks the installer and never runs a tampered file',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-update-helper-')),installer=path.join(dir,'test.msi'),appExe=path.join(dir,'PwhDesktop.exe'),resultFile=path.join(dir,'result.json');await fs.writeFile(installer,bytes);
 const calls=[],spawnImpl=(exe,args,options)=>{calls.push({exe,args,options});const child=new EventEmitter();child.unref=()=>{};if(exe.toLowerCase().endsWith('msiexec.exe'))setImmediate(()=>child.emit('exit',0));return child;};
 const input={installer,digest,size:bytes.length,appExe,resultFile,pids:[111,222]},opts={platform:'win32',spawnImpl,isAlive:()=>false,env:{SystemRoot:dir}};
 try{
  assert.equal(await runUpdate(input,opts),'installed');assert.equal(calls.length,2);assert.ok(calls[0].exe.toLowerCase().endsWith('msiexec.exe'));assert.ok(calls[0].args.includes('MSIRESTARTMANAGERCONTROL=Disable'));assert.equal(calls[1].exe,appExe);
  calls.length=0;await fs.writeFile(installer,Buffer.from('tampered'));assert.equal(await runUpdate(input,opts),'failed');assert.equal(calls.length,1);assert.equal(calls[0].exe,appExe,'Old app reopens without starting the installer');
  calls.length=0;let clock=0;assert.equal(await runUpdate(input,{...opts,isAlive:()=>true,now:()=>clock,sleep:async ms=>{clock+=ms;},timeoutMs:1000}),'blocked');assert.equal(calls.length,0,'An open app cannot be forcibly closed or upgraded');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('a separate copied helper is scheduled with the exact verified installer and owned process IDs',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-schedule-')),nodeExe=path.join(dir,'node.exe'),installer=path.join(dir,'update.msi'),appExe=path.join(dir,'PwhDesktop.exe');await fs.writeFile(nodeExe,'synthetic-node');await fs.writeFile(installer,bytes);
 let call;const spawnImpl=(exe,args,options)=>{call={exe,args,options};const child=new EventEmitter();child.unref=()=>{};setImmediate(()=>child.emit('spawn'));return child;};
 try{await scheduleDesktopUpdate({installer,asset:{sha256:digest,size:bytes.length},dataRoot:dir,appExe,pids:[111,222],nodeExe,spawnImpl});assert.equal(await fs.readFile(call.exe,'utf8'),'synthetic-node');assert.match(await fs.readFile(call.args[0],'utf8'),/verifyInstaller/);assert.deepEqual(call.args.slice(-2),['111','222']);assert.equal(call.args[1],installer);assert.equal(call.options.detached,true);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
