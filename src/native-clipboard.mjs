import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile);
export async function readNativeClipboard({execute=exec,platform=process.platform}={}){
 if(platform!=='win32')throw Error('Native table clipboard reading is Windows-only');
 const {stdout}=await execute('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','RemoteSigned','-File',fileURLToPath(new URL('../scripts/read-clipboard.ps1',import.meta.url))],{windowsHide:true,timeout:10000,maxBuffer:28*1024*1024,encoding:'utf8'});
 const value=JSON.parse(stdout.trim());
 if(typeof value.html!=='string'||typeof value.text!=='string'||value.html.length>8*1024*1024||value.text.length>24000||value.png!==undefined&&(typeof value.png!=='string'||value.png.length>12*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.png)))throw Error('Invalid native clipboard response');
 return {content:[{type:'text',text:'User-initiated local clipboard read'}],structuredContent:{htmlLength:value.html.length,textLength:value.text.length,imageAvailable:!!value.png,formats:value.formats},_meta:{'pwh/clipboard':{html:value.html,text:value.text,formats:value.formats,png:value.png||''}}};
}
