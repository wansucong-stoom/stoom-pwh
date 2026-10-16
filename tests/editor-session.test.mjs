import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {editorPoll,editorState,editorRewrite,editorResult} from '../src/editor-session.mjs';
test('selected rewrite crosses queue once and only becomes applied after client acknowledgement',()=>{
 const sessionId=randomUUID(),context={documentState:{documentEpoch:1,changeSeq:4,documentSha256:'a'.repeat(64)},selection:{start:1,end:3},selectedText:{text:'선택한 문장'}};
 editorPoll({sessionId,context,source:'fixture.hwpx'});
 const selected=editorState({sessionId});
 assert.throws(()=>editorRewrite({sessionId,expected:{...context,documentState:{...context.documentState,changeSeq:3}},replacement:'다시 쓴 문장'}),/바뀌/);
 const ticket=editorRewrite({sessionId,expected:selected.context,replacement:'다시 쓴 문장'});
 assert.equal(editorResult(ticket).status,'pending');
 const received=editorPoll({sessionId,context});assert.equal(received.commands[0].replacement,'다시 쓴 문장');assert.equal(editorPoll({sessionId,context}).commands.length,0);
 editorPoll({sessionId,context,receipt:{ticketId:ticket.ticketId,ok:true,undoSteps:1}});
 assert.equal(editorResult(ticket).status,'applied');
});
test('client rejection is reported as rejected, never successful',()=>{
 const sessionId=randomUUID(),context={selection:{start:0,end:1},selectedText:{text:'x'}};editorPoll({sessionId,context});const ticket=editorRewrite({sessionId,expected:context,replacement:'y'});editorPoll({sessionId,context,receipt:{ticketId:ticket.ticketId,ok:false,error:'Selection changed'}});assert.equal(editorResult(ticket).status,'rejected');
});
