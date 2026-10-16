import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {editorPoll,editorState,editorRewrite,editorResult,editorCapture,editorRequest} from '../src/editor-session.mjs';
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
test('right click request freezes exact selection and note independently of later polling',()=>{
 const sessionId=randomUUID(),context={documentState:{documentEpoch:1,changeSeq:0},selection:{start:2,end:5},selectedText:{text:'기존 문장',known:true,truncated:false}};
 const request=editorCapture({sessionId,source:'fixture.hwpx',context,note:'간결하게 다시 써줘'});
 context.selectedText.text='다른 선택';editorPoll({sessionId,context});
 const captured=editorRequest(request);assert.equal(captured.context.selectedText.text,'기존 문장');assert.equal(captured.note,'간결하게 다시 써줘');
 captured.note='변조';assert.equal(editorRequest(request).note,'간결하게 다시 써줘');
 assert.throws(()=>editorRewrite({sessionId,expected:editorRequest(request).context,replacement:'수정'}),/바뀌/);
});
test('object requests preserve exact object references without accepting a text rewrite',()=>{
 const sessionId=randomUUID(),context={ready:true,kind:'object',documentState:{documentEpoch:1,changeSeq:2,documentSha256:'c'.repeat(64)},selection:null,selectedText:{known:false,text:''},objects:[{source:{type:'image',sec:0,ppi:7,ci:0},properties:{width:200}}]};
 const request=editorCapture({sessionId,context,note:'그림을 바꿔 주세요'});
 context.objects[0].source.ci=3;
 assert.equal(editorRequest(request).context.objects[0].source.ci,0);
 assert.throws(()=>editorRewrite({sessionId,expected:editorState({sessionId}).context,replacement:'text'}),/텍스트/);
 assert.throws(()=>editorCapture({sessionId,context:{...context,objects:[{source:{type:'image',sec:-1,ppi:0,ci:0}}]},note:'수정'}),/선택/);
});
import {editorCompose} from '../src/editor-session.mjs';
test('blank document requests and composition queue preserve snapshot and reject later edits',()=>{
 const sessionId=randomUUID(),context={ready:true,blankDocument:true,documentState:{documentEpoch:1,changeSeq:0,documentSha256:'e'.repeat(64)},selection:null,selectedText:{known:true,text:''}};
 const request=editorCapture({sessionId,context,note:'사업계획서를 작성해 주세요'});
 assert.equal(editorRequest(request).context.blankDocument,true);
 const paragraphs=[{role:'title',text:'계획서'},{role:'body',text:'본문'}];
 const ticket=editorCompose({sessionId,expected:context,paragraphs});paragraphs[0].text='later';
 const cmd=editorPoll({sessionId,context}).commands[0];assert.equal(cmd.type,'compose');assert.equal(cmd.paragraphs[0].text,'계획서');
 const changed={...context,blankDocument:false};editorPoll({sessionId,context:changed});
 assert.throws(()=>editorCompose({sessionId,expected:context,paragraphs}),/빈 문서/);
 editorPoll({sessionId,context:changed,receipt:{ticketId:ticket.ticketId,ok:false,error:'changed'}});assert.equal(editorResult(ticket).status,'rejected');
});
import {editorLayout} from '../src/editor-session.mjs';
test('document-wide request works without selection and layout rejects stale context',()=>{
 const sessionId=randomUUID(),context={ready:true,requestScope:'document',blankDocument:false,selection:null,objects:[],documentState:{documentEpoch:1,changeSeq:3,documentSha256:'f'.repeat(64)}};
 const request=editorCapture({sessionId,context,note:'B4 가로, 좌우 여백 20mm'});assert.equal(editorRequest(request).context.requestScope,'document');
 const patch={paper:'B4',orientation:'landscape',marginsMm:{left:20,right:20}};
 const ticket=editorLayout({sessionId,expected:context,patch});patch.marginsMm.left=1;
 const command=editorPoll({sessionId,context}).commands[0];assert.equal(command.type,'layout');assert.equal(command.patch.marginsMm.left,20);
 assert.throws(()=>editorLayout({sessionId,expected:context,patch:{marginsMm:{left:-1}}}),/여백/);
 editorPoll({sessionId,context:{...context,documentState:{...context.documentState,changeSeq:4}}});assert.throws(()=>editorLayout({sessionId,expected:context,patch}),/바뀌/);assert.equal(editorResult(ticket).status,'pending');
});
