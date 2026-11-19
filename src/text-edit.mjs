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
function charRuns(w,p,start,end){
 const runs=parsed(p.cellPath?w.getCharShapeRunsInCellByPath(p.section,p.paragraph,pathJson(p),start,end):w.getCharShapeRuns(p.section,p.paragraph,start,end));
 if(!Array.isArray(runs))throw Error('글자 서식을 읽지 못했습니다.');
 let next=start;
 for(const r of runs){
  if(r.startOffset!==next||!Number.isSafeInteger(r.endOffset)||r.endOffset<=next||r.endOffset>end||!Number.isSafeInteger(r.charShapeId))throw Error('글자 서식 구간을 확인하지 못했습니다.');
  next=r.endOffset;
 }
 if(next!==end)throw Error('글자 서식 구간이 누락되었습니다.');
 return runs;
}
function shapeIds(w,p,start,end){
 return charRuns(w,p,start,end).flatMap(run=>Array(run.endOffset-run.startOffset).fill(run.charShapeId));
}

const characterStyleKeys=['textColor','bold','italic','underline','strikethrough','fontSize'];
const paragraphStyleKeys=['alignment','lineSpacingPercent'];
export function validateTextStyles(edits,paragraph=false){
 if(!Array.isArray(edits)||!edits.length||edits.length>100)throw Error('서식을 적용할 검색 결과를 1~100개 지정하세요.');
 for(const edit of edits){
  if(!edit||typeof edit.searchId!=='string'||edit.searchId.length>64||typeof edit.matchId!=='string'||!/^\d+$/.test(edit.matchId)||edit.matchId.length>16)throw Error('서식을 적용할 검색 결과를 확인하세요.');
  const style=edit.style,styleKeys=paragraph?paragraphStyleKeys:characterStyleKeys;
  if(!style||typeof style!=='object'||Array.isArray(style)||!Object.keys(style).length||Object.keys(style).some(key=>!styleKeys.includes(key)))throw Error('글자 서식을 확인하세요.');
  if(paragraph){
   if(Object.hasOwn(style,'alignment')&&!['left','center','right','justify'].includes(style.alignment))throw Error('문단 정렬 방식을 확인하세요.');
   if(Object.hasOwn(style,'lineSpacingPercent')&&(!Number.isSafeInteger(style.lineSpacingPercent)||style.lineSpacingPercent<50||style.lineSpacingPercent>500))throw Error('줄 간격은 50~500%로 지정하세요.');
   continue;
  }
  if(Object.hasOwn(style,'textColor')&&(typeof style.textColor!=='string'||!/^#[0-9a-f]{6}$/i.test(style.textColor)))throw Error('글자색은 #FF0000 같은 RGB 값으로 지정하세요.');
  for(const key of ['bold','italic','underline','strikethrough'])if(Object.hasOwn(style,key)&&typeof style[key]!=='boolean')throw Error('굵게·기울임·밑줄·취소선 값은 참 또는 거짓이어야 합니다.');
  if(Object.hasOwn(style,'fontSize')&&(!Number.isSafeInteger(style.fontSize)||style.fontSize<600||style.fontSize>7200))throw Error('글자 크기는 6~72pt 범위로 지정하세요.');
 }
}

function charProperties(w,source,offset){
 return parsed(source.cellPath
  ?w.getCellCharPropertiesAtByPath(source.section,source.paragraph,pathJson(source),offset)
  :w.getCharPropertiesAt(source.section,source.paragraph,offset));
}
function paragraphProperties(w,source){
 return parsed(source.cellPath
  ?w.getCellParaPropertiesAtByPath(source.section,source.paragraph,pathJson(source))
  :w.getParaPropertiesAt(source.section,source.paragraph));
}
function publicCharacterStyle(style){
 return Object.fromEntries(['fontFamily',...characterStyleKeys].map(key=>[key,style[key]]));
}

function publicParagraphStyle(style){
 return Object.fromEntries(['alignment','lineSpacing','lineSpacingType','spacingBefore','spacingAfter'].map(key=>[key,style[key]]));
}

export function applyParagraphStyles(w,prepared){
 for(const {source,original,style} of prepared.groups){
  const {lineSpacingPercent,...props}=style;
  if(lineSpacingPercent!==undefined)Object.assign(props,{lineSpacingType:'Percent',lineSpacing:lineSpacingPercent});
  const json=JSON.stringify(props);
  checked(source.cellPath
   ?w.applyParaFormatInCellByPath(source.section,source.paragraph,pathJson(source),json)
   :w.applyParaFormat(source.section,source.paragraph,json));
  const actual=paragraphProperties(w,source);
  if(Object.keys(props).some(key=>actual[key]!==props[key])||readParagraph(w,source)!==original)throw Error('문단 모양 적용 결과를 확인하지 못했습니다.');
 }
 w.flushDeferredPagination();
 return {paragraphs:prepared.groups.length};
}

function resolveTextMatch(w,plans,edit,context){
 const plan=plans.get(edit.searchId);
 if(!plan)throw Error('검색 결과가 만료되었습니다. 다시 검색하세요.');
 assertTextRevision(plan.revision,context);
 const ref=plan.refs.find(candidate=>candidate.id===edit.matchId);
 if(!ref)throw Error('검색 결과의 문장 위치를 확인하세요.');
 const actual=readParagraph(w,ref.source);
 if(actual!==ref.paragraphText)throw Error('검색한 문단이 변경되었습니다. 다시 검색해 주세요.');
 return {ref,actual};
}

export function prepareTextStyles(w,plans,edits,context,paragraph=false){
 validateTextStyles(edits,paragraph);
 const groups=new Map();
 for(const edit of edits){
  const {ref,actual}=resolveTextMatch(w,plans,edit,context);
  const key=sourceKey(ref.source);
  if(paragraph){
   if(groups.has(key))throw Error('같은 문단의 서식은 하나로 합쳐 주세요.');
   groups.set(key,{source:ref.source,original:actual,style:{...edit.style}});
   continue;
  }
  const group=groups.get(key)||{source:ref.source,original:actual,ranges:[]};
  const end=ref.start+ref.length;
  if(group.ranges.some(range=>ref.start<range.end&&range.start<end))throw Error('서식을 적용할 텍스트 범위가 겹칩니다.');
  shapeIds(w,ref.source,ref.start,end);
  group.ranges.push({start:ref.start,end,style:{...edit.style}});
  groups.set(key,group);
 }
 return {groups:[...groups.values()],count:edits.length};
}

export function applyTextStyles(w,prepared){
 for(const {source,original,ranges} of prepared.groups){
  for(const {start,end,style} of ranges){
   const values=JSON.stringify(style);
   checked(source.cellPath
    ?w.applyCharFormatInCellByPath(source.section,source.paragraph,pathJson(source),start,end,values)
    :w.applyCharFormat(source.section,source.paragraph,start,end,values));
  }
  for(const {start,end,style} of ranges){
   const runs=charRuns(w,source,start,end);
   if(runs.some(run=>{const actual=charProperties(w,source,run.startOffset);return Object.entries(style).some(([key,value])=>key==='textColor'?actual[key]?.toLowerCase()!==value.toLowerCase():actual[key]!==value);}))throw Error('글자 모양 적용 결과를 확인하지 못했습니다.');
  }
  if(readParagraph(w,source)!==original)throw Error('글자 서식 적용 중 원문이 변경되었습니다.');
 }
 w.flushDeferredPagination();
 return {ranges:prepared.count,paragraphs:prepared.groups.length};
}
export function createTextSearchPlan(w,context,query,{cursor=0,limit=40,includeStyle=false}={}){
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
  const formats=includeStyle?charRuns(w,source,ref.start,ref.start+ref.length).map(run=>({start:run.startOffset,end:run.endOffset,...publicCharacterStyle(charProperties(w,source,run.startOffset))})):undefined;
  hits.push({...ref,...(formats?{formats,paragraphStyle:publicParagraphStyle(paragraphProperties(w,source))}:{}),kind:source.cellPath?'cell_text':'body_text',depth:source.cellPath?.length||0});budget+=text.length;
 }
 return {revision:textRevision(context),refs,result:{query,hits,totalMatches:raw.length,nextCursor:index<raw.length?index:null,truncated:index<raw.length,notice:'본문·표 셀·중첩 셀의 원문 주소입니다. 같은 문구의 여러 결과는 주변 문단과 cellPath로 구분하세요. 수식 스크립트는 편집 대상에서 제외합니다.'}};
}

// The cursor model enumerates logical cells, including hidden and split-page rows.
export function styleScanSources(w,scope){
 const sources=[],unsupported=[];
 if(scope!=='tables')for(let section=0;section<w.getSectionCount();section++){
  for(let paragraph=0,count=w.getParagraphCount(section);paragraph<count;paragraph++)sources.push({section,paragraph});
 }
 if(scope==='body')return {sources,unsupported};
 const model=parsed(w.getCursorModel());
 if(!Array.isArray(model?.lists))throw Error('표 셀의 조판 주소를 읽지 못했습니다.');
 const lists=new Map(model.lists.map(list=>[list.listId,list]));
 for(const cell of model.lists){
  if(!cell.isCell)continue;
  const chain=[cell];let parent=cell;
  while(parent.hostListId!==0){
   parent=lists.get(parent.hostListId);
   if(!parent?.isCell||chain.includes(parent))break;
   chain.unshift(parent);
  }
  const root=chain[0];
  if(root.hostListId!==0){unsupported.push(cell.listId);continue;}
  const cellPath=chain.map((item,index)=>({controlIndex:item.controlIndex,cellIndex:item.cellIndex,cellParaIndex:chain[index+1]?.hostPara??0}));
  const {sectionIndex:section,hostPara:paragraph}=root;
  // Resolve the path against the engine rather than relying on visual fragments.
  const count=w.getCellParagraphCountByPath(section,paragraph,JSON.stringify(cellPath));
  if(!Number.isSafeInteger(cell.paraCount)||cell.paraCount!==count){unsupported.push(cell.listId);continue;}
  for(let p=0;p<cell.paraCount;p++){
   sources.push({section,paragraph,cellPath:cellPath.map((entry,index)=>index===cellPath.length-1?{...entry,cellParaIndex:p}:entry)});
  }
 }
 sources.sort((a,b)=>{
  const byParagraph=a.section-b.section||a.paragraph-b.paragraph;
  if(byParagraph)return byParagraph;
  const left=a.cellPath||[],right=b.cellPath||[];
  for(let i=0;i<Math.min(left.length,right.length);i++){
   const difference=left[i].controlIndex-right[i].controlIndex||left[i].cellIndex-right[i].cellIndex||left[i].cellParaIndex-right[i].cellParaIndex;
   if(difference)return difference;
  }
  return left.length-right.length;
 });
 return {sources,unsupported};
}

export function createStyleScanPlan(w,index,context,{filter='all',cursor={index:0,offset:0},limit=40}={}){
 const {sources,unsupported}=index;
 let position=cursor.index,offset=cursor.offset,read=0;
 if(position>sources.length||position===sources.length&&offset)throw Error('서식 검사 위치가 범위를 넘었습니다.');
 const hits=[],refs=[],styles=new Map();
 const paragraphLength=source=>source.cellPath
  ?w.getCellParagraphLengthByPath(source.section,source.paragraph,pathJson(source))
  :w.getParagraphLength(source.section,source.paragraph);
 while(position<sources.length&&read<256&&hits.length<limit){
  const source=sources[position],length=paragraphLength(source);
  if(offset>length)throw Error('서식 검사 위치가 문단 범위를 넘었습니다.');
  if(offset===length){position++;offset=0;read++;continue;}
  const end=Math.min(length,offset+4096);
  let text,characters,paragraphStyle;
  for(const run of charRuns(w,source,offset,end)){
   const {startOffset:start,endOffset:stop,charShapeId}=run;
   let style=styles.get(charShapeId);
   if(!style){style=publicCharacterStyle(charProperties(w,source,start));styles.set(charShapeId,style);}
   if(filter==='all'||style[filter]===true){
    text??=source.cellPath?w.getTextInCellByPath(source.section,source.paragraph,pathJson(source),0,length):w.getTextRange(source.section,source.paragraph,0,length);
    characters??=chars(text);
    const original=characters.slice(start,stop).join(''),id=String(hits.length);
    paragraphStyle??=publicParagraphStyle(paragraphProperties(w,source));
    const ref={id,source,start,length:stop-start,original,paragraphText:text};
    refs.push(ref);
    hits.push({id,source,start,length:stop-start,text:chars(original).slice(0,180).join(''),style,paragraphStyle});
   }
   offset=stop;
   if(hits.length===limit)break;
  }
  if(offset===length){position++;offset=0;}
  read++;
 }
 const nextCursor=position<sources.length?{index:position,offset}:null;
 return {revision:textRevision(context),refs,result:{hits,nextCursor,truncated:!!nextCursor,unsupportedCellLists:unsupported.length}};
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
  if(!validText(edit.replacement,true)||(total+=edit.replacement.length)>48000)throw Error('수정할 검색 결과와 내용을 확인하세요.');
  const {ref,actual}=resolveTextMatch(w,plans,edit,context);
  const key=sourceKey(ref.source),ids=shapeIds(w,ref.source,ref.start,ref.start+ref.length),part={...ref,replacement:edit.replacement,ids:replacementShapeIds(ref.original,edit.replacement,ids)};
  const group=groups.get(key)||{source:ref.source,text:chars(actual),parts:[]};
  if(group.parts.some(p=>ref.start<p.start+p.length&&p.start<ref.start+ref.length))throw Error('수정할 텍스트 범위가 겹칩니다.');
  group.parts.push(part);groups.set(key,group);parts.push(part);
 }
 for(const group of groups.values()){group.parts.sort((a,b)=>b.start-a.start);for(const p of group.parts)group.text.splice(p.start,p.length,...chars(p.replacement));group.expectedText=group.text.join('');}
 return {groups:[...groups.values()],count:parts.length};
}
export function prepareReportFill(w,answers,context){
 const plans=new Map(),edits=[];
 for(const {marker,text} of answers){
  const plan=createTextSearchPlan(w,context,marker,{limit:100});
  if(!plan.refs.length||plan.result.nextCursor!==null)throw Error('보고서 양식의 작성 위치가 변경되었거나 결과가 너무 많습니다. 문서를 다시 확인하세요.');
  plans.set(marker,plan);
  for(const ref of plan.refs)edits.push({searchId:marker,matchId:ref.id,replacement:text});
 }
 return prepareTextEdits(w,plans,edits,context);
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
