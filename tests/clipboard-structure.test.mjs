import test from 'node:test';
import assert from 'node:assert/strict';
import {cellClipboardRisk,clipboardCellWarning} from '../src/clipboard-structure.mjs';
test('structured clipboard refuses lossy cell insertion but leaves body and ordinary cell text routes available',()=>{
 for(const flag of ['internalControl','hasTables','hasObjects']){
  assert.equal(cellClipboardRisk({inCell:true,[flag]:true}),true);
  assert.equal(cellClipboardRisk({inCell:false,[flag]:true}),false);
 }
 assert.equal(cellClipboardRisk({inCell:true}),false);
 assert.equal(clipboardCellWarning({parentParaIndex:0},'',false),null);
 assert.equal(clipboardCellWarning({cellPath:[{}]},'',true)?.includes('중단'),true);
 assert.equal(clipboardCellWarning({},'<table></table>',true),null);
});
test('an unavailable HTML parser cannot silently downgrade a structured cell paste',()=>{
 const old=globalThis.DOMParser;delete globalThis.DOMParser;
 try{assert.match(clipboardCellWarning({parentParaIndex:0},'<table></table>'),/확인하지 못/);}
 finally{if(old)globalThis.DOMParser=old;}
});
