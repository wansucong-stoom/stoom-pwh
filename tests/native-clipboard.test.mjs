import test from 'node:test';
import assert from 'node:assert/strict';
import {readNativeClipboard} from '../src/native-clipboard.mjs';
test('native clipboard uses a fixed local STA helper and returns content only to the app',async()=>{
 const html='<table><tr><td>한글</td></tr></table>';let invocation;
 const result=await readNativeClipboard({platform:'win32',execute:async(...args)=>{invocation=args;return {stdout:JSON.stringify({html,text:'한글',formats:['HTML Format','UnicodeText']})};}});
 assert.equal(invocation[0],'powershell.exe');assert.ok(invocation[1].includes('-STA'));assert.ok(invocation[1].at(-1).endsWith('read-clipboard.ps1'));assert.equal(invocation[2].windowsHide,true);
 assert.equal(result._meta['pwh/clipboard'].html,html);assert.ok(!JSON.stringify(result.content).includes('한글'));assert.ok(!JSON.stringify(result.structuredContent).includes('<table>'));
 await assert.rejects(readNativeClipboard({platform:'linux'}),/Windows/);
 await assert.rejects(readNativeClipboard({platform:'win32',execute:async()=>({stdout:'{"html":1,"text":""}'})}),/Invalid/);
});
