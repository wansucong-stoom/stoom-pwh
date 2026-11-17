import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import net from 'node:net';
import {releaseInstaller} from '../desktop/standalone-pwh/update-check.mjs';
import {installLinux,linuxInstallRoot} from '../desktop/standalone-pwh/linux-install.mjs';
import {createElectronController} from '../desktop/standalone-pwh/electron-controller.mjs';
import {applyLinuxUpdate} from '../desktop/standalone-pwh/linux-update-helper.mjs';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {createHash} from 'node:crypto';

const make=(version,osName)=>{const name=`PwhDesktop-${version}${osName==='linux'?'-linux-x64.tar.gz':'.msi'}`;return {name,state:'uploaded',size:200,digest:'sha256:'+'a'.repeat(64),browser_download_url:'https://github.com/wansucong-stoom/stoom-pwh/releases/download/v0.6.64/'+name};};
test('one release offers the matching newer package to each platform',()=>{
 const release={tag_name:'v0.6.64',draft:false,prerelease:false,assets:[make('0.1.45','win32'),make('0.1.45','linux')]};
 assert.match(releaseInstaller(release,'0.1.44',{platform:'linux'}).name,/-linux-x64.tar.gz$/);
 assert.match(releaseInstaller(release,'0.1.44',{platform:'win32'}).name,/\.msi$/);
 assert.equal(releaseInstaller(release,'0.1.45',{platform:'linux'}),null);
 for(const change of [{draft:true},{prerelease:true},{assets:[{...make('0.1.45','linux'),digest:null}]},{assets:[{...make('0.1.45','linux'),browser_download_url:'https://example.com/unsafe.tar.gz'}]}])assert.equal(releaseInstaller({...release,...change},'0.1.44',{platform:'linux'}),null);
});
test('Linux installation switches versions without replacing app data',{skip:process.platform!=='linux'},async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-install-test-')),source=path.join(home,'package');
 try{
  for(const name of ['pwh-desktop','node/node','electron/electron','standalone-pwh/stoom.png','engine/core/rhwp_bg.wasm']){const file=path.join(source,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'fixture');}
  const version=path.join(source,'standalone-pwh/version.json');await fs.writeFile(version,JSON.stringify({version:'0.1.43'}));await installLinux(source,{home});
  const data=path.join(home,'.local/share/stoom/pwh-desktop/settings.json');await fs.mkdir(path.dirname(data),{recursive:true});await fs.writeFile(data,'preserved');
  await fs.writeFile(version,JSON.stringify({version:'0.1.44'}));const current=await installLinux(source,{home});
  assert.equal(current.version,'0.1.44');assert.equal(await fs.readFile(data,'utf8'),'preserved');
  assert.equal(await fs.realpath(path.join(linuxInstallRoot(home),'current')),path.join(linuxInstallRoot(home),'versions','0.1.44'));
  assert.match(await fs.readFile(current.launcher,'utf8'),/current\/pwh-desktop/);
  await assert.rejects(installLinux(source,{home}),/이미 설치/);
 }finally{await fs.rm(home,{recursive:true,force:true});}
});
test('Linux controller authenticates its private Unix socket and removes it on close',{skip:process.platform!=='linux'},async()=>{
 let onReady;const ready=new Promise(resolve=>{onReady=resolve;});const controller=await createElectronController({onReady});
 const socket=net.createConnection(controller.pipe);let buffer='';socket.on('data',bytes=>{buffer+=bytes;for(let i;(i=buffer.indexOf('\n'))>=0;){const m=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);socket.write(JSON.stringify({id:m.id,result:['fixture.hwpx']})+'\n');}});
 try{assert.equal((await fs.stat(path.dirname(controller.pipe))).mode&0o777,0o700);socket.write(JSON.stringify({type:'hello',token:controller.token})+'\n'+JSON.stringify({type:'ready'})+'\n');await ready;assert.deepEqual(await controller.resolveDroppedFiles('', 'a',1),['fixture.hwpx']);}
 finally{socket.destroy();controller.close();}
});
test('Linux updater preserves files, rejects tampering and links, and leaves an open app installed',{skip:process.platform!=='linux'},async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-update-test-')),source=path.join(home,'input/PwhDesktop'),previousHome=process.env.HOME,launches=[],exec=promisify(execFile),hash=b=>createHash('sha256').update(b).digest('hex');process.env.HOME=home;
 try{
  for(const member of ['pwh-desktop','node/node','electron/electron','standalone-pwh/stoom.png','engine/core/rhwp_bg.wasm']){const file=path.join(source,member);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'fixture');}
  const version=path.join(source,'standalone-pwh/version.json');await fs.writeFile(version,JSON.stringify({version:'0.1.44'}));const previous=await installLinux(source);
  const document=path.join(home,'document.hwpx');await fs.writeFile(document,'unchanged');await fs.writeFile(version,JSON.stringify({version:'0.1.45'}));
  const installer=path.join(home,'update.tar.gz');await exec('tar',['-czf',installer,'-C',path.dirname(source),'PwhDesktop']);const bytes=await fs.readFile(installer),resultFile=path.join(home,'result.json'),input={installer,size:bytes.length,sha256:hash(bytes),pids:[],resultFile,oldApp:previous.launcher},options={launch:exe=>launches.push(exe),graceMs:0};
  const installed=await applyLinuxUpdate(input,options);assert.equal(installed.version,'0.1.45');assert.equal(await fs.readFile(document,'utf8'),'unchanged');assert.equal(launches[0],installed.launcher);
  const pointer=await fs.readlink(path.join(linuxInstallRoot(),'current'));launches.length=0;
  await assert.rejects(applyLinuxUpdate({...input,sha256:'0'.repeat(64)},options),/검증/);assert.equal(launches[0],previous.launcher);assert.equal(await fs.readlink(path.join(linuxInstallRoot(),'current')),pointer);
  launches.length=0;await assert.rejects(applyLinuxUpdate({...input,pids:[999999]},{...options,isAlive:()=>true,timeoutMs:1}),/종료되지/);assert.equal(launches.length,0);assert.equal(await fs.readlink(path.join(linuxInstallRoot(),'current')),pointer);
  await fs.symlink('/outside-not-followed',path.join(source,'escape'));const linked=path.join(home,'linked.tar.gz');await exec('tar',['-czf',linked,'-C',path.dirname(source),'PwhDesktop']);const links=await fs.readFile(linked);
  await assert.rejects(applyLinuxUpdate({...input,installer:linked,size:links.length,sha256:hash(links)},options),/링크|유형/);
 }finally{if(previousHome===undefined)delete process.env.HOME;else process.env.HOME=previousHome;await fs.rm(home,{recursive:true,force:true});}
});
