export function pictureTarget(context:any){
 if(context?.kind!=='object'||context.objects?.length!==1)throw Error('교체할 그림 하나를 선택하세요.');
 const ref=context.objects[0].source;
 if(ref?.type!=='image'||ref.headerFooter||ref.noteRef||!['sec','ppi','ci'].every(k=>Number.isSafeInteger(ref[k])&&ref[k]>=0))throw Error('현재는 본문·표 셀의 그림 교체만 지원합니다.');
 const path=ref.cellPath?.length?ref.cellPath:ref.cellIdx!==undefined&&ref.outerTableControlIdx!==undefined?[{controlIndex:ref.outerTableControlIdx,cellIndex:ref.cellIdx,cellParaIndex:ref.cellParaIdx??0}]:[];
 if(ref.cellIdx!==undefined&&!path.length)throw Error('표 셀 경로가 불완전합니다.');
 return {ref,path,pathJson:JSON.stringify(path)};
}
export function replaceSelectedPicture(wasm:any,context:any,bytes:Uint8Array,image:any){
 const {ref,path,pathJson}=pictureTarget(context);
 const before=path.length?wasm.getCellPicturePropertiesByPath(ref.sec,ref.ppi,path,ref.ci):wasm.getPictureProperties(ref.sec,ref.ppi,ref.ci);
 if(JSON.stringify(before)!==JSON.stringify(context.objects[0].properties))throw Error('그림 속성이 바뀌었습니다. 다시 선택하세요.');
 const result=wasm.assignPictureImage(ref.sec,ref.ppi,pathJson,ref.ci,bytes,image.width,image.height,image.extension);
 const parsed=typeof result==='string'?JSON.parse(result):result;if(parsed?.ok!==true)throw Error('그림 교체 실패');
 wasm.flushDeferredPagination();
 const after=path.length?wasm.getCellPicturePropertiesByPath(ref.sec,ref.ppi,path,ref.ci):wasm.getPictureProperties(ref.sec,ref.ppi,ref.ci);
 if(JSON.stringify(after)!==JSON.stringify(before))throw Error('그림 배치·속성이 달라져 교체를 취소합니다.');
 const actual=wasm.getControlImageData(ref.sec,ref.ppi,ref.ci,pathJson);
 if(actual.length!==bytes.length||actual.some((value:number,i:number)=>value!==bytes[i]))throw Error('교체 이미지 바이트 검증 실패');
 return {source:ref,propertiesPreserved:true,byteLength:bytes.length,binDataId:parsed.binDataId};
}
