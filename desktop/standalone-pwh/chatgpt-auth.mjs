import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createHash,createPublicKey,randomBytes,timingSafeEqual,verify as verifySignature} from 'node:crypto';
import {createCredentialStore} from './chatgpt-store.mjs';

const ISSUER='https://auth.openai.com',RESOURCE='https://api.openai.com/v1';
const ENDPOINTS={authorize:ISSUER+'/api/accounts/authorize',token:ISSUER+'/api/accounts/oauth/token',jwks:ISSUER+'/.well-known/jwks.json',discovery:ISSUER+'/.well-known/openid-configuration'};
const SCOPES=['openid','profile','email','offline_access','resource.invoke','chatgpt.tokens.use.direct'];
const random=()=>randomBytes(32).toString('base64url');
const digest=value=>createHash('sha256').update(value).digest('base64url');
const clean=(value,max=16384)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\x00-\x20\x7f]/.test(value);
const same=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const accountId=(clientId,subject)=>createHash('sha256').update(clientId+'\0'+subject).digest('hex');

async function jsonResponse(response){
 const raw=await response.text();if(raw.length>1024*1024)throw Error('ChatGPT 인증 응답이 너무 큽니다.');
 let value;try{value=JSON.parse(raw);}catch{throw Error('ChatGPT 인증 응답을 확인하지 못했습니다.');}
 if(!response.ok)throw Object.assign(Error('ChatGPT 인증 서버가 요청을 처리하지 못했습니다. 다시 로그인해 주세요.'),{code:response.status===400&&value?.error==='invalid_grant'?'invalid_grant':'authentication_failed'});
 return value;
}
async function fetchJson(fetchImpl,url,options={}){
 let response;try{response=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error('ChatGPT 인증 서버에 연결하지 못했습니다.');}return jsonResponse(response);
}
async function postForm(fetchImpl,url,values){return fetchJson(fetchImpl,url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','accept':'application/json'},body:new URLSearchParams(values)});}
function decodeBytes(part){if(!/^[A-Za-z0-9_-]+$/.test(part)||part.length>24000)throw Error('로그인 응답의 형식이 올바르지 않습니다.');const decoded=Buffer.from(part,'base64url');if(decoded.toString('base64url')!==part)throw Error('로그인 응답의 형식이 올바르지 않습니다.');return decoded;}
function decodePart(part){try{return JSON.parse(decodeBytes(part).toString('utf8'));}catch{throw Error('로그인 응답의 형식이 올바르지 않습니다.');}}

export async function validateChatgptIdToken(token,{clientId,nonce,fetchImpl=fetch,jwksUrl=ENDPOINTS.jwks,now=Date.now}={}){
 if(typeof token!=='string'||token.length>32000)throw Error('ChatGPT 계정 확인 정보가 없습니다.');
 const parts=token.split('.');if(parts.length!==3)throw Error('ChatGPT 계정 확인 정보가 올바르지 않습니다.');const header=decodePart(parts[0]),claims=decodePart(parts[1]);
 if(header.alg!=='RS256'||!clean(header.kid,256)||!clean(clientId,256)||!clean(nonce,256))throw Error('ChatGPT 계정 서명 정보를 확인하지 못했습니다.');
 const jwks=await fetchJson(fetchImpl,jwksUrl,{headers:{accept:'application/json'}}),key=Array.isArray(jwks.keys)?jwks.keys.find(item=>item?.kid===header.kid&&item.kty==='RSA'&&(!item.alg||item.alg==='RS256')&&(!item.use||item.use==='sig')):null;
 if(!key)throw Error('ChatGPT 계정 서명 키를 확인하지 못했습니다.');
 let valid=false;try{valid=verifySignature('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key,format:'jwk'}),decodeBytes(parts[2]));}catch{}
 const aud=Array.isArray(claims.aud)?claims.aud:[claims.aud];
 if(!valid||claims.iss!==ISSUER||!aud.includes(clientId)||(aud.length>1&&claims.azp!==clientId)||!Number.isFinite(claims.exp)||claims.exp*1000<=now()||!same(claims.nonce,nonce)||!clean(claims.sub,512))throw Error('ChatGPT 계정 확인에 실패했습니다. 다시 로그인해 주세요.');
 return {subject:claims.sub,email:typeof claims.email==='string'&&claims.email.length<=320&&!/[\x00-\x1f]/.test(claims.email)?claims.email:'',name:typeof claims.name==='string'&&claims.name.length<=200&&!/[\x00-\x1f]/.test(claims.name)?claims.name:''};
}
function validateTokenSet(data,{requireId=false,previousRefresh}={}){
 const scopes=typeof data?.scope==='string'?data.scope.split(/\s+/).filter(Boolean):[];
 if(!clean(data?.access_token)||String(data?.token_type).toLowerCase()!=='bearer'||!Number.isFinite(data?.expires_in)||data.expires_in<=0||data.expires_in>31*86400||!scopes.includes('openid')||!scopes.includes('chatgpt.tokens.use.direct')||!scopes.includes('resource.invoke')||!scopes.includes('offline_access')||!clean(data?.refresh_token||previousRefresh)||(requireId&&!clean(data?.id_token,32000)))throw Error('ChatGPT 요금제 사용 권한을 확인하지 못했습니다.');
 return {accessToken:data.access_token,refreshToken:data.refresh_token||previousRefresh,idToken:data.id_token||null,scopes:[...new Set(scopes)],expiresIn:data.expires_in};
}
function openSystemBrowser(url){
 if(process.platform!=='win32')throw Error('이 로그인 연결은 Windows Desktop에서 사용할 수 있습니다.');
 return new Promise((resolve,reject)=>{const system=process.env.SystemRoot||'C:\\Windows',child=spawn(system+'\\System32\\rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,stdio:'ignore',shell:false});child.once('error',()=>reject(Error('기본 브라우저를 열지 못했습니다.')));child.once('spawn',()=>{child.unref();resolve();});});
}

export function createChatgptAuth({dataRoot,store=createCredentialStore({root:dataRoot}),fetchImpl=fetch,openBrowser=openSystemBrowser,now=Date.now,endpoints=ENDPOINTS}={}){
 let pending=null,starting=false,lastError='',issuedForRetry=null;
 const summary=state=>({active:state.active,accounts:state.accounts.map(a=>({id:a.id,email:a.email||'',name:a.name||'',connected:!!a.refreshToken&&!a.signingOut,active:a.id===state.active})),needsWelcome:!!state.active&&!state.planWelcomeAcknowledged,pending:!!pending||starting,error:lastError});
 const status=()=>store.transaction(async state=>({value:summary(state)}));
 async function begin(accountIdToUse=null){
  if(pending||starting)throw Error('이미 ChatGPT 로그인 창이 열려 있습니다.');starting=true;
  try{
  const selected=await store.transaction(async state=>{const account=accountIdToUse?state.accounts.find(a=>a.id===accountIdToUse):null;if(accountIdToUse&&!account)throw Error('선택한 계정을 찾지 못했습니다.');if(account?.signingOut&&now()-account.signOutStartedAt<120000)throw Error('로그아웃을 완료한 뒤 다시 로그인해 주세요.');return {value:{hostId:state.hostId,account:account?{...account}:null}};});
  const retryClientId=selected.account?null:issuedForRetry,state=random(),nonce=random(),verifier=random();let server,attempt;
  server=createServer(async(req,res)=>{
   const fail=message=>{res.writeHead(400,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'"});res.end(message);};
   if(req.method!=='GET'||req.socket.remoteAddress!=='127.0.0.1'||req.headers.host!==`127.0.0.1:${server.address().port}`)return fail('Invalid callback.');
   const url=new URL(req.url,'http://127.0.0.1');if(url.pathname!=='/auth/callback'||url.searchParams.getAll('state').length!==1||!same(url.searchParams.get('state'),state))return fail('Invalid callback.');
   if(attempt.handling)return fail('This authorization is already being processed.');attempt.handling=true;
   let issued;try{
    if(url.searchParams.has('error'))throw Error('ChatGPT 로그인 또는 요금제 사용 승인이 취소되었습니다.');
    const code=url.searchParams.get('code'),received=url.searchParams.get('client_id');if(url.searchParams.getAll('code').length!==1||!clean(code,8000)||url.searchParams.getAll('client_id').length>1)throw Error('ChatGPT 로그인 응답을 확인하지 못했습니다.');
    issued=selected.account?.clientId||retryClientId||received;if(!clean(issued,256)||issued==='dynamic_agent_client'||((selected.account||retryClientId)&&received&&received!==issued)||(!selected.account&&!retryClientId&&!received))throw Error('ChatGPT 앱 등록 정보를 확인하지 못했습니다.');
    const data=await postForm(fetchImpl,endpoints.token,{grant_type:'authorization_code',client_id:issued,code,code_verifier:verifier,redirect_uri:attempt.redirectUri,resource:RESOURCE});
    const tokens=validateTokenSet(data,{requireId:true}),identity=await validateChatgptIdToken(tokens.idToken,{clientId:issued,nonce,fetchImpl,jwksUrl:endpoints.jwks,now});
    if(selected.account&&(selected.account.clientId!==issued||selected.account.subject!==identity.subject))throw Error('선택한 ChatGPT 계정과 로그인한 계정이 다릅니다.');
    await store.transaction(async(state,guard)=>{guard();const id=accountId(issued,identity.subject),old=state.accounts.find(a=>a.id===id),record={id,clientId:issued,subject:identity.subject,email:identity.email,name:identity.name,accessToken:tokens.accessToken,refreshToken:tokens.refreshToken,idToken:tokens.idToken,scopes:tokens.scopes,expiresAt:now()+tokens.expiresIn*1000,signingOut:false};if(old)Object.assign(old,record);else state.accounts.push(record);state.active=id;return {write:true};});
    issuedForRetry=null;lastError='';res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'"});res.end('<!doctype html><meta charset="utf-8"><title>Pwh Desktop</title><p>ChatGPT 연결이 완료되었습니다. Pwh Desktop으로 돌아가세요.</p>');
   }catch(error){if(error.code==='invalid_grant'&&!selected.account&&issued)issuedForRetry=issued;lastError=error.message||'ChatGPT 로그인에 실패했습니다.';res.writeHead(400,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'"});res.end('<!doctype html><meta charset="utf-8"><title>Pwh Desktop</title><p>ChatGPT 연결을 완료하지 못했습니다. Pwh Desktop에서 상태를 확인하세요.</p>');}
   finally{clearTimeout(attempt.timer);pending=null;server.close();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const redirectUri=`http://127.0.0.1:${server.address().port}/auth/callback`,query={client_id:selected.account?.clientId||retryClientId||'dynamic_agent_client',ext_agent_host_id:selected.hostId,response_type:'code',redirect_uri:redirectUri,scope:SCOPES.join(' '),resource:RESOURCE,state,nonce,code_challenge_method:'S256',code_challenge:digest(verifier)};
  if(!selected.account&&!retryClientId)query.agent_name_hint='Pwh Desktop';else if(selected.account){if(selected.account.idToken)query.id_token_hint=selected.account.idToken;if(selected.account.email)query.login_hint=selected.account.email;}
  attempt={server,redirectUri,handling:false,timer:setTimeout(()=>{if(pending===attempt){lastError='ChatGPT 로그인 시간이 만료되었습니다. 다시 시도해 주세요.';pending=null;server.close();}},600000)};attempt.timer.unref?.();pending=attempt;lastError='';
  try{await openBrowser(endpoints.authorize+'?'+new URLSearchParams(query));}catch(error){clearTimeout(attempt.timer);pending=null;server.close();throw error;}
  return {started:true};
  }finally{starting=false;}
 }
 async function getAccessToken(id=null){
  return store.transaction(async(state,guard)=>{
   const account=state.accounts.find(a=>a.id===(id||state.active));if(!account?.refreshToken||account.signingOut)throw Error('ChatGPT 계정으로 로그인해 주세요.');
   if(account.accessToken&&Number(account.expiresAt)>now()+120000)return {value:{accessToken:account.accessToken,accountId:account.id,expiresAt:account.expiresAt}};
   const data=await postForm(fetchImpl,endpoints.token,{grant_type:'refresh_token',client_id:account.clientId,refresh_token:account.refreshToken,resource:RESOURCE});guard();
   // OAuth refresh responses may omit scope when the existing grant is unchanged.
   const tokens=validateTokenSet({...data,scope:data.scope||account.scopes.join(' ')},{previousRefresh:account.refreshToken});
   account.accessToken=tokens.accessToken;account.refreshToken=tokens.refreshToken;if(tokens.idToken)account.idToken=tokens.idToken;account.scopes=tokens.scopes;account.expiresAt=now()+tokens.expiresIn*1000;
   return {write:true,value:{accessToken:account.accessToken,accountId:account.id,expiresAt:account.expiresAt}};
  });
 }
 async function select(id){await getAccessToken(id);return store.transaction(async state=>{if(!state.accounts.some(a=>a.id===id&&a.refreshToken&&!a.signingOut))throw Error('ChatGPT 계정을 다시 로그인해 주세요.');state.active=id;return {write:true,value:summary(state)};});}
 async function signOut(id=null){
  const saved=await store.transaction(async state=>{const account=state.accounts.find(a=>a.id===(id||state.active));if(!account)return {value:null};account.signingOut=true;account.signOutStartedAt=now();if(state.active===account.id)state.active=null;return {write:true,value:{id:account.id,refreshToken:account.refreshToken,clientId:account.clientId}};});
  if(!saved)return {remoteRevocationConfirmed:true};let confirmed=!saved.refreshToken;
  if(saved.refreshToken)for(let attempt=0;attempt<2&&!confirmed;attempt++){let retry=true;try{const discovery=await fetchJson(fetchImpl,endpoints.discovery,{headers:{accept:'application/json'}}),url=new URL(discovery.revocation_endpoint);if(url.protocol!=='https:'||url.origin!==ISSUER)throw Error('Invalid endpoint');const response=await fetchImpl(url.href,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:saved.refreshToken,token_type_hint:'refresh_token',client_id:saved.clientId}),redirect:'error',signal:AbortSignal.timeout(15000)});confirmed=response.status===200;retry=response.status>=500;}catch{}if(!confirmed&&retry&&attempt===0)await new Promise(resolve=>setTimeout(resolve,250));if(!retry)break;}
  await store.transaction(async state=>{const account=state.accounts.find(a=>a.id===saved.id);if(!account||!account.signingOut||account.refreshToken!==saved.refreshToken)return {};delete account.accessToken;delete account.refreshToken;delete account.idToken;delete account.expiresAt;delete account.signOutStartedAt;account.scopes=[];account.signingOut=false;return {write:true};});
  return {remoteRevocationConfirmed:confirmed};
 }
 async function acknowledgeWelcome(){return store.transaction(async state=>{if(!state.active)throw Error('먼저 ChatGPT 계정에 로그인해 주세요.');state.planWelcomeAcknowledged=true;return {write:true,value:{ok:true}};});}
 function close(){if(pending){clearTimeout(pending.timer);pending.server.close();pending=null;}}
 return {begin,status,getAccessToken,select,signOut,acknowledgeWelcome,close};
}
