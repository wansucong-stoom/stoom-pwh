import {tableSnapshot} from './table-style.mjs';
import {sameRequestValue} from './request-state.mjs';
const parsed=v=>typeof v==='string'?JSON.parse(v):v;
const check=v=>{const r=parsed(v);if(r?.ok!==true)throw Error('Table operation failed');return r;};
const size=text=>Array.from(text).length;
const validText=text=>typeof text==='string'&&text.length<=24000&&!/[\r\n\u0000-\u0008\u000b-\u001f\ufffc]/.test(text);

export function validateCellEdits(edits,allowed){
 if(!Array.isArray(edits)||!edits.length||edits.length>256)throw Error('Provide 1 to 256 cell edits');
 const seen=new Set();let total=0;
 for(const e of edits){
  if(!e||Object.keys(e).some(k=>!['cellIndex','paragraphs'].includes(k))||!Number.isSafeInteger(e.cellIndex)||e.cellIndex<0||seen.has(e.cellIndex)||allowed&&!allowed.includes(e.cellIndex))throw Error('Invalid, duplicate or unselected cell');
  seen.add(e.cellIndex);
  if(!Array.isArray(e.paragraphs)||!e.paragraphs.length||e.paragraphs.length>128||e.paragraphs.some(p=>!validText(p))||(total+=e.paragraphs.reduce((n,p)=>n+p.length,0))>24000)throw Error('Invalid cell paragraphs; maximum total text is 24000 characters');
 }
}

// Read and validate every destination before making the first mutation.
export function prepareCellEdits(w,ref,edits,allowed){
 validateCellEdits(edits,allowed);const snapshot=tableSnapshot(w,ref.sec,ref.ppi,ref.ci);
 for(const e of edits){
  const cell=snapshot.cells[e.cellIndex];
  if(!cell||cell.paragraphs.length!==e.paragraphs.length)throw Error('Keep the existing paragraph count in each cell');
  for(const p of cell.paragraphs){
   if(size(p.text)!==p.length||!validText(p.text))throw Error('Cell contains an object or unsupported text');
   if(p.formats.length!==1)throw Error('Cell has mixed character formatting; select a uniform cell');
   // Text length equality also detects inline controls omitted from getTextInCell.
  }
 }
 return {...ref,snapshot};
}

export function applyCellEdits(w,ref,edits,allowed){
 ref=prepareCellEdits(w,ref,edits,allowed);const {sec,ppi,ci,snapshot}=ref;
 for(const e of edits)for(let p=0;p<e.paragraphs.length;p++){
  const old=snapshot.cells[e.cellIndex].paragraphs[p],text=e.paragraphs[p];
  if(old.length)check(w.deleteTextInCell(sec,ppi,ci,e.cellIndex,p,0,old.length));
  if(text){
   check(w.insertTextInCell(sec,ppi,ci,e.cellIndex,p,0,text));
   check(w.setCharShapeIdInCell(sec,ppi,ci,e.cellIndex,p,0,size(text),old.formats[0].format.charShapeId));
  }
 }
 w.flushDeferredPagination();const after=tableSnapshot(w,sec,ppi,ci);
 if(!sameRequestValue(snapshot.dimensions,after.dimensions)||!sameRequestValue(snapshot.properties,after.properties))throw Error('Table structure or placement changed');
 for(let i=0;i<snapshot.cells.length;i++){
  const before=snapshot.cells[i],actual=after.cells[i],edit=edits.find(e=>e.cellIndex===i);
  // Height may legitimately grow with the new text. Width, spans, borders and margins must not.
  const stable=cell=>{const {height,...properties}=cell.properties;return {geometry:cell.geometry,properties};};
  if(!sameRequestValue(stable(before),stable(actual)))throw Error('Cell structure or style changed');
  if(!edit){if(!sameRequestValue(before.paragraphs,actual.paragraphs))throw Error('Unselected cell changed');continue;}
  if(actual.paragraphs.length!==edit.paragraphs.length)throw Error('Cell paragraph count changed');
  for(let p=0;p<actual.paragraphs.length;p++){
   const old=before.paragraphs[p],now=actual.paragraphs[p];
   if(now.text!==edit.paragraphs[p]||!sameRequestValue(old.format,now.format)||now.formats.some(f=>!sameRequestValue(f.format,old.formats[0].format)))throw Error('Cell content or formatting verification failed');
  }
 }
 return {cellCount:edits.length,cellIndices:edits.map(e=>e.cellIndex),structurePreserved:true};
}

