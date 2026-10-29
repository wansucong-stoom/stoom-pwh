import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {createCredentialStore} from '../desktop/standalone-pwh/chatgpt-store.mjs';
import {createChatgptAuth,validateChatgptIdToken} from '../desktop/standalone-pwh/chatgpt-auth.mjs';

const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...publicKey.export({format:'jwk'}),kid:'synthetic-key',alg:'RS256',use:'sig'};
const jwt=claims=>{const h=Buffer.from(JSON.stringify({alg:'RS256',kid:jwk.kid})).toString('base64url'),p=Buffer.from(JSON.stringify(claims)).toString('base64url'),data=h+'.'+p;return data+'.'+sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url');};
const fakeCodec={async protect(b){return Buffer.from('encoded:'+Buffer.from(b).toString('base64'));},async unprotect(b){return Buffer.from(b.toString().slice(8),'base64');}};
function serializedLock(){let queue=Promise.resolve();return async(_root,operation)=>{let release;const previous=queue;queue=new Promise(resolve=>release=resolve);await previous;try{return await operation(()=>{});}finally{release();}};}
const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});

test('ChatGPT login validates OAuth state, PKCE, signature and rotating credentials',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-chatgpt-auth-')),store=createCredentialStore({root:dir,codec:fakeCodec,lock:serializedLock()});let url,clock=Date.now(),exchanges=0,refreshes=0,revoked=0;
 const fetchImpl=async(address,options={})=>{
  if(address.endsWith('/.well-known/jwks.json'))return json({keys:[jwk]});
  if(address.endsWith('/.well-known/openid-configuration'))return json({revocation_endpoint:'https://auth.openai.com/api/accounts/oauth/revoke'});
  if(address.endsWith('/oauth/revoke')){assert.equal(options.body.get('token'),'rotated-refresh');revoked++;return new Response(null,{status:200});}
  if(address.endsWith('/oauth/token')){const form=options.body;
   if(form.get('grant_type')==='authorization_code'){exchanges++;const authorize=new URL(url);assert.equal(form.get('client_id'),'oaiapp_synthetic');assert.equal(form.get('redirect_uri'),authorize.searchParams.get('redirect_uri'));assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'),authorize.searchParams.get('code_challenge'));assert.equal(form.get('resource'),'https://api.openai.com/v1');return json({token_type:'Bearer',access_token:'initial-access',refresh_token:'initial-refresh',expires_in:3600,scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',id_token:jwt({iss:'https://auth.openai.com',sub:'test-subject',aud:'oaiapp_synthetic',exp:Math.floor(clock/1000)+3600,nonce:authorize.searchParams.get('nonce'),email:'user@example.test'})});}
   assert.equal(form.get('grant_type'),'refresh_token');assert.equal(form.get('refresh_token'),'initial-refresh');refreshes++;await new Promise(resolve=>setTimeout(resolve,20));return json({token_type:'Bearer',access_token:'rotated-access',refresh_token:'rotated-refresh',expires_in:3600});
  }throw Error('Unexpected mocked endpoint');
 };
 const auth=createChatgptAuth({dataRoot:dir,store,fetchImpl,openBrowser:async value=>{url=value;},now:()=>clock});
 try{
  await auth.begin();const authorize=new URL(url);assert.equal(authorize.origin,'https://auth.openai.com');assert.equal(authorize.searchParams.get('client_id'),'dynamic_agent_client');assert.equal(authorize.searchParams.get('agent_name_hint'),'Pwh Desktop');assert.match(authorize.searchParams.get('ext_agent_host_id'),/^urn:uuid:/);
  const callback=new URL(authorize.searchParams.get('redirect_uri'));callback.searchParams.set('state','wrong');callback.searchParams.set('code','test-code');callback.searchParams.set('client_id','oaiapp_synthetic');assert.equal((await fetch(callback)).status,400);assert.equal(exchanges,0);
  callback.searchParams.set('state',authorize.searchParams.get('state'));assert.equal((await fetch(callback)).status,200);let s=await auth.status();assert.equal(s.accounts.length,1);assert.equal(s.accounts[0].email,'user@example.test');assert.equal(s.accounts[0].connected,true);assert.equal(s.needsWelcome,true);await auth.acknowledgeWelcome();assert.equal((await auth.status()).needsWelcome,false);assert.doesNotMatch(JSON.stringify(s),/initial-access|initial-refresh/);assert.doesNotMatch((await fs.readFile(path.join(dir,'credentials.dat'))).toString(),/initial-access|initial-refresh/);
  assert.equal((await auth.getAccessToken()).accessToken,'initial-access');clock+=3500*1000;const refreshed=await Promise.all([auth.getAccessToken(),auth.getAccessToken()]);assert.equal(refreshes,1,'only one process may rotate the same token');assert.equal(refreshed[0].accessToken,'rotated-access');assert.equal(refreshed[1].accessToken,'rotated-access');
  const out=await auth.signOut();assert.equal(out.remoteRevocationConfirmed,true);assert.equal(revoked,1);s=await auth.status();assert.equal(s.accounts[0].connected,false);assert.equal(s.active,null);await assert.rejects(auth.getAccessToken(),/로그인/);
  await auth.begin(s.accounts[0].id);const returning=new URL(url);assert.equal(returning.searchParams.get('client_id'),'oaiapp_synthetic');assert.equal(returning.searchParams.has('agent_name_hint'),false);assert.equal(returning.searchParams.get('ext_agent_host_id'),authorize.searchParams.get('ext_agent_host_id'));
 }finally{auth.close();await fs.rm(dir,{recursive:true,force:true});}
});

