import test from 'node:test';
import assert from 'node:assert/strict';
import {preserveFillEditIntent,discardUneditedDialogValues} from '../src/format-property-changes.mjs';

test('a normalized unsupported pattern does not turn a spacing-only edit into a border/fill edit',()=>{
  const ui=['none','#ffffff','#000000',''];
  assert.deepEqual(preserveFillEditIntent({spacingBefore:2000,patternType:-1,fillType:'none'},ui,[...ui],{borderFillId:2}),{spacingBefore:2000});
});
test('explicit fill and one-sided border edits retain their original border-fill base',()=>{
  const original={borderFillId:7};
  assert.deepEqual(preserveFillEditIntent({fillType:'solid',fillColor:'#aabbcc'},['none','#ffffff','#000000',''],['solid','#aabbcc','#000000',''],original),{fillType:'solid',fillColor:'#aabbcc',borderFillId:7});
  assert.deepEqual(preserveFillEditIntent({borderLeft:{type:0}},['solid'],['solid'],original),{borderLeft:{type:0},borderFillId:7});
});
test('changing only fill color supplies the fill kind without changing an untouched pattern',()=>{
  assert.deepEqual(preserveFillEditIntent({fillColor:'#abcdef',patternType:-1},['solid','#ffffff','#112233',''],['solid','#abcdef','#112233',''],{borderFillId:3}),{fillColor:'#abcdef',fillType:'solid',borderFillId:3});
});
test('accepting rounded display values preserves untouched stored dimensions',()=>{
  assert.deepEqual(discardUneditedDialogValues({marginLeft:580,borderSpacing:[0,1,0,2],spacingBefore:4000},{marginLeft:580,borderSpacing:[0,1,0,2]}),{spacingBefore:4000});
});
