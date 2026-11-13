import test from 'node:test';import assert from 'node:assert/strict';
import {parseStoreUpdateResult,createStoreUpdateChecker} from '../desktop/standalone-pwh/store-update-check.mjs';
const response=status=>JSON.stringify({schema:1,packageName:'STOOMLab.PwhDesktop',familyName:'STOOMLab.PwhDesktop_g8ykese288rn6',currentVersion:'0.1.36.0',status});
test('only verified production package results advertise available updates',()=>{
  assert.equal(parseStoreUpdateResult(response('available')).available,true);
  assert.equal(parseStoreUpdateResult(response('current')).available,false);
  for(const change of [{packageName:'Other'},{familyName:'STOOMLab.PwhDesktop_other'},{status:'pending'},{currentVersion:'0.1.37'},{currentVersion:'0.1.70000.0'}])assert.throws(()=>parseStoreUpdateResult(JSON.stringify({...JSON.parse(response('available')),...change})));
});
test('preview/non-Windows never invoke Store or MSI and failures are not latest-version claims',async()=>{
  let calls=0;const check=createStoreUpdateChecker({platform:'win32',env:{SystemRoot:'C:\\Windows'},execFileImpl(){calls++;throw Error('Denied');}});
  assert.equal((await check({channel:'msix-preview'})).status,'unavailable');assert.equal(calls,0);
  assert.equal((await check({channel:'microsoft-store'})).status,'unavailable');assert.equal(calls,1);
  const other=createStoreUpdateChecker({platform:'linux',execFileImpl(){throw Error('Must not spawn');}});assert.equal((await other({channel:'microsoft-store'})).available,false);
});
test('Store lookup deduplicates in-flight work, caches success and retries failures',async()=>{
  let at=0,calls=0,complete;const check=createStoreUpdateChecker({platform:'win32',env:{SystemRoot:'C:\\Windows'},now:()=>at,ttlMs:300,retryMs:10,execFileImpl(exe,args,options,callback){
    calls++;assert.ok(exe.endsWith('store-update-check.exe'));assert.deepEqual(args,[]);assert.equal(options.windowsHide,true);assert.equal(options.maxBuffer,65536);assert.equal(options.timeout,20000);complete=callback;
  }});
  const a=check({channel:'microsoft-store'}),b=check({channel:'microsoft-store'});assert.equal(calls,1);complete(null,response('available'));assert.deepEqual(await a,await b);
  const cached=await check({channel:'microsoft-store'});cached.available=false;assert.equal((await check({channel:'microsoft-store'})).available,true);assert.equal(calls,1);
  at=301;const failed=check({channel:'microsoft-store'});complete(Error('Timed out'));assert.equal((await failed).status,'unavailable');
  at=306;await check({channel:'microsoft-store'});assert.equal(calls,2);
  at=312;const again=check({channel:'microsoft-store'});complete(null,response('current'));assert.equal((await again).status,'current');assert.equal(calls,3);
});
