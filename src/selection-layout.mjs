const parse=value=>typeof value==='string'?JSON.parse(value):value;
const finite=values=>values.every(Number.isFinite);
// Page text layout rebuilds the native render tree. Reuse it only during a
// pointer gesture, never as a persistent document cache: raw WASM mutations do
// not expose a reliable layout revision. The host must invalidate before edits,
// layout/font changes, and end the scope on pointerup/cancel/blur.
export function createBodySelectionLayoutCache({maxPages=32}={}){
 if(!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>1000)throw new RangeError('Selection layout cache maxPages must be between 1 and 1000');
 let active=false,currentDoc=null,pages=new Map();
 const clear=()=>{currentDoc=null;pages=new Map();};
 return {
  begin(){clear();active=true;},
  end(){active=false;clear();},
  invalidate(){clear();},
  read(doc,page,load){
   if(!active)return load();
   if(currentDoc!==doc){clear();currentDoc=doc;}
   if(pages.has(page)){const layout=pages.get(page);pages.delete(page);pages.set(page,layout);return layout;}
   const layout=load();
   // Do not retain malformed or failed native results.
   if(!Array.isArray(layout?.runs))return layout;
   pages.set(page,layout);if(pages.size>maxPages)pages.delete(pages.keys().next().value);
   return layout;
  },
 };
}
// Derive source-aware rectangles from the SAME wrapped text runs the renderer
// uses. Never alter the source text, stored line segments, or document layout.
export function rectanglesFromRuns(runs,pageIndex,sec,startPara,startOffset,endPara,endOffset){
 const rects=[],coverage=new Map();
 for(const run of runs){
  if(run.secIdx!==sec||!Number.isInteger(run.paraIdx)||run.paraIdx<startPara||run.paraIdx>endPara||run.parentParaIdx!=null||run.cellPath?.length||run.headerFooter||run.noteRef)continue;
  const p=run.paraIdx,text=run.text;if(typeof text!=='string'||!text.length||!Number.isInteger(run.charStart)||run.charStart<0||!Array.isArray(run.charX))continue;
  let boundaries;
  if(run.charX.length===text.length+1)boundaries=Array.from({length:text.length+1},(_,i)=>i);
  else{boundaries=[0];for(const char of text)boundaries.push(boundaries.at(-1)+char.length);if(boundaries.length!==run.charX.length)continue;}
  const from=Math.max(run.charStart,p===startPara?startOffset:0),to=Math.min(run.charStart+text.length,p===endPara?endOffset:Infinity);
  if(to<=from)continue;
  const left=boundaries.indexOf(from-run.charStart),right=boundaries.indexOf(to-run.charStart);
  if(left<0||right<0||!finite([run.x,run.y,run.h,run.charX[left],run.charX[right]])||run.h<=0)continue;
  const x1=run.x+run.charX[left],x2=run.x+run.charX[right];
  rects.push({pageIndex,x:Math.min(x1,x2),y:run.y,width:Math.abs(x2-x1),height:run.h});
  const intervals=coverage.get(p)||[];intervals.push([from,to]);coverage.set(p,intervals);
 }
 return {rects,coverage};
}
function covers(intervals,start,end){
 let next=start;for(const [from,to]of intervals.sort((a,b)=>a[0]-b[0])){if(from>next)return false;next=Math.max(next,to);if(next>=end)return true;}return next>=end;
}
/** @param {ReturnType<typeof createBodySelectionLayoutCache>|null} [cache] */
export function renderedBodySelectionRects(doc,sec,startPara,startOffset,endPara,endOffset,fallback,cache=null){
 try{
  if(![sec,startPara,startOffset,endPara,endOffset].every(n=>Number.isSafeInteger(n)&&n>=0)||startPara>endPara||endPara-startPara>4096||typeof doc.getPageTextLayout!=='function')return fallback;
  const count=doc.pageCount();if(!Number.isSafeInteger(count)||count<1||count>1000)return fallback;
  const bounds=new Map(),texts=new Map();let chars=0;
  for(let p=startPara;p<=endPara;p++){
   const length=doc.getParagraphLength(sec,p),from=p===startPara?startOffset:0,to=p===endPara?endOffset:length;
   if(!Number.isInteger(length)||from>to||to>length)return fallback;chars+=to-from;if(chars>1000000)return fallback;
   if(typeof doc.getControlTextPositions==='function'&&parse(doc.getControlTextPositions(sec,p))?.length)return fallback;
   bounds.set(p,[from,to]);if(typeof doc.getTextRange==='function')texts.set(p,doc.getTextRange(sec,p,0,length));
  }
  if(!chars)return fallback;
  const pages=fallback.map(r=>r.pageIndex).filter(Number.isInteger);
  const first=pages.length?Math.min(...pages):parse(doc.getCursorRect(sec,startPara,startOffset)).pageIndex;
  if(!Number.isInteger(first)||first<0||first>=count)return fallback;
  const rects=[],coverage=new Map();let runsSeen=0;
  const complete=()=>[...bounds].every(([p,[from,to]])=>from===to||covers(coverage.get(p)||[],from,to));
  for(let page=first;page<count;page++){
   const load=()=>parse(doc.getPageTextLayout(page));
   const layout=cache?cache.read(doc,page,load):load();if(!Array.isArray(layout?.runs))return fallback;
   runsSeen+=layout.runs.length;if(runsSeen>200000)return fallback;
   const sourceRuns=layout.runs.filter(run=>!texts.has(run.paraIdx)||typeof run.text==='string'&&texts.get(run.paraIdx).slice(run.charStart,run.charStart+run.text.length)===run.text);
   const result=rectanglesFromRuns(sourceRuns,page,sec,startPara,startOffset,endPara,endOffset);rects.push(...result.rects);
   for(const [p,intervals]of result.coverage){const old=coverage.get(p)||[];old.push(...intervals);coverage.set(p,old);}
   if(complete())return rects.filter(r=>r.width>0);
  }
  // Source metadata may omit objects/fields. Do not guess their source spans.
  return fallback;
 }catch{return fallback;}
}
