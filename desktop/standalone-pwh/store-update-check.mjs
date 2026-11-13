import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const packageName='STOOMLab.PwhDesktop',familyName=packageName+'_g8ykese288rn6';
const probe=fileURLToPath(new URL('./store-update-check.exe',import.meta.url));
export function parseStoreUpdateResult(stdout){
  if(typeof stdout!=='string'||Buffer.byteLength(stdout)>65536)throw Error('Invalid Store response');
  const value=JSON.parse(stdout.replace(/^\uFEFF/,''));
  if(value.schema!==1||value.packageName!==packageName||value.familyName!==familyName
    ||!['available','current'].includes(value.status)
    ||typeof value.currentVersion!=='string'||!/^\d{1,5}(\.\d{1,5}){3}$/.test(value.currentVersion)
    ||value.currentVersion.split('.').some(part=>Number(part)>65535))throw Error('Invalid Store identity');
  return {channel:'microsoft-store',status:value.status,available:value.status==='available',currentVersion:value.currentVersion};
}

export function createStoreUpdateChecker({execFileImpl=execFile,platform=process.platform,env=process.env,now=Date.now,ttlMs=300000,retryMs=60000}={}){
  let cache=null,expires=0,inFlight=null;
  return async function check({channel=env.PWH_DESKTOP_DISTRIBUTION}={}){
    const unavailable=()=>({channel:channel||'unknown',status:'unavailable',available:false});
    if(channel!=='microsoft-store'||platform!=='win32')return unavailable();
    if(cache&&now()<expires)return {...cache};
    if(inFlight)return {...await inFlight};
    inFlight=(async()=>{
      let result;
      try{
        const stdout=await new Promise((resolve,reject)=>execFileImpl(probe,[],
          {windowsHide:true,timeout:20000,maxBuffer:65536,encoding:'utf8',env},(error,out)=>error?reject(error):resolve(out)));
        result=parseStoreUpdateResult(stdout);
      }catch{result=unavailable();}
      cache=result;expires=now()+(result.status==='unavailable'?retryMs:ttlMs);
      return result;
    })();
    try{return {...await inFlight};}finally{inFlight=null;}
  };
}
export const checkForStoreUpdate=createStoreUpdateChecker();
