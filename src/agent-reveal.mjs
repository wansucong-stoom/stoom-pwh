// Transient presentation only: never changes the document, selection or caret.
export function createAgentReveal({wasm,getCanvasView,document,window}){
 let generation=0,marker=null,timer=null;
 const clear=()=>{generation++;if(timer)window.clearTimeout(timer);timer=null;marker?.remove();marker=null;};
 const container=document.getElementById('scroll-container');
 for(const event of ['pointerdown','wheel','touchstart','keydown'])container?.addEventListener(event,clear,{passive:true});
 function show(positions){
  clear();const token=generation,content=document.getElementById('scroll-content'),canvas=getCanvasView?.(),virtual=canvas?.getVirtualScroll?.(),viewport=canvas?.getViewportManager?.();
  if(!container||!content||!virtual||!viewport||!Array.isArray(positions)||!positions.length)return;
  const targets=positions.slice(0,6);let index=0;
  function next(){
   if(token!==generation||index>=targets.length)return;
   const p=targets[index++];let rect;
   try{rect=p.cellPath?.length?wasm.getCursorRectByPath(p.sectionIndex,p.parentParaIndex,JSON.stringify(p.cellPath),p.charOffset):wasm.getCursorRect(p.sectionIndex,p.paragraphIndex,p.charOffset);}catch{next();return;}
   if(!rect||rect.cellOverflowed||!Number.isInteger(rect.pageIndex)||![rect.x,rect.y,rect.height].every(Number.isFinite)){next();return;}
   const zoom=viewport.getZoom(),left=virtual.getPageLeftResolved(rect.pageIndex,content.clientWidth)+rect.x*zoom,top=virtual.getPageOffset(rect.pageIndex)+rect.y*zoom;
   if(![zoom,left,top].every(Number.isFinite)||zoom<=0){next();return;}
   marker?.remove();marker=document.createElement('div');marker.className='pwh-agent-change-marker';marker.setAttribute('aria-hidden','true');
   Object.assign(marker.style,{position:'absolute',left:`${Math.max(0,left-7)}px`,top:`${Math.max(0,top-3)}px`,width:'14px',height:`${Math.max(20,rect.height*zoom+6)}px`,borderRadius:'7px',border:'2px solid #327f9c',background:'rgba(75,159,187,.24)',boxShadow:'0 0 0 5px rgba(75,159,187,.12)',pointerEvents:'none',zIndex:'90'});
   content.append(marker);container.scrollTo({top:Math.max(0,top-container.clientHeight*.38),behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
   if(!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)marker.animate?.([{opacity:.25,transform:'scale(1.45)'},{opacity:1,transform:'scale(1)'},{opacity:.35,transform:'scale(1.15)'}],{duration:1150,iterations:1});
   timer=window.setTimeout(()=>{marker?.remove();marker=null;next();},1400);
  }
  next();
 }
 return {show,clear};
}
