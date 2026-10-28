// Pixel-derived oracle for engine-generated SVG. No document text is logged.
export async function visibleSvgText(page,svg){
 await page.setContent(svg);
 return page.evaluate(()=>{
  const svg=document.querySelector('svg');if(!svg)throw Error('SVG missing');
  const limits=[];
  const box=(node,matrix=node.getScreenCTM())=>{const b=node.getBBox(),points=[[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(matrix));return {left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))};};
  const intersect=(a,b)=>({left:Math.max(a.left,b.left),right:Math.min(a.right,b.right),top:Math.max(a.top,b.top),bottom:Math.min(a.bottom,b.bottom)});
  const viewport=svg.getBoundingClientRect();let visible='',hidden=0,partial=0,total=0;
  for(const text of svg.querySelectorAll('text')){
   total++;const glyph=box(text);let clip={left:viewport.left,right:viewport.right,top:viewport.top,bottom:viewport.bottom};
   for(let ancestor=text;ancestor&&ancestor!==svg;ancestor=ancestor.parentElement){
    if(getComputedStyle(ancestor).display==='none'||getComputedStyle(ancestor).visibility==='hidden'){clip.right=clip.left;break;}
    const value=ancestor.getAttribute('clip-path');if(!value)continue;
    const id=value.match(/^url\(#([^\)]+)\)$/)?.[1],path=id&&document.getElementById(id);
    if(!path||path.getAttribute('clipPathUnits')==='objectBoundingBox'||path.children.length!==1||path.children[0].tagName!=='rect'){limits.push('unsupported-clip');continue;}
    const shape=path.children[0];if(path.getAttribute('transform')||shape.getAttribute('transform')){limits.push('transformed-clip');continue;}
    clip=intersect(clip,box(shape,ancestor.getScreenCTM()));
   }
   const shown=intersect(glyph,clip),area=Math.max(0,glyph.right-glyph.left)*Math.max(0,glyph.bottom-glyph.top),visibleArea=Math.max(0,shown.right-shown.left)*Math.max(0,shown.bottom-shown.top);
   if(area>0&&visibleArea/area<0.999&&visibleArea>0)partial++;
   const cx=(glyph.left+glyph.right)/2,cy=(glyph.top+glyph.bottom)/2;
   if(cx>=clip.left&&cx<=clip.right&&cy>=clip.top&&cy<=clip.bottom)visible+=text.textContent||'';else hidden++;
  }
  return {text:visible,total,hidden,partial,limitations:[...new Set(limits)]};
 });
}
