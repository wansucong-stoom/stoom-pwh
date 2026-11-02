// Audit actual text paint at the same 150 dpi / 2 px edge budget as the PDF gate.
// Font rectangles are used only to size the diagnostic surface, never as ink.
import {LAYOUT_GATE_POLICY} from '../../scripts/check-layout-gates.mjs';

export async function visibleSvgInk(page,source){
 const {dpi,tolerancePixels}=LAYOUT_GATE_POLICY;
 await page.setContent(source);
 const geometry=await page.evaluate(async dpi=>{
  await document.fonts.ready;
  if(Math.abs(devicePixelRatio-dpi/96)>1e-8)throw Error('Ink audit requires the fixed gate resolution');
  document.body.style.cssText='margin:0;background:transparent';
  const svg=document.querySelector('svg');if(!svg)throw Error('SVG missing');
  const texts=[...svg.querySelectorAll('text')],bounds=svg.getBoundingClientRect();
  const box=(node,matrix=node.getScreenCTM())=>{
   const b=node.getBBox(),points=[[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(matrix));
   return {left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))};
  };
  const boxes=texts.map(node=>box(node));
  const left=Math.ceil(Math.max(0,bounds.left-Math.min(bounds.left,...boxes.map(b=>b.left))))+16;
  const top=Math.ceil(Math.max(0,bounds.top-Math.min(bounds.top,...boxes.map(b=>b.top))))+16;
  const right=Math.ceil(Math.max(0,Math.max(bounds.right,...boxes.map(b=>b.right))-bounds.right))+16;
  const bottom=Math.ceil(Math.max(0,Math.max(bounds.bottom,...boxes.map(b=>b.bottom))-bounds.bottom))+16;
  const surface=document.createElement('div');surface.id='pwh-ink-surface';
  surface.style.cssText=`position:relative;width:${left+bounds.width+right}px;height:${top+bounds.height+bottom}px;background:transparent`;
  svg.before(surface);surface.append(svg);svg.style.position='absolute';svg.style.left=left+'px';svg.style.top=top+'px';
  svg.style.width=bounds.width+'px';svg.style.height=bounds.height+'px';svg.style.overflow='hidden';svg.style.background='transparent';
  if(surface.getBoundingClientRect().width*devicePixelRatio>4096||surface.getBoundingClientRect().height*devicePixelRatio>4096)throw Error('Diagnostic ink surface exceeds limit');
  const intersect=(a,b)=>({left:Math.max(a.left,b.left),right:Math.min(a.right,b.right),top:Math.max(a.top,b.top),bottom:Math.min(a.bottom,b.bottom)});
  const viewport=svg.getBoundingClientRect(),limitations=[],runs=[];
  for(const text of texts){
   let clip={left:viewport.left,right:viewport.right,top:viewport.top,bottom:viewport.bottom},hiddenByStyle=false;
   for(let a=text;a;a=a===svg?null:a.parentElement){
    const style=getComputedStyle(a);if(style.display==='none'||style.visibility==='hidden'||style.opacity==='0')hiddenByStyle=true;
    if(style.filter!=='none'||style.maskImage!=='none')limitations.push('filtered-or-masked-text');
    const value=a.getAttribute('clip-path');
    if(!value){if(style.clipPath!=='none')limitations.push('css-clip');continue;}
    const id=value.match(/^url\(#([^)]+)\)$/)?.[1],path=id&&document.getElementById(id);
    if(!path||path.getAttribute('clipPathUnits')==='objectBoundingBox'||path.children.length!==1||path.children[0].tagName!=='rect'){limitations.push('unsupported-clip');continue;}
    const shape=path.children[0],matrix=a.getScreenCTM();
    if(path.getAttribute('transform')||shape.getAttribute('transform')||Math.abs(matrix.b)>1e-8||Math.abs(matrix.c)>1e-8){limitations.push('transformed-clip');continue;}
    clip=intersect(clip,box(shape,matrix));
   }
   runs.push({text:text.textContent||'',clip,hiddenByStyle});
  }
  for(const node of svg.querySelectorAll('rect,path,line,polygon,polyline,circle,ellipse,image,use'))if(!node.closest('defs'))node.remove();
  const clips=[...svg.querySelectorAll('[clip-path]')].map(node=>({node,value:node.getAttribute('clip-path')}));
  window.__pwhInkAudit={svg,texts,clips};
  for(const text of texts)text.style.visibility='hidden';
  const surfaceBox=surface.getBoundingClientRect();
  return {runs,limitations:[...new Set(limitations)],scale:devicePixelRatio,origin:{left:surfaceBox.left,top:surfaceBox.top}};
 },dpi);
 const records=[];
 for(let index=0;index<geometry.runs.length;index++){
  const run=geometry.runs[index];
  if(run.hiddenByStyle){records.push({hidden:true,deepClippedPixels:0,lostPixels:0,maxDepth:0});continue;}
  await page.evaluate(index=>{
   const state=window.__pwhInkAudit;
   for(let n=0;n<state.texts.length;n++)state.texts[n].style.visibility=n===index?'visible':'hidden';
   for(const clip of state.clips)clip.node.setAttribute('clip-path',clip.value);
   state.svg.style.overflow='hidden';
  },index);
  const clipped=await page.locator('#pwh-ink-surface').screenshot({omitBackground:true,scale:'device'});
  await page.evaluate(()=>{
   const state=window.__pwhInkAudit;for(const clip of state.clips)clip.node.removeAttribute('clip-path');
   state.svg.style.overflow='visible';
  });
  const unclipped=await page.locator('#pwh-ink-surface').screenshot({omitBackground:true,scale:'device'});
  const record=await page.evaluate(async({images,run,origin,scale,tolerancePixels})=>{
   const decode=async data=>{
    const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0)),bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
    return {width:canvas.width,height:canvas.height,data:ctx.getImageData(0,0,canvas.width,canvas.height).data};
   };
   const [actual,reference]=await Promise.all(images.map(decode));
   if(actual.width!==reference.width||actual.height!==reference.height)throw Error('Ink captures changed scale');
   let actualAlpha=0,referenceAlpha=0,lostPixels=0,deepClippedPixels=0,maxDepth=0;
   for(let i=3;i<reference.data.length;i+=4){
    actualAlpha+=actual.data[i];referenceAlpha+=reference.data[i];
    if(reference.data[i]<=actual.data[i])continue;
    lostPixels++;
    const pixel=(i-3)/4,x=(pixel%reference.width+.5)/scale+origin.left,y=(Math.floor(pixel/reference.width)+.5)/scale+origin.top;
    const depth=Math.max(0,run.clip.left-x,x-run.clip.right,run.clip.top-y,y-run.clip.bottom)*scale;
    maxDepth=Math.max(maxDepth,depth);if(depth>tolerancePixels+1e-8)deepClippedPixels++;
   }
   return {hidden:run.text.trim().length>0&&(referenceAlpha===0||actualAlpha===0),lostPixels,deepClippedPixels,maxDepth};
  },{images:[clipped.toString('base64'),unclipped.toString('base64')],run,origin:geometry.origin,scale:geometry.scale,tolerancePixels});
  records.push(record);
 }
 return {text:geometry.runs.filter((run,index)=>!records[index].hidden).map(run=>run.text).join(''),total:records.length,
  hidden:records.filter(r=>r.hidden).length,partial:records.filter(r=>!r.hidden&&r.deepClippedPixels>0).length,
  edgeClippedRuns:records.filter(r=>!r.hidden&&r.lostPixels>0&&r.deepClippedPixels===0).length,
  lostInkPixels:records.reduce((n,r)=>n+r.lostPixels,0),deepClippedInkPixels:records.reduce((n,r)=>n+r.deepClippedPixels,0),
  maxClipDepthPixels:Math.max(0,...records.map(r=>r.maxDepth)),dpi,tolerancePixels,limitations:geometry.limitations};
}
