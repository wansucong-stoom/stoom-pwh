import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppServer} from './host.mjs';

test('only the current native app page can clear or restore its window properties', {skip:!process.env.PWH_RUNTIME_ROOT,timeout:30000},async()=>{
 let ready=0,closing=0;
 const nativeBranding={token:'a'.repeat(32),complete:false,failed:false,ready:()=>ready++,closing:()=>closing++};
 const app=await createAppServer({nativeBranding});
 try{
  const origin=new URL(app.url).origin;
  const first=await(await fetch(app.url)).text();assert.match(first,/<title>Pwh Desktop \[a{32}\]<\/title>/);assert.match(first,/window-branding\?instance=1/);
  await fetch(app.url+'native/window-branding?instance=1');assert.equal(ready,1);
  const second=await(await fetch(app.url)).text();assert.match(second,/window-branding\?instance=2/);
  await fetch(app.url+'native/window-closing?instance=1',{method:'POST',headers:{origin}});assert.equal(closing,0);
  await fetch(app.url+'native/window-closing?instance=2',{method:'POST',headers:{origin}});assert.equal(closing,1);
  await fetch(app.url+'native/window-branding?instance=2');assert.equal(ready,2);
  const forbidden=await fetch(app.url+'native/window-closing?instance=2',{method:'POST',headers:{origin:'https://example.invalid'}});assert.equal(forbidden.status,403);assert.equal(closing,1);
 }finally{await new Promise(resolve=>app.server.close(resolve));}
});
