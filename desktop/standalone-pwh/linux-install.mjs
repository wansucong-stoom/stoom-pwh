import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';

export const linuxInstallRoot=(home=os.homedir())=>path.join(home,'.local','share','stoom','PwhDesktop');
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
export async function installLinux(source,{home=os.homedir()}={}){
 if(process.platform!=='linux'||process.arch!=='x64')throw Error('Linux x64 환경이 필요합니다.');
 source=await fs.realpath(source);const version=JSON.parse(await fs.readFile(path.join(source,'standalone-pwh','version.json'),'utf8')).version;
 if(!/^\d{1,3}\.\d{1,3}\.\d{1,5}$/.test(version))throw Error('버전 번호가 올바르지 않습니다.');
 for(const member of ['pwh-desktop','node/node','electron/electron','standalone-pwh/stoom.png','engine/core/rhwp_bg.wasm'])if(!(await fs.lstat(path.join(source,member))).isFile())throw Error('패키지에 필수 파일이 없습니다.');
 const base=linuxInstallRoot(home),versions=path.join(base,'versions'),destination=path.join(versions,version),stage=path.join(versions,'.stage-'+randomUUID());
 await fs.mkdir(versions,{recursive:true});
 try{await fs.access(destination);if(await fs.realpath(destination)!==source)throw Error('같은 버전이 이미 설치되어 있습니다.');}
 catch(error){if(error.code!=='ENOENT')throw error;await fs.cp(source,stage,{recursive:true,errorOnExist:true,force:false,dereference:false});await fs.rename(stage,destination);}
 const current=path.join(base,'current'),pointer=path.join(base,'.current-'+randomUUID());
 try{const stat=await fs.lstat(current);if(!stat.isSymbolicLink())throw Error('기존 설치 경로가 Pwh 링크가 아닙니다.');}catch(error){if(error.code!=='ENOENT')throw error;}
 await fs.symlink(path.relative(base,destination),pointer);await fs.rename(pointer,current);
 const bin=path.join(home,'.local','bin'),apps=path.join(home,'.local','share','applications'),launcher=path.join(bin,'pwh-desktop');await fs.mkdir(bin,{recursive:true});await fs.mkdir(apps,{recursive:true});
 await fs.writeFile(launcher,'#!/bin/sh\nexec '+quote(path.join(current,'pwh-desktop'))+' "$@"\n',{mode:0o755});await fs.chmod(launcher,0o755);
 const escape=value=>value.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('`','\\`').replaceAll('$','\\$');
 await fs.writeFile(path.join(apps,'stoom-pwh-desktop.desktop'),'[Desktop Entry]\nType=Application\nName=Pwh Desktop\nComment=모두를 위한 무료 한글 편집기\nExec="'+escape(launcher)+'" %f\nIcon='+path.join(current,'standalone-pwh','stoom.png')+'\nTerminal=false\nCategories=Office;WordProcessor;\nMimeType=application/x-hwp;application/vnd.hancom.hwpx;\nStartupWMClass=stoom-pwh-desktop\n');
 await fs.writeFile(path.join(base,'.pwh-linux-install.json'),JSON.stringify({schema:1,kind:'Pwh Desktop Linux',version})+'\n',{mode:0o600});
 return {version,launcher,appRoot:destination};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){installLinux(path.dirname(path.dirname(fileURLToPath(import.meta.url)))).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});}
