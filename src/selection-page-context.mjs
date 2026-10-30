/** Only endpoint geometry computed for these exact positions is a page hint. */
export function selectionPageHints(start,end){
 const first=start?.cursorRect?.pageIndex,last=end?.cursorRect?.pageIndex;
 return Number.isInteger(first)&&first>=0&&Number.isInteger(last)&&last>=0?{startPageHint:first,endPageHint:last}:undefined;
}
