import {SnapshotCommand} from './engine/command';

// The checkpoint is captured once, before the first live mutation. Keeping only
// offsets cannot restore stored row heights and paragraph line-layout history.
const journals=new WeakMap<any,{state:any;doc:any;generation:number;id:number;cursor:any}>();
export function capturePictureMoveHistory(input:any){
 const state=input.pictureMoveState;if(!state||journals.get(input)?.state===state)return;
 if(journals.has(input))throw Error('Previous picture move was not closed');
 const doc=input.wasm.borrowDocumentHandle(),generation=input.wasm.documentGeneration,cursor=structuredClone(input.cursor.getPosition());
 journals.set(input,{state,doc,generation,id:input.wasm.saveSnapshot(),cursor});
}
export function closePictureMoveHistory(input:any,cancel=false){
 const journal=journals.get(input);if(!journal)return;
 journals.delete(input);
 const {state,doc,generation,id,cursor}=journal;
 if(input.wasm.documentGeneration!==generation||input.wasm.borrowDocumentHandle()!==doc){
  try{doc.discardSnapshot(id);}catch{/* The previous document may already be freed. */}return;
 }
 if(cancel||(!state.totalDeltaH&&!state.totalDeltaV)){
  try{input.wasm.restoreSnapshot(id);}finally{input.wasm.discardSnapshot(id);}
  input.eventBus.emit('document-changed');return;
 }
 const command=SnapshotCommand.fromApplied('pictureMove',id,cursor,structuredClone(input.cursor.getPosition()));
 try{input.executeOperation({kind:'record',command,meta:{domain:'object',refresh:'none',dirtyScope:'object'}});}
 catch(error){try{input.wasm.restoreSnapshot(id);}finally{command.discard(input.wasm);input.eventBus.emit('document-changed');}throw error;}
}
