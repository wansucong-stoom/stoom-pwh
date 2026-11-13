import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseCopiedFormat} from '../src/format-copy-options.mjs';

const snapshot={charProps:{bold:true,fontSize:1600},paraProps:{alignment:'center',spacingBefore:500},cellProps:{paddingLeft:700,borderFillId:9,borderLeft:{color:'#ff0000'},fillColor:'#ffeecc',fillType:'solid'}};
test('character, paragraph and combined copy scopes preserve the captured source',()=>{
 for(const scope of ['character','paragraph','both']){
  const state=chooseCopiedFormat(snapshot,{text:scope});
  assert.deepEqual(state.charProps,scope==='paragraph'?{}:snapshot.charProps);
  assert.deepEqual(state.paraProps,scope==='character'?{}:snapshot.paraProps);
  assert.equal(state.cellProps,undefined);assert.equal(state.textToCells,true);
  state.charProps.bold=false;assert.equal(snapshot.charProps.bold,true);
 }
});
test('cell border and background scopes do not leak the shared border-fill reference',()=>{
 const border=chooseCopiedFormat(snapshot,{text:'character',cellBorders:true});
 assert.deepEqual(border.cellProps,{borderLeft:{color:'#ff0000'}});
 const fill=chooseCopiedFormat(snapshot,{text:'character',cellBackground:true});
 assert.deepEqual(fill.cellProps,{fillColor:'#ffeecc',fillType:'solid'});
 const target={fillColor:'#abcdef',...border.cellProps};assert.equal(target.fillColor,'#abcdef');
 border.cellProps.borderLeft.color='#000000';assert.equal(snapshot.cellProps.borderLeft.color,'#ff0000');
});
test('cell-only requires a supported cell scope and excludes text formatting',()=>{
 assert.throws(()=>chooseCopiedFormat(snapshot,{text:'both',target:'cell'}));
 assert.throws(()=>chooseCopiedFormat({charProps:{},paraProps:{}},{text:'both',cellBorders:true}));
 const state=chooseCopiedFormat(snapshot,{text:'both',target:'cell',cellAttributes:true});
 assert.deepEqual(state,{charProps:{},paraProps:{},cellProps:{paddingLeft:700},textToCells:false});
});
