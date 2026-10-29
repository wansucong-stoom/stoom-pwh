import {promises as fs} from 'node:fs';
import path from 'node:path';

export async function desktopVersion(root){
 try{
  const {version}=JSON.parse(await fs.readFile(path.join(root,'version.json'),'utf8'));
  return typeof version==='string'&&/^\d{1,3}\.\d{1,3}\.\d{1,5}$/.test(version)?version:null;
 }catch{return null;}
}
export function addDesktopVersion(html,version){
 const marker='<small id="pwh-version"';
 if(!html.includes(marker))throw Error('조판기 버전 표시를 확인하지 못했습니다.');
 const label=version?`Desktop ${version}`:'Desktop 버전 확인 불가';
 return html.replace(marker,`<small id="desktop-version" style="white-space:nowrap">${label}</small>${marker}`);
}
