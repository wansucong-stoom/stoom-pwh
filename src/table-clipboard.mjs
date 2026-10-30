import {tableSnapshot,applyTableStyles} from './table-style.mjs';
import {validateTableSpec,insertStructuredTable,applyCellEdits,prepareCellEdits} from './table-content.mjs';
import {extractHancomTableModel,pasteHancomTableInCell,pasteInternalTableInCell,pasteHtmlTableInCell} from './nested-table-paste.mjs';
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
  const borders=['Left','Right','Top','Bottom'].map(side=>{const b=props['border'+side];return `border-${side.toLowerCase()}:${b?.type===0?'none':`${Math.max(0.3,(b?.width||1)*0.25)}pt ${b?.type===2?'dashed':b?.type===3?'dotted':'solid'} ${esc(b?.color||'#000000')}`}`;}).join(';');
  rows[c.row].push({column:c.column,html:`<td rowspan="${c.rowSpan}" colspan="${c.columnSpan}" style="${borders};padding:2pt;width:${(props.width||0)/100}pt;height:${(props.height||0)/100}pt;background:${esc(props.fillType==='solid'?props.fillColor:'#ffffff')}">${paragraphs}</td>`});
  plain[c.row][c.column]=c.paragraphs.join('\n');
 });
 return {spec,text:plain.map(r=>r.join('\t')).join('\n'),html:`<table style="border-collapse:collapse">${rows.map(r=>'<tr>'+r.sort((a,b)=>a.column-b.column).map(c=>c.html).join('')+'</tr>').join('')}</table>`};
}

// Read a bounded subset of the clipboard's presentation; never insert its HTML.
function clipboardCellStyle(cell){
 const chain=[];for(let e=cell;e&&e.tagName!=='BODY';e=e.parentElement)chain.unshift(e);
 const base={};for(const e of chain)for(const name of e.style||[])base[name]=e.style.getPropertyValue(name);
 const child=cell.querySelector('p,div,span,font,b,strong');const text={...base};
 if(child)for(const name of child.style||[])text[name]=child.style.getPropertyValue(name);
 const color=v=>{if(!v)return;const h=v.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);if(h)return '#'+(h[1].length===3?[...h[1]].map(x=>x+x).join(''):h[1]);const m=v.match(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/i);if(m&&m.slice(1).every(x=>+x<=255))return '#'+m.slice(1).map(x=>(+x).toString(16).padStart(2,'0')).join('');};
 const s={},fill=color(base['background-color']||base.background||cell.getAttribute('bgcolor')),ink=color(text.color||child?.getAttribute('color'));
 if(fill)s.fillColor=fill;if(ink)s.textColor=ink;
 const align=text['text-align']||cell.getAttribute('align');if(['left','center','right','justify'].includes(align))s.alignment=align;
 const weight=text['font-weight'];if(weight)s.bold=weight==='bold'||+weight>=600;else if(child?.matches('b,strong'))s.bold=true;
 const size=(text['font-size']||'').match(/^(\d+(?:\.\d+)?)(pt|px)$/i);if(size){const n=Math.round(+size[1]*(size[2].toLowerCase()==='px'?75:100));if(n>=600&&n<=7200)s.fontSize=n;}
 const family=(text['font-family']||'').split(',')[0].trim().replace(/^['"]|['"]$/g,'');if(family&&family.length<=100)s.fontFamily=family;
 return s;
}
export function tableFromClipboardHtml(html,Parser=globalThis.DOMParser){
 if(typeof html!=='string'||!html.trim()||html.length>8*1024*1024)return null;
 if(typeof Parser!=='function')throw Error('HTML parser unavailable');
 // Windows CF_HTML offsets are bytes, so never slice a Unicode JS string by
 // those offsets. Parsing the full HTML envelope preserves Korean text.
 if(!/<table\b/i.test(html)&&/<(?:tr|td|th)\b/i.test(html))html='<table>'+html+'</table>';
 const doc=new Parser().parseFromString(html,'text/html'),tables=doc.querySelectorAll('table');
 if(!tables.length)return null;
 if(tables.length!==1||tables[0].querySelector('table,img,svg,object,embed,math'))throw Error('중첩 표나 그림이 포함된 표는 기존 셀에 덮어쓸 수 없습니다. 셀 안에 표로 넣기를 선택해 주세요.');
 const table=tables[0],cells=[],styles=[],used=new Set();let columns=0;
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
   cells.push({row:r,column:col,rowSpan,columnSpan,paragraphs});styles.push(clipboardCellStyle(cell));
   for(let dr=0;dr<rowSpan;dr++)for(let dc=0;dc<columnSpan;dc++){const key=(r+dr)+':'+(col+dc);if(used.has(key))throw Error('Overlapping clipboard cells');used.add(key);}
   col+=columnSpan;columns=Math.max(columns,col);
  }
 });
 const spec=validateTableSpec({rows:rows.length,columns,cells});Object.defineProperty(spec,'clipboardStyles',{value:styles});return spec;
}

