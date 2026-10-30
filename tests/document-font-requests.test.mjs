import test from 'node:test';
import assert from 'node:assert/strict';
import {documentFontRequests} from '../src/document-font-requests.mjs';
import {selectionPageHints} from '../src/selection-page-context.mjs';

test('source font inventory covers weights, slants and substitutions without page rendering',()=>{
 const calls=[],record={hostReference:{key:'same'},family:'resolved'};
 const resolve=(name,style)=>{calls.push([name,style]);return name==='available'?record:null;};
 const info={fontsUsed:['available','missing','available'],fontSubstitutions:[['missing','substitute']],fallbackFont:'fallback'};
 assert.deepEqual(documentFontRequests(info,resolve,r=>r.hostReference.key),[record]);
 for(const name of ['available','missing','substitute','fallback'])for(const weight of [400,700])for(const slant of ['normal','italic'])assert.ok(calls.some(([n,s])=>n===name&&s.weight===weight&&s.slant===slant));
 assert.equal(calls.length,16);
});
test('new source families are picked up on the next edit and malformed inventory uses the compatibility path',()=>{
 const resolve=name=>({family:name,hostReference:{key:name}}),key=r=>r.family;
 assert.deepEqual(documentFontRequests({fontsUsed:['old']},resolve,key).map(r=>r.family),['old']);
 assert.deepEqual(documentFontRequests({fontsUsed:['old','new']},resolve,key).map(r=>r.family),['old','new']);
 for(const info of [null,{}, {fontsUsed:[null]}, {fontsUsed:[],fontSubstitutions:[['only-one']]}])assert.equal(documentFontRequests(info,resolve,key),null);
});
test('cell selection context passes only complete valid endpoint page hints',()=>{
 assert.deepEqual(selectionPageHints({cursorRect:{pageIndex:20}},{cursorRect:{pageIndex:21}}),{startPageHint:20,endPageHint:21});
 for(const [start,end] of [[{},{}],[{cursorRect:{pageIndex:0}},{}],[{cursorRect:{pageIndex:-1}},{cursorRect:{pageIndex:2}}]])assert.equal(selectionPageHints(start,end),undefined);
});
