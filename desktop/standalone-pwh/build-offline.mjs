import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {packagePlugin} from '../release-source/scripts/package.mjs';
import {zipEntries} from '../release-source/scripts/setup.mjs';
import {buildNativeLauncher} from './build-native-launcher.mjs';
import {stagePreviewCore} from './preview-core.mjs';
import {copyOfficialRuntime} from './official-codex-runtime.mjs';

const root=path.dirname(fileURLToPath(import.meta.url)),workspace=path.dirname(root);
const version=process.env.PWH_ZIP_VERSION||'0.1.14';
if(!/^\d{1,3}\.\d{1,3}\.\d{1,5}$/.test(version)||version.split('.').some((n,i)=>Number(n)>(i===2?65535:255)))throw Error('ZIP 버전이 올바르지 않습니다.');
const output=path.resolve(process.argv[2]||path.join(workspace,'dist',`PwhDesktop-${version}-offline.zip`));
const runtimeArchive=process.env.PWH_OFFLINE_RUNTIME_ARCHIVE||path.join(os.homedir(),'.stoom-pwh','downloads',JSON.parse(await fs.readFile(new URL('../release-source/runtime-lock.json',import.meta.url),'utf8')).runtime.file);
const pwhRoot=path.join(workspace,'release-source'),lock=JSON.parse(await fs.readFile(path.join(pwhRoot,'runtime-lock.json'),'utf8')),pin=lock.runtime;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const runtimeBytes=await fs.readFile(runtimeArchive);
if(runtimeBytes.length!==pin.size||hash(runtimeBytes)!==pin.sha256)throw Error('보존 조판 엔진 ZIP의 크기 또는 해시가 다릅니다.');
const pwhVersion=JSON.parse(await fs.readFile(path.join(pwhRoot,'package.json'),'utf8')).version,pwhClient=JSON.parse(await fs.readFile(path.join(pwhRoot,'client','.pwh-install.json'),'utf8')),desktopClient=JSON.parse(await fs.readFile(path.join(root,'client','manifest.json'),'utf8'));
if(pwhVersion!==pwhClient.version||desktopClient.baseVersion!==pwhVersion||desktopClient.baseEditorSha256!==pwhClient.files?.['editor.js']||desktopClient.upstreamCommit!==pwhClient.upstreamCommit||pwhClient.upstreamCommit!==lock.upstreamCommit||hash(await fs.readFile(path.join(pwhRoot,'client','editor.js')))!==pwhClient.files?.['editor.js']||hash(await fs.readFile(path.join(root,'client','editor.js')))!==desktopClient.sha256)throw Error('Pwh와 Desktop 원본 버전이 일치하지 않습니다. 두 편집기를 함께 다시 빌드하세요.');
try{await fs.access(output);throw Error('출력 파일이 이미 있습니다. 새 이름을 선택하세요.');}catch(e){if(e.code!=='ENOENT')throw e;}
await fs.mkdir(path.dirname(output),{recursive:true});
const stage=path.join(path.dirname(output),`.pwh-desktop-build-${randomUUID()}`);await fs.mkdir(stage);
const pkg=path.join(stage,'PwhDesktop');await fs.mkdir(pkg);
async function copy(src,rel){const dest=path.join(pkg,rel);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(src,dest,fs.constants.COPYFILE_EXCL);}
const pwhZip=path.join(stage,'pwh.zip');await packagePlugin({output:pwhZip});
const run=(program,args)=>new Promise((resolve,reject)=>{const p=spawn(program,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let error='';p.stderr.on('data',b=>error+=b);p.on('error',reject);p.on('close',code=>code===0?resolve():reject(Error(error||`${program} failed: ${code}`)));});
const unpack=path.join(stage,'unpack');await fs.mkdir(unpack);
for(const entry of zipEntries(await fs.readFile(pwhZip))){const rel=entry.name.replace(/\/$/,'');if(!rel||path.isAbsolute(rel)||rel.split('/').includes('..'))throw Error('패키지 경로가 올바르지 않습니다.');const target=path.join(unpack,...rel.split('/'));if(entry.name.endsWith('/'))await fs.mkdir(target,{recursive:true});else{await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,entry.read(),{flag:'wx'});}}
await fs.rename(path.join(unpack,'pwh'),path.join(pkg,'release-source'));
for(const name of ['ai-providers.mjs','generated-image.mjs','recent-documents.mjs','codex-agent.mjs','codex-session.mjs','codex-native-host.mjs','codex-plugin-setup.mjs','chatgpt-auth.mjs','chatgpt-store.mjs','chatgpt-credentials.ps1','official-codex-runtime.mjs','CODEX-APACHE-LICENSE.txt','CODEX-NOTICE.txt','CODEX-RATATUI-MIT.txt','CODEX-RIPGREP-MIT.txt','CODEX-PCRE2-LICENSE.txt','rewrite.mjs','settings.mjs','convert-hwp.mjs','desktop-files.mjs','document-scan.mjs','editor-result-wait.mjs','steer-turn.mjs','version-info.mjs','update-check.mjs','update-helper.mjs','workspace-child.mjs','workspace-shell.mjs','window-close-controller.mjs','workspace.html','workspace.css','workspace.js','file-dialog.ps1','host.mjs','launch.mjs','app.html','app.css','app.js','stoom-mark.svg','stoom.ico'])await copy(path.join(root,name),path.join('standalone-pwh',name));
if(!process.env.PWH_CODEX_RUNTIME_DIR||!path.isAbsolute(process.env.PWH_CODEX_RUNTIME_DIR))throw Error('검증할 공식 Codex 앱 서버 패키지 경로를 지정해 주세요.');
await copyOfficialRuntime(process.env.PWH_CODEX_RUNTIME_DIR,path.join(pkg,'standalone-pwh','codex-runtime'));
await fs.writeFile(path.join(pkg,'standalone-pwh','version.json'),JSON.stringify({version})+'\n',{flag:'wx'});
for(const name of ['editor.js','manifest.json'])await copy(path.join(root,'client',name),path.join('standalone-pwh','client',name));
await copy(path.join(workspace,'bridge','hwp-codex-host.mjs'),path.join('bridge','hwp-codex-host.mjs'));
await copy(path.join(workspace,'bridge','codex-image-host.mjs'),path.join('bridge','codex-image-host.mjs'));
await copy(process.execPath,path.join('node','node.exe'));
await copy(path.join(root,'NODE-LICENSE.txt'),path.join('node','LICENSE.txt'));
await buildNativeLauncher(path.join(pkg,'PwhDesktop.exe'));
await run(process.execPath,[path.join(pwhRoot,'scripts','setup.mjs'),'--runtime-root',path.join(pkg,'engine'),'--runtime-archive',runtimeArchive,'--skip-download']);
const candidateDir=process.env.PWH_CORE_CANDIDATE_DIR;
const coreCandidate=candidateDir?await stagePreviewCore({candidateDir:path.resolve(candidateDir),runtimeRoot:path.join(pkg,'engine'),pluginRoot:pwhRoot,lock}):null;
for(const name of ['launch.vbs','install.ps1','install.cmd'])await copy(path.join(root,name),name);
async function walk(dir,base=''){const result=[];for(const name of (await fs.readdir(dir)).sort()){const rel=path.join(base,name),full=path.join(dir,name),st=await fs.lstat(full);if(st.isSymbolicLink())throw Error('배포 패키지에 심볼릭 링크를 포함할 수 없습니다.');if(st.isDirectory())result.push(...await walk(full,rel));else if(st.isFile()&&!['install.ps1','install.cmd'].includes(rel))result.push({path:rel.replaceAll('\\','/'),sha256:hash(await fs.readFile(full))});}return result;}
await fs.writeFile(path.join(pkg,'manifest.json'),JSON.stringify({schemaVersion:1,version,files:await walk(pkg),...(coreCandidate?{runtimeVariant:'local-candidate',coreCandidate}:{runtimeVariant:'preserved-runtime',runtimeId:lock.id})},null,2)+'\n',{flag:'wx'});
await run('tar.exe',['-a','-c','-f',output,'-C',stage,'PwhDesktop']);
console.log(JSON.stringify({output,version,bytes:(await fs.stat(output)).size,sha256:hash(await fs.readFile(output)),staging:stage,runtimeVariant:coreCandidate?'local-candidate':'preserved-runtime'}));
