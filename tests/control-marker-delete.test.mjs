import test from 'node:test';
import assert from 'node:assert/strict';
import {tryDeletePageHiding} from '../src/control-marker-delete.mjs';
function harness({show=true,exists=true,selection=false,fail=false}={}){
 const calls=[];const position={sectionIndex:1,paragraphIndex:2,charOffset:7,cursorRect:{x:20}};
 const input={wasm:{getShowControlCodes:()=>show,getPageHide:()=>JSON.stringify({exists}),getParagraphCount:()=>3,getControlTextPositions:()=>[0,7],getControls:()=>[{list:0,para:5,controlIndex:0,ctrlId:'secd'},{list:0,para:5,controlIndex:1,ctrlId:'pghd'}],deleteControlAt:(...args)=>{calls.push(args);if(fail)throw Error('rejected');}},cursor:{isInHeaderFooter:()=>false,isInFootnote:()=>false,isInTextBox:()=>false,hasSelection:()=>selection},executeOperation:operation=>{calls.push(operation.operationType);return operation.operation(input.wasm);}};
 return {input,position,calls};
}
test('Delete owns only the visible hiding control at its exact text boundary across sections',()=>{
 const {input,position,calls}=harness();
 assert.equal(tryDeletePageHiding(input,{...position,charOffset:6},false),false);assert.deepEqual(calls,[]);
 assert.equal(tryDeletePageHiding(input,position,false),true);assert.deepEqual(calls,['deletePageHiding',[0,5,1]]);
});
test('ordinary Delete, cell editing and existing selections keep their original path',()=>{
 for(const options of [{show:false},{exists:false},{selection:true}]){const {input,position,calls}=harness(options);assert.equal(tryDeletePageHiding(input,position,false),false);assert.deepEqual(calls,[]);}
 const {input,position,calls}=harness();assert.equal(tryDeletePageHiding(input,position,true),false);assert.deepEqual(calls,[]);
});
test('a rejected owned control deletion does not fall through to deleting user text',()=>{
 const {input,position,calls}=harness({fail:true});const warn=console.warn;console.warn=()=>{};
 try{assert.equal(tryDeletePageHiding(input,position,false),true);assert.deepEqual(calls,['deletePageHiding',[0,5,1]]);}finally{console.warn=warn;}
});
