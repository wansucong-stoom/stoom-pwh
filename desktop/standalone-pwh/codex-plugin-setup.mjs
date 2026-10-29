import {promises as fs} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {discoverCodex} from './codex-native-host.mjs';

const app=path.dirname(fileURLToPath(import.meta.url));
const repository='https://github.com/wansucong-stoom/stoom-pwh';
const ownedMarker='.pwh-desktop-marketplace.json';
const safeVersion=v=>/^\d+\.\d+\.\d+$/.test(v||'');
const compare=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]-y[i];return 0;};
const canonical=async p=>path.resolve((await fs.realpath(p)).replace(/^\\\\\?\\/, '')).toLowerCase();
const isOfficialGit=value=>typeof value==='string'&&value.replace(/\.git\/?$/i,'').replace(/\/$/,'').toLowerCase()===repository;

function runCommand(executable,args,{cwd,env=process.env,timeout=90000}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',diagnostic='',finished=false;
  const timer=setTimeout(()=>{child.kill();finish(Error('Codex 플러그인 연결 시간이 초과되었습니다.'));},timeout);
  const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);error?reject(error):resolve(value);};
  child.stdout.on('data',chunk=>{output+=chunk;if(output.length>4*1024*1024){child.kill();finish(Error('Codex 응답이 너무 큽니다.'));}});
  child.stderr.on('data',chunk=>{diagnostic=(diagnostic+chunk).slice(-4000);});
  child.on('error',()=>finish(Error('Codex를 실행하지 못했습니다.')));
  child.on('close',code=>{if(code!==0)return finish(Error('Codex 플러그인 명령이 실패했습니다. '+diagnostic.slice(-800)));try{finish(null,JSON.parse(output));}catch{finish(Error('Codex 플러그인 응답을 확인하지 못했습니다.'));}});
 });
}

async function prepareBundledMarketplace(installRoot,dataRoot){
 const source=path.join(installRoot,'release-source'),destination=path.join(dataRoot,'codex-marketplace');
 await fs.access(path.join(source,'skills','pwh','SKILL.md'));
 const {node,runtime}=await preservePluginRuntime(installRoot,dataRoot);
 const stage=path.join(dataRoot,`.codex-marketplace-${randomUUID()}`),backup=path.join(dataRoot,`.codex-marketplace-backup-${randomUUID()}`);
 await fs.mkdir(dataRoot,{recursive:true});let moved=false;
 try{
  await fs.cp(source,stage,{recursive:true,errorOnExist:true,force:false});
  const config=JSON.parse(await fs.readFile(path.join(stage,'.mcp.json'),'utf8'));
  for(const server of Object.values(config.mcpServers||{})){server.command=node;server.env={...server.env,PWH_RUNTIME_ROOT:runtime,PWH_OUTPUT_ROOT:path.join(dataRoot,'codex-documents')};}
  await fs.writeFile(path.join(stage,'.mcp.json'),JSON.stringify(config,null,2)+'\n');
  await fs.writeFile(path.join(stage,'mcp.json'),JSON.stringify({$schema:'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',...config},null,2)+'\n');
  await fs.mkdir(path.join(stage,'.agents','plugins'),{recursive:true});
  await fs.writeFile(path.join(stage,'.agents','plugins','marketplace.json'),JSON.stringify({name:'pwh',interface:{displayName:'Pwh'},plugins:[{name:'pwh',source:{source:'local',path:'./'},category:'Productivity',policy:{installation:'AVAILABLE',authentication:'ON_USE'}}]},null,2)+'\n');
  await fs.writeFile(path.join(stage,ownedMarker),JSON.stringify({kind:'Pwh Desktop Codex marketplace',schema:1})+'\n');
  try{const marker=JSON.parse(await fs.readFile(path.join(destination,ownedMarker),'utf8'));if(marker.kind!=='Pwh Desktop Codex marketplace'||marker.schema!==1)throw Error('기존 Codex 연결의 출처를 확인하지 못했습니다.');await fs.rename(destination,backup);moved=true;}
  catch(error){if(error.code!=='ENOENT')throw error;try{await fs.access(destination);throw Error('기존 Codex 연결을 덮어쓰지 않았습니다.');}catch(check){if(check.code!=='ENOENT')throw check;}}
  try{await fs.rename(stage,destination);}catch(error){if(moved)await fs.rename(backup,destination);throw error;}
  if(moved)await fs.rm(backup,{recursive:true,force:true});
  return destination;
 }finally{await fs.rm(stage,{recursive:true,force:true});}
}

