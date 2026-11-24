import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {parseArgs} from 'node:util';
import {copyDesktopRuntime} from './desktop-runtime-assets.mjs';
import {verifyDesktopRuntime} from './verify-desktop-runtime.mjs';
import {childPath,zipEntries} from './setup.mjs';
import {packagePlugin} from './package.mjs';
import {ELECTRON_VERSION} from './stage-electron.mjs';
import {verifyOfficialRuntime} from '../desktop/standalone-pwh/official-codex-runtime.mjs';
import {desktopPackageVersion} from '../desktop/standalone-pwh/version-info.mjs';

const exec=promisify(execFile);
const root=fileURLToPath(new URL('../',import.meta.url));
const readJson=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const {values}=parseArgs({options:{output:{type:'string'},cache:{type:'string'}}});
const {output,cache}=values;
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('An Apple Silicon macOS host is required');
const source=path.join(root,'desktop','standalone-pwh');
const desktopVersion=await desktopPackageVersion(source);
const {version:pwhVersion}=await readJson(path.join(root,'package.json'));
const packageName='PwhDesktop-'+desktopVersion+'-macos-arm64.zip';
if(!path.isAbsolute(output||'')||path.basename(output)!==packageName||!path.isAbsolute(cache||'')){
 throw Error('Usage: --output /absolute/'+packageName+' --cache /absolute/cache');
}
await fs.mkdir(path.dirname(output),{recursive:true});
await fs.mkdir(cache,{recursive:true});

const common=await readJson(path.join(root,'runtime-lock.json'));
const native=await readJson(path.join(root,'packaging','macos','runtime-lock.json'));
if(native.electron.name!=='electron-v'+ELECTRON_VERSION+'-darwin-arm64.zip'||native.rhwp.name!=='rhwp-v'+common.upstreamVersion+'-macos-aarch64.tar.gz'){
 throw Error('macOS dependencies differ from the shared release versions');
}

async function verifiedArchive(item){
 const file=path.join(cache,item.name||item.file);
 let bytes;
 try{bytes=await fs.readFile(file);}catch(error){
  if(error.code!=='ENOENT')throw error;
  const response=await fetch(item.url,{signal:AbortSignal.timeout(600000)});
  if(!response.ok)throw Error('Download failed: '+(item.name||item.file)+' '+response.status);
  bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length===item.size&&sha256(bytes)===item.sha256)await fs.writeFile(file,bytes,{flag:'wx'});
 }
 if(bytes.length!==item.size||sha256(bytes)!==item.sha256)throw Error('Archive checksum mismatch: '+path.basename(file));
 return file;
}

async function unpackZip(file,destination,{strip='',include=()=>true}={}){
 const seen=new Set();
 for(const entry of zipEntries(await fs.readFile(file),{maxMember:300*1024*1024})){
  if(!entry.name.startsWith(strip))throw Error('Unexpected ZIP archive root');
  const relative=entry.name.slice(strip.length).replace(/\/$/,'');
  if(!relative||!include(relative))continue;
  if(seen.has(relative))throw Error('Duplicate ZIP path: '+relative);
  seen.add(relative);
  const target=childPath(destination,relative);
  if(entry.name.endsWith('/'))await fs.mkdir(target,{recursive:true});
  else{
   await fs.mkdir(path.dirname(target),{recursive:true});
   await fs.writeFile(target,entry.read(),{flag:'wx'});
  }
 }
}

async function extractTar(file,destination){
 await fs.mkdir(destination,{recursive:true});
 await exec('/usr/bin/tar',['-xf',file,'-C',destination,'--no-same-owner']);
}

async function signBundle(bundle){
 await exec('/usr/bin/codesign',['--force','--sign','-','--preserve-metadata=entitlements',bundle]);
}

async function signFrameworks(directory){
 for(const entry of await fs.readdir(directory,{withFileTypes:true})){
  if(!entry.isDirectory())continue;
  const target=path.join(directory,entry.name);
  if(entry.name.endsWith('.framework')){
   const versions=path.join(target,'Versions');
   const entries=await fs.readdir(versions,{withFileTypes:true}).catch(error=>{
    if(error.code==='ENOENT')return [];
    throw error;
   });
   const concrete=entries.filter(version=>version.isDirectory());
   if(concrete.length){
    for(const version of concrete)await signBundle(path.join(versions,version.name));
   }else await signBundle(target);
  }else if(entry.name.endsWith('.app')){
   await signBundle(target);
  }
 }
}

