// Compare physical border strokes, not only a renderer bbox/clip that may have
// been expanded after pagination. This is an oracle for fixtures that specify
// an owned nested frame and a visible complete parent-cell horizontal edge.
export async function physicalFrameBorders(page,svg,frame,tolerance=0.6,tableFrame=null){
 await page.setContent(svg);
 return page.evaluate(({frame,tolerance,tableFrame})=>{
  const svg=document.querySelector('svg');if(!svg)throw Error('SVG missing');
  const candidates=[];let unsupportedTransforms=false;
  for(const node of svg.querySelectorAll('line,path,polyline')){
   if(!node.getAttribute('stroke')||node.getAttribute('stroke')==='none')continue;
   let clips=0,transformed=false;for(let a=node;a&&a!==svg;a=a.parentElement){if(a.getAttribute('clip-path'))clips++;if(a.getAttribute('transform'))transformed=true;}
   const b=node.getBBox(),scope=tableFrame||frame;if(b.height>tolerance||b.y<scope.y-tolerance||b.y>scope.y+scope.h+tolerance)continue;
   if(transformed){unsupportedTransforms=true;continue;}candidates.push({x:b.x,w:b.width,y:b.y,clips});
  }
  if(!candidates.length)return {known:false,reason:unsupportedTransforms?'transformed-border':'no-full-parent-edge'};
  // A descendant with the same width can have its own lower border. Its
  // additional cell clip proves that it is not the parent's physical edge.
  const scope=tableFrame||frame,scopeEdges=candidates.filter(c=>Math.abs(c.x-scope.x)<=tolerance&&Math.abs(c.w-scope.w)<=tolerance);
  if(!scopeEdges.length)return {known:false,reason:'no-full-parent-table-edge'};
  const depth=Math.min(...scopeEdges.map(c=>c.clips)),edges=candidates.filter(c=>c.clips===depth&&c.x<=frame.x+tolerance&&c.x+c.w>=frame.x+frame.w-tolerance&&c.y>=frame.y-tolerance&&c.y<=frame.y+frame.h+tolerance);
  if(!edges.length)return {known:false,reason:'no-parent-cell-edge-at-table-scope'};
  if(Math.max(...edges.map(e=>e.y))-Math.min(...edges.map(e=>e.y))<=tolerance)return {known:false,reason:'incomplete-parent-cell-frame'};
  return {known:true,top:Math.min(...edges.map(e=>e.y)),bottom:Math.max(...edges.map(e=>e.y)),clipDepth:depth,edgeCount:edges.length};
 },{frame,tolerance,tableFrame});
}
