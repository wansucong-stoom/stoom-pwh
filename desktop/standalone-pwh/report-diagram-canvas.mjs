const fontStack = '"맑은 고딕","Malgun Gothic","Noto Sans CJK KR","Apple SD Gothic Neo",sans-serif';

function wrapLines(ctx,text,width) {
 const lines=[];
 let line='';
 for(const word of text.split(' ')){
  const joined=line?line+' '+word:word;
  if(ctx.measureText(joined).width<=width){line=joined;continue;}
  if(line)lines.push(line);
  line='';
  for(const letter of Array.from(word)){
   if(line&&ctx.measureText(line+letter).width>width){lines.push(line);line='';}
   line+=letter;
  }
 }
 if(line)lines.push(line);
 return lines;
}

function arrow(ctx,from,to,size) {
 const angle=Math.atan2(to.y-from.y,to.x-from.x);
 ctx.beginPath();
 ctx.moveTo(from.x,from.y);
 ctx.lineTo(to.x,to.y);
 ctx.stroke();
 ctx.beginPath();
 ctx.moveTo(to.x,to.y);
 for(const offset of [-0.54,0.54])ctx.lineTo(to.x-size*Math.cos(angle+offset),to.y-size*Math.sin(angle+offset));
 ctx.closePath();
 ctx.fill();
}

export async function renderReportDiagram(canvas,spec) {
 const {width,height,title,steps,layout,accent}=spec,flow=layout==='flow';
 canvas.width=width;
 canvas.height=height;
 const ctx=canvas.getContext('2d');
 const scale=Math.min(width,height),margin=Math.round(scale*0.055);
 const gap=Math.round(scale*0.045),ratio=width/height;
 const titleSize=Math.max(18,Math.round(scale*0.066));
 ctx.textBaseline='top';
 ctx.font='700 '+titleSize+'px '+fontStack;
 const titleLines=wrapLines(ctx,title,width-2*margin);
 const titleHeight=titleLines.length*titleSize*1.22;
 const top=margin+titleHeight+gap*1.2;
 const columns=Math.min(steps.length,ratio>2.5?4:ratio>=1.4?3:ratio>=0.82?2:1);
 const rows=Math.ceil(steps.length/columns);
 const cardWidth=(width-2*margin-(columns-1)*gap)/columns;
 const cardHeight=(height-top-margin-(rows-1)*gap)/rows;
 if(cardWidth<65||cardHeight<35)throw Error('도식의 단계가 그림 틀에 들어가지 않습니다. 단계 수나 제목을 줄여 주세요.');
 const pad=Math.round(Math.min(cardHeight,cardWidth)*0.14);
 const badge=flow?Math.min(34,Math.max(16,Math.round(cardHeight*0.22))):0;
 const textWidth=cardWidth-2*pad-(flow?badge+pad*0.55:0);
 const cards=steps.map(({label,detail},index)=>{
  const row=Math.floor(index/columns),inRow=index%columns;
  const column=flow&&row%2?columns-1-inRow:inRow;
  const x=margin+column*(cardWidth+gap),y=top+row*(cardHeight+gap);
  for(let size=Math.round(Math.min(cardHeight*0.25,scale*0.048));size>=13;size--){
   ctx.font='700 '+size+'px '+fontStack;
   const labelLines=wrapLines(ctx,label,textWidth);
   const detailSize=Math.max(12,Math.round(size*0.8));
   ctx.font='400 '+detailSize+'px '+fontStack;
   const detailLines=detail?wrapLines(ctx,detail,textWidth):[];
   const labelLeading=size*1.24,detailLeading=detailSize*1.36;
   const textHeight=labelLines.length*labelLeading+(detailLines.length?pad*0.33+detailLines.length*detailLeading:0);
   if(textHeight<=cardHeight-2*pad)return {x,y,index,size,labelLines,labelLeading,detailSize,detailLines,detailLeading,textHeight};
  }
  throw Error('도식의 단계 문구가 그림 틀에 들어가지 않습니다. 제목이나 단계 설명을 짧게 써 주세요.');
 });

 ctx.fillStyle='#ffffff';
 ctx.fillRect(0,0,width,height);
 ctx.fillStyle='#182b3b';
 ctx.font='700 '+titleSize+'px '+fontStack;
 titleLines.forEach((line,index)=>ctx.fillText(line,margin,margin+index*titleSize*1.22));
 ctx.fillStyle=accent;
 ctx.fillRect(margin,top-gap*0.55,Math.min(cardWidth/3,scale*0.16),Math.max(3,scale*0.007));
 ctx.fillStyle=accent;
 ctx.strokeStyle=accent;
 ctx.lineWidth=Math.max(2,scale*0.004);
 if(flow)for(let index=1;index<cards.length;index++){
  const before=cards[index-1],after=cards[index],inset=gap*0.17,tip=Math.max(6,scale*0.013);
  if(after.y>before.y){
   const x=before.x+cardWidth/2;
   arrow(ctx,{x,y:before.y+cardHeight+inset},{x,y:after.y-inset},tip);
  }else{
   const forward=after.x>before.x,y=before.y+cardHeight/2;
   arrow(ctx,{x:forward?before.x+cardWidth+inset:before.x-inset,y},{x:forward?after.x-inset:after.x+cardWidth+inset,y},tip);
  }
 }
 for(const {x,y,index,size,labelLines,labelLeading,detailSize,detailLines,detailLeading,textHeight} of cards){
  ctx.beginPath();
  ctx.roundRect(x,y,cardWidth,cardHeight,Math.max(5,scale*0.014));
  ctx.fillStyle='#f2f6fa';
  ctx.fill();
  ctx.strokeStyle='#d8e2eb';
  ctx.lineWidth=Math.max(1,scale*0.002);
  ctx.stroke();
  const textX=x+pad+(flow?badge+pad*0.55:0);
  if(flow){
   const centerX=x+pad+badge/2,centerY=y+cardHeight/2;
   ctx.beginPath();
   ctx.arc(centerX,centerY,badge/2,0,2*Math.PI);
   ctx.fillStyle=accent;
   ctx.fill();
   ctx.font='700 '+Math.round(badge*0.56)+'px '+fontStack;
   ctx.fillStyle='#ffffff';
   ctx.textBaseline='middle';
   ctx.textAlign='center';
   ctx.fillText(String(index+1),centerX,centerY);
   ctx.textBaseline='top';
   ctx.textAlign='start';
  }
  let textY=y+(cardHeight-textHeight)/2;
  ctx.font='700 '+size+'px '+fontStack;
  ctx.fillStyle='#182b3b';
  for(const line of labelLines){ctx.fillText(line,textX,textY);textY+=labelLeading;}
  textY+=pad*0.33;
  ctx.font='400 '+detailSize+'px '+fontStack;
  ctx.fillStyle='#405c71';
  for(const line of detailLines){ctx.fillText(line,textX,textY);textY+=detailLeading;}
 }
 return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('도식 그림을 저장하지 못했습니다.')),'image/png'));
}
