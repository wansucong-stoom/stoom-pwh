import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {childPath,zipEntries} from './setup.mjs';

// Official Electron release archive and its published SHASUMS256.txt.
export const ELECTRON_VERSION='45.1.0';
export const ELECTRON_ARCHIVE_SHA256='55eaba17abff7b5bba6c3bbc85068967379024fe742fe9c7fdba9118922ccbe2';
export const ELECTRON_ARCHIVE_SIZE=158224448;

export async function stageElectron(archive,destination){
 if(!path.isAbsolute(archive)||!path.isAbsolute(destination))throw Error('Electron 입력과 출력 경로는 절대 경로여야 합니다.');
 const bytes=await fs.readFile(archive);
 if(bytes.length!==ELECTRON_ARCHIVE_SIZE||createHash('sha256').update(bytes).digest('hex')!==ELECTRON_ARCHIVE_SHA256)throw Error('공식 Electron 런타임의 무결성이 일치하지 않습니다.');
 const entries=zipEntries(bytes,{maxMember:300*1024*1024}),seen=new Set();let total=0;
 for(const entry of entries){
  const name=entry.name.replace(/\/$/,'');if(!name)continue;
  const key=name.toLowerCase();if(seen.has(key))throw Error('Electron 런타임에 중복 경로가 있습니다.');seen.add(key);
  total+=entry.size;if(total>1024*1024*1024)throw Error('Electron 런타임 크기가 너무 큽니다.');
  const target=childPath(destination,name);
  if(entry.name.endsWith('/'))await fs.mkdir(target,{recursive:true});
  else{await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,entry.read(),{flag:'wx'});}
 }
 for(const name of ['electron.exe','resources/default_app.asar','LICENSE','LICENSES.chromium.html','version'])if(!seen.has(name.toLowerCase()))throw Error('Electron 런타임 파일이 누락되었습니다.');
 if((await fs.readFile(path.join(destination,'version'),'utf8')).trim()!==ELECTRON_VERSION)throw Error('Electron 런타임 버전이 다릅니다.');
 return {version:ELECTRON_VERSION,sha256:ELECTRON_ARCHIVE_SHA256,files:seen.size,totalBytes:total};
}
