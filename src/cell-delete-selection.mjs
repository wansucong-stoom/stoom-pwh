// Classify only selections that cover complete grid lines and whole merged cells.
export function classifyCellDeleteSelection({rowCount,colCount,cells,selected}) {
 if (!Number.isInteger(rowCount)||!Number.isInteger(colCount)||rowCount<1||colCount<1) return {kind:'partial'};
 const chosen=new Set(selected);
 const grid=Array.from({length:rowCount},()=>Array(colCount).fill(false));
 for (let i=0;i<cells.length;i++) {
  const c=cells[i];
  if(!Number.isInteger(c.row)||!Number.isInteger(c.col)||!Number.isInteger(c.rowSpan)||!Number.isInteger(c.colSpan)||c.row<0||c.col<0||c.rowSpan<1||c.colSpan<1||c.row+c.rowSpan>rowCount||c.col+c.colSpan>colCount) return {kind:'partial'};
  if(chosen.has(i)) for(let r=c.row;r<c.row+c.rowSpan;r++) for(let k=c.col;k<c.col+c.colSpan;k++) grid[r][k]=true;
 }
 const rows=grid.map((row,i)=>row.every(Boolean)?i:-1).filter(i=>i>=0);
 const cols=Array.from({length:colCount},(_,i)=>grid.every(row=>row[i])?i:-1).filter(i=>i>=0);
 const count=grid.flat().filter(Boolean).length;
 if(rows.length && count===rows.length*colCount && rows.length<rowCount) return {kind:'rows',indices:rows};
 if(cols.length && count===cols.length*rowCount && cols.length<colCount) return {kind:'columns',indices:cols};
 if(count===rowCount*colCount) return {kind:'table'};
 return {kind:'partial'};
}