async function configureBundle(app,resources,work){
 const info=path.join(app,'Contents','Info.plist');
 const {stdout}=await exec('/usr/bin/plutil',['-convert','json','-o','-',info]);
 const metadata=JSON.parse(stdout);
 const documentTypes=[
  {extension:'hwp',name:'한글 문서',mime:'application/x-hwp'},
  {extension:'hwpx',name:'한글 표준 문서',mime:'application/hwp+zip'},
 ];
 const typeId=extension=>'win.stoom.pwh.desktop.'+extension;
 Object.assign(metadata,{
  CFBundleIdentifier:'win.stoom.pwh.desktop',
  CFBundleName:'Pwh Desktop',
  CFBundleDisplayName:'Pwh Desktop',
  CFBundleShortVersionString:desktopVersion,
  CFBundleVersion:desktopVersion,
  CFBundleIconFile:'Pwh Desktop.icns',
  LSApplicationCategoryType:'public.app-category.productivity',
  CFBundleDocumentTypes:documentTypes.map(({extension,name})=>({
   CFBundleTypeName:name,CFBundleTypeRole:'Editor',LSHandlerRank:'Alternate',
   CFBundleTypeIconFile:'Pwh Desktop.icns',LSItemContentTypes:[typeId(extension)],
  })),
  UTImportedTypeDeclarations:documentTypes.map(({extension,name,mime})=>({
   UTTypeIdentifier:typeId(extension),UTTypeDescription:name,UTTypeConformsTo:['public.data'],
   UTTypeTagSpecification:{'public.filename-extension':[extension],'public.mime-type':[mime]},
  })),
 });
 const json=path.join(work,'Info.json');
 await fs.writeFile(json,JSON.stringify(metadata));
 await exec('/usr/bin/plutil',['-convert','xml1','-o',info,json]);
 const iconset=path.join(work,'Pwh.iconset');
 await fs.mkdir(iconset);
 const mark=path.join(source,'stoom.png');
 for(const size of [16,32,128,256,512]){
  for(const scale of [1,2]){
   const pixels=size*scale;
   const filename='icon_'+size+'x'+size+(scale===2?'@2x':'')+'.png';
   await exec('/usr/bin/sips',['-z',String(pixels),String(pixels),mark,'--out',path.join(iconset,filename)]);
  }
 }
 await exec('/usr/bin/iconutil',['-c','icns','-o',path.join(resources,'Pwh Desktop.icns'),iconset]);
}

