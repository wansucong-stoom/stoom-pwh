import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedTableFragment,tableFromClipboardText} from '../src/table-clipboard.mjs';
const cell=(row,col,text,rowSpan=1,colSpan=1)=>({geometry:{row,col,rowSpan,colSpan},properties:{width:12000},paragraphs:[{text,length:Array.from(text).length,format:{alignment:'left'},formats:[{offset:0,format:{fontFamily:'맑은 고딕',fontSize:1000,textColor:'#000000'}}]}]});
test('copying one cell or a row excludes every unselected cell and normalizes coordinates',()=>{
 const snapshot={cells:[cell(0,0,'동물',1,3),cell(1,0,'말'),cell(1,1,'소'),cell(1,2,'양'),cell(2,0,'개'),cell(2,1,'고양이'),cell(2,2,'토끼')]};
 const one=selectedTableFragment(snapshot,[2]);assert.equal(one.text,'소');assert.equal(one.spec.cells.length,1);assert.equal(one.spec.columns,1);assert.ok(!one.html.includes('고양이'));assert.deepEqual(one.spec.cells[0],{row:0,column:0,rowSpan:1,columnSpan:1,paragraphs:['소']});
 const row=selectedTableFragment(snapshot,[1,2,3]);assert.equal(row.text,'말\t소\t양');assert.equal(row.spec.rows,1);assert.equal(row.spec.columns,3);
 const merged=selectedTableFragment(snapshot,[0]);assert.equal(merged.spec.cells[0].columnSpan,3);assert.equal(merged.spec.cells.length,1);
 assert.throws(()=>selectedTableFragment(snapshot,[1,3]),/missing/);assert.throws(()=>selectedTableFragment(snapshot,[0,0]),/Select/);
});
test('table TSV preserves empty cells and rejects ragged rows instead of guessing merges',()=>{
 const table=tableFromClipboardText('말\t\t소\r\n개\t양\t토끼\r\n');assert.equal(table.rows,2);assert.equal(table.columns,3);assert.equal(table.cells[1].paragraphs[0],'');
 assert.equal(tableFromClipboardText('제목\n말\t소'),null);assert.equal(tableFromClipboardText('일반 문장'),null);
});
