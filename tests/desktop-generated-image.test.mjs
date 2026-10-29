import test from 'node:test';
import assert from 'node:assert/strict';
import {assertSameImageAccount} from '../desktop/standalone-pwh/generated-image.mjs';
const native={type:'chatgpt',email:'owner@example.invalid'};
const account={active:'one',accounts:[{id:'one',email:'Owner@Example.Invalid',connected:true}]};
test('reuses the connected ChatGPT account for native image generation',()=>assert.equal(assertSameImageAccount(account,native),'one'));
test('refuses to generate using a different native account',()=>assert.throws(()=>assertSameImageAccount(account,{...native,email:'other@example.invalid'})));
test('refuses disconnected, absent or unidentifiable accounts',()=>{
 for(const input of [{active:null,accounts:[]},{...account,accounts:[{...account.accounts[0],connected:false}]},{...account,accounts:[{...account.accounts[0],email:''}]}])assert.throws(()=>assertSameImageAccount(input,native));
 assert.throws(()=>assertSameImageAccount(account,{type:'apiKey',email:native.email}));
});
test('does not select another connected account after the active account changes',()=>{
 const changed={active:'two',accounts:[...account.accounts,{id:'two',email:'different@example.invalid',connected:true}]};assert.throws(()=>assertSameImageAccount(changed,native));
});
