/** Vertical paragraph geometry does not introduce new glyph/font measurements. */
export function preservesCanvasMetricRequests(method,args){
 if(!['applyParaFormat','applyParaFormatInCell','applyParaFormatInCellByPath','applyParaFormatInHf','applyParaFormatInFootnote'].includes(method))return false;
 let props;try{const value=args.at(-1);props=typeof value==='string'?JSON.parse(value):value;}catch{return false;}
 return isVerticalParagraphFormat(props);
}
export function isVerticalParagraphFormat(props){
 if(!props||typeof props!=='object'||Array.isArray(props))return false;
 const keys=Object.keys(props);if(!keys.length||keys.some(key=>!['lineSpacing','lineSpacingType'].includes(key)))return false;
 if(Object.hasOwn(props,'lineSpacing')&&(!Number.isFinite(props.lineSpacing)||props.lineSpacing<0))return false;
 if(Object.hasOwn(props,'lineSpacingType')&&!['Percent','Fixed','AtLeast','BetweenLines'].includes(props.lineSpacingType))return false;
 return true;
}
export function installCanvasMetricMutationGuards(bridge,methods,invalidate){
 const restores=['restoreSnapshot','restoreDeleteFragment','restoreSectionRaw','swapPictureTransform','insertPwhScratchParagraph','deletePwhScratchParagraph','deleteBodyParagraph'];
 for(const name of new Set([...methods,...restores])){
  const method=bridge[name];if(typeof method!=='function')continue;
  bridge[name]=function(...args){if(!preservesCanvasMetricRequests(name,args))invalidate();return method.apply(this,args);};
 }
}
