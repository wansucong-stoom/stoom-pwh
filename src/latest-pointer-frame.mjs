/** Coalesce pointer motion without losing the last sample before mouseup.
 * State identity prevents an old callback from acting on a new gesture. */
export function createLatestPointerFrame({request,cancel,update,isCurrent}) {
 let frame=null,latest=null,last=null,closed=false;
 const current=()=>!closed&&isCurrent();
 const consume=()=>{const point=latest;latest=null;if(point&&current()&&(!last||point.clientX!==last.clientX||point.clientY!==last.clientY)){update(point);last=point;}};
 return {
  schedule(point){if(closed)return;latest=point;if(frame===null)frame=request(()=>{frame=null;consume();});},
  flush(point){if(closed)return;if(frame!==null)cancel(frame);frame=null;if(point)latest=point;consume();closed=true;},
  cancel(){closed=true;if(frame!==null)cancel(frame);frame=null;latest=null;},
 };
}

const gestures=new WeakMap();
export function queuePictureMove(input,event){
 const state=input.pictureMoveState;let gesture=gestures.get(input);
 if(gesture?.state!==state){gesture?.frame.cancel();gesture={state,frame:createLatestPointerFrame({request:requestAnimationFrame,cancel:cancelAnimationFrame,update:point=>input.updatePictureMoveDrag(point),isCurrent:()=>input.isPictureMoveDragging&&input.pictureMoveState===state})};gestures.set(input,gesture);}
 gesture.frame.schedule(event);
}
export function flushPictureMove(input,event){
 const gesture=gestures.get(input);
 if(gesture){gesture.frame.flush(event);gestures.delete(input);}
 else if(event&&input.isPictureMoveDragging)input.updatePictureMoveDrag(event);
}
export function cancelPictureMove(input){gestures.get(input)?.frame.cancel();gestures.delete(input);}
