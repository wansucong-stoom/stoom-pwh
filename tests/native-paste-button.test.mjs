import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import {installPasteBridge} from '../desktop/standalone-pwh/paste-bridge.mjs';
const {installNativePaste}=createRequire(import.meta.url)('../desktop/standalone-pwh/native-paste.cjs');
const url='http://127.0.0.1:1234/'+('a'.repeat(48))+'/editor';
test('the shipped editor frame declares the native frame name',async()=>{
 const html=await fs.readFile(new URL('../desktop/standalone-pwh/app.html',import.meta.url),'utf8');
 assert.match(html,/<iframe\b[^>]*\bid="editor"[^>]*\bname="editor"/);
});
function native(){
 let handler,pastes=0,focused=true;const frame={name:'editor',url,executeJavaScript:async()=>true};
 const contents={getURL:()=>url.replace(/editor$/,''),mainFrame:{framesInSubtree:[frame]},focusedFrame:frame,paste:()=>pastes++};
 const win={webContents:contents,isFocused:()=>focused,isDestroyed:()=>false};installNativePaste({handle:(_name,callback)=>{handler=callback;}},()=>win,()=>true);
 return {frame,contents,run:()=>handler({sender:contents,senderFrame:contents.mainFrame},{url,expected:{documentEpoch:1,changeSeq:2,cursor:{},selection:null}}),blur:()=>{focused=false;},get pastes(){return pastes;}};
}
test('the toolbar sends the native editing command only to the same focused editor',async()=>{
 const h=native();assert.deepEqual(await h.run(),{ok:true});assert.equal(h.pastes,1);
 h.contents.focusedFrame=null;await assert.rejects(h.run());assert.equal(h.pastes,1);
});
test('focus changes during the asynchronous state check cancel and reset the request',async()=>{
 const h=native();h.frame.executeJavaScript=async()=>{h.contents.focusedFrame=null;return true;};await assert.rejects(h.run());assert.equal(h.pastes,0);
 h.contents.focusedFrame=h.frame;h.frame.executeJavaScript=async()=>true;await h.run();assert.equal(h.pastes,1);
});
test('native query errors and duplicate requests leave no permanent busy flag',async()=>{
 const h=native();h.frame.executeJavaScript=async()=>{throw Error('closed');};await assert.rejects(h.run());
 let resolve;h.frame.executeJavaScript=()=>new Promise(r=>{resolve=r;});const first=h.run();await assert.rejects(h.run());resolve(true);await first;
 h.frame.executeJavaScript=async()=>true;await h.run();assert.equal(h.pastes,2);
});
test('the editor bridge consumes button requests, reports errors and permits retry without reading the clipboard',async()=>{
 const editor=new EventTarget();editor.location={href:url};editor.pwhEditor={context:()=>({ready:true,documentState:{documentEpoch:1,changeSeq:2},cursor:{charOffset:3},selection:null})};
 const messages=[],calls=[];let reject=true;installPasteBridge(editor,async request=>{calls.push(request);if(reject)throw Error('cancelled');},message=>messages.push(message));
 const request=()=>editor.dispatchEvent(new Event('pwh-native-paste-request',{cancelable:true}));
 assert.equal(request(),false);request();await new Promise(setImmediate);assert.equal(calls.length,1);assert.deepEqual(messages,['cancelled']);
 reject=false;request();await new Promise(setImmediate);assert.equal(calls.length,2);assert.equal(calls[0].expected.cursor.charOffset,3);
});