// Explicit cell coordinates represent merged tables without placeholder strings.
export function validateTableSpec(spec){
 if(!spec||Object.keys(spec).some(k=>!['rows','columns','cells'].includes(k))||!Number.isSafeInteger(spec.rows)||!Number.isSafeInteger(spec.columns)||spec.rows<1||spec.columns<1||spec.rows*spec.columns>256||!Array.isArray(spec.cells)||!spec.cells.length||spec.cells.length>256)throw Error('Table must have 1 to 256 grid positions');
 const occupied=new Set();let total=0;
 for(const c of spec.cells){
  if(!c||Object.keys(c).some(k=>!['row','column','rowSpan','columnSpan','paragraphs'].includes(k))||![c.row,c.column,c.rowSpan??1,c.columnSpan??1].every(Number.isSafeInteger)||c.row<0||c.column<0||(c.rowSpan??1)<1||(c.columnSpan??1)<1||c.row+(c.rowSpan??1)>spec.rows||c.column+(c.columnSpan??1)>spec.columns)throw Error('Invalid cell coordinates or span');
  validateCellEdits([{cellIndex:0,paragraphs:c.paragraphs}]);total+=c.paragraphs.reduce((n,p)=>n+p.length,0);if(total>24000)throw Error('Table text exceeds 24000 characters');
  for(let r=c.row;r<c.row+(c.rowSpan??1);r++)for(let col=c.column;col<c.column+(c.columnSpan??1);col++){const key=r*spec.columns+col;if(occupied.has(key))throw Error('Overlapping cells');occupied.add(key);}
 }
 if(occupied.size!==spec.rows*spec.columns)throw Error('Table grid has missing cells');
 return spec;
}

export function insertStructuredTable(w,position,spec){
 validateTableSpec(spec);
 if(position.parentParaIndex!=null||position.cellPath?.length||position.headerFooter||position.noteRef)throw Error('Insert a new table at a body cursor outside existing cells');
 const {sectionIndex:sec,paragraphIndex:ppi,charOffset}=position;
 if(![sec,ppi,charOffset].every(n=>Number.isSafeInteger(n)&&n>=0)||charOffset>w.getParagraphLength(sec,ppi))throw Error('Invalid insertion position');
 const created=check(w.createTable(sec,ppi,charOffset,spec.rows,spec.columns)),ci=created.controlIdx,parent=created.paraIdx;
 if(!Number.isSafeInteger(ci)||!Number.isSafeInteger(parent))throw Error('Missing created table address');
 for(const c of spec.cells)if((c.rowSpan??1)>1||(c.columnSpan??1)>1)check(w.mergeTableCells(sec,parent,ci,c.row,c.column,c.row+(c.rowSpan??1)-1,c.column+(c.columnSpan??1)-1));
 const merged=tableSnapshot(w,sec,parent,ci);
 for(const c of spec.cells){
  const cellIndex=merged.cells.findIndex(x=>x.geometry.row===c.row&&x.geometry.col===c.column);
  if(cellIndex<0)throw Error('Created cell not found');
  const g=merged.cells[cellIndex].geometry;if(g.rowSpan!==(c.rowSpan??1)||g.colSpan!==(c.columnSpan??1))throw Error('Created merge differs');
  for(let p=1;p<c.paragraphs.length;p++)check(w.splitParagraphInCell(sec,parent,ci,cellIndex,p-1,0));
 }
 const ref={sec,ppi:parent,ci},snapshot=tableSnapshot(w,sec,parent,ci);
 const edits=spec.cells.map(c=>({cellIndex:snapshot.cells.findIndex(x=>x.geometry.row===c.row&&x.geometry.col===c.column),paragraphs:c.paragraphs}));
 const changes=applyCellEdits(w,ref,edits);
 return {...changes,source:ref,rows:spec.rows,columns:spec.columns};
}