export function tableFromClipboardText(text){
 if(typeof text!=='string'||!text.includes('\t')||text.length>24000)return null;
 const rows=text.replace(/\r\n?/g,'\n').replace(/\n$/,'').split('\n').map(r=>r.split('\t'));
 const columns=rows[0]?.length;if(!columns||rows.some(r=>r.length!==columns))return null;
 return validateTableSpec({rows:rows.length,columns,cells:rows.flatMap((row,r)=>row.map((value,column)=>({row:r,column,paragraphs:[value]})))});
}

function safeTableHtml(html,spec){
 if(html&&/<table\b/i.test(html)){
  const doc=new DOMParser().parseFromString(html,'text/html'),tables=doc.querySelectorAll('table');
  if(tables.length!==1||tables[0].querySelector('table,img,svg,object,embed,math,iframe,video,canvas'))throw Error('이 HTML 표의 중첩 객체는 안전하게 가져올 수 없습니다.');
  const table=tables[0].cloneNode(true);table.querySelectorAll('script,style,link,meta').forEach(node=>node.remove());
  for(const element of [table,...table.querySelectorAll('*')])for(const attr of [...element.attributes])if(/^on/i.test(attr.name))element.removeAttribute(attr.name);
  return table.outerHTML;
 }
 const rows=Array.from({length:spec.rows},()=>[]);
 for(const c of spec.cells)rows[c.row].push({column:c.column,html:`<td rowspan="${c.rowSpan??1}" colspan="${c.columnSpan??1}">${c.paragraphs.map(p=>'<p>'+esc(p)+'</p>').join('')}</td>`});
 return '<table>'+rows.map(row=>'<tr>'+row.sort((a,b)=>a.column-b.column).map(c=>c.html).join('')+'</tr>').join('')+'</table>';
}

function hasHancomModel(html){
 if(typeof html!=='string'||html.length>8*1024*1024)return false;
 const marker=html.indexOf('[data-hwpjson]'),start=html.indexOf('{',marker),end=html.indexOf('-->',start);
 if(marker<0||start<0||end<0)return false;
 try{return !!JSON.parse(html.slice(start,end));}catch{return false;}
}