test('ID-token validation rejects wrong identity, nonce, expiry and signature',async()=>{
 const clock=Date.now(),base={iss:'https://auth.openai.com',sub:'test-subject',aud:'oaiapp_test',exp:Math.floor(clock/1000)+300,nonce:'synthetic-nonce'},options={clientId:'oaiapp_test',nonce:'synthetic-nonce',now:()=>clock,fetchImpl:async()=>json({keys:[jwk]})};
 assert.equal((await validateChatgptIdToken(jwt(base),options)).subject,'test-subject');
 for(const claims of [{...base,aud:'other'},{...base,nonce:'bad'},{...base,exp:0},{...base,iss:'https://example.test'}])await assert.rejects(validateChatgptIdToken(jwt(claims),options));
 const parts=jwt(base).split('.');parts[1]=Buffer.from(JSON.stringify({...base,sub:'tampered'})).toString('base64url');await assert.rejects(validateChatgptIdToken(parts.join('.'),options));const malformed=jwt(base).split('.');malformed[2]+='=';await assert.rejects(validateChatgptIdToken(malformed.join('.'),options));
});

test('an expired authorization code retries the issued registration and failed revocation clears local tokens',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-chatgpt-retry-')),store=createCredentialStore({root:dir,codec:fakeCodec,lock:serializedLock()});let url,attempts=0,revocations=0;
 const fetchImpl=async(address,options={})=>{
  if(address.endsWith('/.well-known/jwks.json'))return json({keys:[jwk]});
  if(address.endsWith('/.well-known/openid-configuration'))return json({revocation_endpoint:'https://auth.openai.com/api/accounts/oauth/revoke'});
  if(address.endsWith('/oauth/revoke')){revocations++;return new Response('',{status:503});}
  if(address.endsWith('/oauth/token')){attempts++;if(attempts===1)return new Response(JSON.stringify({error:'invalid_grant'}),{status:400});const authorize=new URL(url);assert.equal(options.body.get('client_id'),'oaiapp_retained');return json({token_type:'Bearer',access_token:'access',refresh_token:'refresh',expires_in:3600,scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',id_token:jwt({iss:'https://auth.openai.com',sub:'subject',aud:'oaiapp_retained',exp:Math.floor(Date.now()/1000)+3600,nonce:authorize.searchParams.get('nonce')})});}
  throw Error('Unexpected mocked endpoint');
 };
 const auth=createChatgptAuth({dataRoot:dir,store,fetchImpl,openBrowser:async value=>{url=value;}});
 try{
  await auth.begin();let authorize=new URL(url),callback=new URL(authorize.searchParams.get('redirect_uri'));callback.searchParams.set('state',authorize.searchParams.get('state'));callback.searchParams.set('code','expired-code');callback.searchParams.set('client_id','oaiapp_retained');assert.equal((await fetch(callback)).status,400);
  await auth.begin();authorize=new URL(url);assert.equal(authorize.searchParams.get('client_id'),'oaiapp_retained');assert.equal(authorize.searchParams.has('agent_name_hint'),false);callback=new URL(authorize.searchParams.get('redirect_uri'));callback.searchParams.set('state',authorize.searchParams.get('state'));callback.searchParams.set('code','new-code');assert.equal((await fetch(callback)).status,200);
  assert.equal((await auth.signOut()).remoteRevocationConfirmed,false);assert.equal(revocations,2);assert.equal((await auth.status()).active,null);await assert.rejects(auth.getAccessToken(),/로그인/);
 }finally{auth.close();await fs.rm(dir,{recursive:true,force:true,maxRetries:5});}
});

test('sign-out disables the account before a slow remote revocation completes',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-chatgpt-signout-')),store=createCredentialStore({root:dir,codec:fakeCodec,lock:serializedLock()});
 await store.transaction(async state=>{state.active='account';state.accounts=[{id:'account',clientId:'client',subject:'subject',refreshToken:'refresh',accessToken:'access',expiresAt:Date.now()+3600000,scopes:['openid','offline_access','resource.invoke','chatgpt.tokens.use.direct']}];return {write:true};});
 let revokeStarted,finishRevoke;const started=new Promise(resolve=>revokeStarted=resolve),gate=new Promise(resolve=>finishRevoke=resolve);
 const auth=createChatgptAuth({dataRoot:dir,store,fetchImpl:async address=>{if(address.endsWith('/.well-known/openid-configuration'))return json({revocation_endpoint:'https://auth.openai.com/api/accounts/oauth/revoke'});if(address.endsWith('/oauth/revoke')){revokeStarted();await gate;return new Response(null,{status:200});}throw Error('unexpected endpoint');}});
 try{const signingOut=auth.signOut();await started;const state=await auth.status();assert.equal(state.active,null);assert.equal(state.accounts[0].connected,false);await assert.rejects(auth.getAccessToken('account'),/로그인/);finishRevoke();assert.equal((await signingOut).remoteRevocationConfirmed,true);}finally{finishRevoke();auth.close();await fs.rm(dir,{recursive:true,force:true,maxRetries:5});}
});
