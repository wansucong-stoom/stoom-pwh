import test from'node:test';import assert from'node:assert/strict';
import{hostFontSettingsState,detectHostFontSettings}from'../src/host-font-settings.mjs';
test('settings read the renderer catalog without requesting browser access or font bytes',async()=>{
 let ready=0,reads=0;const source={active:true,lastError:null,references:()=>['regular','bold'],ready:async()=>{ready++;},read:()=>{reads++;throw Error('No byte transfer expected');}};
 const getFonts=options=>options.includeRegistered?['바탕','Custom']:['Custom'];
 assert.deepEqual(await detectHostFontSettings(source,getFonts,{force:true}),['Custom']);
 assert.deepEqual(await detectHostFontSettings(source,getFonts,{includeRegistered:true}),['바탕','Custom']);
 assert.equal(hostFontSettingsState(source).count,2);assert.equal(hostFontSettingsState(source).stored,false);assert.equal(hostFontSettingsState(source).complete,false);assert.equal(ready,2);assert.equal(reads,0);
});
test('an empty active host catalog is a valid result and does not fall through to browser detection',async()=>{
 const source={active:true,lastError:null,references:()=>[],ready:async()=>{}};
 assert.deepEqual(await detectHostFontSettings(source,()=>[]),[]);assert.equal(hostFontSettingsState(source).count,0);
});
test('host failure remains a host error and a disconnected provider restores browser routing',async()=>{
 const source={active:true,lastError:'catalog unavailable',references:()=>[],ready:async()=>{}};
 await assert.rejects(detectHostFontSettings(source,()=>{throw Error('Stale catalog used');}),/앱의 시스템 글꼴/);
 assert.equal(hostFontSettingsState(source).lastError,'catalog unavailable');source.active=false;
 assert.equal(await detectHostFontSettings(source,()=>{throw Error('Unexpected host lookup');}),null);assert.equal(hostFontSettingsState(source),null);
});
