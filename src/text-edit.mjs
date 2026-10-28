// Text edits use source paragraph addresses, independent of table geometry.
// Call applyTextEdits inside the editor's snapshot transaction.
const parsed=v=>typeof v==='string'?JSON.parse(v):v;
const chars=v=>Array.from(v);
const keys=['documentEpoch','changeSeq','documentSha256'];
export const textRevision=c=>Object.fromEntries(keys.map(k=>[k,(c?.documentState||c)?.[k]]));
export function assertTextRevision(expected,current){
 if(!expected||keys.some(k=>expected[k]!==textRevision(current)[k]))throw Error('문서 내용이 변경되었습니다. 텍스트를 다시 검색해 주세요.');
}
const checked=v=>{const r=parsed(v);if(r?.ok===false||r?.error)throw Error(r.error||'텍스트 수정 실패');};
const validText=(v,empty=false)=>typeof v==='string'&&(empty||v.length>0)&&v.length<=12000&&!/[\r\n\u0000-\u0008\u000b-\u001f\ufffc]/.test(v);
const pathJson=p=>JSON.stringify(p.cellPath);
const sourceKey=p=>JSON.stringify([p.section,p.paragraph,(p.cellPath||[]).map(e=>[e.controlIndex,e.cellIndex,e.cellParaIndex])]);
function sourceOf(hit){
 const c=hit.cellContext,path=hit.cellPath||c&&[{controlIndex:c.ctrlIdx,cellIndex:c.cellIdx,cellParaIndex:c.cellPara}];
 return {section:hit.sec,paragraph:c?.parentPara??hit.para,...(path?.length?{cellPath:path}:{})};
}
function readParagraph(w,p){
 const n=p.cellPath?w.getCellParagraphLengthByPath(p.section,p.paragraph,pathJson(p)):w.getParagraphLength(p.section,p.paragraph);
 if(n>48000)throw Error('문단이 텍스트 편집 한도를 넘습니다.');
 return p.cellPath?w.getTextInCellByPath(p.section,p.paragraph,pathJson(p),0,n):w.getTextRange(p.section,p.paragraph,0,n);
}
function shapeIds(w,p,start,end){
 const runs=parsed(p.cellPath?w.getCharShapeRunsInCellByPath(p.section,p.paragraph,pathJson(p),start,end):w.getCharShapeRuns(p.section,p.paragraph,start,end));
 if(!Array.isArray(runs))throw Error('글자 서식을 읽지 못했습니다.');
 const ids=[];let next=start;
 for(const r of runs){if(r.startOffset!==next||!Number.isSafeInteger(r.endOffset)||r.endOffset<=next||r.endOffset>end||!Number.isSafeInteger(r.charShapeId))throw Error('글자 서식 구간을 확인하지 못했습니다.');ids.push(...Array(r.endOffset-next).fill(r.charShapeId));next=r.endOffset;}
 if(next!==end)throw Error('글자 서식 구간이 누락되었습니다.');return ids;
}
export function createTextSearchPlan(w,context,query,{cursor=0,limit=40}={}){
 if(!validText(query)||!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('검색어와 검색 범위를 확인하세요.');
 const raw=parsed(w.searchAllText(query,true,true));if(!Array.isArray(raw))throw Error('텍스트 검색 결과가 올바르지 않습니다.');
 if(cursor>raw.length)throw Error('텍스트 검색 위치가 범위를 넘었습니다.');
 const refs=[],hits=[];let index=cursor,budget=0;
 for(;index<raw.length&&hits.length<limit;index++){
  const hit=raw[index];if(hit.equationControl!=null)continue;
  const source=sourceOf(hit),text=readParagraph(w,source),all=chars(text),original=all.slice(hit.charOffset,hit.charOffset+hit.length).join('');
  if(original!==query)throw Error('검색 위치의 원문을 확인하지 못했습니다.');
  if(hits.length&&budget+text.length>48000)break;
  const id=String(index),ref={id,source,start:hit.charOffset,length:hit.length,original,paragraphText:text};refs.push(ref);
  hits.push({...ref,kind:source.cellPath?'cell_text':'body_text',depth:source.cellPath?.length||0});budget+=text.length;
 }
 return {revision:textRevision(context),refs,result:{query,hits,totalMatches:raw.length,nextCursor:index<raw.length?index:null,truncated:index<raw.length,notice:'본문·표 셀·중첩 셀의 원문 주소입니다. 같은 문구의 여러 결과는 주변 문단과 cellPath로 구분하세요. 수식 스크립트는 편집 대상에서 제외합니다.'}};
}

// LCS preserves every retained character's shape; inserted characters inherit
// the replaced span's first shape, or the preceding retained character's shape.
// Trim the equal ends before the bounded matrix so routine sentence edits stay small.
export function replacementShapeIds(original,replacement,ids){
 const a=chars(original),b=chars(replacement);if(ids.length!==a.length)throw Error('글자 서식 길이가 다릅니다.');
 if(!b.length)return [];let left=0,right=0;
 while(left<a.length&&left<b.length&&a[left]===b[left])left++;
 while(right<a.length-left&&right<b.length-left&&a[a.length-1-right]===b[b.length-1-right])right++;
 const n=a.length-left-right,m=b.length-left-right;
 if(n*m>4000000)throw Error('한 번에 바꿀 문장이 너무 깁니다. 변경할 문구를 더 짧게 검색해 주세요.');
 const stride=m+1,dp=new Uint16Array((n+1)*stride);
 for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)dp[i*stride+j]=a[left+i]===b[left+j]?1+dp[(i+1)*stride+j+1]:Math.max(dp[(i+1)*stride+j],dp[i*stride+j+1]);
 const result=ids.slice(0,left);let i=0,j=0,inherit=ids[left]??ids[left-1]??ids[0],deleting=false;
 while(i<n||j<m){
  if(i<n&&j<m&&a[left+i]===b[left+j]){inherit=ids[left+i];deleting=false;result.push(inherit);i++;j++;}
  else if(i<n&&(j===m||dp[(i+1)*stride+j]>=dp[i*stride+j+1])){if(!deleting)inherit=ids[left+i];deleting=true;i++;}
  else{result.push(inherit);j++;}
 }
 result.push(...ids.slice(a.length-right));return result;
}
export function prepareTextEdits(w,plans,edits,context){
 if(!Array.isArray(edits)||edits.length<1||edits.length>100)throw Error('수정할 텍스트 범위를 1~100개 지정하세요.');
 const parts=[],groups=new Map();let total=0;
 for(const edit of edits){
  const plan=plans.get(edit.searchId);if(!plan)throw Error('검색 결과가 만료되었습니다. 다시 검색하세요.');assertTextRevision(plan.revision,context);
  const ref=plan.refs.find(r=>r.id===edit.matchId);if(!ref||!validText(edit.replacement,true)||(total+=edit.replacement.length)>48000)throw Error('수정할 검색 결과와 내용을 확인하세요.');
  const actual=readParagraph(w,ref.source);if(actual!==ref.paragraphText)throw Error('검색한 문단이 변경되었습니다. 다시 검색해 주세요.');
  const key=sourceKey(ref.source),ids=shapeIds(w,ref.source,ref.start,ref.start+ref.length),part={...ref,replacement:edit.replacement,ids:replacementShapeIds(ref.original,edit.replacement,ids)};
  const group=groups.get(key)||{source:ref.source,text:chars(actual),parts:[]};
  if(group.parts.some(p=>ref.start<p.start+p.length&&p.start<ref.start+ref.length))throw Error('수정할 텍스트 범위가 겹칩니다.');
  group.parts.push(part);groups.set(key,group);parts.push(part);
 }
 for(const group of groups.values()){group.parts.sort((a,b)=>b.start-a.start);for(const p of group.parts)group.text.splice(p.start,p.length,...chars(p.replacement));group.expectedText=group.text.join('');}
 return {groups:[...groups.values()],count:parts.length};
}
export function applyTextEdits(w,prepared,replace){
 for(const group of prepared.groups){
  for(const p of group.parts){
   const s=p.source,cell=s.cellPath?.[0],position={sectionIndex:s.section,paragraphIndex:s.paragraph,charOffset:p.start,...(cell?{parentParaIndex:s.paragraph,controlIndex:cell.controlIndex,cellIndex:cell.cellIndex,cellParaIndex:cell.cellParaIndex,cellPath:s.cellPath}:{})};
   if(replace)replace(w,position,p.length,p.replacement);
   else{if(s.cellPath){checked(w.deleteTextInCellByPath(s.section,s.paragraph,pathJson(s),p.start,p.length));if(p.replacement)checked(w.insertTextInCellByPath(s.section,s.paragraph,pathJson(s),p.start,p.replacement));}else{checked(w.deleteText(s.section,s.paragraph,p.start,p.length));if(p.replacement)checked(w.insertText(s.section,s.paragraph,p.start,p.replacement));}}
   for(let start=0;start<p.ids.length;){let end=start+1;while(end<p.ids.length&&p.ids[end]===p.ids[start])end++;
    checked(s.cellPath?w.setCharShapeIdInCellByPath(s.section,s.paragraph,pathJson(s),p.start+start,p.start+end,p.ids[start]):w.setCharShapeId(s.section,s.paragraph,p.start+start,p.start+end,p.ids[start]));start=end;
   }
  }
 }
 w.flushDeferredPagination();
 for(const group of prepared.groups)if(readParagraph(w,group.source)!==group.expectedText)throw Error('텍스트 수정 결과가 요청과 다릅니다.');
 return {ranges:prepared.count,paragraphs:prepared.groups.length};
}
export function textEditCursor(prepared,cursor){
 const cellPath=cursor.cellPath?.length?cursor.cellPath:cursor.parentParaIndex!=null?[{controlIndex:cursor.controlIndex,cellIndex:cursor.cellIndex,cellParaIndex:cursor.cellParaIndex}]:undefined;
 const source={section:cursor.sectionIndex,paragraph:cursor.parentParaIndex??cursor.paragraphIndex,...(cellPath?{cellPath}:{})};
 const group=prepared.groups.find(g=>sourceKey(g.source)===sourceKey(source));if(!group)return cursor;
 const old=cursor.charOffset;let delta=0,mapped;
 for(const p of [...group.parts].reverse()){
  if(old<p.start)break;
  const length=chars(p.replacement).length;
  if(old<p.start+p.length){mapped=p.start+delta+Math.min(old-p.start,length);break;}
  delta+=length-p.length;
 }
 return {...cursor,charOffset:Math.max(0,Math.min(mapped??old+delta,chars(group.expectedText).length))};
}
