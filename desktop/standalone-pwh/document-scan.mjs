// Read-only document scan: the engine walks body, table cells, nested tables
// and supported text boxes. Scan entries do not carry page numbers or styling.
export function scanDocumentText(doc,{maxCharacters=2000000,maxItems=200000}={}){
 const raw=JSON.parse(doc.getScanItems());if(!Array.isArray(raw))throw Error('문서 스캔 결과가 올바르지 않습니다.');
 const items=[];let characters=0,truncated=false;
 for(const entry of raw){if(!entry||typeof entry.text!=='string'||![2,3,4,5].includes(entry.state)){truncated=true;break;}if(entry.kind===1)continue;
  let position=0;const text=entry.text;if(!text){if(items.length>=maxItems){truncated=true;break;}items.push({state:entry.state,text:''});continue;}
  while(position<text.length){if(items.length>=maxItems||characters>=maxCharacters){truncated=true;break;}let end=Math.min(text.length,position+4000,position+maxCharacters-characters);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;if(end<=position){truncated=true;break;}const part=text.slice(position,end);items.push({state:position===0?entry.state:2,text:part});characters+=part.length;position=end;}
  if(truncated)break;
 }
 return {items,truncated};
}
