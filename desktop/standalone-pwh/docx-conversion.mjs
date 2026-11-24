import path from 'node:path';
import {writeZipMembers} from '../release-source/scripts/zip-writer.mjs';
import {attr, child, children, descendants, elements, packageParts, textOf, xmlDeclaration as declaration, xmlEscape as esc} from './docx-xml.mjs';

const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const pkgRel = 'http://schemas.openxmlformats.org/package/2006/relationships';
const contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const sides = ['top','right','bottom','left','header','footer','gutter'];
const imageTypes = {png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',bmp:'image/bmp',tiff:'image/tiff',tif:'image/tiff'};
const cellSides = ['top','left','bottom','right'];
const wordBorderTypes = {nil:'NONE',none:'NONE',single:'SOLID',dashed:'DASH',dotted:'DOT',dotDash:'DASH_DOT',dotDotDash:'DASH_DOT_DOT',double:'DOUBLE_SLIM'};
const hwpxBorderTypes = Object.fromEntries(Object.entries(wordBorderTypes).map(([word,hancom])=>[hancom,word]));
const wordHighlights = {black:'000000',blue:'0000FF',cyan:'00FFFF',green:'00FF00',magenta:'FF00FF',
  red:'FF0000',yellow:'FFFF00',darkBlue:'000080',darkCyan:'008080',darkGreen:'008000',darkMagenta:'800080',
  darkRed:'800000',darkYellow:'808000',darkGray:'808080',lightGray:'C0C0C0'};
const highlightsByColor = Object.fromEntries(Object.entries(wordHighlights).map(([name,rgb])=>[rgb,name]));
const runProperties = new Set(['rStyle','rFonts','sz','szCs','color','b','i','u','strike','vertAlign','highlight','shd','lang','noProof']);
const paraProperties = new Set(['pStyle','rPr','ind','spacing','jc','keepNext','keepLines','pageBreakBefore','sectPr','numPr']);
const pictureExtent = 127; // EMUs per HWPUNIT.
const integer = (value, fallback=0) => /^-?\d+$/.test(value ?? '') && Math.abs(Number(value)) <= 2_000_000_000 ? Number(value) : fallback;
const nonnegative = (value, fallback=0) => Math.max(0, integer(value,fallback));
const val = (node, name) => attr(child(node,name),'val');
const on = (node,name) => child(node,name) ? !/^(?:0|false|off|none)$/i.test(val(node,name) ?? '') : undefined;
const color = (value, fallback='000000') => /^[0-9a-f]{6}$/i.test(value ?? '') ? value.toUpperCase() : fallback;
const item = (name, input, stored=false) => ({name,bytes:Buffer.isBuffer(input)?input:Buffer.from(input),stored});
const tag = (name, fields={}, content) => '<'+name+Object.entries(fields).filter(([,value])=>value!==undefined)
  .map(([key,value])=>' '+key+'="'+esc(value)+'"').join('')+(content===undefined?'/>' : '>'+content+'</'+name+'>');
const prop = (name,value) => value === undefined ? '' : tag('w:'+name,{'w:val':value});
const normalize = object => Object.fromEntries(Object.entries(object).filter(([,value])=>value!==undefined));
const groups = ['hangul','latin','hanja','japanese','other','symbol','user'];
const styleRef = (node,name) => nonnegative(attr(node,name));
const coords = (width,height) => ({width,height});
const deck = (width=59528,height=84186,margin={top:5668,bottom:4252,left:8504,right:8504,header:4252,footer:4252,gutter:0},cols=1,gap=0) =>
  ({width,height,margin,cols,gap});

function relationshipPart(part) {
  return path.posix.join(path.posix.dirname(part),'_rels',path.posix.basename(part)+'.rels');
}
function relationships(pkg, part) {
  const base = part ? path.posix.dirname(part) : '';
  const xml = pkg.xml(part ? relationshipPart(part) : '_rels/.rels');
  return new Map(children(xml,'Relationship').map(node=>{
    const target = attr(node,'Target') ?? '';
    let resolved;
    if (target && attr(node,'TargetMode') !== 'External' && !/[:\\?#\x00]/.test(target)) {
      const decoded = decodeURIComponent(target);
      if (!/[:\\?#\x00]/.test(decoded)) {
        resolved = path.posix.normalize(decoded.startsWith('/') ? decoded.slice(1) : path.posix.join(base,decoded));
        if (resolved.startsWith('../')) resolved = undefined;
      }
    }
    return [attr(node,'Id'),{part:resolved,type:(attr(node,'Type') ?? '').split('/').at(-1)}];
  }));
}

function wordStyle(run,warnings) {
  const fonts=child(run,'rFonts');
  const highlight=val(run,'highlight'), shading=child(run,'shd'), fill=attr(shading,'fill');
  if (elements(run).some(node=>!runProperties.has(node.name))) warnings.add('지원 범위 밖의 글자 서식');
  if (highlight && highlight!=='none' && !Object.hasOwn(wordHighlights,highlight)) warnings.add('일부 형광펜 색상');
  if (shading && (attr(shading,'themeFill') || (attr(shading,'val') && attr(shading,'val')!=='clear'))) warnings.add('글자 배경 무늬·테마');
  if (fonts && Object.keys(fonts.attrs).some(name=>/theme$/i.test(name)) && !(attr(fonts,'ascii') && attr(fonts,'eastAsia'))) warnings.add('테마 글꼴');
  if (attr(child(run,'color'),'themeColor')) warnings.add('테마 글자 색');
  if (val(run,'u') && !['single','none'].includes(val(run,'u'))) warnings.add('일부 밑줄 모양');
  if (val(run,'szCs') && val(run,'szCs')!==val(run,'sz')) warnings.add('복합 문자 크기');
  return normalize({font:attr(fonts,'eastAsia') ?? attr(fonts,'ascii') ?? attr(fonts,'hAnsi'),
    latin:attr(fonts,'ascii') ?? attr(fonts,'hAnsi'),size:val(run,'sz')===undefined?undefined:nonnegative(val(run,'sz'))*50,
    color:val(run,'color')===undefined?undefined:color(val(run,'color')),bold:on(run,'b'),italic:on(run,'i'),
    shade:Object.hasOwn(wordHighlights,highlight)?wordHighlights[highlight]:(fill?color(fill,''):highlight==='none'?'':undefined),
    underline:on(run,'u'),strike:on(run,'strike') ?? on(run,'dstrike'),
    vertical:['superscript','subscript'].includes(val(run,'vertAlign'))?val(run,'vertAlign'):undefined});
}
function wordParagraphStyle(props,warnings) {
  const indent=child(props,'ind'), spacing=child(props,'spacing'), alignment=val(props,'jc');
  if (elements(props).some(node=>!paraProperties.has(node.name))) warnings.add('지원 범위 밖의 문단 서식');
  if (elements(props).some(node=>node.name==='pStyle')) warnings.add('Word 문단 스타일');
  if (indent && Object.keys(indent.attrs).some(key=>/Chars$/i.test(key))) warnings.add('글자 수 기준 문단 여백');
  if (spacing && Object.keys(spacing.attrs).some(key=>/AutoSpacing$|Lines$/i.test(key))) warnings.add('자동 문단 간격');
  const position=key=>attr(indent,key)===undefined?undefined:integer(attr(indent,key))*5;
  const line=attr(spacing,'line');
  return normalize({align:({left:'LEFT',start:'LEFT',right:'RIGHT',end:'RIGHT',center:'CENTER',both:'JUSTIFY',distribute:'DISTRIBUTE'})[alignment],
    left:position('left') ?? position('start'),right:position('right') ?? position('end'),
    first:position('hanging')===undefined?position('firstLine'):-position('hanging'),
    before:attr(spacing,'before')===undefined?undefined:integer(attr(spacing,'before'))*5,
    after:attr(spacing,'after')===undefined?undefined:integer(attr(spacing,'after'))*5,
    ...(line===undefined?{}:attr(spacing,'lineRule')==='exact'?{line:nonnegative(line)*5,lineType:'FIXED'}:
      attr(spacing,'lineRule')==='atLeast'?{line:nonnegative(line)*5,lineType:'AT_LEAST'}:{line:Math.round(nonnegative(line)*100/240),lineType:'PERCENT'}),
    keepWithNext:on(props,'keepNext'),keepLines:on(props,'keepLines'),pageBreak:on(props,'pageBreakBefore')});
}
function wordPage(pr, warnings) {
  const size=child(pr,'pgSz'), margins=child(pr,'pgMar'), columns=child(pr,'cols'), defaults=deck();
  const page=deck(nonnegative(attr(size,'w'),11906)*5,nonnegative(attr(size,'h'),16837)*5,
    Object.fromEntries(sides.map(side=>[side,nonnegative(attr(margins,side),Math.round(defaults.margin[side]/5))*5])),
    Math.min(32,Math.max(1,nonnegative(attr(columns,'num'),1))),nonnegative(attr(columns,'space'))*5);
  if (children(columns,'col').length || (val(pr,'type') && val(pr,'type')!=='nextPage')) warnings.add('연속·홀짝 구역 또는 너비가 서로 다른 단');
  return page;
}
function paragraphsInWord(bytes) {
  const pkg=packageParts(bytes), document=Array.from(relationships(pkg,'').values()).find(r=>r.type==='officeDocument')?.part;
  const root=document && pkg.xml(document), body=child(root,'body');
  const types=pkg.xml('[Content_Types].xml');
  if (root?.name!=='document' || !body || !children(types,'Override').some(entry =>
    attr(entry,'PartName')==='/'+document && attr(entry,'ContentType')===contentType)) throw Error('Word DOCX 문서를 읽을 수 없습니다.');
  const links=relationships(pkg,document), stylePart=Array.from(links.values()).find(r=>r.type==='styles')?.part;
  const styleDoc=stylePart&&pkg.xml(stylePart), defs=child(styleDoc,'docDefaults');
  const warnings=new Set();
  const defaultRun=wordStyle(child(child(defs,'rPrDefault'),'rPr'),warnings);
  const defaultPara=wordParagraphStyle(child(child(defs,'pPrDefault'),'pPr'),warnings);
  const optionsPart=Array.from(links.values()).find(r=>r.type==='settings')?.part;
  const options=optionsPart&&pkg.xml(optionsPart);
  if (child(options,'documentProtection')||child(options,'writeProtection')) warnings.add('Word 편집 제한 설정');
  if ([...pkg.entries.keys()].some(name=>name.startsWith('customXml/')||name.startsWith('_xmlsignatures/'))) warnings.add('문서에 연결된 데이터 또는 서명');
  const styleNodes=children(styleDoc,'style'), styles=new Map(styleNodes.map(node=>[attr(node,'styleId'),node]));
  const normal=attr(styleNodes.find(node=>attr(node,'type')==='paragraph'&&attr(node,'default')==='1'),'styleId');
  const resolvedStyles=new Map(), pictures=new Map();
  function style(id, visited=new Set()) {
    if (resolvedStyles.has(id)) return resolvedStyles.get(id);
    if (!id || !styles.has(id) || visited.has(id) || visited.size>64) return {run:{},para:{}};
    visited.add(id);
    const node=styles.get(id), parent=style(val(node,'basedOn'),visited), props=child(node,'pPr');
    const value={run:{...parent.run,...wordStyle(child(node,'rPr'),warnings)},para:{...parent.para,...wordParagraphStyle(props,warnings)},
      numbered:!!child(props,'numPr') || parent.numbered};
    resolvedStyles.set(id,value);
    return value;
  }
  const unsupported=new Map(Object.entries({headerReference:'머리말·꼬리말',footerReference:'머리말·꼬리말',numPr:'자동 문단 번호',
    footnoteReference:'각주·미주',endnoteReference:'각주·미주',commentRangeStart:'메모·책갈피',bookmarkStart:'메모·책갈피',
    ins:'변경 내용 추적',del:'변경 내용 추적',moveFrom:'변경 내용 추적',moveTo:'변경 내용 추적',
    fldSimple:'필드',fldChar:'필드',instrText:'필드',sdt:'콘텐츠 컨트롤',anchor:'떠 있는 개체',
    pict:'도형·기타 개체',object:'도형·기타 개체',chart:'차트',oMath:'수식',oMathPara:'수식',altChunk:'포함 문서',
    tblpPr:'떠 있는 표',pgBorders:'쪽 테두리',pgNumType:'쪽 번호 설정',srcRect:'그림 자르기'}));
  for (const node of descendants(body)) if (unsupported.has(node.name)) warnings.add(unsupported.get(node.name));

  function picture(node) {
    const parts=Array.from(descendants(node)), blip=parts.find(n=>n.name==='blip'), extent=parts.find(n=>n.name==='extent');
    const target=links.get(attr(blip,'embed'));
    const ext=path.posix.extname(target?.part ?? '').slice(1).toLowerCase();
    if (target?.type!=='image' || !Object.hasOwn(imageTypes,ext) || !pkg.entries.has(target.part) || !extent) {
      warnings.add('일부 그림 또는 그리기 개체');
      return undefined;
    }
    if (!pictures.has(target.part)) pictures.set(target.part,{bytes:pkg.data(target.part),ext});
    return {kind:'picture',media:pictures.get(target.part),width:Math.max(1,Math.round(nonnegative(attr(extent,'cx'))/pictureExtent)),
      height:Math.max(1,Math.round(nonnegative(attr(extent,'cy'))/pictureExtent)),description:attr(parts.find(n=>n.name==='docPr'),'descr')};
  }
  function paragraph(node) {
    const props=child(node,'pPr'), paragraphStyle=style(val(props,'pStyle') ?? normal);
    if (paragraphStyle.numbered) warnings.add('자동 문단 번호');
    const format={...defaultPara,...paragraphStyle.para,...wordParagraphStyle(props,warnings)};
    const runs=[];
    function visit(container) {
      for (const n of elements(container)) {
        if (n.name==='r') {
          const prop=child(n,'rPr');
          if (child(prop,'rStyle')) warnings.add('Word 글자 스타일');
          const format={...defaultRun,...paragraphStyle.run,...style(val(prop,'rStyle')).run,...wordStyle(prop,warnings)};
          for (const content of elements(n)) {
            if (content.name==='t') runs.push({kind:'text',text:textOf(content),format});
            else if (content.name==='tab') runs.push({kind:'tab',format});
            else if (content.name==='br' || content.name==='cr') runs.push({kind:attr(content,'type')==='page'?'pageBreak':'break',format});
            else if (content.name==='drawing') {
              const image=picture(content);
              if (image) runs.push({...image,format});
            } else if (!['rPr','lastRenderedPageBreak','instrText','fldChar'].includes(content.name)) warnings.add('일부 글자 개체');
          }
        } else if (n.name==='del'||n.name==='moveFrom') continue;
        else if (n.name!=='pPr') {
          if (n.name==='hyperlink') warnings.add('하이퍼링크');
          visit(n);
        }
      }
    }
    visit(node);
    return {kind:'paragraph',format,runs,emptyFormat:{...defaultRun,...paragraphStyle.run,...wordStyle(child(props,'rPr'),warnings)}};
  }
  function table(node) {
    const widths=children(child(node,'tblGrid'),'gridCol').map(c=>nonnegative(attr(c,'w'))*5), rows=[];
    const properties=child(node,'tblPr'), margins=child(properties,'tblCellMar'), tableStyle=val(properties,'tblStyle');
    const tableBorders=child(properties,'tblBorders') ?? child(child(styles.get(tableStyle),'tblPr'),'tblBorders');
    if (children(styles.get(tableStyle),'tblStylePr').length) warnings.add('일부 조건부 표 서식');
    const rowNodes=children(node,'tr');
    const borderFor=(record,fallbackType='none')=>{
      const kind=attr(record,'val')||fallbackType;
      if (!Object.hasOwn(wordBorderTypes,kind)) warnings.add('일부 표 테두리');
      return {type:wordBorderTypes[kind]??'SOLID',mm:nonnegative(attr(record,'sz'),4)*25.4/72/8,color:color(attr(record,'color'))};
    };
    const active=new Map();
    for (const tr of rowNodes) {
      const props=child(tr,'trPr'), row={cells:[],height:nonnegative(val(props,'trHeight'))*5,header:on(props,'tblHeader')===true};
      let col=nonnegative(val(props,'gridBefore'));
      const continued=new Map();
      for (const tc of children(tr,'tc')) {
        const pr=child(tc,'tcPr'), span=Math.min(256,Math.max(1,nonnegative(val(pr,'gridSpan'),1)));
        if (col+span>256 || rows.length>=65535) throw Error('지원 범위를 넘는 표입니다.');
        const merge=child(pr,'vMerge'), prior=active.get(col);
        if (merge && attr(merge,'val')!=='restart' && prior?.colSpan===span) {
          prior.rowSpan++;
          continued.set(col,prior);
          col+=span;
          continue;
        }
        const sizing=child(pr,'tcW'), width=attr(sizing,'type')==='dxa'?nonnegative(attr(sizing,'w'))*5:undefined;
        const gap=child(pr,'tcMar'), direct=child(pr,'tcBorders');
        const borders=Object.fromEntries(cellSides.map(side=>{
          const interior=side==='top'?rows.length>0:side==='bottom'?rows.length+1<rowNodes.length:
            side==='left'?col>0:widths.length>0?col+span<widths.length:tc!==children(tr,'tc').at(-1);
          const defaultEdge=child(tableBorders,interior?(side==='top'||side==='bottom'?'insideH':'insideV'):side);
          return [side,borderFor(child(direct,side)??defaultEdge,tableStyle==='TableGrid'?'single':'none')];
        }));
        const cell={col,colSpan:span,rowSpan:1,width,borders,
          shade:color(attr(child(pr,'shd'),'fill'),''),vertical:(val(pr,'vAlign') ?? 'top').toUpperCase(),
          margin:Object.fromEntries(sides.slice(0,4).map(side=>[side,nonnegative(attr(child(gap,side) ?? child(margins,side),'w'),side==='left'||side==='right'?108:0)*5])),
          blocks:bodyBlocks(tc)};
        if (merge) continued.set(col,cell);
        row.cells.push(cell);
        col+=span;
      }
      if (nonnegative(val(props,'gridBefore')) || nonnegative(val(props,'gridAfter'))) warnings.add('일부 비정형 표');
      active.clear();
      for (const [col,cell] of continued) active.set(col,cell);
      row.columns=col;
      rows.push(row);
    }
    if (!rows.length) throw Error('행이 없는 표를 변환할 수 없습니다.');
    return {kind:'table',rows,widths};
  }
  function bodyBlocks(parent) {
    const result=[];
    for (const n of elements(parent)) {
      if (n.name==='p') result.push(paragraph(n));
      else if (n.name==='tbl') result.push(table(n));
      else if (n.name==='sdt') result.push(...bodyBlocks(child(n,'sdtContent')));
      else if (!['tcPr','sectPr','bookmarkStart','bookmarkEnd','proofErr'].includes(n.name)) warnings.add('일부 본문 개체');
    }
    return result;
  }
  const sections=[];
  let blocks=[];
  for (const node of elements(body)) {
    if (node.name==='sectPr') continue;
    blocks.push(...bodyBlocks({children:[node]}));
    const breakProperties=child(child(node,'pPr'),'sectPr');
    if (node.name==='p'&&breakProperties) {
      sections.push({blocks,page:wordPage(breakProperties,warnings)});
      blocks=[];
    }
  }
  sections.push({blocks,page:wordPage(child(body,'sectPr'),warnings)});
  return {sections,warnings};
}

function hwpxWriter(blankBytes) {
  const base=packageParts(blankBytes);
  const source=name=>base.data(name).toString('utf8');
  const section=source('Contents/section0.xml');
  const sectionStart=section.slice(0,section.indexOf('<hp:p '));
  const settings=/<hp:secPr\b[\s\S]*?<\/hp:secPr>/.exec(section)?.[0];
  const column=/<hp:colPr\b[^>]*\/>/.exec(section)?.[0];
  const templateHeader=source('Contents/header.xml');
  const templateChar=/<hh:charPr\b[^>]*id="0"[\s\S]*?<\/hh:charPr>/.exec(templateHeader)?.[0];
  const templatePara=/<hh:paraPr\b[^>]*id="0"[\s\S]*?<\/hh:paraPr>/.exec(templateHeader)?.[0];
  const noCellFill=/<hh:borderFill\b[^>]*id="2"[\s\S]*?<\/hh:borderFill>/.exec(templateHeader)?.[0];
  if (!sectionStart||!settings||!column||!templateChar||!templatePara||!noCellFill) throw Error('Pwh의 기본 문서 구조를 읽을 수 없습니다.');
  const templateRoot=base.xml('Contents/header.xml'), refs=child(templateRoot,'refList');
  const counts=Object.fromEntries(['charProperties','paraProperties','borderFills'].map(name=>{
    const values=elements(child(refs,name));
    return [name,Math.max(-1,...values.map(node=>styleRef(node,'id')))+1];
  }));
  const fontDefs=children(child(refs,'fontfaces'),'fontface'), fontCount=Math.max(...fontDefs.flatMap(n=>children(n,'font')).map(n=>styleRef(n,'id')))+1;
  const fonts=new Map(), characterStyles=new Map(), paragraphStyles=new Map(), cellFills=new Map(), media=new Map();
  let id=1, objectId=1;
  function intern(map,key,base,xml) {
    if (!map.has(key)) map.set(key,{id:base+map.size,xml:xml(base+map.size)});
    return map.get(key).id;
  }
  const fontIndex=face=>face?intern(fonts,face,fontCount,idx=>tag('hh:font',{id:idx,face,type:'TTF',isEmbedded:0})):1;
  function characterStyle(style) {
    if (!Object.keys(style).length) return 0;
    const font=fontIndex(style.font), latin=style.latin?fontIndex(style.latin):font;
    return intern(characterStyles,JSON.stringify(style),counts.charProperties,idx=>templateChar
      .replace(/\bid="0"/,'id="'+idx+'"').replace(/\bheight="[^"]*"/,'height="'+(style.size||1000)+'"')
      .replace(/\btextColor="[^"]*"/,'textColor="#'+(style.color||'000000')+'"')
      .replace(/\bshadeColor="[^"]*"/,'shadeColor="'+(style.shade?'#'+style.shade:'none')+'"')
      .replace(/<hh:fontRef[^>]*\/>/,tag('hh:fontRef',Object.fromEntries(groups.map(key=>[key,key==='latin'?latin:font]))))
      .replace(/<hh:underline[^>]*\/>/,(style.bold?'<hh:bold/>':'')+(style.italic?'<hh:italic/>':'')+
        (style.vertical==='superscript'?'<hh:supscript/>':style.vertical==='subscript'?'<hh:subscript/>':'')+
        tag('hh:underline',{type:style.underline?'BOTTOM':'NONE',shape:'SOLID',color:'#'+(style.color||'000000')}))
      .replace(/<hh:strikeout[^>]*\/>/,tag('hh:strikeout',{shape:style.strike?'SOLID':'NONE',color:'#'+(style.color||'000000')})));
  }
  function paragraphStyle(style) {
    if (!Object.keys(style).length) return 0;
    const margins={intent:style.first,left:style.left,right:style.right,prev:style.before,next:style.after};
    return intern(paragraphStyles,JSON.stringify(style),counts.paraProperties,idx=>templatePara
      .replace(/\bid="0"/,'id="'+idx+'"').replace(/\bhorizontal="[^"]*"/,'horizontal="'+(style.align ?? 'LEFT')+'"')
      .replace(/\bkeepWithNext="0"/,'keepWithNext="'+Number(!!style.keepWithNext)+'"')
      .replace(/\bkeepLines="0"/,'keepLines="'+Number(!!style.keepLines)+'"')
      .replace(/<hc:(intent|left|right|prev|next) value="[^"]*"/g,(_,side)=>'<hc:'+side+' value="'+(margins[side]??0)+'"')
      .replace(/<hh:lineSpacing type="[^"]*" value="[^"]*"/g,()=>'<hh:lineSpacing type="'+(style.lineType??'PERCENT')+'" value="'+(style.line??100)+'"'));
  }
  function cellFill(shade='',borders={}) {
    return intern(cellFills,JSON.stringify([shade,borders]),counts.borderFills,idx=>noCellFill.replace(/\bid="2"/,'id="'+idx+'"')
      .replace(/<hh:(left|right|top|bottom)Border[^>]*\/>/g,(original,side)=>{
        const border=borders[side];
        return border?tag('hh:'+side+'Border',{type:border.type,width:border.mm.toFixed(2)+' mm',color:'#'+border.color}):original;
      })
      .replace(/faceColor="none"/g,'faceColor="'+(shade?'#'+shade:'none')+'"'));
  }
  const size=(width,height)=>tag('hp:sz',{width,height,widthRelTo:'ABSOLUTE',heightRelTo:'ABSOLUTE',protect:0});
  const inline=tag('hp:pos',{treatAsChar:1,affectLSpacing:0,flowWithText:1,allowOverlap:0,vertRelTo:'PARA',horzRelTo:'PARA',vertAlign:'TOP',horzAlign:'LEFT',vertOffset:0,horzOffset:0});
  const zero=Object.fromEntries(sides.slice(0,4).map(side=>[side,0]));
  function picture(run,maxWidth) {
    if (!media.has(run.media)) media.set(run.media,'image'+(media.size+1));
    const mediaId=media.get(run.media), uid=objectId++;
    const width=Math.min(maxWidth,run.width), height=Math.max(1,Math.round(run.height*width/run.width));
    return tag('hp:pic',{id:uid,instid:uid,zOrder:uid,numberingType:'PICTURE',textWrap:'TOP_AND_BOTTOM',textFlow:'BOTH_SIDES'},
      tag('hp:offset',{x:0,y:0})+tag('hp:orgSz',coords(width,height))+tag('hp:curSz',coords(width,height))+
      tag('hp:imgRect',{},[[0,0],[width,0],[width,height],[0,height]].map(([x,y],i)=>tag('hc:pt'+i,{x,y})).join(''))+
      tag('hp:imgClip',{left:0,top:0,right:width,bottom:height})+tag('hp:imgDim',coords(width,height))+
      tag('hc:img',{binaryItemIDRef:mediaId,bright:0,contrast:0,effect:'REAL_PIC'})+
      size(width,height)+inline+tag('hp:outMargin',zero)+(run.description?tag('hp:shapeComment',{},esc(run.description)):''));
  }
  function paragraph(p, maxWidth, prefix='', forcedBreak=false, extra='') {
    function runs(list) {
      return list.map(run=>tag('hp:run',{charPrIDRef:characterStyle(run.format)},run.kind==='picture'?picture(run,maxWidth):
        tag('hp:t',{},run.kind==='text'?esc(run.text):run.kind==='tab'?'<hp:tab/>':'<hp:lineBreak/>'))).join('');
    }
    const empty=tag('hp:run',{charPrIDRef:characterStyle(p.emptyFormat ?? {})},'<hp:t/>');
    const segment = (list, opening, pageBreak) => tag('hp:p',{id:id++,paraPrIDRef:paragraphStyle(p.format),styleIDRef:0,
      pageBreak:Number(pageBreak),columnBreak:0,merged:0},opening+(runs(list)||empty)+extra);
    let list=[], output='', opening=prefix, makeBreak=forcedBreak||p.format.pageBreak;
    for (const run of p.runs) {
      if (run.kind==='pageBreak') {output+=segment(list,opening,!!makeBreak);list=[];opening='';makeBreak=true;}
      else list.push(run);
    }
    return output+segment(list,opening,!!makeBreak);
  }
  const blank={kind:'paragraph',format:{},runs:[]};
  function table(table,maxWidth) {
    const colCount=Math.max(table.widths.length,...table.rows.map(row=>row.columns),1);
    if (colCount>256) throw Error('지원 범위를 넘는 표입니다.');
    const widths=Array.from({length:colCount},(_,col)=>table.widths[col]||0);
    for (const {cells} of table.rows) for (const {col,colSpan,width} of cells) if (colSpan===1&&!widths[col]&&width) widths[col]=width;
    for (let i=0;i<widths.length;i++) if (!widths[i]) widths[i]=Math.max(1,Math.floor(maxWidth/colCount));
    const actual=widths.reduce((a,b)=>a+b,0);
    if (actual>maxWidth) for (let i=0;i<widths.length;i++) widths[i]=Math.max(1,Math.floor(widths[i]*maxWidth/actual));
    const rowHeight=row=>Math.max(1000,row.height);
    const uid=objectId++;
    const innerRows=table.rows.map((row,rowIndex)=>tag('hp:tr',{},row.cells.map(cell=>{
      const w=widths.slice(cell.col,cell.col+cell.colSpan).reduce((a,b)=>a+b,0);
      const h=table.rows.slice(rowIndex,rowIndex+cell.rowSpan).reduce((sum,item)=>sum+rowHeight(item),0);
      return tag('hp:tc',{header:Number(row.header),hasMargin:1,protect:0,editable:0,borderFillIDRef:cellFill(cell.shade,cell.borders)},
        tag('hp:subList',{textDirection:'HORIZONTAL',lineWrap:'BREAK',vertAlign:cell.vertical==='BOTH'?'CENTER':cell.vertical},
          blocks(cell.blocks,Math.max(1,w-cell.margin.left-cell.margin.right)))+
        tag('hp:cellAddr',{colAddr:cell.col,rowAddr:rowIndex})+tag('hp:cellSpan',{colSpan:cell.colSpan,rowSpan:cell.rowSpan})+
        tag('hp:cellSz',coords(w,h))+tag('hp:cellMargin',cell.margin));
    }).join(''))).join('');
    return tag('hp:tbl',{id:uid,zOrder:uid,numberingType:'TABLE',textWrap:'TOP_AND_BOTTOM',textFlow:'BOTH_SIDES',
      pageBreak:'CELL',repeatHeader:Number(table.rows[0].header),rowCnt:table.rows.length,colCnt:colCount,cellSpacing:0,borderFillIDRef:cellFill('')},
      size(widths.reduce((a,b)=>a+b,0),table.rows.reduce((a,b)=>a+rowHeight(b),0))+inline+tag('hp:outMargin',zero)+tag('hp:inMargin',zero)+innerRows);
  }
  function blocks(list,width,prefix='') {
    if (!list.length) return paragraph(blank,width,prefix);
    return list.map((block,index)=>{
      const opening=index===0?prefix:'';
      return block.kind==='table'?paragraph(blank,width,opening,false,tag('hp:run',{charPrIDRef:0},table(block,width))):paragraph(block,width,opening);
    }).join('');
  }
  return sections=>{
    const sectionMembers=sections.map(({page,blocks:list},index)=>{
      const {width,height,margin,cols,gap}=page;
      const layout=settings.replace(/<hp:pagePr\b[^>]*>[\s\S]*?<\/hp:pagePr>/,
        tag('hp:pagePr',{landscape:width>height?'NARROWLY':'WIDELY',width,height,gutterType:'LEFT_ONLY'},tag('hp:margin',margin)));
      const colProps=column.replace(/colCount="\d+"/,'colCount="'+cols+'"').replace(/sameGap="\d+"/,'sameGap="'+gap+'"');
      const prefix=tag('hp:run',{charPrIDRef:0},layout+tag('hp:ctrl',{},colProps));
      const available=Math.max(1,Math.floor((width-margin.left-margin.right-margin.gutter-(cols-1)*gap)/cols));
      return item('Contents/section'+index+'.xml',sectionStart+blocks(list,available,prefix)+'</hs:sec>');
    });
    const assets=Array.from(media,([asset,id])=>({id,name:'BinData/'+id+'.'+asset.ext,bytes:asset.bytes,type:imageTypes[asset.ext]}));
    const hpf=source('Contents/content.hpf').replace(/<opf:item id="section0"[^>]*\/>/,
      sectionMembers.map(({name},i)=>tag('opf:item',{id:'section'+i,href:name,'media-type':'application/xml'})).join('')+
      assets.map(({id,name,type})=>tag('opf:item',{id,href:name,'media-type':type,isEmbeded:1})).join(''))
      .replace(/<opf:itemref idref="section0"[^>]*\/>/,sectionMembers.map((_,i)=>tag('opf:itemref',{idref:'section'+i,linear:'yes'})).join(''));
    let header=templateHeader.replace(/\bsecCnt="\d+"/,'secCnt="'+sections.length+'"');
    const newFonts=Array.from(fonts.values(),f=>f.xml).join('');
    if (newFonts) header=header.replace(/(<hh:fontface\b[^>]*fontCnt=")(\d+)("[^>]*>)([\s\S]*?)<\/hh:fontface>/g,
      (_,a,count,b,xml)=>a+(Number(count)+fonts.size)+b+xml+newFonts+'</hh:fontface>');
    for (const [name,map] of [['charProperties',characterStyles],['paraProperties',paragraphStyles],['borderFills',cellFills]]) {
      header=header.replace(new RegExp('(<hh:'+name+'[^>]*itemCnt=")(\\d+)(")'),(_,a,count,b)=>a+(Number(count)+map.size)+b)
        .replace('</hh:'+name+'>',Array.from(map.values(),f=>f.xml).join('')+'</hh:'+name+'>');
    }
    const preserved=Array.from(base.entries.keys()).filter(name=>!/^Contents\/(?:section\d+\.xml|header\.xml|content\.hpf)$/.test(name));
    return writeZipMembers([...preserved.map(name=>item(name,base.data(name),name==='mimetype')),
      item('Contents/header.xml',header),item('Contents/content.hpf',hpf),...sectionMembers,...assets.map(a=>item(a.name,a.bytes))]);
  };
}

export function importDocx(bytes, blankBytes) {
  const {sections,warnings}=paragraphsInWord(bytes);
  return {bytes:hwpxWriter(blankBytes)(sections),warnings:Array.from(warnings)};
}

function hwpxModel(bytes) {
  const pkg=packageParts(bytes), packageXml=pkg.xml('Contents/content.hpf'), header=pkg.xml('Contents/header.xml');
  if (!packageXml||!header) throw Error('저장할 HWPX 문서 구조를 읽을 수 없습니다.');
  const manifest=new Map(children(child(packageXml,'manifest'),'item').map(node=>[attr(node,'id'),attr(node,'href')]));
  const refs=child(header,'refList'), warnings=new Set(), media=new Map();
  const lookup=name=>new Map(elements(child(refs,name)).map(node=>[styleRef(node,'id'),node]));
  const fonts=new Map(children(child(refs,'fontfaces'),'fontface').map(group=>[attr(group,'lang'),
    new Map(children(group,'font').map(node=>[styleRef(node,'id'),attr(node,'face')]))]));
  const chars=lookup('charProperties'), paras=lookup('paraProperties'), borders=lookup('borderFills');
  function style(id) {
    const n=chars.get(id), font=child(n,'fontRef'), under=child(n,'underline'), strike=child(n,'strikeout');
    return normalize({font:fonts.get('HANGUL')?.get(styleRef(font,'hangul')),latin:fonts.get('LATIN')?.get(styleRef(font,'latin')),
      size:nonnegative(attr(n,'height'),1000),color:color(attr(n,'textColor')?.slice(1)),
      shade:color(attr(n,'shadeColor')?.replace(/^#/,''),'')||undefined,
      bold:!!child(n,'bold'),italic:!!child(n,'italic'),
      underline:!!under && attr(under,'type')!=='NONE',strike:!!strike && attr(strike,'shape')!=='NONE',
      vertical:child(n,'supscript')?'superscript':child(n,'subscript')?'subscript':undefined});
  }
  function paraStyle(p) {
    const node=paras.get(styleRef(p,'paraPrIDRef')), variant=child(child(node,'switch'),'case') ?? child(child(node,'switch'),'default') ?? node;
    const margin=child(variant,'margin'), line=child(variant,'lineSpacing'), heading=child(node,'heading'), breaking=child(node,'breakSetting');
    if (['OUTLINE','NUMBER','BULLET'].includes(attr(heading,'type'))) warnings.add('자동 문단 번호');
    return {align:attr(child(node,'align'),'horizontal'),left:integer(attr(child(margin,'left'),'value')),
      right:integer(attr(child(margin,'right'),'value')),first:integer(attr(child(margin,'intent'),'value')),
      before:integer(attr(child(margin,'prev'),'value')),after:integer(attr(child(margin,'next'),'value')),
      line:nonnegative(attr(line,'value'),160),lineType:attr(line,'type'),
      keepWithNext:attr(breaking,'keepWithNext')==='1',keepLines:attr(breaking,'keepLines')==='1',
      pageBreak:attr(p,'pageBreak')==='1'||attr(breaking,'pageBreakBefore')==='1'};
  }
  function picture(n) {
    const img=child(n,'img'), ref=attr(img,'binaryItemIDRef'), filename=manifest.get(ref), size=child(n,'sz');
    const ext=path.posix.extname(filename ?? '').slice(1).toLowerCase();
    const width=nonnegative(attr(size,'width')), height=nonnegative(attr(size,'height'));
    if (!Object.hasOwn(imageTypes,ext)||!pkg.entries.has(filename)||!width||!height) {
      warnings.add('일부 그림');
      return undefined;
    }
    if (attr(child(n,'pos'),'treatAsChar')!=='1' || integer(attr(child(n,'rotationInfo'),'angle'))
      || attr(n,'reverse')==='1' || child(n,'caption')) warnings.add('그림 위치·회전·캡션');
    if (!media.has(ref)) media.set(ref,{bytes:pkg.data(filename),ext});
    return {kind:'picture',media:media.get(ref),width,height,description:textOf(child(n,'shapeComment'))};
  }
  function table(n) {
    const cols=nonnegative(attr(n,'colCnt')), rows=children(n,'tr'), minWidth=Math.max(1,Math.round(nonnegative(attr(child(n,'sz'),'width'),42520)/Math.max(1,cols)));
    if (!cols || cols>256 || !rows.length || rows.length>65535) throw Error('DOCX로 변환할 표의 구조를 읽을 수 없습니다.');
    if (attr(child(n,'pos'),'treatAsChar')!=='1' || child(n,'caption')) warnings.add('표 위치·캡션');
    const widths=Array(cols).fill(0), rowHeights=Array(rows.length).fill(0);
    const list=rows.map((row,index)=>{
      const cells=children(row,'tc').map(tc=>{
        const addr=child(tc,'cellAddr'), span=child(tc,'cellSpan'), sz=child(tc,'cellSz'), inner=child(tc,'subList');
        const col=nonnegative(attr(addr,'colAddr')), colSpan=Math.max(1,nonnegative(attr(span,'colSpan'),1));
        const rowSpan=Math.max(1,nonnegative(attr(span,'rowSpan'),1));
        const width=nonnegative(attr(sz,'width')), height=nonnegative(attr(sz,'height'));
        if (col+colSpan>cols || index+rowSpan>rows.length) throw Error('표의 셀 병합 정보를 읽을 수 없습니다.');
        if (colSpan===1&&width) widths[col]=width;
        if (rowSpan===1&&height) rowHeights[index]=Math.max(rowHeights[index],height);
        const fill=borders.get(styleRef(tc,'borderFillIDRef')), brush=child(fill,'fillBrush'), win=child(brush,'winBrush');
        if (elements(brush).some(node=>node.name!=='winBrush') || (attr(win,'hatchStyle')&&attr(win,'hatchStyle')!=='NONE')) warnings.add('표의 그라데이션·무늬·그림 배경');
        const edges=Object.fromEntries(cellSides.map(side=>{
          const border=child(fill,side+'Border'), type=attr(border,'type')||'NONE';
          if (!Object.hasOwn(hwpxBorderTypes,type)) warnings.add('일부 표 테두리');
          return [side,{type,mm:Number.parseFloat(attr(border,'width'))||0.1,color:color(attr(border,'color')?.slice(1))}];
        }));
        const margin=attr(tc,'hasMargin')==='1'?child(tc,'cellMargin'):child(n,'inMargin');
        return {col,colSpan,rowSpan,width,height,borders:edges,shade:color(attr(win,'faceColor')?.slice(1),''),
          vertical:attr(inner,'vertAlign'),margin:Object.fromEntries(sides.slice(0,4).map(side=>[side,nonnegative(attr(margin,side))])),
          blocks:children(inner,'p').flatMap(paragraph)};
      });
      return {cells,header:!!children(row,'tc').find(tc=>attr(tc,'header')==='1')};
    });
    for (const [rowIndex,{cells}] of list.entries()) for (const cell of cells) {
      const unknown=widths.slice(cell.col,cell.col+cell.colSpan).filter(w=>!w).length;
      if (unknown&&cell.width) {
        const known=widths.slice(cell.col,cell.col+cell.colSpan).reduce((a,b)=>a+b,0);
        const estimate=Math.max(1,Math.round((cell.width-known)/unknown));
        for (let i=cell.col;i<cell.col+cell.colSpan;i++) if (!widths[i]) widths[i]=estimate;
      }
      if (cell.rowSpan>1&&cell.height) {
        const estimate=Math.round(cell.height/cell.rowSpan);
        for (let i=rowIndex;i<rowIndex+cell.rowSpan;i++) if (!rowHeights[i]) rowHeights[i]=estimate;
      }
    }
    return {kind:'table',rows:list.map((row,i)=>({...row,height:rowHeights[i]})),widths:widths.map(w=>w||minWidth)};
  }
  function paragraph(n) {
    const format=paraStyle(n), output=[];
    let runs=[], emptyFormat={};
    function flush(force=false) {
      if (runs.length||force) output.push({kind:'paragraph',format:{...format,pageBreak:format.pageBreak&&!output.length},runs,emptyFormat});
      runs=[];
    }
    for (const run of children(n,'run')) {
      const runFormat=style(styleRef(run,'charPrIDRef'));
      emptyFormat=runFormat;
      for (const content of elements(run)) {
        if (content.name==='t') {
          for (const text of content.children) {
            if (typeof text==='string') runs.push({kind:'text',text,format:runFormat});
            else if (text.name==='tab' || text.name==='lineBreak') runs.push({kind:text.name==='tab'?'tab':'break',format:runFormat});
            else if (text.name==='nbSpace'||text.name==='fwSpace'||text.name==='hyphen') runs.push({kind:'text',text:({nbSpace:'\u00a0',fwSpace:'\u3000',hyphen:'\u00ad'})[text.name],format:runFormat});
            else warnings.add('일부 글자 개체');
          }
        } else if (content.name==='tbl') {
          flush(format.pageBreak&&!output.length);
          output.push(table(content));
        } else if (content.name==='pic') {
          const image=picture(content);
          if (image) runs.push({...image,format:runFormat});
        } else if (content.name==='ctrl') {
          if (elements(content).some(ctrl=>ctrl.name!=='colPr')) warnings.add('머리말·꼬리말·각주 또는 기타 조판 부호');
        } else if (!['secPr','colPr'].includes(content.name)) warnings.add('도형·수식 또는 기타 본문 개체');
      }
    }
    flush(!output.length);
    return output;
  }
  const sections=[];
  for (const ref of children(child(packageXml,'spine'),'itemref')) {
    const filename=manifest.get(attr(ref,'idref'));
    if (!filename || !/(?:^|\/)section\d+\.xml$/.test(filename)) continue;
    const section=pkg.xml(filename);
    if (!section||section.name!=='sec') throw Error('HWPX의 구역을 읽을 수 없습니다.');
    const props=Array.from(descendants(section)).find(n=>n.name==='secPr'), pageProps=child(props,'pagePr'), margins=child(pageProps,'margin');
    const columns=Array.from(descendants(section)).filter(n=>n.name==='colPr');
    if (columns.length>1 || attr(columns[0],'sameSz')==='0') warnings.add('구역 안에서 바뀌는 단');
    const defaults=deck(), page=deck(nonnegative(attr(pageProps,'width'),defaults.width),nonnegative(attr(pageProps,'height'),defaults.height),
      Object.fromEntries(sides.map(side=>[side,nonnegative(attr(margins,side),defaults.margin[side])])),
      Math.max(1,nonnegative(attr(columns[0],'colCount'),1)),nonnegative(attr(columns[0],'sameGap')));
    sections.push({page,blocks:children(section,'p').flatMap(paragraph)});
  }
  if (!sections.length) throw Error('DOCX로 저장할 문서에 본문 구역이 없습니다.');
  return {sections,warnings};
}

function wordWriter(sections) {
  const media=new Map();
  let pictureId=0;
  const twip=hu=>Math.round((hu ?? 0)/5);
  const size=(name,value)=>tag('w:'+name,{'w:w':twip(value),'w:type':'dxa'});
  function runs(list) {
    return list.map(run=>{
      let content='';
      if (run.kind==='text') content=tag('w:t',{'xml:space':'preserve'},esc(run.text));
      else if (run.kind==='break'||run.kind==='tab') content='<w:'+(run.kind==='tab'?'tab':'br')+'/>';
      else if (run.kind==='picture') content=picture(run);
      const {font,latin,size,color,bold,italic,underline,strike,vertical,shade}=run.format ?? {};
      const fontTag=font||latin?tag('w:rFonts',{'w:ascii':latin||font,'w:hAnsi':latin||font,'w:eastAsia':font||latin}):'';
      const background=shade?(highlightsByColor[shade]?prop('highlight',highlightsByColor[shade]):
        tag('w:shd',{'w:val':'clear','w:color':'auto','w:fill':shade})):'';
      return tag('w:r',{},tag('w:rPr',{},fontTag+(bold?'<w:b/>':'')+(italic?'<w:i/>':'')+(strike?'<w:strike/>':'')+
        prop('color',color)+prop('sz',size===undefined?undefined:Math.max(1,Math.round(size/50)))+background+
        prop('u',underline?'single':undefined)+prop('vertAlign',vertical))+content);
    }).join('');
  }
  function picture(image) {
    if (!media.has(image.media)) media.set(image.media,'image'+(media.size+1));
    const relId=media.get(image.media), id=++pictureId, cx=image.width*pictureExtent, cy=image.height*pictureExtent;
    const name='Picture '+id, extent={cx,cy};
    return tag('w:drawing',{},tag('wp:inline',{},
      tag('wp:extent',extent)+tag('wp:docPr',{id,name,descr:image.description})+
      tag('a:graphic',{},tag('a:graphicData',{uri:'http://schemas.openxmlformats.org/drawingml/2006/picture'},tag('pic:pic',{},
        tag('pic:nvPicPr',{},tag('pic:cNvPr',{id:0,name})+'<pic:cNvPicPr/>')+
        tag('pic:blipFill',{},tag('a:blip',{'r:embed':relId})+'<a:stretch><a:fillRect/></a:stretch>')+
        tag('pic:spPr',{},tag('a:xfrm',{},'<a:off x="0" y="0"/>'+tag('a:ext',extent))+'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'))))));
  }
  function paragraph(block, section='') {
    const f=block.format ?? {}, fragments=runs(block.runs ?? []);
    const align=({LEFT:'left',RIGHT:'right',CENTER:'center',JUSTIFY:'both',DISTRIBUTE:'distribute'})[f.align];
    const properties=(f.keepWithNext?'<w:keepNext/>':'')+(f.keepLines?'<w:keepLines/>':'')+(f.pageBreak?'<w:pageBreakBefore/>':'')+
      tag('w:spacing',{'w:before':Math.max(0,twip(f.before)),'w:after':Math.max(0,twip(f.after)),
        'w:line':f.line===undefined?undefined:f.lineType==='FIXED'||f.lineType==='AT_LEAST'?twip(f.line):Math.round(f.line*240/100),
        'w:lineRule':f.line===undefined?undefined:f.lineType==='FIXED'?'exact':f.lineType==='AT_LEAST'?'atLeast':'auto'})+
      tag('w:ind',{'w:left':twip(f.left),'w:right':twip(f.right),'w:firstLine':f.first>0?twip(f.first):undefined,
        'w:hanging':f.first<0?-twip(f.first):undefined})+prop('jc',align)+section;
    return tag('w:p',{},tag('w:pPr',{},properties)+fragments);
  }
  function table(block) {
    const active=new Map();
    const tableProps=tag('w:tblPr',{},size('tblW',block.widths.reduce((a,b)=>a+b,0))+tag('w:tblLayout',{'w:type':'fixed'}));
    const grid=tag('w:tblGrid',{},block.widths.map(width=>tag('w:gridCol',{'w:w':twip(width)})).join(''));
    function cell(record, continuation=false) {
      const {col,colSpan,rowSpan,margin,shade,borders,vertical,blocks:list}=record;
      const width=block.widths.slice(col,col+colSpan).reduce((a,b)=>a+b,0);
      const properties=size('tcW',width)+(colSpan>1?prop('gridSpan',colSpan):'')+
        (continuation?'<w:vMerge/>':rowSpan>1?prop('vMerge','restart'):'')+
        (borders?tag('w:tcBorders',{},cellSides.map(side=>{
          const edge=borders[side], type=hwpxBorderTypes[edge.type]??'single';
          return tag('w:'+side,{'w:val':type,'w:color':edge.color,'w:sz':Math.max(2,Math.min(96,Math.round(edge.mm*72*8/25.4)))});
        }).join('')):'')+
        (shade?tag('w:shd',{'w:val':'clear','w:color':'auto','w:fill':shade}):'')+
        (margin?tag('w:tcMar',{},sides.slice(0,4).map(side=>size(side,margin[side])).join('')):'')+
        prop('vAlign',({TOP:'top',CENTER:'center',BOTTOM:'bottom'})[vertical]);
      return tag('w:tc',{},tag('w:tcPr',{},properties)+(continuation?'<w:p/>':
        blocks(list)+(list.at(-1)?.kind==='paragraph'?'':'<w:p/>')));
    }
    const rows=block.rows.map((row,i)=>{
      for (const [col,record] of active) if (record.until<=i) active.delete(col);
      const start=new Map(row.cells.map(c=>[c.col,c]));
      let result='';
      for (let col=0;col<block.widths.length;) {
        const record=start.get(col), spanning=active.get(col);
        if (record) {
          result+=cell(record);
          if (record.rowSpan>1) active.set(col,{...record,until:i+record.rowSpan});
          col+=record.colSpan;
        } else if (spanning) {
          result+=cell(spanning,true);
          col+=spanning.colSpan;
        } else {
          result+=cell({col,colSpan:1,rowSpan:1,blocks:[]});
          col++;
        }
      }
      const props=(row.height?tag('w:trHeight',{'w:val':twip(row.height),'w:hRule':'atLeast'}):'')+(row.header?'<w:tblHeader/>':'');
      return tag('w:tr',{},tag('w:trPr',{},props)+result);
    }).join('');
    return tag('w:tbl',{},tableProps+grid+rows);
  }
  function blocks(list) {
    return list.map(block=>block.kind==='table'?table(block):paragraph(block)).join('');
  }
  const body=sections.map(({page,blocks:list},i)=>{
    const properties=tag('w:sectPr',{},tag('w:pgSz',{'w:w':twip(page.width),'w:h':twip(page.height),'w:orient':page.width>page.height?'landscape':undefined})+
      tag('w:pgMar',Object.fromEntries(sides.map(side=>['w:'+side,twip(page.margin[side])])))+
        tag('w:cols',{'w:num':page.cols,'w:space':twip(page.gap)}));
    if (i===sections.length-1) return (blocks(list)||'<w:p/>')+properties;
    const last=list.at(-1);
    if (last?.kind==='paragraph') return blocks(list.slice(0,-1))+paragraph(last,properties);
    return blocks(list)+paragraph({},properties);
  }).join('');
  const root=tag('w:document',{'xmlns:w':word,'xmlns:r':rel,
    'xmlns:wp':'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    'xmlns:a':'http://schemas.openxmlformats.org/drawingml/2006/main','xmlns:pic':'http://schemas.openxmlformats.org/drawingml/2006/picture'},
    tag('w:body',{},body));
  const assets=Array.from(media,([asset,id])=>({id,ext:asset.ext,target:'media/'+id+'.'+asset.ext,bytes:asset.bytes}));
  const ns='http://schemas.openxmlformats.org/package/2006/content-types';
  const types=tag('Types',{xmlns:ns},
    tag('Default',{Extension:'xml',ContentType:'application/xml'})+
    tag('Default',{Extension:'rels',ContentType:'application/vnd.openxmlformats-package.relationships+xml'})+
    tag('Override',{PartName:'/word/document.xml',ContentType:contentType})+
    Array.from(new Set(assets.map(a=>a.ext)),ext=>tag('Default',{Extension:ext,ContentType:imageTypes[ext]})).join(''));
  const relations=items=>declaration+tag('Relationships',{xmlns:pkgRel},items.map(attributes=>tag('Relationship',attributes)).join(''));
  return writeZipMembers([item('[Content_Types].xml',declaration+types),
    item('_rels/.rels',relations([{Id:'rId1',Type:rel+'/officeDocument',Target:'word/document.xml'}])),
    item('word/document.xml',declaration+root),
    item('word/_rels/document.xml.rels',relations(assets.map(a=>({Id:a.id,Type:rel+'/image',Target:a.target})))),
    ...assets.map(a=>item('word/'+a.target,a.bytes))]);
}

export function exportDocx(bytes) {
  const {sections,warnings}=hwpxModel(bytes);
  return {bytes:wordWriter(sections),warnings:Array.from(warnings)};
}
