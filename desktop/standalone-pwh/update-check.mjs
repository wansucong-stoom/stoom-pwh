import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const latest='https://api.github.com/repos/wansucong-stoom/stoom-pwh/releases/latest';
const recentReleases='https://api.github.com/repos/wansucong-stoom/stoom-pwh/releases?per_page=20';
const allowedHosts=new Set(['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com']);
const maxBytes=512*1024*1024;
export function compareVersions(a,b){
 const parse=v=>{if(typeof v!=='string'||!/^\d{1,3}\.\d{1,3}\.\d{1,5}$/.test(v))throw Error('버전 번호가 올바르지 않습니다.');return v.split('.').map(Number);};
 const left=parse(a),right=parse(b);for(let i=0;i<3;i++)if(left[i]!==right[i])return left[i]>right[i]?1:-1;return 0;
}
export function releaseInstaller(release,currentVersion,{platform=process.platform}={}){
 if(!release||release.draft||typeof release.tag_name!=='string'||!Array.isArray(release.assets))return null;
 const mac=platform==='darwin';
 const preview=mac&&release.prerelease&&/^macos-preview-\d+\.\d+\.\d+$/.test(release.tag_name);
 if(release.prerelease&&!preview)return null;
 if(mac&&!preview&&!/^v\d+\.\d+\.\d+$/.test(release.tag_name))return null;
 const pattern=mac?/^PwhDesktop-(\d{1,3}\.\d{1,3}\.\d{1,5})-macos-arm64\.zip$/
  :platform==='linux'?/^PwhDesktop-(\d{1,3}\.\d{1,3}\.\d{1,5})-linux-x64\.tar\.gz$/
  :/^PwhDesktop-(\d{1,3}\.\d{1,3}\.\d{1,5})\.msi$/;
 const tag=encodeURIComponent(release.tag_name),prefix=`/wansucong-stoom/stoom-pwh/releases/download/${tag}/`;
 const candidates=[];
 for(const asset of release.assets){
  const m=pattern.exec(asset.name||'');if(!m||asset.state&&asset.state!=='uploaded'||compareVersions(m[1],currentVersion)<=0)continue;
  if(preview&&release.tag_name!=='macos-preview-'+m[1])continue;
  if(!Number.isSafeInteger(asset.size)||asset.size<1||asset.size>maxBytes||!/^sha256:[0-9a-f]{64}$/i.test(asset.digest||''))continue;
  let url;try{url=new URL(asset.browser_download_url);}catch{continue;}
  if(url.protocol!=='https:'||url.hostname!=='github.com'||url.username||url.password||url.search||url.hash||url.pathname!==prefix+encodeURIComponent(asset.name))continue;
  candidates.push({version:m[1],name:asset.name,url:url.href,size:asset.size,sha256:asset.digest.slice(7).toLowerCase(),...(mac?{releaseUrl:'https://github.com/wansucong-stoom/stoom-pwh/releases/tag/'+tag}:{})});
 }
 candidates.sort((a,b)=>compareVersions(b.version,a.version));return candidates[0]||null;
}
export async function checkForDesktopUpdate(currentVersion,{fetchImpl=fetch,platform=process.platform}={}){
 const response=await fetchImpl(platform==='darwin'?recentReleases:latest,{headers:{'accept':'application/vnd.github+json','user-agent':'Pwh-Desktop','x-github-api-version':'2022-11-28'},signal:AbortSignal.timeout(10000),redirect:'error'});
 if(!response.ok)throw Error('GitHub 업데이트 정보를 확인하지 못했습니다.');
 const text=await response.text();if(text.length>2*1024*1024)throw Error('업데이트 정보가 너무 큽니다.');
 const release=JSON.parse(text);
 if(platform!=='darwin')return releaseInstaller(release,currentVersion,{platform});
 if(!Array.isArray(release))throw Error('Mac 업데이트 정보를 확인하지 못했습니다.');
 const candidates=release.map(item=>releaseInstaller(item,currentVersion,{platform})).filter(Boolean);
 candidates.sort((a,b)=>compareVersions(b.version,a.version));
 return candidates[0]||null;
}
async function followDownload(url,fetchImpl,signal){
 for(let i=0;i<5;i++){
  const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||!allowedHosts.has(parsed.hostname))throw Error('허용되지 않은 업데이트 주소입니다.');
  const limit=AbortSignal.timeout(900000);const response=await fetchImpl(parsed.href,{headers:{'user-agent':'Pwh-Desktop','accept':'application/octet-stream'},signal:signal?AbortSignal.any([signal,limit]):limit,redirect:'manual'});
  if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');if(!location)throw Error('업데이트 주소를 확인하지 못했습니다.');url=new URL(location,parsed).href;continue;}
  if(!response.ok||!response.body)throw Error('업데이트 설치 파일을 받지 못했습니다.');return response;
 }throw Error('업데이트 주소 이동이 너무 많습니다.');
}
export async function downloadInstaller(asset,dir,{fetchImpl=fetch,signal}={}){
 const extension=process.platform==='linux'?'-linux-x64.tar.gz':'.msi';
 if(!asset||asset.name!==`PwhDesktop-${asset.version}${extension}`||!/^\d{1,3}\.\d{1,3}\.\d{1,5}$/.test(asset.version)||!/^[0-9a-f]{64}$/.test(asset.sha256)||!Number.isSafeInteger(asset.size)||asset.size<1||asset.size>maxBytes)throw Error('업데이트 정보를 확인하지 못했습니다.');
 const original=new URL(asset.url);if(original.protocol!=='https:'||original.hostname!=='github.com'||original.username||original.password||original.search||original.hash||!original.pathname.startsWith('/wansucong-stoom/stoom-pwh/releases/download/')||!original.pathname.endsWith('/'+encodeURIComponent(asset.name)))throw Error('업데이트 주소를 확인하지 못했습니다.');
 const response=await followDownload(asset.url,fetchImpl,signal);await fs.mkdir(dir,{recursive:true});
 const filename=path.join(dir,`PwhDesktop-${asset.version}-${randomUUID()}${extension}`),file=await fs.open(filename,'wx'),hash=createHash('sha256');let length=0;
 try{
  for await(const chunk of response.body){const bytes=Buffer.from(chunk);length+=bytes.length;if(length>asset.size||length>maxBytes)throw Error('설치 파일 크기가 다릅니다.');hash.update(bytes);await file.writeFile(bytes);}
  await file.close();if(length!==asset.size||hash.digest('hex')!==asset.sha256)throw Error('설치 파일의 무결성 확인에 실패했습니다.');return filename;
 }catch(error){await file.close().catch(()=>{});await fs.rm(filename,{force:true}).catch(()=>{});throw error;}
}
export async function scheduleDesktopUpdate({installer,asset,dataRoot,appExe,pids,spawnImpl=spawn,nodeExe=process.execPath}){
 if(process.platform==='linux'){
  const {linuxInstallRoot}=await import('./linux-install.mjs');
  const marker=JSON.parse(await fs.readFile(path.join(linuxInstallRoot(),'.pwh-linux-install.json'),'utf8'));
  const installed=await fs.realpath(appExe),base=await fs.realpath(path.join(linuxInstallRoot(),'versions'));
  if(marker.schema!==1||marker.kind!=='Pwh Desktop Linux'||!installed.startsWith(base+path.sep))throw Error('Linux 설치판에서 업데이트해 주세요.');
  const dir=path.join(dataRoot,'updates',randomUUID());await fs.mkdir(dir,{recursive:true,mode:0o700});
  for(const name of ['linux-update-helper.mjs','linux-install.mjs'])await fs.copyFile(fileURLToPath(new URL('./'+name,import.meta.url)),path.join(dir,name),fs.constants.COPYFILE_EXCL);
  const nodeCopy=path.join(dir,'node');await fs.copyFile(nodeExe,nodeCopy,fs.constants.COPYFILE_EXCL);await fs.chmod(nodeCopy,0o700);
  const request=path.join(dir,'request.json');await fs.writeFile(request,JSON.stringify({installer,sha256:asset.sha256,size:asset.size,oldApp:installed,pids:pids.filter(pid=>pid!==process.ppid&&pid>1),resultFile:path.join(dataRoot,'updates','last-result.json')}),{mode:0o600,flag:'wx'});
  const child=spawnImpl(nodeCopy,[path.join(dir,'linux-update-helper.mjs'),request],{detached:true,stdio:'ignore'});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();return;
 }
 if(process.platform!=='win32')throw Error('Windows 설치판에서만 업데이트할 수 있습니다.');
 const dir=path.join(dataRoot,'updates',randomUUID());await fs.mkdir(dir,{recursive:true});
 const nodeCopy=path.join(dir,'node.exe'),helper=path.join(dir,'update-helper.mjs');
 await fs.copyFile(nodeExe,nodeCopy,fs.constants.COPYFILE_EXCL);await fs.copyFile(fileURLToPath(new URL('./update-helper.mjs',import.meta.url)),helper,fs.constants.COPYFILE_EXCL);
 const args=[helper,installer,asset.sha256,String(asset.size),appExe,path.join(dataRoot,'updates','last-result.json'),...pids.map(String)];
 const child=spawnImpl(nodeCopy,args,{detached:true,windowsHide:true,stdio:'ignore'});
 await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
}
