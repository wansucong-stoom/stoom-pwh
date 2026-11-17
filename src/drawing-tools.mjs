const tool=(type,label,path)=>Object.freeze({type,label,path});
export const drawingTools=Object.freeze([
 tool('textbox','글상자','M3 4h22v20H3z M7 9h14 M14 9v11 M10 20h8'),
 tool('rectangle','사각형','M3 5h22v18H3z'),
 tool('ellipse','타원','M25 14a11 8 0 1 1-22 0 11 8 0 1 1 22 0'),
 tool('line','직선','M3 4l22 20'),
 tool('arc','호','M3 23A20 20 0 0 1 25 3'),
 tool('polygon','다각형','M3 23L7 4l17 7-3 12z'),
 tool('curve','곡선','M3 23C3 2 24 26 25 4'),
 tool('freehand','자유선','M3 22l4-8 4 4 3-14 3 17 4-10 4 7'),
]);
const routes={straight:'M3 23L25 5',stroke:'M3 23V5H25',arc:'M3 23C3 5 25 23 25 5'};
export const connectorTools=Object.freeze(['straight','stroke','arc'].flatMap((route)=>{
 const label={straight:'직선',stroke:'꺾인',arc:'곡선'}[route];
 return [tool('connector-'+route,label+' 연결선',routes[route]),
  tool('connector-'+route+'-arrow',label+' 화살표 연결선',routes[route]),
  tool('connector-'+route+'-both','양방향 '+label+' 연결선',routes[route])];
}));
export const allDrawingTools=Object.freeze([...drawingTools,...connectorTools]);
export const isConnector=type=>type.startsWith('connector-');
export const isPointDrawing=type=>type==='polygon'||type==='curve';
export const isLinear=type=>type==='line'||isConnector(type);
export function constrainDrawingEnd(type,start,end,shift=false){
 if(!shift)return {...end};
 const dx=end.x-start.x,dy=end.y-start.y;
 if(isLinear(type)){
  const angle=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*(Math.PI/4),length=Math.hypot(dx,dy);
  return{x:start.x+length*Math.cos(angle),y:start.y+length*Math.sin(angle)};
 }
 const size=Math.max(Math.abs(dx),Math.abs(dy));
 return{x:start.x+(dx<0?-size:size),y:start.y+(dy<0?-size:size)};
}
export function drawingGeometry(type,start,end,{shift=false,points=[],click=false}={}){
 let finish=constrainDrawingEnd(type,start,end,shift);
 if(click&&!points.length)finish={x:start.x+30*96/25.4,y:start.y+(isLinear(type)?0:30*96/25.4)};
 const vertices=points.length?points:[start,finish];
 const xs=vertices.map(p=>p.x),ys=vertices.map(p=>p.y);
 const left=Math.min(...xs),top=Math.min(...ys),right=Math.max(...xs),bottom=Math.max(...ys);
 const pxToHu=value=>Math.round(value*75);
 return {width:Math.max(1,pxToHu(right-left)),height:Math.max(1,pxToHu(bottom-top)),
  horzOffset:Math.max(0,pxToHu(left)),vertOffset:Math.max(0,pxToHu(top)),
  lineFlipX:finish.x<start.x,lineFlipY:finish.y<start.y,
  ...(points.length?{polygonPoints:points.map(p=>({x:pxToHu(p.x-left),y:pxToHu(p.y-top)}))}:{})};
}
export function appendDrawingSample(points,point,minDistance=2,limit=2048){
 const last=points.at(-1);
 if(!last||Math.hypot(point.x-last.x,point.y-last.y)>=minDistance){
  if(points.length>=limit){
   let next=1;for(let i=2;i<points.length;i+=2)points[next++]=points[i];points.length=next;
  }
  points.push({...point});
 }
 return points;
}
export function connectorPath(type,x1,y1,x2,y2){
 if(type.includes('-stroke'))return `M${x1} ${y1}H${x2}V${y2}`;
 if(type.includes('-arc'))return `M${x1} ${y1}C${x1+(x2-x1)/2} ${y1} ${x1+(x2-x1)/2} ${y2} ${x2} ${y2}`;
 return `M${x1} ${y1}L${x2} ${y2}`;
}
