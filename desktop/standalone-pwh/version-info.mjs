import {promises as fs} from 'node:fs';
import path from 'node:path';

export async function desktopVersion(root){
 try{
  const {version}=JSON.parse(await fs.readFile(path.join(root,'version.json'),'utf8'));
  return typeof version==='string'&&/^\d{1,3}\.\d{1,3}\.\d{1,5}$/.test(version)?version:null;
 }catch{return null;}
}
export async function desktopPackageVersion(root,requested){
 const version=await desktopVersion(root);
 if(!version||version.split('.').some((part,index)=>Number(part)>(index===2?65535:255))){
  throw Error('Desktop version.json has an invalid package version');
 }
 if(requested!==undefined&&requested!==version)throw Error('Requested Desktop version differs from version.json ('+version+')');
 return version;
}

export function addDesktopVersion(html,version){
 const marker=/<small id="pwh-version"[^>]*>Pwh (\d+\.\d+\.\d+)<\/small>/i;
 if(!marker.test(html))throw Error('조판기 버전 표시를 확인하지 못했습니다.');
 const desktop=version||'버전 확인 불가';
 return html.replace(marker,(_whole,pwh)=>`<small id="pwh-version" style="white-space:nowrap">Pwh Desktop ${desktop} (${pwh})</small>`);
}
