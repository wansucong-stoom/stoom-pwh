import test from 'node:test';
import assert from 'node:assert/strict';
import {steerTurn} from './steer-turn.mjs';

test('steers the active turn exactly once using its expected identifier',async()=>{
 const calls=[],client={request:async(...args)=>{calls.push(args);return {turnId:'turn-a'};}};
 assert.deepEqual(await steerTurn(client,'thread-a','turn-a','누락된 항목을 추가해 줘'),{accepted:true});
 assert.equal(calls.length,1);assert.equal(calls[0][0],'turn/steer');assert.equal(calls[0][1].expectedTurnId,'turn-a');assert.equal(calls[0][1].input[0].text,'누락된 항목을 추가해 줘');
});
test('never reports accepted when no turn exists or the acknowledgement is ambiguous',async()=>{
 let calls=0;const client={request:async()=>{calls++;return {turnId:'other'};}};
 await assert.rejects(steerTurn(client,'thread-a','', '추가 지시'));assert.equal(calls,0);
 await assert.rejects(steerTurn(client,'thread-a','turn-a',''));assert.equal(calls,0);
 await assert.rejects(steerTurn(client,'thread-a','turn-a','추가 지시'));assert.equal(calls,1);
});
