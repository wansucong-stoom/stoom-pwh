import {tableSnapshot} from './table-style.mjs';
import {validateTableSpec,insertStructuredTable,applyCellEdits,prepareCellEdits} from './table-content.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const parse=v=>typeof v==='string'?JSON.parse(v):v;

export function selectedTableFragment(snapshot,indices){
 if(!Array.isArray(indices)||!indices.length||new Set(indices).size!==indices.length)throw Error('Select table cells to copy');
 const selected=indices.map(i=>snapshot.cells[i]);if(selected.some(c=>!c))throw Error('Invalid selected cell');
 const top=Math.min(...selected.map(c=>c.geometry.row)),left=Math.min(...selected.map(c=>c.geometry.col));
 const bottom=Math.max(...selected.map(c=>c.geometry.row+c.geometry.rowSpan)),right=Math.max(...selected.map(c=>c.geometry.col+c.geometry.colSpan));
 const spec={rows:bottom-top,columns:right-left,cells:selected.map(c=>({row:c.geometry.row-top,column:c.geometry.col-left,rowSpan:c.geometry.rowSpan,columnSpan:c.geometry.colSpan,paragraphs:c.paragraphs.map(p=>p.text)}))};
 validateTableSpec(spec);
 for(const cell of selected)for(const p of cell.paragraphs)if(Array.from(p.text).length!==p.length||/[\u0000-\u0008\ufffc]/.test(p.text))throw Error('Selected cells contain an object; copy its source HWPX instead');
 const rows=Array.from({length:spec.rows},()=>[]),plain=Array.from({length:spec.rows},()=>Array(spec.columns).fill(''));
 selected.forEach((cell,i)=>{
  const c=spec.cells[i],props=cell.properties;
  const paragraphs=cell.paragraphs.map(p=>{
   const chars=Array.from(p.text);
   const runs=p.formats.map((run,index)=>{
    const f=run.format,text=chars.slice(run.offset,p.formats[index+1]?.offset??chars.length).join('');
    return `<span style="font-family:${esc(f.fontFamily||'맑은 고딕')};font-size:${(f.fontSize||1000)/100}pt;font-weight:${f.bold?'bold':'normal'};font-style:${f.italic?'italic':'normal'};color:${esc(f.textColor||'#000000')}">${esc(text)}</span>`;
   }).join('');return `<p style="margin:0;text-align:${esc(p.format.alignment||'left')}">${runs||'<br>'}</p>`;
  }).join('');
  rows[c.row].push({column:c.column,html:`<td rowspan="${c.rowSpan}" colspan="${c.columnSpan}" style="border:1px solid #000;padding:2pt;width:${(props.width||0)/100}pt;background:${esc(props.fillType==='solid'?props.fillColor:'#ffffff')}">${paragraphs}</td>`});
  plain[c.row][c.column]=c.paragraphs.join('\n');
 });
 return {spec,text:plain.map(r=>r.join('\t')).join('\n'),html:`<table style="border-collapse:collapse">${rows.map(r=>'<tr>'+r.sort((a,b)=>a.column-b.column).map(c=>c.html).join('')+'</tr>').join('')}</table>`};
}

export function tableFromClipboardHtml(html,Parser=globalThis.DOMParser){
 if(typeof html!=='string'||!html.trim()||html.length>8*1024*1024)return null;
 if(typeof Parser!=='function')throw Error('HTML parser unavailable');
 // Windows CF_HTML offsets are bytes, so never slice a Unicode JS string by
 // those offsets. Parsing the full HTML envelope preserves Korean text.
 if(!/<table\b/i.test(html)&&/<(?:tr|td|th)\b/i.test(html))html='<table>'+html+'</table>';
 const doc=new Parser().parseFromString(html,'text/html'),tables=doc.querySelectorAll('table');
 if(!tables.length)return null;
 if(tables.length!==1||tables[0].querySelector('table,img,svg,object,embed,math'))throw Error('Copy one flat text table without images or nested objects');
 const table=tables[0],cells=[],used=new Set();let columns=0;
 const rows=Array.from(table.rows);if(rows.length>256)throw Error('Table exceeds 256 grid positions');
 rows.forEach((row,r)=>{
  let col=0;
  for(const cell of Array.from(row.cells)){
   while(used.has(r+':'+col))col++;
   const rowSpan=cell.rowSpan===0?rows.length-r:cell.rowSpan||1,columnSpan=cell.colSpan||1;
   if(rowSpan<1||columnSpan<1||r+rowSpan>rows.length||columnSpan>256)throw Error('Invalid clipboard cell spans');
   const paragraphs=[];let buffer='';
   const flush=()=>{paragraphs.push(buffer.replace(/\u00a0/g,' '));buffer='';};
   const walk=node=>{
    if(node.nodeType===3){if(node.parentElement===cell&&!node.textContent.trim()&&Array.from(cell.children).some(n=>['P','DIV'].includes(n.tagName)))return;buffer+=node.textContent.replace(/[\r\n\t]+/g,' ');return;}
    if(node.nodeType!==1||['SCRIPT','STYLE','META','LINK'].includes(node.tagName))return;
    if(node.tagName==='BR'){flush();return;}
    const block=['P','DIV','LI'].includes(node.tagName);if(block&&buffer)flush();
    for(const child of node.childNodes)walk(child);
    if(block&&(buffer||!paragraphs.length))flush();
   };
   for(const child of cell.childNodes)walk(child);if(buffer||!paragraphs.length)flush();
   cells.push({row:r,column:col,rowSpan,columnSpan,paragraphs});
   for(let dr=0;dr<rowSpan;dr++)for(let dc=0;dc<columnSpan;dc++){const key=(r+dr)+':'+(col+dc);if(used.has(key))throw Error('Overlapping clipboard cells');used.add(key);}
   col+=columnSpan;columns=Math.max(columns,col);
  }
 });
 return validateTableSpec({rows:rows.length,columns,cells});
}

