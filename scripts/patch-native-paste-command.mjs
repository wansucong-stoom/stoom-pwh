import fs from 'node:fs/promises';import path from 'node:path';
export async function patchNativePasteCommand(studio){
 const file=path.join(studio,'src/engine/input-handler.ts');let source=await fs.readFile(file,'utf8');
 if(source.includes("new CustomEvent('pwh-native-paste-request'"))return;
 const anchor="    return document.execCommand('paste');";if(source.split(anchor).length!==2)throw Error('Unsupported toolbar paste handler');
 source=source.replace(anchor,"    const request=new CustomEvent('pwh-native-paste-request',{cancelable:true});\n    if(!window.dispatchEvent(request))return true;\n    return document.execCommand('paste');");await fs.writeFile(file,source);
}
