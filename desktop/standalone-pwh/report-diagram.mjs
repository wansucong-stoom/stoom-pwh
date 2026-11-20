export const diagramSpecSchema = {
 type:'object',
 additionalProperties:false,
 required:['title','steps'],
 properties:{
  title:{type:'string',maxLength:60},
  layout:{type:'string',enum:['flow','groups'],description:'시간 순서는 flow, 역할·구성 요소의 묶음은 groups'},
  accent:{type:'string',pattern:'^#[a-fA-F0-9]{6}$',description:'참고 그림의 강조색 또는 문서에 어울리는 색'},
  steps:{type:'array',minItems:2,maxItems:12,items:{type:'object',additionalProperties:false,required:['label'],
   properties:{label:{type:'string',maxLength:25},detail:{type:'string',maxLength:80}}}},
 },
};

const maxSide = 1600;
const normalizeText = (text,max) => {
 if(typeof text!=='string'||text.length>max)throw Error('도식의 제목과 단계 문구를 확인하세요.');
 return text.replace(/\s+/g,' ').trim();
};

export function prepareReportDiagram(spec,reference) {
 if(!Array.isArray(spec?.steps)||spec.steps.length<2||spec.steps.length>12)throw Error('도식 한 장에는 두 단계에서 열두 단계까지 넣을 수 있습니다.');
 const title=normalizeText(spec.title,60),layout=spec.layout??'flow',accent=spec.accent??'#205780';
 if(!title||!['flow','groups'].includes(layout)||typeof accent!=='string'||!/^#[a-f\d]{6}$/i.test(accent))throw Error('도식의 제목, 구성 또는 강조색을 확인하세요.');
 const steps=spec.steps.map(step=>{
  const label=normalizeText(step?.label,25),detail=normalizeText(step?.detail??'',80);
  if(!label)throw Error('도식에 빈 단계 이름이 있습니다.');
  return {label,detail};
 });
 const ratio=reference?reference.widthMm/reference.heightMm:steps.length>6?1.42:2.1;
 if(!Number.isFinite(ratio)||ratio<0.15||ratio>7)throw Error('참고 그림의 폭과 높이 비율을 확인하세요.');
 const width=Math.round(maxSide*Math.min(1,ratio));
 const height=Math.round(maxSide*Math.min(1,1/ratio));
 return {title,layout,accent,steps,width,height};
}