export function tableFromClipboardText(text){
 if(typeof text!=='string'||!text.includes('\t')||text.length>24000)return null;
 const rows=text.replace(/\r\n?/g,'\n').replace(/\n$/,'').split('\n').map(r=>r.split('\t'));
 const columns=rows[0]?.length;if(!columns||rows.some(r=>r.length!==columns))return null;
 return validateTableSpec({rows:rows.length,columns,cells:rows.flatMap((row,r)=>row.map((value,column)=>({row:r,column,paragraphs:[value]})))});
}

export function pasteClipboardCells(w,context,spec){
 validateTableSpec(spec);const source=context.table?.source,pos=context.cursor;
 if(!source||source.cellPath?.length>1)throw Error('Use a flat body table destination');
 const ref={sec:source.sec,ppi:source.ppi,ci:source.ci},snapshot=tableSnapshot(w,ref.sec,ref.ppi,ref.ci);
 const selected=context.kind==='cell_block'?context.table.selectedCells:null;
 const anchor=selected?.length?snapshot.cells[selected[0].cellIndex]:snapshot.cells[pos.cellIndex];if(!anchor)throw Error('Choose a destination cell');
 const top=selected?.length?Math.min(...selected.map(c=>c.row)):anchor.geometry.row,left=selected?.length?Math.min(...selected.map(c=>c.col)):anchor.geometry.col;
 const allowed=selected?.length?new Set(selected.map(c=>c.cellIndex)):null,edits=[];
 for(const cell of spec.cells){
  const index=snapshot.cells.findIndex(c=>c.geometry.row===top+cell.row&&c.geometry.col===left+cell.column);
  const target=snapshot.cells[index];
  if(!target||allowed&&!allowed.has(index)||target.geometry.rowSpan!==(cell.rowSpan??1)||target.geometry.colSpan!==(cell.columnSpan??1))throw Error('Destination cells must fit the copied rows, columns and merges');
  edits.push({cellIndex:index,paragraphs:cell.paragraphs});
 }
 if(allowed&&allowed.size!==edits.length)throw Error('Select a destination block matching the copied cells');
 // Preflight all original paragraphs before reshaping text containers. Row,
 // column and merge geometry remain unchanged, even for multiline cell paste.
 prepareCellEdits(w,ref,edits.map(e=>({cellIndex:e.cellIndex,paragraphs:snapshot.cells[e.cellIndex].paragraphs.map(p=>p.text)})),allowed?[...allowed]:undefined);
 const checked=value=>{if(parse(value)?.ok!==true)throw Error('Cell paragraph operation failed');};
 for(const edit of edits){
  const old=snapshot.cells[edit.cellIndex].paragraphs;if(old.length===edit.paragraphs.length)continue;
  for(let p=0;p<old.length;p++)if(old[p].length)checked(w.deleteTextInCell(ref.sec,ref.ppi,ref.ci,edit.cellIndex,p,0,old[p].length));
  for(let count=old.length;count>edit.paragraphs.length;count--)checked(w.mergeParagraphInCell(ref.sec,ref.ppi,ref.ci,edit.cellIndex,count-1));
  for(let count=old.length;count<edit.paragraphs.length;count++)checked(w.splitParagraphInCell(ref.sec,ref.ppi,ref.ci,edit.cellIndex,count-1,0));
 }
 return applyCellEdits(w,ref,edits,allowed?[...allowed]:undefined);
}

