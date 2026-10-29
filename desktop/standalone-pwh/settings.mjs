import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {localApiBase} from './ai-providers.mjs';

export const defaultSettings = Object.freeze({provider:'chatgpt',localBaseUrl:'http://127.0.0.1:11434/v1',localModel:'',codexModel:'',codexReasoningEffort:''});
export function validateSettings(input) {
 if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('AI 설정이 올바르지 않습니다.');
 const out={...defaultSettings,...input};
 if (!['chatgpt','codex','local'].includes(out.provider)) throw Error('AI 제공자를 선택하세요.');
 out.localBaseUrl=localApiBase(out.localBaseUrl);
 for(const key of ['localModel','codexModel']) if(typeof out[key]!=='string'||out[key].length>256||/[\x00-\x1f]/.test(out[key])) throw Error('AI 모델 이름이 올바르지 않습니다.');
 if(!['','none','minimal','low','medium','high','xhigh','max','ultra'].includes(out.codexReasoningEffort)) throw Error('Codex 추론 강도가 올바르지 않습니다.');
 return Object.fromEntries(Object.keys(defaultSettings).map(k=>[k,out[k]]));
}
export async function readSettings(filename) {
 try{return validateSettings(JSON.parse(await fs.readFile(filename,'utf8')));}
 catch(error){if(error.code==='ENOENT')return {...defaultSettings};throw error;}
}
export async function writeSettings(filename, value) {
 const settings=validateSettings(value),dir=path.dirname(filename);
 await fs.mkdir(dir,{recursive:true});
 const temporary=path.join(dir,`.pwh-settings-${randomUUID()}.tmp`);
 try{await fs.writeFile(temporary,JSON.stringify(settings,null,2)+'\n',{flag:'wx',mode:0o600});await fs.rename(temporary,filename);}
 finally{await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 return settings;
}