const inputs=Object.fromEntries(await Promise.all(Object.entries({...native,common:common.runtime}).map(async ([name,item])=>[name,await verifiedArchive(item)])));
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-macos-build-'));
try{
 const extracted=path.join(temporary,'electron');
 await exec('/usr/bin/ditto',['-x','-k',inputs.electron,extracted]);
 const app=path.join(temporary,'Pwh Desktop.app');
 await fs.rename(path.join(extracted,'Electron.app'),app);
 const resources=path.join(app,'Contents','Resources');
 const runtime=path.join(resources,'app');
 await fs.rm(path.join(resources,'default_app.asar'),{force:true});
 await configureBundle(app,resources,temporary);

 await fs.mkdir(runtime);
 await fs.writeFile(path.join(runtime,'package.json'),JSON.stringify({
  name:'pwh-desktop',version:desktopVersion,main:'standalone-pwh/macos-main.cjs',
 })+'\n',{flag:'wx'});
 await copyDesktopRuntime(source,path.join(runtime,'standalone-pwh'));
 // Keep the upstream signatures and exact executable bytes for runtime validation.
 const codex=path.join(runtime,'standalone-pwh','codex-runtime');
 await extractTar(inputs.codex,codex);
 await verifyOfficialRuntime(codex);
 await fs.copyFile(path.join(source,'version.json'),path.join(runtime,'standalone-pwh','version.json'));
 await fs.writeFile(path.join(runtime,'standalone-pwh','distribution.json'),JSON.stringify({schema:1,channel:'macos-preview'})+'\n');
 await fs.mkdir(path.join(runtime,'bridge'));
 for(const bridge of ['hwp-codex-host.mjs','codex-image-host.mjs'])await fs.copyFile(path.join(root,'desktop','bridge',bridge),path.join(runtime,'bridge',bridge));
 const plugin=path.join(temporary,'pwh.zip');
 await packagePlugin({output:plugin});
 await unpackZip(plugin,path.join(runtime,'release-source'),{strip:'pwh/'});
 const engine=path.join(runtime,'engine');
 await unpackZip(inputs.common,engine,{include:name=>name!=='rhwp'&&!name.startsWith('rhwp/')&&!name.endsWith('.exe')});
 const rhwp=path.join(temporary,'rhwp');
 await extractTar(inputs.rhwp,rhwp);
 await fs.cp(path.join(rhwp,'rhwp'),path.join(engine,'rhwp'),{recursive:true});
 const node=path.join(temporary,'node');
 await extractTar(inputs.node,node);
 const nodeRoot=path.join(node,path.basename(native.node.name,'.tar.xz'));
 await fs.mkdir(path.join(runtime,'node'));
 await fs.copyFile(path.join(nodeRoot,'bin','node'),path.join(runtime,'node','node'));
 await fs.copyFile(path.join(nodeRoot,'LICENSE'),path.join(runtime,'node','LICENSE'));
 for(const executable of [path.join(runtime,'node','node'),path.join(engine,'rhwp','rhwp')]){
  await fs.chmod(executable,0o755);
  await exec('/usr/bin/codesign',['--force','--sign','-',executable]);
 }
 await fs.writeFile(path.join(engine,'.preserved-runtime.json'),JSON.stringify({schemaVersion:1,id:common.id,platform:'darwin-arm64',archiveSha256:common.runtime.sha256})+'\n');
 for(const license of ['LICENSE','LICENSES.chromium.html']){
  await fs.copyFile(path.join(extracted,license),path.join(runtime,'node','ELECTRON-'+license));
 }
 await signFrameworks(path.join(app,'Contents','Frameworks'));
 await signBundle(app);
 await exec('/usr/bin/codesign',['--verify','--deep','--strict',app]);
 const archive=path.join(temporary,packageName);
 await exec('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',app,archive]);

 // Validate the exact archive users receive, including framework symlinks.
 const verified=path.join(temporary,'verified');
 await exec('/usr/bin/ditto',['-x','-k',archive,verified]);
 const verifiedApp=path.join(verified,'Pwh Desktop.app');
 const verifiedRuntime=path.join(verifiedApp,'Contents','Resources','app');
 await exec('/usr/bin/codesign',['--verify','--deep','--strict',verifiedApp]);
 console.log('Verified the app and nested code in the final ZIP');
 const runtimeSmoke=await verifyDesktopRuntime(verifiedRuntime,{sectionEditing:true,runtimeId:common.id});
 console.log('Verified new and existing HWPX document tabs in the final ZIP');
 const {verifyMacDesktop}=await import('./verify-desktop-macos.mjs');
 const appSmoke=await verifyMacDesktop(verifiedApp);
 const bytes=await fs.readFile(archive);
 const report={
  platform:'darwin-arm64',pwhVersion,desktopVersion,commonRuntime:common.id,
  coreSha256:sha256(await fs.readFile(path.join(verifiedRuntime,'engine','core','rhwp_bg.wasm'))),
  editorSha256:sha256(await fs.readFile(path.join(verifiedRuntime,'standalone-pwh','client','editor.js'))),
  package:packageName,size:bytes.length,sha256:sha256(bytes),
  signing:'ad-hoc',notarized:false,runtimeSmoke,appSmoke,
 };
 await fs.writeFile(output,bytes,{flag:'wx'});
 await fs.writeFile(output+'.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(report,null,2));
}finally{
 await fs.rm(temporary,{recursive:true,force:true});
}
