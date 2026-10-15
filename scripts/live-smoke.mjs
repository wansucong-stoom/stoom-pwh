import assert from 'node:assert/strict';
import {readLiveSession,listLiveCommands,applyLiveSession,saveLiveSession} from '../src/live.mjs';

if (process.env.PWH_LIVE_SMOKE !== '1' || !process.env.PWH_LIVE_EXPECT_TEXT)
  throw new Error('Use an isolated editor session; set PWH_LIVE_SMOKE=1 and PWH_LIVE_EXPECT_TEXT to its test marker.');
const marker=process.env.PWH_LIVE_EXPECT_TEXT;
const before=await readLiveSession();
assert.ok(before.text.includes(marker),'현재 세션에 지정한 테스트 표식이 있어야 합니다.');
const commands=await listLiveCommands();
assert.ok(commands.some(c=>c.id==='format:bold'));
const receipt=await applyLiveSession({type:'hwpctrl',calls:[{method:'SetTextFile',args:['공유 편집 검증 | ','UNICODE','']}]},before.state);
const after=await readLiveSession();
assert.match(after.text,/공유 편집 검증/);
assert.ok(after.text.includes(marker),'사용자 미저장 입력을 보존해야 합니다.');
assert.ok(after.state.changeSeq>before.state.changeSeq);
await assert.rejects(applyLiveSession({type:'undo'},before.state),/상태|변경|최신/);
const saved=await saveLiveSession(undefined,after.state);
console.log(JSON.stringify({sameLiveDocument:true,userEditsPreserved:true,staleCommandRejected:true,before:before.state,after:after.state,receipt,saved,availableCommands:commands.length},null,2));