export function pasteClipboardCells(w,context,spec){
 validateTableSpec(spec);const source=context.table?.source,pos=context.cursor;
 if(!source||source.cellPath?.length>1)throw Error('중첩 표의 기존 셀에 덮어쓰기는 아직 지원하지 않습니다.');
 const ref={sec:source.sec,ppi:source.ppi,ci:source.ci},snapshot=tableSnapshot(w,ref.sec,ref.ppi,ref.ci);
 const selected=context.kind==='cell_block'?context.table.selectedCells:null;
 const anchor=selected?.length?snapshot.cells[selected[0].cellIndex]:snapshot.cells[pos.cellIndex];if(!anchor)throw Error('Choose a destination cell');
 const top=selected?.length?Math.min(...selected.map(c=>c.row)):anchor.geometry.row,left=selected?.length?Math.min(...selected.map(c=>c.col)):anchor.geometry.col;
 const allowed=selected?.length>1?new Set(selected.map(c=>c.cellIndex)):null,edits=[];
 for(const cell of spec.cells){
  const index=snapshot.cells.findIndex(c=>c.geometry.row===top+cell.row&&c.geometry.col===left+cell.column);
  const target=snapshot.cells[index];
  if(!target)throw Error('복사한 표가 대상 표의 바깥으로 벗어납니다. 충분한 줄과 칸이 있는 위치를 선택해 주세요.');
  if(allowed&&!allowed.has(index))throw Error('선택한 셀 범위가 복사한 표보다 작습니다. 같은 크기의 셀 범위를 선택해 주세요.');
  if(target.geometry.rowSpan!==(cell.rowSpan??1)||target.geometry.colSpan!==(cell.columnSpan??1))throw Error('복사한 표와 대상 셀의 병합 모양이 다릅니다. 같은 모양의 셀을 선택해 주세요.');
  edits.push({cellIndex:index,paragraphs:cell.paragraphs});
 }
 if(allowed&&allowed.size!==edits.length)throw Error('복사한 표와 같은 크기의 셀 범위를 선택해 주세요.');
 // Preflight all original paragraphs before reshaping text containers. Row,
 // column and merge geometry remain unchanged, even for multiline cell paste.
 try{prepareCellEdits(w,ref,edits.map(e=>({cellIndex:e.cellIndex,paragraphs:snapshot.cells[e.cellIndex].paragraphs.map(p=>p.text)})),allowed?[...allowed]:undefined);}catch(error){
  if(/mixed character formatting/i.test(error.message))throw Error('대상 셀에 여러 글자 서식이 섞여 있어 덮어쓰지 않았습니다.');
  if(/contains an object/i.test(error.message))throw Error('대상 셀에 표나 그림이 있어 덮어쓰지 않았습니다.');
  throw error;
 }
 const checked=value=>{if(parse(value)?.ok!==true)throw Error('Cell paragraph operation failed');};
 for(const edit of edits){
  const old=snapshot.cells[edit.cellIndex].paragraphs;if(old.length===edit.paragraphs.length)continue;
  for(let p=0;p<old.length;p++)if(old[p].length)checked(w.deleteTextInCell(ref.sec,ref.ppi,ref.ci,edit.cellIndex,p,0,old[p].length));
  for(let count=old.length;count>edit.paragraphs.length;count--)checked(w.mergeParagraphInCell(ref.sec,ref.ppi,ref.ci,edit.cellIndex,count-1));
  for(let count=old.length;count<edit.paragraphs.length;count++)checked(w.splitParagraphInCell(ref.sec,ref.ppi,ref.ci,edit.cellIndex,count-1,0));
 }
 return applyCellEdits(w,ref,edits,allowed?[...allowed]:undefined);
}

