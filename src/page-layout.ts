const presets:Record<string,[number,number]>={A4:[59528,84188],A3:[84188,119055],B4:[72850,103040],B5:[51502,72850],Letter:[62208,80496],Legal:[62208,102816]};
const margins:Record<string,string>={left:'marginLeft',right:'marginRight',top:'marginTop',bottom:'marginBottom',header:'marginHeader',footer:'marginFooter',gutter:'marginGutter'};
export function validateLayout(p:any){
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['paper','orientation','marginsMm'].includes(k))||!Object.keys(p).length)throw Error('용지·방향·여백 중 변경할 설정을 지정하세요.');
 if(p.paper!==undefined&&!presets[p.paper])throw Error('지원되지 않는 용지입니다.');
 if(p.orientation!==undefined&&!['portrait','landscape'].includes(p.orientation))throw Error('용지 방향을 확인하세요.');
 if(p.marginsMm!==undefined){if(!p.marginsMm||typeof p.marginsMm!=='object'||Array.isArray(p.marginsMm)||!Object.keys(p.marginsMm).length||Object.entries(p.marginsMm).some(([k,v])=>!margins[k]||typeof v!=='number'||!Number.isFinite(v)||v<0||v>150))throw Error('여백은 0~150mm 범위의 숫자여야 합니다.');}
}
export function layoutDefinitions(wasm:any,patch:any,sectionIndex?:number){
 validateLayout(patch);const count=wasm.getSectionCount();
 if(sectionIndex!==undefined&&(!Number.isInteger(sectionIndex)||sectionIndex<0||sectionIndex>=count))throw Error('구역 번호를 확인하세요.');
 return Array.from({length:sectionIndex===undefined?count:1},(_,i)=>{
  const section=sectionIndex??i,raw=wasm.getPageDef(section),before=typeof raw==='string'?JSON.parse(raw):raw,after={...before};
  if(patch.paper)[after.width,after.height]=presets[patch.paper];
  if(patch.orientation!==undefined)after.landscape=patch.orientation==='landscape';
  for(const [key,value]of Object.entries(patch.marginsMm||{}))after[margins[key]]=Math.round(Number(value)*7200/25.4);
  // Core stores portrait dimensions; landscape rotates the page's usable axes.
  const width=after.landscape?after.height:after.width,height=after.landscape?after.width:after.height;
  if(width-after.marginLeft-after.marginRight-after.marginGutter<2835||height-after.marginTop-after.marginBottom<2835)throw Error('여백을 적용하면 본문 영역이 너무 작습니다.');
  return {section,before,after};
 });
}
export function applyLayout(wasm:any,patch:any,sectionIndex?:number){
 const changes=layoutDefinitions(wasm,patch,sectionIndex);
 for(const change of changes){const result=wasm.setPageDef(change.section,change.after);const parsed=typeof result==='string'?JSON.parse(result):result;if(parsed?.ok===false)throw Error('용지 설정 적용 실패');}
 wasm.flushDeferredPagination();
 for(const {section,after}of changes){const raw=wasm.getPageDef(section),actual=typeof raw==='string'?JSON.parse(raw):raw;for(const key of Object.keys(after))if(JSON.stringify(actual[key])!==JSON.stringify(after[key]))throw Error('용지 설정 결과 검증 실패');}
 return changes;
}
