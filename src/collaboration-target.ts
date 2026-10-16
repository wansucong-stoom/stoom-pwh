export function findParagraph(wasm:any,sec:number,id:string){
 if(!id)throw Error('요청 대상 식별 정보가 없습니다.');
 let found=-1;const count=wasm.getParagraphCount(sec);if(count>20000)throw Error('문단 추적 한도 초과');
 for(let i=0;i<count;i++)if(id.startsWith('content:')?paragraphToken(wasm,sec,i)===id:wasm.getParagraphStableId(sec,i)===id){if(found!==-1)throw Error('문단 식별자가 중복됩니다.');found=i;}
 if(found<0)throw Error('요청한 문단이 삭제되거나 다른 문서로 바뀌었습니다.');return found;
}
function paragraphToken(wasm:any,sec:number,para:number){
 const stable=wasm.getParagraphStableId(sec,para);if(stable)return stable;
 const length=wasm.getParagraphLength(sec,para);if(length>12000)throw Error('요청 문단이 너무 깁니다.');
 return 'content:'+JSON.stringify({text:wasm.getTextRange(sec,para,0,length),paragraphFormat:wasm.getParaPropertiesAt(sec,para)});
}
export async function captureTarget(wasm:any,c:any){
 const epoch=c.documentState?.documentEpoch;
 if(c.kind==='object'&&c.objects?.length===1&&c.objects[0].source.type==='image'){
  const ref=c.objects[0].source;if(ref.cellIdx!=null||ref.cellPath?.length||ref.headerFooter||ref.noteRef)return null;
  const bytes=wasm.getControlImageData(ref.sec,ref.ppi,ref.ci,'[]');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),(v:number)=>v.toString(16).padStart(2,'0')).join('');
  return {kind:'image',epoch,parentId:wasm.getParagraphStableId(ref.sec,ref.ppi),source:ref,properties:c.objects[0].properties,imageSha256:digest};
 }
 if(c.kind==='cell_text'&&c.selection&&c.selectedText?.known&&!c.selectedText.truncated){
  const {start,end}=c.selection,path=start.cellPath?.length?start.cellPath:[{controlIndex:start.controlIndex,cellIndex:start.cellIndex,cellParaIndex:start.cellParaIndex}];
  if(path.length!==1||start.sectionIndex!==end.sectionIndex||start.parentParaIndex!==end.parentParaIndex)return null;
  const first=path[0].cellParaIndex,last=end.cellPath?.[0]?.cellParaIndex??end.cellParaIndex;if(!Number.isInteger(first)||!Number.isInteger(last)||last-first>23)return null;
  const segments=[];for(let i=first;i<=last;i++){const p=[{...path[0],cellParaIndex:i}],json=JSON.stringify(p),length=wasm.getCellParagraphLengthByPath(start.sectionIndex,start.parentParaIndex,json);segments.push({path:p,text:wasm.getTextInCellByPath(start.sectionIndex,start.parentParaIndex,json,0,length),length,format:wasm.getCellCharPropertiesAtByPath(start.sectionIndex,start.parentParaIndex,json,i===first?start.charOffset:0)});}
  return {kind:'cell_text',epoch,section:start.sectionIndex,parentId:wasm.getParagraphStableId(start.sectionIndex,start.parentParaIndex),controlIndex:path[0].controlIndex,tableProperties:wasm.getTableProperties(start.sectionIndex,start.parentParaIndex,path[0].controlIndex),segments,startOffset:start.charOffset,endOffset:end.charOffset};
 }
 if(c.kind==='body_text'&&c.selection&&c.selectedText?.known&&!c.selectedText.truncated){
  const {start,end}=c.selection;if(start.parentParaIndex!=null||end.parentParaIndex!=null||start.sectionIndex!==end.sectionIndex)return null;
  const segments=[];if(end.paragraphIndex-start.paragraphIndex>23)return null;
  for(let i=start.paragraphIndex;i<=end.paragraphIndex;i++){
   const length=wasm.getParagraphLength(start.sectionIndex,i),text=wasm.getTextRange(start.sectionIndex,i,0,length);
   segments.push({id:paragraphToken(wasm,start.sectionIndex,i),text,length,format:wasm.getCharPropertiesAt(start.sectionIndex,i,i===start.paragraphIndex?start.charOffset:0),paragraphFormat:wasm.getParaPropertiesAt(start.sectionIndex,i)});
  }
  if(segments.some(p=>!p.id)||segments.reduce((n,p)=>n+p.text.length,0)>12000)return null;
  return {kind:'body_text',epoch,section:start.sectionIndex,segments,startOffset:start.charOffset,endOffset:end.charOffset};
 }
 return null;
}
export async function resolveTarget(wasm:any,expected:any,current:any){
 const target=expected.target;if(!target)throw Error('이전 요청은 대상 추적 정보를 포함하지 않습니다. 다시 요청하세요.');
 if(current.documentState.documentEpoch!==target.epoch)throw Error('문서를 다시 열어 요청 대상이 만료됐습니다.');
 if(target.kind==='body_text'){
  const positions=target.segments.map((p:any)=>findParagraph(wasm,target.section,p.id));
  if(positions.some((p:number,i:number)=>i&&p!==positions[i-1]+1))throw Error('요청 범위에 문단이 추가·이동됐습니다.');
  for(let i=0;i<positions.length;i++){const p=positions[i],saved=target.segments[i],length=wasm.getParagraphLength(target.section,p);
   if(length!==saved.length||wasm.getTextRange(target.section,p,0,length)!==saved.text||JSON.stringify(wasm.getParaPropertiesAt(target.section,p))!==JSON.stringify(saved.paragraphFormat)||JSON.stringify(wasm.getCharPropertiesAt(target.section,p,i===0?target.startOffset:0))!==JSON.stringify(saved.format))throw Error('요청한 문단의 내용·서식이 변경되어 충돌했습니다.');
  }
  return {...expected,documentState:current.documentState,selection:{start:{...expected.selection.start,paragraphIndex:positions[0]},end:{...expected.selection.end,paragraphIndex:positions.at(-1)}}};
 }
 if(target.kind==='cell_text'){
  const candidates=target.parentId?[findParagraph(wasm,target.section,target.parentId)]:Array.from({length:Math.min(wasm.getParagraphCount(target.section),20000)},(_,i)=>i),matches=[];
  for(const ppi of candidates)try{
   if(JSON.stringify(wasm.getTableProperties(target.section,ppi,target.controlIndex))!==JSON.stringify(target.tableProperties))continue;
   const valid=target.segments.every((saved:any,i:number)=>{const path=JSON.stringify(saved.path),length=wasm.getCellParagraphLengthByPath(target.section,ppi,path);return length===saved.length&&wasm.getTextInCellByPath(target.section,ppi,path,0,length)===saved.text&&JSON.stringify(wasm.getCellCharPropertiesAtByPath(target.section,ppi,path,i===0?target.startOffset:0))===JSON.stringify(saved.format);});if(valid)matches.push(ppi);
  }catch{}
  if(matches.length!==1)throw Error('요청한 표·셀이 변경됐거나 대상을 고유하게 식별할 수 없습니다.');
  return {...expected,documentState:current.documentState,selection:{start:{...expected.selection.start,parentParaIndex:matches[0]},end:{...expected.selection.end,parentParaIndex:matches[0]}}};
 }
 if(target.kind==='image'){
  const ref=target.source,matches=[];
  const paragraphs=target.parentId?[findParagraph(wasm,ref.sec,target.parentId)]:Array.from({length:Math.min(wasm.getParagraphCount(ref.sec),20000)},(_,i)=>i);
  for(const ppi of paragraphs){
   const positions=wasm.getControlTextPositions(ref.sec,ppi);
   for(let ci=0;ci<positions.length;ci++){
    try{const properties=wasm.getPictureProperties(ref.sec,ppi,ci);if(JSON.stringify(properties)!==JSON.stringify(target.properties))continue;
     const bytes=wasm.getControlImageData(ref.sec,ppi,ci,'[]'),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),(v:number)=>v.toString(16).padStart(2,'0')).join('');
     if(digest===target.imageSha256)matches.push({source:{...ref,ppi,ci},properties});
    }catch{}
   }
  }
  if(matches.length!==1)throw Error('요청한 그림이 변경·삭제됐거나 대상을 고유하게 식별할 수 없습니다.');
  return {...expected,documentState:current.documentState,objects:matches};
 }
 throw Error('지원되지 않는 요청 대상입니다.');
}
