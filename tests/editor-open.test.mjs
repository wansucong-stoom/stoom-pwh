import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {editorPoll,editorState,editorOpen,editorResult} from '../src/editor-session.mjs';
const context=(dirty=false,seq=0)=>({ready:true,documentState:{documentEpoch:1,changeSeq:seq,dirty,documentSha256:'a'.repeat(64)}});
test('direct document opening requires a capable, clean, unchanged editor and awaits acknowledgement',async()=>{
 const sessionId=randomUUID(),expected=context();editorPoll({sessionId,context:expected,source:'old.hwpx'});
 const register=async()=>({documentId:randomUUID(),source:'new.hwpx',sourceSha256:'b'.repeat(64),name:'new.hwpx'});
 await assert.rejects(editorOpen({sessionId,expected,input:'new.hwpx'},register),/predates/);
 editorPoll({sessionId,context:context(true),capabilities:{documentOpen:true}});
 await assert.rejects(editorOpen({sessionId,expected:context(true),input:'new.hwpx'},register),/Save/);
 editorPoll({sessionId,context:expected,capabilities:{documentOpen:true}});
 await assert.rejects(editorOpen({sessionId,expected:context(false,1),input:'new.hwpx'},register),/changed/);
 const ticket=await editorOpen({sessionId,expected,input:'new.hwpx'},register);
 assert.equal(editorResult(ticket).status,'pending');const command=editorPoll({sessionId,context:expected}).commands[0];assert.equal(command.type,'openDocument');assert.equal(command.document.source,'new.hwpx');
 editorPoll({sessionId,source:'new.hwpx',context:{documentState:{documentEpoch:2,dirty:false}},receipt:{ticketId:ticket.ticketId,ok:true,openedDocument:{source:'new.hwpx'}}});
 assert.equal(editorResult(ticket).status,'applied');assert.equal(editorState({sessionId}).source,'new.hwpx');
});
test('edits made while the requested file is prepared prevent document replacement',async()=>{
 const sessionId=randomUUID(),expected=context();editorPoll({sessionId,context:expected,capabilities:{documentOpen:true}});
 await assert.rejects(editorOpen({sessionId,expected,input:'new.hwpx'},async()=>{editorPoll({sessionId,context:context(true,1)});return {documentId:randomUUID(),source:'new.hwpx'};}),/changed/);
 assert.equal(editorPoll({sessionId,context:context(true,1)}).commands.length,0);
});
