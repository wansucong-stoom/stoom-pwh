const PAPERS={A3:[297,420],A4:[210,297],A5:[148,210],B4:[257,364],B5:[182,257],Letter:[215.9,279.4],Legal:[215.9,355.6]};
const GRIDS={1:[1,1],2:[2,1],4:[2,2],6:[3,2],9:[3,3],16:[4,4]};

export function parsePrintPages(value,count){
 if(!Number.isInteger(count)||count<1||count>10000)throw Error('문서의 쪽 수를 확인하지 못했습니다.');
 const pages=new Set();
 for(const part of String(value).split(',')){
  const match=part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
  if(!match)throw Error('쪽 범위는 1, 3, 5-7 형식으로 입력해 주세요.');
  const from=Number(match[1]),to=Number(match[2]||match[1]);
  if(from<1||to<from||to>count)throw Error(`쪽 범위는 1~${count}이어야 합니다.`);
  for(let page=from;page<=to;page++)pages.add(page-1);
 }
 return [...pages].sort((a,b)=>a-b);
}

export function selectedPrintPages(mode,context,custom=''){
 const count=context.pages.length,current=Math.min(Math.max(context.currentPage||0,0),count-1);
 const all=Array.from({length:count},(_,i)=>i);
 if(mode==='all')return all;
 if(mode==='current')return [current];
 if(mode==='through')return all.filter(i=>i<=current);
 if(mode==='from')return all.filter(i=>i>=current);
 if(mode==='section')return all.filter(i=>context.pages[i].sectionIndex===context.pages[current].sectionIndex);
 if(mode==='selected'){
  const selected=[...new Set(context.selectedPages||[])].filter(i=>Number.isInteger(i)&&i>=0&&i<count).sort((a,b)=>a-b);
  if(selected.length)return selected;
  throw Error('문서에서 선택한 쪽이 없습니다.');
 }
 if(mode==='custom')return parsePrintPages(custom,count);
 throw Error('인쇄할 쪽을 선택해 주세요.');
}

export function createPrintPlan(pages,indexes,{paper='document',orientation='document',fit='fit',perSheet=1}={}){
 if(!pages.length||!indexes.length||indexes.some(i=>!Number.isInteger(i)||i<0||i>=pages.length))throw Error('인쇄할 쪽을 확인해 주세요.');
 if(pages.some(p=>!Number.isFinite(p.widthMm)||!Number.isFinite(p.heightMm)||p.widthMm<1||p.heightMm<1||p.widthMm>2000||p.heightMm>2000))throw Error('문서의 용지 크기를 확인하지 못했습니다.');
 if(!Object.hasOwn(GRIDS,perSheet))throw Error('모아 찍기 설정을 확인해 주세요.');
 if(!['document','portrait','landscape'].includes(orientation)||!['fit','actual'].includes(fit))throw Error('인쇄 방향과 크기를 확인해 주세요.');
 const size=paper==='document'?[pages[0].widthMm,pages[0].heightMm]:PAPERS[paper];
 if(!size)throw Error('용지 크기를 확인해 주세요.');
 let [widthMm,heightMm]=size;
 if(orientation==='portrait')[widthMm,heightMm]=[Math.min(...size),Math.max(...size)];
 if(orientation==='landscape')[widthMm,heightMm]=[Math.max(...size),Math.min(...size)];
 const [columns,rows]=GRIDS[perSheet],cellWidth=widthMm/columns,cellHeight=heightMm/rows,sheets=[];
 for(let offset=0;offset<indexes.length;offset+=perSheet){
  const placements=indexes.slice(offset,offset+perSheet).map((pageIndex,slot)=>{
   const page=pages[pageIndex],scale=fit==='actual'&&perSheet===1?1:Math.min(cellWidth/page.widthMm,cellHeight/page.heightMm);
   return {pageIndex,widthMm:page.widthMm,heightMm:page.heightMm,scale,
    leftMm:(slot%columns)*cellWidth+(cellWidth-page.widthMm*scale)/2,
    topMm:Math.floor(slot/columns)*cellHeight+(cellHeight-page.heightMm*scale)/2};
  });
  sheets.push({widthMm,heightMm,placements});
 }
 return {widthMm,heightMm,sheets,pageCount:indexes.length};
}
