const parsed=v=>typeof v==='string'?JSON.parse(v):v;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const color=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(v=>v.toString(16).padStart(2,'0')).join('');}
export function tableSnapshot(w,sec,ppi,ci){
 const dimensions=parsed(w.getTableDimensions(sec,ppi,ci));
 if(!dimensions?.cellCount||dimensions.cellCount>256)throw Error('Table size exceeds supported limits');
 let total=0;const cells=[];
 for(let cell=0;cell<dimensions.cellCount;cell++){
  const paragraphs=[],count=w.getCellParagraphCount(sec,ppi,ci,cell);
  if(count>128)throw Error('Too many cell paragraphs');
  for(let p=0;p<count;p++){
   const length=w.getCellParagraphLength(sec,ppi,ci,cell,p);total+=length;if(total>24000)throw Error('Table text exceeds supported limits');
   const formats=[];let last;
   for(let offset=0;offset<Math.max(1,length);offset++){
    const format=parsed(w.getCellCharPropertiesAt(sec,ppi,ci,cell,p,offset));
    if(!equal(format,last)){formats.push({offset,format});last=format;}
   }
   paragraphs.push({length,text:w.getTextInCell(sec,ppi,ci,cell,p,0,length),format:parsed(w.getCellParaPropertiesAt(sec,ppi,ci,cell,p)),formats});
  }
  cells.push({geometry:parsed(w.getCellInfo(sec,ppi,ci,cell)),properties:parsed(w.getCellProperties(sec,ppi,ci,cell)),paragraphs});
 }
 return {dimensions,properties:parsed(w.getTableProperties(sec,ppi,ci)),cells};
}
export async function captureTableTarget(w,c){
 if(c.kind!=='cell_block'||!c.table?.selectedCellsComplete||!c.table.selectedCells?.length)return null;
 const {sec,ppi,ci,cellPath}=c.table.source;
 if(cellPath?.length>1)return null;
 const cells=c.table.selectedCells.map(x=>x.cellIndex);
 if(cells.length>256)return null;
 const snapshot=tableSnapshot(w,sec,ppi,ci);
 return {kind:'table_cells',epoch:c.documentState.documentEpoch,section:sec,controlIndex:ci,cells,sha256:await digest(snapshot)};
}
export async function resolveTableTarget(w,target,current){
 if(target?.kind!=='table_cells'||target.epoch!==current.documentState?.documentEpoch)throw Error('Table request expired; reopen request');
 let match=null;const count=w.getParagraphCount(target.section);if(count>20000)throw Error('Too many paragraphs');
 for(let ppi=0;ppi<count;ppi++){
  const controls=parsed(w.getControlTextPositions(target.section,ppi));
  for(let ci=0;ci<controls.length;ci++){
   let snapshot;try{snapshot=tableSnapshot(w,target.section,ppi,ci);}catch{continue;}
   if(await digest(snapshot)===target.sha256){if(match)throw Error('Ambiguous table target');match={sec:target.section,ppi,ci,snapshot};}
  }
 }
 if(!match)throw Error('Requested table changed or was deleted');return match;
}
export function validateTableStyles(styles,cells){
 if(!Array.isArray(styles)||!styles.length||styles.length>256)throw Error('Provide 1 to 256 cell styles');
 const seen=new Set();
 for(const s of styles){
  if(!s||!cells.includes(s.cellIndex)||seen.has(s.cellIndex)||Object.keys(s).some(k=>!['cellIndex','fillColor','textColor','bold','fontFamily','fontSize','alignment','borderColor','borderWidth','borders'].includes(k))||Object.keys(s).length<2)throw Error('Invalid or unselected cell');
  seen.add(s.cellIndex);
  for(const k of ['fillColor','textColor','borderColor'])if(s[k]!==undefined&&!color(s[k]))throw Error('Use #RRGGBB colors');
  if(s.fontFamily!==undefined&&(typeof s.fontFamily!=='string'||!s.fontFamily.trim()||s.fontFamily.length>100)||s.fontSize!==undefined&&(!Number.isFinite(s.fontSize)||s.fontSize<600||s.fontSize>7200))throw Error('Invalid font');
  if(s.borders!==undefined){for(const [side,b]of Object.entries(s.borders)){if(!['Left','Right','Top','Bottom'].includes(side)||!b||!color(b.color)||![0,1,2,3].includes(b.type)||!Number.isInteger(b.width)||b.width<0||b.width>6)throw Error('Invalid border');}}
  if(s.bold!==undefined&&typeof s.bold!=='boolean'||s.alignment!==undefined&&!['left','center','right','justify'].includes(s.alignment)||s.borderWidth!==undefined&&(!Number.isInteger(s.borderWidth)||s.borderWidth<0||s.borderWidth>6||!s.borderColor))throw Error('Invalid cell style');
 }
}
function checked(value){if(parsed(value)?.ok===false)throw Error('Cell style operation failed');}
export function applyTableStyles(w,ref,styles){
 validateTableStyles(styles,styles.map(s=>s.cellIndex));const {sec,ppi,ci,snapshot}=ref;
 for(const s of styles){
  const cell=snapshot.cells[s.cellIndex];if(!cell)throw Error('Cell index out of range');
  const props={};if(s.fillColor)Object.assign(props,{fillType:'solid',fillColor:s.fillColor});
  if(s.borderColor)for(const side of ['Left','Right','Top','Bottom'])props['border'+side]={type:1,width:s.borderWidth??1,color:s.borderColor};
  for(const [side,border]of Object.entries(s.borders||{}))props['border'+side]=border;
  if(Object.keys(props).length)checked(w.setCellProperties(sec,ppi,ci,s.cellIndex,props));
  for(let p=0;p<cell.paragraphs.length;p++){
   const para=cell.paragraphs[p],char={};for(const key of ['textColor','bold','fontSize'])if(s[key]!==undefined)char[key]=s[key];
   if(s.fontFamily)char.fontIds=Array.from({length:7},(_,lang)=>w.findOrCreateFontIdForLang(lang,s.fontFamily));
   if(Object.keys(char).length&&para.length)checked(w.applyCharFormatInCell(sec,ppi,ci,s.cellIndex,p,0,para.length,JSON.stringify(char)));
   if(s.alignment)checked(w.applyParaFormatInCell(sec,ppi,ci,s.cellIndex,p,JSON.stringify({alignment:s.alignment})));
  }
 }
 w.flushDeferredPagination();
 const after=tableSnapshot(w,sec,ppi,ci);
 if(!equal(snapshot.dimensions,after.dimensions)||!equal(snapshot.properties,after.properties))throw Error('Table structure or placement changed');
 for(let c=0;c<snapshot.cells.length;c++){
  const before=snapshot.cells[c],actual=after.cells[c],style=styles.find(s=>s.cellIndex===c);
  if(!equal(before.paragraphs.map(p=>p.text),actual.paragraphs.map(p=>p.text))||before.properties.width!==actual.properties.width)throw Error('Cell content or width changed');
  if(style?.fillColor&&actual.properties.fillColor.toLowerCase()!==style.fillColor.toLowerCase())throw Error('Cell fill verification failed');
  for(const [side,border]of Object.entries(style?.borders||{})){
   const got=actual.properties['border'+side];
   if(got?.type!==border.type||border.type!==0&&(got.width!==border.width||got.color.toLowerCase()!==border.color.toLowerCase()))throw Error('Cell border verification failed');
  }
  for(const p of actual.paragraphs){
   if(style?.alignment&&p.format.alignment!==style.alignment)throw Error('Alignment verification failed');
   if(p.length)for(const run of p.formats)if(style?.textColor&&run.format.textColor.toLowerCase()!==style.textColor.toLowerCase()||style?.bold!==undefined&&run.format.bold!==style.bold||style?.fontSize!==undefined&&run.format.fontSize!==style.fontSize||style?.fontFamily!==undefined&&run.format.fontFamily!==style.fontFamily)throw Error('Text style verification failed: '+JSON.stringify({cell:c,wanted:style,actual:{textColor:run.format.textColor,bold:run.format.bold,fontSize:run.format.fontSize,fontFamily:run.format.fontFamily}}));
  }
 }
 return {cellCount:styles.length,cellIndices:styles.map(s=>s.cellIndex)};
}