// The Codex plugin keeps its own immutable runtime so uninstalling Desktop does
// not leave an installed plugin pointing at deleted application files.
async function preservePluginRuntime(installRoot,dataRoot){
 const source=path.join(installRoot,'engine'),nodeSource=path.join(installRoot,'node','node.exe');
 const [manifest,nodeBytes]=await Promise.all([fs.readFile(path.join(source,'.preserved-runtime.json')),fs.readFile(nodeSource)]);
 const pin=JSON.parse(manifest);if(!/^[a-f0-9]{64}$/.test(pin.archiveSha256||''))throw Error('Pwh 엔진 정보를 확인하지 못했습니다.');
 const nodeHash=createHash('sha256').update(nodeBytes).digest('hex');
 const identity=createHash('sha256').update(manifest).update(nodeHash).digest('hex').slice(0,24);
 const parent=path.join(dataRoot,'codex-runtimes'),destination=path.join(parent,identity),stage=path.join(parent,`.stage-${randomUUID()}`);
 const verify=async()=>{const marker=JSON.parse(await fs.readFile(path.join(destination,'.pwh-runtime.json'),'utf8'));if(marker.identity!==identity||marker.archiveSha256!==pin.archiveSha256||marker.nodeSha256!==nodeHash)throw Error('Codex Pwh 런타임 정보를 확인하지 못했습니다.');await Promise.all([fs.access(path.join(destination,'node.exe')),fs.access(path.join(destination,'engine','core','rhwp_bg.wasm')),fs.access(path.join(destination,'engine','rhwp','rhwp.exe'))]);return {node:path.join(destination,'node.exe'),runtime:path.join(destination,'engine')};};
 try{return await verify();}catch(error){if(error.code!=='ENOENT')throw error;}
 await fs.mkdir(parent,{recursive:true});await fs.mkdir(stage);
 try{
  await fs.cp(source,path.join(stage,'engine'),{recursive:true,errorOnExist:true,force:false});await fs.writeFile(path.join(stage,'node.exe'),nodeBytes,{flag:'wx'});
  await fs.writeFile(path.join(stage,'.pwh-runtime.json'),JSON.stringify({identity,archiveSha256:pin.archiveSha256,nodeSha256:nodeHash})+'\n',{flag:'wx'});
  try{await fs.rename(stage,destination);}catch(error){if(!['EEXIST','ENOTEMPTY','EPERM'].includes(error.code))throw error;}
  return await verify();
 }finally{await fs.rm(stage,{recursive:true,force:true});}
}

// Never remove or replace an existing marketplace. Git installations keep their
// original source; new offline installations use a Desktop-owned local source.
export async function setupCodexPlugin({installRoot=path.dirname(app),dataRoot=path.join(process.env.LOCALAPPDATA||process.env.HOME||app,'PwhDesktop'),executable,run=runCommand,env=process.env}={}){
 executable??=await discoverCodex({env});
 if(!executable)return {status:'not-installed',message:'Codex가 설치되면 Pwh 연결을 다시 시도할 수 있습니다.'};
 const target=JSON.parse(await fs.readFile(path.join(installRoot,'release-source','package.json'),'utf8')).version;
 if(!safeVersion(target))throw Error('설치된 Pwh 버전을 확인하지 못했습니다.');
 await fs.mkdir(dataRoot,{recursive:true});
 const call=args=>run(executable,[...args,'--json'],{cwd:dataRoot,env});
 const current=await call(['plugin','list']);
 const installed=(current.installed||[]).find(x=>x.pluginId==='pwh@pwh');
 if(installed&&safeVersion(installed.version)&&compare(installed.version,target)>=0)return {status:'ready',version:installed.version,message:compare(installed.version,target)>0?'Codex에 더 새로운 Pwh가 있어 그대로 유지했습니다.':'Codex Pwh가 이미 같은 버전입니다.'};
 const source=installed?.marketplaceSource;
 if(source?.sourceType==='git'&&isOfficialGit(source.source)){
  await call(['plugin','marketplace','upgrade','pwh']);
 }else if(installed){
  const expected=path.join(dataRoot,'codex-marketplace');
  if(source?.sourceType!=='local'||typeof source.source!=='string'||await canonical(source.source)!==await canonical(expected))throw Error('기존 Pwh 연결의 출처가 달라 변경하지 않았습니다.');
  await prepareBundledMarketplace(installRoot,dataRoot);
 }else{
  const marketplace=await prepareBundledMarketplace(installRoot,dataRoot);
  await call(['plugin','marketplace','add',marketplace]);
 }
 await call(['plugin','add','pwh@pwh']);
 const result=await call(['plugin','list']);
 const verified=(result.installed||[]).find(x=>x.pluginId==='pwh@pwh');
 if(!verified||verified.version!==target)throw Error(`Codex Pwh ${target} 설치를 확인하지 못했습니다. 인터넷 연결과 릴리스를 확인한 후 다시 시도해 주세요.`);
 return {status:'ready',version:target,message:'Codex Pwh와 스킬을 같은 버전으로 연결했습니다. 새 대화에서 사용해 주세요.'};
}

export async function recordCodexPluginSetup(options={}){
 const dataRoot=options.dataRoot||path.join(process.env.LOCALAPPDATA||process.env.HOME||app,'PwhDesktop');await fs.mkdir(dataRoot,{recursive:true});
 let result;try{result=await setupCodexPlugin({...options,dataRoot});}catch(error){result={status:'failed',message:'Codex Pwh 연결을 완료하지 못했습니다. '+String(error.message||error).slice(0,500)};}
 const temp=path.join(dataRoot,`.codex-setup-${randomUUID()}.json`);await fs.writeFile(temp,JSON.stringify(result)+'\n');await fs.rename(temp,path.join(dataRoot,'codex-setup-result.json')).catch(async error=>{if(!['EEXIST','EPERM'].includes(error.code))throw error;await fs.writeFile(path.join(dataRoot,'codex-setup-result.json'),JSON.stringify(result)+'\n');await fs.rm(temp,{force:true});});return result;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)recordCodexPluginSetup().then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(error.message);process.exitCode=1;});
