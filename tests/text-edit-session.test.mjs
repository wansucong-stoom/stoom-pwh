import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {editorPoll,editorTextSearch,editorTextEdit,editorResult} from '../src/editor-session.mjs';

test('text tools require support and only acknowledge actual editor receipts',()=>{
 const sessionId=randomUUID(),context={ready:true,documentState:{documentEpoch:2,changeSeq:0,documentSha256:'a'}};
 editorPoll({sessionId,context});assert.throws(()=>editorTextSearch({sessionId,expected:context,query:'original'}),/새 편집기/);
 editorPoll({sessionId,context,capabilities:{textEdit:true}});
 const search=editorTextSearch({sessionId,expected:context,query:'original',limit:10});
 assert.equal(editorPoll({sessionId,context}).commands[0].type,'textSearch');assert.equal(editorResult(search).status,'pending');
 const textSearch={searchId:'plan',hits:[{id:'0',source:{section:0,paragraph:1,cellPath:[{controlIndex:0,cellIndex:2,cellParaIndex:3}]}}]};
 editorPoll({sessionId,context,receipt:{ticketId:search.ticketId,ok:true,textSearch}});
 assert.deepEqual(editorResult(search).result.textSearch,textSearch);
 const edits=[{searchId:'plan',matchId:'0',replacement:'changed'}],ticket=editorTextEdit({sessionId,expected:context,edits});edits[0].replacement='mutated after queue';
 const queued=editorPoll({sessionId,context}).commands[0];assert.equal(queued.type,'textEdit');assert.equal(queued.edits[0].replacement,'changed');
 editorPoll({sessionId,context,receipt:{ticketId:ticket.ticketId,ok:false,error:'stale'}});assert.equal(editorResult(ticket).status,'rejected');
 assert.throws(()=>editorTextEdit({sessionId,expected:{documentState:{documentEpoch:1}},edits}),/다시 열렸/);
 assert.throws(()=>editorTextEdit({sessionId,expected:context,edits:[{searchId:'plan',matchId:'0',replacement:'line\nbreak'}]}),/텍스트/);
});