export async function inspectTablePlan(w,context){
 const refs=[];let cells=0;
 // Enumeration is deliberately bounded. An unsupported nested table prevents
 // a misleading document-wide success claim.
 const controls=parsed(w.getControls());
 const unsupported=controls.filter(c=>c.ctrlId==='tbl'&&c.list!==0).length;
 for(let sec=0;sec<w.getSectionCount();sec++){
  const count=w.getParagraphCount(sec);if(count>20000)throw Error('Too many paragraphs');
  for(let ppi=0;ppi<count;ppi++){
   const positions=parsed(w.getControlTextPositions(sec,ppi));
   for(let ci=0;ci<positions.length;ci++){
    let dimensions;try{dimensions=parsed(w.getTableDimensions(sec,ppi,ci));}catch{continue;}
    if(!dimensions?.cellCount)continue;
    const snapshot=tableSnapshot(w,sec,ppi,ci);cells+=snapshot.cells.length;
    if(refs.length>=64||cells>2048)throw Error('Document table plan exceeds supported limits');
    refs.push({sec,ppi,ci,snapshot,sha256:await digest(snapshot)});
   }
  }
 }
 return {epoch:context.documentState.documentEpoch,refs,unsupported};
}
const roleStyle=cell=>{
 const p=cell?.paragraphs.find(p=>p.length)||cell?.paragraphs[0],c=p?.formats[0]?.format||{};
 return {fontFamily:c.fontFamily||'맑은 고딕',fontSize:c.fontSize||1000,bold:!!c.bold,textColor:c.textColor||'#000000',fillColor:cell?.properties.fillType==='solid'?cell.properties.fillColor:'#ffffff',alignment:p?.format.alignment||'left'};
};
export function themeFromTable(ref){
 const cells=ref.snapshot.cells,header=cells.find(c=>c.properties.isHeader)||cells.find(c=>c.geometry.row===0),body=cells.find(c=>c.geometry.row>0&&!c.properties.isHeader)||header;
 const edge=body?.properties.borderBottom||{type:1,width:1,color:'#b8c6d4'};
 return {header:roleStyle(header),body:roleStyle(body),border:{color:edge.color,width:edge.width,type:edge.type,outerLeft:!!cells.find(c=>c.geometry.col===0)?.properties.borderLeft?.type,outerRight:!!cells.find(c=>c.geometry.col+c.geometry.colSpan===ref.snapshot.dimensions.colCount)?.properties.borderRight?.type,vertical:!!body?.properties.borderRight?.type},headerRows:1};
}
export function validateTheme(theme){
 if(!theme||Object.keys(theme).some(k=>!['header','body','border','headerRows'].includes(k)))throw Error('Invalid table theme');
 for(const role of ['header','body']){if(!theme[role]||Object.keys(theme[role]).some(k=>!['fillColor','textColor','fontFamily','fontSize','bold','alignment'].includes(k)))throw Error('Invalid header/body theme');validateTableStyles([{cellIndex:0,...theme[role]}],[0]);}
 const b=theme.border;if(!b||Object.keys(b).some(k=>!['color','width','type','outerLeft','outerRight','vertical'].includes(k))||!color(b.color)||!Number.isInteger(b.width)||b.width<0||b.width>6||![0,1,2,3].includes(b.type)||['outerLeft','outerRight','vertical'].some(k=>typeof b[k]!=='boolean'))throw Error('Invalid table border theme');
 if(!Number.isInteger(theme.headerRows)||theme.headerRows<0||theme.headerRows>10)throw Error('Invalid header row count');
}
export function stylesForTheme(ref,theme,headerRows=theme.headerRows){
 validateTheme(theme);const {rowCount,colCount}=ref.snapshot.dimensions,b=theme.border;
 return ref.snapshot.cells.map((cell,cellIndex)=>{
  const g=cell.geometry,isHeader=headerRows>0&&(cell.properties.isHeader||g.row<headerRows),border=(on)=>({type:on?b.type:0,width:b.width,color:b.color});
  return {cellIndex,...theme[isHeader?'header':'body'],borders:{Left:border(g.col===0?b.outerLeft:b.vertical),Right:border(g.col+g.colSpan===colCount?b.outerRight:b.vertical),Top:border(true),Bottom:border(true)}};
 });
}
export async function resolveTablePlan(w,plan,current,scope,tableIndex){
 if(plan.epoch!==current.documentState?.documentEpoch)throw Error('Table plan expired');
 if(scope==='document'&&plan.unsupported)throw Error('Nested/non-body tables need a supported table path before document-wide styling');
 const latest=await inspectTablePlan(w,current);
 if(scope==='document'&&(latest.refs.length!==plan.refs.length||latest.unsupported!==plan.unsupported))throw Error('Document table set changed');
 const selected=scope==='document'?plan.refs:[plan.refs[tableIndex]];if(selected.some(r=>!r))throw Error('Unknown table index');
 const used=new Set();return selected.map(ref=>{
  const matches=latest.refs.filter(r=>r.sha256===ref.sha256);
  if(matches.length!==1||used.has(matches[0]))throw Error('Table changed or is ambiguous');used.add(matches[0]);return matches[0];
 });
}
