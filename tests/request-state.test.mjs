import test from 'node:test';
import assert from 'node:assert/strict';
import {sameRequestValue,assertRequestStateCurrent,normalizeRequestContext,queuedRequestContext,sameRequestContext} from '../src/request-state.mjs';
import {randomUUID} from 'node:crypto';
import {editorCapture,editorRequest,editorPoll,editorCompose,editorRewrite} from '../src/editor-session.mjs';
const fresh={schemaVersion:1,format:'hwpx',documentEpoch:1,changeSeq:2,dirty:true,pageCount:97,documentSha256:'a'.repeat(64)};
const presentation={schemaVersion:1,documentEpoch:1,changeSeq:2,format:'hwpx',pageCount:97,dirty:true,documentSha256:'a'.repeat(64)};
const context=state=>({ready:true,kind:'body_text',requestScope:'document',selection:null,objects:[],documentState:state,target:null});

test('unchanged document requests accept fresh and presentation state with different member order',()=>{
 assert.notEqual(JSON.stringify(fresh),JSON.stringify(presentation));
 assert.equal(sameRequestValue(fresh,presentation),true);
 assert.doesNotThrow(()=>assertRequestStateCurrent(context(fresh),context(presentation)));
 assert.doesNotThrow(()=>assertRequestStateCurrent(context(presentation),context(fresh)));
});

test('real document mutations, selection and object changes still reject untracked requests',()=>{
 for(const update of [{documentEpoch:2},{changeSeq:3},{documentSha256:'b'.repeat(64)},{dirty:false},{pageCount:98},{format:'hwp'}])assert.throws(()=>assertRequestStateCurrent(context(fresh),context({...presentation,...update})),/다시/);
 for(const update of [{kind:'cell_text'},{selection:{start:0,end:1}},{objects:[{source:{sec:0,ppi:1,ci:0}}]}])assert.throws(()=>assertRequestStateCurrent(context(fresh),{...context(presentation),...update}),/다시/);
});

test('tracked requests preserve the frozen target across other edits but never across a document epoch',()=>{
 const frozen={...context(fresh),target:{kind:'body_text',epoch:1}};
 assert.doesNotThrow(()=>assertRequestStateCurrent(frozen,{...context({...presentation,changeSeq:3,documentSha256:'b'.repeat(64)}),kind:'cell_text'}));
 assert.throws(()=>assertRequestStateCurrent(frozen,context({...presentation,documentEpoch:2})),/다시/);
 assert.throws(()=>assertRequestStateCurrent(frozen,{ready:false}),/다시/);
});

test('nested object member order is immaterial while array order and missing properties remain significant',()=>{
 assert.equal(sameRequestValue({a:{x:1,y:2},b:[1,2]},{b:[1,2],a:{y:2,x:1}}),true);
 assert.equal(sameRequestValue({b:[1,2]},{b:[2,1]}),false);
 assert.equal(sameRequestValue({a:null},{}),false);
});

test('empty tracking metadata is normalized, while meaningful targets and all document fields are kept',()=>{
 assert.equal(sameRequestContext(context(fresh),normalizeRequestContext(context(presentation))),true);
 const queued=queuedRequestContext(context(presentation));
 assert.equal('target' in queued,false);
 assert.equal(JSON.stringify(queued.documentState),JSON.stringify(fresh));
 assert.equal(sameRequestValue(queued.documentState,presentation),true);
 const tracked={...context(presentation),target:{kind:'body_text',epoch:1}};
 assert.deepEqual(queuedRequestContext(tracked).target,tracked.target);
 assert.equal(sameRequestContext({...context(fresh),other:null},context(fresh)),false);
});

test('capture, ordinary poll, and blank compose preserve integrity across fresh/cache ordering',()=>{
 const sessionId=randomUUID(),captured={...context(fresh),blankDocument:true};
 const request=editorCapture({sessionId,context:captured,note:'초안 작성'});
 const saved=editorRequest(request).context;
 assert.equal('target' in saved,false);
 editorPoll({sessionId,context:normalizeRequestContext({...context(presentation),blankDocument:true})});
 editorCompose({sessionId,expected:saved,paragraphs:[{role:'body',text:'초안'}]});
 const command=editorPoll({sessionId,context:normalizeRequestContext({...context(presentation),blankDocument:true})}).commands[0];
 assert.equal(JSON.stringify(command.expected.documentState),JSON.stringify(fresh));
 assert.equal('target' in command.expected,false);
 editorPoll({sessionId,context:normalizeRequestContext({...context({...presentation,documentSha256:'b'.repeat(64)}),blankDocument:true})});
 assert.throws(()=>editorCompose({sessionId,expected:saved,paragraphs:[{role:'body',text:'초안'}]}),/바뀌/);
});

test('untracked text fallback tolerates member ordering but rejects changed selection text',()=>{
 const sessionId=randomUUID(),selection={start:{sectionIndex:0,paragraphIndex:1,charOffset:0},end:{sectionIndex:0,paragraphIndex:1,charOffset:2}};
 const selected={...context(fresh),requestScope:'selection',selection,selectedText:{known:true,truncated:false,text:'원문'}};
 const request=editorCapture({sessionId,context:selected,note:'다시 쓰기'}),saved=editorRequest(request).context;
 editorPoll({sessionId,context:normalizeRequestContext({...selected,documentState:presentation})});
 assert.equal(editorRewrite({sessionId,expected:saved,replacement:'수정'}).status,'pending');
 editorPoll({sessionId,context:normalizeRequestContext({...selected,documentState:presentation,selectedText:{known:true,truncated:false,text:'변경'}})});
 assert.throws(()=>editorRewrite({sessionId,expected:saved,replacement:'수정'}),/바뀌/);
});
