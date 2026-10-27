// Cell HTML import in the bundled engine can report success after flattening
// tables/objects. Refuse that path before deleting the destination selection.
export function cellClipboardRisk({inCell,internalControl=false,hasTables=false,hasObjects=false}) {
 return Boolean(inCell&&(internalControl||hasTables||hasObjects));
}
// Office applications can supply both an editable HTML table and a bitmap
// preview. The bitmap must not hide the editable representation.
export function preferStructuredClipboardHtml(html){
 if(typeof html!=='string'||!html)return false;
 try{return !!new DOMParser().parseFromString(html,'text/html').querySelector('table');}
 catch{return false;}
}
export function clipboardCellWarning(position,html,internalControl=false) {
 const inCell=position.parentParaIndex!==undefined||(position.cellPath?.length??0)>0;
 if(!inCell)return null;
 let hasTables=false,hasObjects=false;
 if(html){
  try{
   const parsed=new DOMParser().parseFromString(html,'text/html');
   hasTables=Boolean(parsed.querySelector('table'));
   hasObjects=Boolean(parsed.querySelector('img,svg,object,embed,canvas,math,v\\:shape,v\\:imagedata'));
  }catch{return '셀 안에 붙일 서식 구조를 확인하지 못했습니다. 기존 내용은 유지했습니다.';}
 }
 return cellClipboardRisk({inCell,internalControl,hasTables,hasObjects})
  ?'현재 셀 붙여넣기 경로는 표·객체 구조를 보존하지 못할 수 있어 중단했습니다. 기존 내용은 유지했습니다. 텍스트만 붙이려면 일반 텍스트로 붙여넣기를 사용하세요.'
  :null;
}