export function installTableClipboard({wasm,read,getInput,mutate,notice,nativeRead}){
 let bypass=false,plainPasteUntil=0;
 const payload=()=>{
  const input=getInput(),context=read();let ref,indices;
  if(context.kind==='cell_block'){
   if(!context.table?.selectedCellsComplete||!context.table.selectedCells?.length)throw Error('Select a complete rectangular cell block');
   ref=context.table.source;indices=context.table.selectedCells.map(c=>c.cellIndex);
  }else if(input?.isInTableObjectSelection())ref=input.getSelectedTableRef();else return null;
  if(ref.cellPath?.length>1)throw Error('Nested table copying is not supported yet');
  const snapshot=tableSnapshot(wasm,ref.sec,ref.ppi,ref.ci);indices??=snapshot.cells.map((_,i)=>i);
  return selectedTableFragment(snapshot,indices);
 };
 document.addEventListener('copy',event=>{
  let data;try{data=payload();}catch(error){event.preventDefault();event.stopImmediatePropagation();notice(error.message);return;}
  if(!data)return;event.preventDefault();event.stopImmediatePropagation();
  event.clipboardData?.setData('text/plain',data.text);event.clipboardData?.setData('text/html',data.html);
  notice('선택한 '+data.spec.cells.length+'개 셀을 복사했습니다.');
 },true);
 window.addEventListener('keydown',event=>{
  const key=event.code==='KeyC'?'c':event.code==='KeyV'?'v':event.key.toLowerCase();
  if((event.ctrlKey||event.metaKey)&&event.shiftKey&&key==='v'){plainPasteUntil=Date.now()+1500;return;}
  if(!(event.ctrlKey||event.metaKey)||event.altKey)return;
  const input=getInput();
  if(key==='v'&&input?.isInCellSelectionMode()){event.stopImmediatePropagation();return;}
  if(key!=='c'||!input?.isInCellSelectionMode()&&!input?.isInTableObjectSelection())return;
  event.preventDefault();event.stopImmediatePropagation();document.execCommand('copy');
 },true);
 const input=getInput();if(input){const original=input.performCopy.bind(input);input.performCopy=()=>input.isInCellSelectionMode()||input.isInTableObjectSelection()?document.execCommand('copy'):original();}
 const apply=async(spec,expected)=>mutate(expected,w=>{
  if(expected.cursor?.parentParaIndex!=null)return pasteClipboardCells(w,expected,spec);
  if(expected.selection)throw Error('Place a body cursor outside a selection before pasting a table');
  return insertStructuredTable(w,expected.cursor,spec);
 });
 document.addEventListener('paste',event=>{
  if(bypass)return;if(Date.now()<plainPasteUntil){plainPasteUntil=0;return;}
  const expected=structuredClone(read()),data=event.clipboardData;
  if(!expected.ready||!data)return;
  const html=data.getData('text/html'),text=data.getData('text/plain');let spec;
  try{spec=tableFromClipboardHtml(html)||tableFromClipboardText(text);}catch(error){event.preventDefault();event.stopImmediatePropagation();notice(error.message);return;}
  const needNative=!spec&&event.isTrusted&&nativeRead&&(!text.trim()||text.includes('\t'));
  if(!spec&&!needNative)return;
  event.preventDefault();event.stopImmediatePropagation();
  void(async()=>{
   try{
    if(!spec){const native=await nativeRead();spec=tableFromClipboardHtml(native.html)||tableFromClipboardText(native.text);if(!spec&&native.formats?.some(f=>/hwp|hancom|hanword/i.test(f)))throw Error('한글 전용 클립보드만 있고 표 HTML이 없습니다. 원본 HWPX 파일을 열어 가져와 주세요.');}
    if(spec){await apply(spec,expected);notice('표·셀 붙여넣기를 완료했습니다. 실행 취소 한 번으로 되돌릴 수 있습니다.');}
    else{bypass=true;try{event.target.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));}finally{bypass=false;}}
   }catch(error){notice('표·셀 붙여넣기: '+error.message);}
  })();
 },true);
 window.addEventListener('pwh-import-native-table',()=>{
  const expected=structuredClone(read());
  void(async()=>{try{const data=await nativeRead(),spec=tableFromClipboardHtml(data.html)||tableFromClipboardText(data.text);if(!spec)throw Error('클립보드에서 표 구조를 찾지 못했습니다. 한글에서 표 또는 셀을 다시 복사하거나 원본 HWPX를 열어 주세요.');await apply(spec,expected);notice('한글 표·셀을 가져왔습니다.');}catch(error){notice(error.message);}})();
 });
 return {copySelected:payload,paste:apply};
}