export function installTableClipboard({wasm,read,getInput,mutate,notice,nativeRead,chooseTablePaste,enableNestedClipping}){
 let bypass=false,plainPasteUntil=0,richCopy=null;
 const richPayload=(ref,context)=>{
  const path=ref.cellPath||[],target=path.length>1?{ci:path.at(-1).controlIndex,owner:JSON.stringify(path.slice(0,-1))}:{ci:ref.ci,owner:'[]'};
  if(parse(wasm.copyControl(ref.sec,ref.ppi,target.ci,target.owner))?.ok!==true)throw Error('표를 복사하지 못했습니다.');
  const html=wasm.exportControlHtml(ref.sec,ref.ppi,target.ci,target.owner);if(typeof html!=='string'||!/<table\b/i.test(html))throw Error('표의 복사 형식을 만들지 못했습니다.');
  const token=crypto.randomUUID();richCopy={token,epoch:context.documentState.documentEpoch};
  return {html:html+`<!--pwh-rich-table:${token}-->`,text:wasm.getClipboardText()||'[표]',rich:true};
 };
 const payload=()=>{
  const input=getInput(),context=read();let ref,indices;
  if(context.kind==='cell_block'){
   if(!context.table?.selectedCellsComplete||!context.table.selectedCells?.length)throw Error('Select a complete rectangular cell block');
   ref=context.table.source;indices=context.table.selectedCells.map(c=>c.cellIndex);
  }else if(input?.isInTableObjectSelection()){ref=input.getSelectedTableRef();if(!ref)throw Error('복사할 표를 찾지 못했습니다.');return richPayload(ref,context);}else return null;
  if(ref.cellPath?.length>1){const dims=wasm.getTableDimensionsByPath(ref.sec,ref.ppi,JSON.stringify(ref.cellPath));if(indices.length===dims.cellCount)return richPayload(ref,context);throw Error('중첩 표의 일부 셀 복사는 아직 지원하지 않습니다.');}
  const snapshot=tableSnapshot(wasm,ref.sec,ref.ppi,ref.ci);indices??=snapshot.cells.map((_,i)=>i);
  if(indices.length===snapshot.dimensions.cellCount)return richPayload(ref,context);
  return selectedTableFragment(snapshot,indices);
 };
 document.addEventListener('copy',event=>{
  richCopy=null;
  let data;try{data=payload();}catch(error){event.preventDefault();event.stopImmediatePropagation();notice(error.message,true);return;}
  if(!data)return;event.preventDefault();event.stopImmediatePropagation();
  event.clipboardData?.setData('text/plain',data.text);event.clipboardData?.setData('text/html',data.html+'<!--pwh-table-copy-->');
  notice(data.rich?'표 전체를 복사했습니다.':'선택한 '+data.spec.cells.length+'개 셀을 복사했습니다.');
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
  let result,ref;
  if(expected.cursor?.parentParaIndex!=null){result=pasteClipboardCells(w,expected,spec);const source=expected.table.source;ref={sec:source.sec,ppi:source.ppi,ci:source.ci};}
  else{if(expected.selection)throw Error('Place a body cursor outside a selection before pasting a table');result=insertStructuredTable(w,expected.cursor,spec);ref=result.source;}
  const styles=(spec.clipboardStyles||[]).map((s,i)=>({cellIndex:result.cellIndices[i],...s})).filter(s=>Object.keys(s).length>1);
  if(styles.length)applyTableStyles(w,{...ref,snapshot:tableSnapshot(w,ref.sec,ref.ppi,ref.ci)},styles);
  return result;
 });
 document.addEventListener('paste',event=>{
  if(bypass)return;if(Date.now()<plainPasteUntil){plainPasteUntil=0;return;}
  const expected=structuredClone(read()),data=event.clipboardData;
  if(!expected.ready||!data)return;
  if(event.isTrusted&&nativeRead&&!(data.types?.length||data.items?.length)){
   notice('붙여넣을 내용을 확인하지 못했습니다. 한글 표나 셀은 ‘한글 표·셀 가져오기’를 이용해 주세요.',true);
   return;
  }
  let html=data.getData('text/html'),text=data.getData('text/plain');let spec,parseError;
  const inCell=expected.cursor?.parentParaIndex!=null;
  const token=html.match(/<!--pwh-rich-table:([0-9a-f-]+)-->/i)?.[1];
  const internalTable=inCell&&!!token&&richCopy?.token===token&&richCopy.epoch===expected.documentState.documentEpoch&&wasm.clipboardHasControl();
  // The engine's Hancom model importer preserves richer formatting and pictures.
  if(!inCell&&hasHancomModel(html))return;
  let model=inCell?extractHancomTableModel(html):null;
  try{if(!model&&!internalTable)spec=tableFromClipboardHtml(html)||tableFromClipboardText(text);}catch(error){parseError=error;}
  const ownCopy=html.includes('<!--pwh-table-copy-->');
  // Ordinary text, rich text, RTF and image paste belongs to this event and
  // must be handled synchronously by the editor. A later OS clipboard read
  // is useful only to enrich an external table with Hancom's document model.
  const needNative=!!(event.isTrusted&&nativeRead&&!ownCopy&&!model&&!internalTable&&text&&/<table\b/i.test(html));
  if(parseError&&!needNative){event.preventDefault();event.stopImmediatePropagation();notice(parseError.message,true);return;}
  if(!spec&&!model&&!internalTable&&!needNative)return;
  // ClipboardEvent data is only guaranteed to be readable during dispatch.
  // Keep string MIME data and File objects, never the original DataTransfer.
  const target=event.target,replayData=new DataTransfer();
  for(const type of Array.from(data.types||[]))if(type!=='Files')replayData.setData(type,data.getData(type));
  for(const item of Array.from(data.items||[]))if(item.kind==='file'){const file=item.getAsFile();if(file)replayData.items.add(file);}
  const ensureContext=()=>{
   const current=read();
   if(JSON.stringify(current.documentState)!==JSON.stringify(expected.documentState)||JSON.stringify(current.cursor)!==JSON.stringify(expected.cursor)||JSON.stringify(current.selection)!==JSON.stringify(expected.selection))throw Error('문서나 선택 위치가 변경되어 붙여넣기를 취소했습니다.');
   const doc=target?.ownerDocument;
   if(!target?.isConnected||doc?.activeElement!==target||!doc?.hasFocus())throw Error('입력 포커스가 변경되어 붙여넣기를 취소했습니다.');
  };
  const replay=transfer=>{bypass=true;try{target.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));}finally{bypass=false;}};
  event.preventDefault();event.stopImmediatePropagation();
  void(async()=>{
   try{
    if(needNative){
     let native;try{native=await nativeRead();}catch{/* Use the original event data. */}
     ensureContext();
     // Never substitute data from a different clipboard transaction. Native
     // picture-only data cannot be tied to the original event and is ignored.
     const normalized=value=>String(value||'').replace(/\r\n?/g,'\n').replace(/\0+$/,'');
     if(native&&normalized(text)&&normalized(native.text)===normalized(text)){
      if(!inCell&&hasHancomModel(native.html)){const transfer=new DataTransfer();transfer.setData('text/html',native.html);transfer.setData('text/plain',text);replay(transfer);return;}
      if(inCell&&hasHancomModel(native.html)){html=native.html;model=extractHancomTableModel(html);}
     }
    }
    if((model||internalTable||spec)&&inCell){
     const choice=await chooseTablePaste({htmlOnly:!model&&!internalTable});if(!choice)return;
     if(choice==='nested'){const tableHtml=!model&&!internalTable?safeTableHtml(html,spec):null;await mutate(expected,w=>model?pasteHancomTableInCell(w,expected,model):internalTable?pasteInternalTableInCell(w,expected):pasteHtmlTableInCell(w,expected,tableHtml,spec));enableNestedClipping?.();notice('셀 안에 표를 넣었습니다. 실행 취소 한 번으로 되돌릴 수 있습니다.');return;}
     if(!spec)spec=tableFromClipboardHtml(html)||tableFromClipboardText(text);if(!spec)throw Error('기존 셀에 붙일 표 내용을 확인하지 못했습니다.');
    }
    if(parseError&&!spec)throw parseError;
    if(spec){await apply(spec,expected);notice('표·셀 붙여넣기를 완료했습니다. 실행 취소 한 번으로 되돌릴 수 있습니다.');}
    else{ensureContext();replay(replayData);}
   }catch(error){notice('표·셀 붙여넣기: '+error.message,true);}
  })();
 },true);
 window.addEventListener('pwh-import-native-table',()=>{
  const expected=structuredClone(read());
  void(async()=>{try{
   const data=await nativeRead(),inCell=expected.cursor?.parentParaIndex!=null;
   if(!inCell&&hasHancomModel(data.html)){
    const current=read();if(JSON.stringify(current.documentState)!==JSON.stringify(expected.documentState)||JSON.stringify(current.cursor)!==JSON.stringify(expected.cursor))throw Error('문서나 커서가 변경되어 붙여넣기를 취소했습니다.');
    const transfer=new DataTransfer();transfer.setData('text/html',data.html);transfer.setData('text/plain',data.text);const target=document.querySelector('[aria-label="문서 편집 입력"]');if(!target)throw Error('문서 입력 위치를 찾지 못했습니다.');
    bypass=true;try{target.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));}finally{bypass=false;}return;
   }
   const model=inCell?extractHancomTableModel(data.html):null;
   let spec=model?null:tableFromClipboardHtml(data.html)||tableFromClipboardText(data.text);
   if(inCell&&(model||spec)){
    const choice=await chooseTablePaste({htmlOnly:!model});if(!choice)return;
    if(choice==='nested'){const tableHtml=!model?safeTableHtml(data.html,spec):null;await mutate(expected,w=>model?pasteHancomTableInCell(w,expected,model):pasteHtmlTableInCell(w,expected,tableHtml,spec));enableNestedClipping?.();notice('셀 안에 표를 넣었습니다. 실행 취소 한 번으로 되돌릴 수 있습니다.');return;}
   }
   if(!spec)spec=tableFromClipboardHtml(data.html)||tableFromClipboardText(data.text);
   if(!spec)throw Error('클립보드에서 표 구조를 찾지 못했습니다. 한글에서 표 또는 셀을 다시 복사하거나 원본 HWPX를 열어 주세요.');
   await apply(spec,expected);notice('한글 표·셀을 가져왔습니다.');
  }catch(error){notice(error.message,true);}})();
 });
 return {copySelected:payload,paste:apply};
}
