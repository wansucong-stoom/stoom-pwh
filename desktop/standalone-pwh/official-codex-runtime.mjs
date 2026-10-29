import {promises as fs,createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {spawn} from 'node:child_process';

// Official open-source Codex app-server package for Windows x64, rust-v0.165.0.
// Pin every executable/helper, not only the download archive.
export const officialRuntimeFiles=Object.freeze({
 'codex-package.json':[237,'6d615d5b1c298aa0976e9d44e6336c6e69ba32baedc964daa8741d7a70b7f460'],
 'bin/codex-app-server.exe':[275077936,'bb34b457af59f6a8d2ab62e8a6cb3c8b4347222f61d40dc289ba0cefea492231'],
 'bin/codex-code-mode-host.exe':[78139696,'c15b0ec7c44be4bef2516c251cc8b9f3f4ab9f8727cf2d567d1f183fd415ef2d'],
 'codex-path/rg.exe':[4218880,'14231169855ec5205cf5a1b6f1db358ff4aed4247c86b69ce8aae647c77f6680'],
 'codex-resources/codex-command-runner.exe':[8748848,'8f1a9d4217a34d6b44df81c25999ff9b98bb8d0e3c179aa070fcd84b3ce7a9d3'],
 'codex-resources/codex-windows-sandbox-setup.exe':[18794288,'a39f42dc697919e650cd24f82daaecd6121e41e3f4d56373fef4f4177f8eee02']
});
async function hashFile(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
export async function verifyOfficialRuntime(root){
 if(!path.isAbsolute(root))throw Error('공식 AI 실행 파일의 경로를 확인하지 못했습니다.');
 for(const [relative,[size,digest]] of Object.entries(officialRuntimeFiles)){
  const file=path.join(root,...relative.split('/'));let stat;try{stat=await fs.lstat(file);}catch{throw Error('공식 AI 실행 파일이 없습니다. Pwh Desktop을 다시 설치해 주세요.');}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==size||await hashFile(file)!==digest)throw Error('공식 AI 실행 파일이 올바르지 않습니다. Pwh Desktop을 다시 설치해 주세요.');
 }
 return path.join(root,'bin','codex-app-server.exe');
}
export async function copyOfficialRuntime(source,target){
 await verifyOfficialRuntime(source);
 for(const relative of Object.keys(officialRuntimeFiles)){const out=path.join(target,...relative.split('/'));await fs.mkdir(path.dirname(out),{recursive:true});await fs.copyFile(path.join(source,...relative.split('/')),out,fs.constants.COPYFILE_EXCL);}
 await verifyOfficialRuntime(target);
}
const directSettings=[
 'model_provider="openai_chatgpt_plan"',
 'model_providers.openai_chatgpt_plan.name="ChatGPT plan"',
 'model_providers.openai_chatgpt_plan.base_url="https://api.openai.com/v1"',
 'model_providers.openai_chatgpt_plan.env_key="ACCESS_TOKEN"',
 'model_providers.openai_chatgpt_plan.wire_api="responses"',
 'model_providers.openai_chatgpt_plan.requires_openai_auth=false',
 'model_providers.openai_chatgpt_plan.supports_websockets=false',
 'features.shell_tool=false','features.unified_exec=false','features.plugins=false',
 'features.apps=false','features.hooks=false','features.memories=false','features.multi_agent=false',
 // Some current models require the official code-mode dispatcher to invoke MCP
 // tools even when the feature toggle is off. Its JS runtime has no direct
 // filesystem or network APIs; command, browser and other tools stay disabled.
 'features.view_image=false','features.code_mode=false','features.code_mode_host=true','features.code_mode_tool_search=false',
 'features.computer_use=false','features.browser_use=false','project_doc_max_bytes=0',
 'notify=[]','skills.include_instructions=false','web_search="disabled"'
];
export async function directConnection({runtime,root,home,accessToken,mcpUrl,bearerToken,spawnImpl=spawn}){
 if(!path.isAbsolute(home)||typeof accessToken!=='string'||!accessToken||/[\x00-\x20]/.test(accessToken))throw Error('ChatGPT 연결 정보를 확인하지 못했습니다.');
 const exe=await verifyOfficialRuntime(root);await fs.mkdir(home,{recursive:true});
 const args=['--listen','stdio://',...directSettings.flatMap(setting=>['-c',setting])];
 if(mcpUrl){const url=new URL(mcpUrl);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||!bearerToken)throw Error('문서 도구 주소를 확인하지 못했습니다.');args.push('-c',`mcp_servers.pwh.url=${JSON.stringify(mcpUrl)}`,'-c','mcp_servers.pwh.bearer_token_env_var="PWH_DESKTOP_AGENT_TOKEN"');}
 // Credentials exist only in the dedicated child process environment.
 return new runtime.CodexConnection(exe,{spawnImpl:(program,_args,options)=>spawnImpl(program,args,{...options,env:{...options.env,CODEX_HOME:home,ACCESS_TOKEN:accessToken,...(bearerToken?{PWH_DESKTOP_AGENT_TOKEN:bearerToken}:{})}}),killImpl:runtime.terminateOwnedChild,rpcTimeout:30000});
}
export async function initializeDirect(client,version='0.1.11'){
 await client.request('initialize',{clientInfo:{name:'Pwh Desktop',title:'Pwh Desktop',version},capabilities:{experimentalApi:false}});client.write({method:'initialized'});
}
export async function directModels(client){
 const result=[];let cursor=null;const seen=new Set(),allowed=new Set(['none','minimal','low','medium','high','xhigh','max','ultra']);
 for(let page=0;page<8;page++){
  const response=await client.request('model/list',{cursor,limit:100,includeHidden:false});if(!Array.isArray(response?.data))throw Error('모델 목록을 확인하지 못했습니다.');
  for(const model of response.data){const id=model?.id;if(typeof id!=='string'||!id||id.length>256||/[\x00-\x1f]/.test(id))continue;const reasoningEfforts=(model.supportedReasoningEfforts||[]).map(x=>typeof x==='string'?x:x?.reasoningEffort).filter(x=>allowed.has(x));result.push({id,name:typeof model.displayName==='string'&&model.displayName.length<=256?model.displayName:id,isDefault:model.isDefault===true,reasoningEfforts});if(result.length>256)throw Error('모델 목록이 너무 깁니다.');}
  cursor=response.nextCursor||null;if(!cursor)return result;if(seen.has(cursor))throw Error('모델 목록을 확인하지 못했습니다.');seen.add(cursor);
 }
 throw Error('모델 목록을 끝까지 확인하지 못했습니다.');
}
