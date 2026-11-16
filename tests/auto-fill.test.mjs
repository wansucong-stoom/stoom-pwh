import test from 'node:test';
import assert from 'node:assert/strict';
import {autoFillLists,validateCustomList} from '../src/auto-fill-lists.mjs';
import {autoFillDirection,inferAutoFillPattern,planAutoFill} from '../src/auto-fill-pattern.mjs';

test('number rules preserve decimal precision, padding, grouping and surrounding text',()=>{
 for(const [seed,index,expected] of [
  [['1','2','3'],28,'29'],[['2','4','6'],5,'12'],[['-1','-2'],3,'-4'],
  [['0.1','0.2','0.3'],9,'1.0'],[['001','002'],10,'011'],
  [['1,000원','2,000원'],9,'10,000원'],[['제1호','제2호'],19,'제20호'],
  [['9007199254740992','9007199254740993'],2,'9007199254740994'],
 ])assert.equal(inferAutoFillPattern(seed).at(index),expected);
});
test('registered lists wrap, reverse and skip in either direction',()=>{
 for(const [seed,index,expected] of [
  [['금요일','토요일'],2,'일요일'],[['토요일','일요일'],2,'월요일'],
  [['March','February'],2,'January'],[['January','March'],2,'May'],
  [['가','나'],2,'다'],[['Z','A'],2,'B'],[['첫째','둘째'],2,'셋째'],
  [['甲子','乙丑'],2,'丙寅'],[['11월','12월'],2,'1월'],
  [['2월','1월'],2,'12월'],[['18','19','20'],3,'21'],
 ])assert.equal(inferAutoFillPattern(seed).at(index),expected);
 assert.equal(inferAutoFillPattern(['입춘','우수']).at(2),'경칩');
 assert.equal(inferAutoFillPattern(['초안','검수']).at(2),'초안');
 const list=validateCustomList({id:'team',label:'업무 순서',values:['접수','검토','완료']});
 assert.equal(inferAutoFillPattern(['검토','완료'],[list]).at(2),'접수');
 assert.equal(autoFillLists.find(l=>l.id==='cycle').values.length,60);
 assert.equal(new Set(autoFillLists.map(l=>l.id)).size,autoFillLists.length);
});
const table=(rows,cols,values={})=>({rowCount:rows,colCount:cols,cells:Array.from({length:rows*cols},(_,index)=>({index,row:Math.floor(index/cols),col:index%cols,rowSpan:1,colSpan:1})),getText:index=>values[index]??''});
test('selection endpoints infer all four directions and fill only selected blanks',()=>{
 const cases=[
  {direction:'down',values:{1:'1',4:'2'},range:{startRow:0,endRow:2,startCol:1,endCol:1},selection:{anchor:{row:0,col:1},focus:{row:2,col:1}},expected:[{cellIndex:7,text:'3'}]},
  {direction:'up',values:{7:'2',10:'1'},range:{startRow:1,endRow:3,startCol:1,endCol:1},selection:{anchor:{row:3,col:1},focus:{row:1,col:1}},expected:[{cellIndex:4,text:'3'}]},
  {direction:'right',values:{3:'1',4:'2'},range:{startRow:1,endRow:1,startCol:0,endCol:2},selection:{anchor:{row:1,col:0},focus:{row:1,col:2}},expected:[{cellIndex:5,text:'3'}]},
  {direction:'left',values:{4:'2',5:'1'},range:{startRow:1,endRow:1,startCol:0,endCol:2},selection:{anchor:{row:1,col:2},focus:{row:1,col:0}},expected:[{cellIndex:3,text:'3'}]},
 ];
 for(const item of cases){
  const result=planAutoFill({...table(4,3,item.values),...item});
  assert.equal(result.direction,item.direction);assert.deepEqual(result.edits,item.expected);
  assert.equal(autoFillDirection(item.range,item.selection),item.direction);
 }
});

test('seed-only selections do nothing and existing values or cells outside the block stay unchanged',()=>{
 const base=table(8,2,{0:'1',2:'2',8:'보존'});
 assert.deepEqual(planAutoFill({...base,range:{startRow:0,endRow:1,startCol:0,endCol:0}}).edits,[]);
 const result=planAutoFill({...base,range:{startRow:0,endRow:5,startCol:0,endCol:0}});
 assert.deepEqual(result.edits,[{cellIndex:4,text:'3'},{cellIndex:6,text:'4'},{cellIndex:10,text:'6'}]);
 // Dragging back from an empty destination toward the seeds keeps the same values.
 const backward=planAutoFill({...base,range:{startRow:0,endRow:3,startCol:0,endCol:0},selection:{anchor:{row:3,col:0},focus:{row:0,col:0}}});
 assert.deepEqual(backward.edits,[{cellIndex:6,text:'4'},{cellIndex:4,text:'3'}]);
});
test('a selected rectangle includes only selected destinations and continues across rows',()=>{
 const result=planAutoFill({...table(5,5,{0:'1',1:'2'}),range:{startRow:0,endRow:4,startCol:0,endCol:4}});
 assert.equal(result.edits.length,23);assert.deepEqual(result.edits.at(-1),{cellIndex:24,text:'25'});
 const limited=planAutoFill({...table(10,3,{4:'10',7:'20'}),range:{startRow:1,endRow:4,startCol:1,endCol:1}});
 assert.deepEqual(limited.edits,[{cellIndex:10,text:'30'},{cellIndex:13,text:'40'}]);
});
test('manual lists fill only selected blanks; missing seeds and merges reject before mutation',()=>{
 const base=table(3,3),range={startRow:0,endRow:2,startCol:0,endCol:0};
 const list={label:'요일',values:['월','화']};
 assert.deepEqual(planAutoFill({...base,range,list}).edits.map(v=>v.text),['월','화','월']);
 assert.deepEqual(planAutoFill({...table(3,3,{3:'보존'}),range,list}).edits,[{cellIndex:0,text:'월'},{cellIndex:6,text:'화'}]);
 assert.throws(()=>planAutoFill({...base,range}),/먼저/);
 base.cells[0].rowSpan=2;
 assert.throws(()=>planAutoFill({...base,range,list}),/병합/);
});
