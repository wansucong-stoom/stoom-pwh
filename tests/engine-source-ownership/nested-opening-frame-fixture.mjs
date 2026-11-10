import {zipEntries} from '../../scripts/setup.mjs';
import fs from 'node:fs/promises';
import {mapHwpxMember} from './hwpx-fixture-utils.mjs';

const seed = await fs.readFile(new URL('../fixtures/rowbreak-table/synthetic-rowbreak-single-line-control.hwpx', import.meta.url));
const text = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
function paragraph(value, {vpos=0, height=1000, spacing=600, width=18000, control='', stored=true}={}) {
  return `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${control}<hp:t>${text(value)}</hp:t></hp:run>${stored ? `<hp:linesegarray><hp:lineseg textpos="0" vertpos="${vpos}" vertsize="${height}" textheight="${height}" baseline="${Math.round(height*.85)}" spacing="${spacing}" horzpos="0" horzsize="${width}" flags="393216"/></hp:linesegarray>` : ''}</hp:p>`;
}
function cell(row, col, content, height, {width=10000, align='CENTER'}={}) {
  return `<hp:tc hasMargin="1" borderFillIDRef="1"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${align}">${content}</hp:subList><hp:cellAddr colAddr="${col}" rowAddr="${row}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${width}" height="${height}"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/></hp:tc>`;
}
function table(id, rows, columns, content, height, {inline=false, width=20000, margin=100, outerTop=margin, outerBottom=margin, verticalOffset=0}={}) {
  return `<hp:tbl id="${id}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" pageBreak="CELL" repeatHeader="0" noAdjust="1" rowCnt="${rows}" colCnt="${columns}" cellSpacing="0" borderFillIDRef="1"><hp:sz width="${width}" height="${height}" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE"/><hp:pos treatAsChar="${inline?1:0}" affectLSpacing="0" flowWithText="1" allowOverlap="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="${verticalOffset >>> 0}" horzOffset="0"/><hp:outMargin left="${margin}" right="${margin}" top="${outerTop}" bottom="${outerBottom}"/><hp:inMargin left="100" right="100" top="100" bottom="100"/>${content}</hp:tbl>`;
}

// Geometry and ASCII markers are wholly synthetic. The source-owned opening
// frame ends before an exact inline-table placeholder reset. That later table
// stays a distinct content owner; its height is not a remaining-row ledger.
export function nestedOpeningFrameFixture({frameHeight=10200, stored=true, placeholderDelta=0, inlineHeight=6000, outerTop=100, outerBottom=100, hostStored=stored, projectedInline=false}={}) {
  const deepRows = [0, 1, 2].map(row =>
    `<hp:tr>${cell(row, 0, paragraph('DEEP_' + row, {stored}), 1400, {width:16000})}</hp:tr>`).join('');
  const deep = table(400, 3, 1, deepRows, 4200, {width:16000});
  const nextTable = table(300, 2, 1, [0,1].map(row => {
    const label = paragraph('NEXT_' + row, {stored});
    const contents = projectedInline && row === 1
      ? label + paragraph('', {vpos:1600, width:0, control:deep, stored})
      : label;
    return `<hp:tr>${cell(row, 0, contents, inlineHeight/2, {width:18000})}</hp:tr>`;
  }).join(''), inlineHeight, {inline:true,width:18000});
  const mainRows = [
    `<hp:tr>${cell(0,0,paragraph('HEAD_LABEL',{stored}),1200)}${cell(0,1,paragraph('HEAD_BODY',{stored}),1200)}</hp:tr>`,
    `<hp:tr>${cell(1,0,paragraph('FULL_LABEL',{stored}),4000)}${cell(1,1,paragraph('FULL_BODY',{stored}),4000)}</hp:tr>`,
    `<hp:tr>${cell(2,0,paragraph('OPEN_LABEL',{stored}),10000)}${cell(2,1,paragraph('OPEN_LINE_A',{stored})+paragraph('OPEN_LINE_B',{vpos:1600,stored})+paragraph('',{height:inlineHeight+200+placeholderDelta,control:nextTable,stored})+paragraph('NEXT_TAIL',{vpos:inlineHeight+800,stored}),10000)}</hp:tr>`,
  ].join('');
  const grid = table(200,3,2,mainRows,frameHeight,{outerTop,outerBottom});
  const body = paragraph('WRAPPER_LEAD',{stored})+paragraph('',{vpos:1600,width:0,control:grid,stored:hostStored});
  const wrapper = table(100,2,1,`<hp:tr>${cell(0,0,paragraph('WRAPPER_TITLE',{stored}),1200,{width:22000,align:'TOP'})}</hp:tr><hp:tr>${cell(1,0,body,23000,{width:22000,align:'TOP'})}</hp:tr>`,13400,{width:22000,margin:0});
  const section = '<hp:secPr id="0"><hp:pagePr width="26000" height="15000" landscape="WIDELY"><hp:margin left="0" right="0" top="0" bottom="0" header="0" footer="0" gutter="0"/></hp:pagePr></hp:secPr>';
  return mapHwpxMember(seed,'Contents/section0.xml',xml => xml.replace(/(<hs:sec\b[^>]*>)[\s\S]*<\/hs:sec>/,'$1'+paragraph('',{height:600,control:section+wrapper,stored})+'</hs:sec>'));
}


// The column definition configures the host paragraph but owns no height.
export function displacedNestedTableLineFixture({savedStartDelta=0}={}) {
  const row = (index, width, height, content, align) =>
    `<hp:tr>${cell(index,0,content,height,{width,align})}</hp:tr>`;
  const detailRows = [0,1,2,3].map(index =>
    row(index,16000,1400,paragraph('DETAIL_'+index))).join('');
  const detail = table(300,4,1,detailRows,5600,{width:16000,verticalOffset:-600});
  const column = '<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>';
  const note = paragraph('DISPLACED_NOTE',{vpos:5800+savedStartDelta,control:column+detail});
  const inlineRows = row(0,18500,1200,paragraph('INLINE_HEAD'))
    + row(1,18500,7200,note) + row(2,18500,2600,paragraph('INLINE_TAIL'));
  const inline = table(200,3,1,inlineRows,11000,{inline:true,width:18500});
  const outerRows = row(0,22000,3000,paragraph('FIRST_BODY'),'TOP')
    + row(1,22000,12200,paragraph('',{height:11200,control:inline}),'TOP');
  const outer = table(100,2,1,outerRows,15200,{width:22000,margin:0});
  const section = '<hp:secPr id="0"><hp:pagePr width="26000" height="20000" landscape="WIDELY"><hp:margin left="0" right="0" top="0" bottom="0" header="0" footer="0" gutter="0"/></hp:pagePr></hp:secPr>';
  return mapHwpxMember(seed,'Contents/section0.xml',xml =>
    xml.replace(/(<hs:sec\b[^>]*>)[\s\S]*<\/hs:sec>/,'$1'+paragraph('',{height:700,control:section+outer})+'</hs:sec>'));
}

export function parallelPictureBandFixture(core, {overlapping=false, savedOpening=false, peerHeightDelta=0}={}) {
  const seedDoc = new core.HwpDocument(seed);
  let material;
  try {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=', 'base64');
    const added = JSON.parse(seedDoc.insertPicture(0,0,0,'[]',png,6000,9000,1,1,'png','Synthetic picture'));
    if (!added.ok) throw Error('Synthetic image insertion failed');
    material = seedDoc.exportHwpx();
  } finally { seedDoc.free(); }
  const sectionName = 'Contents/section0.xml';
  const sectionEntry = zipEntries(Buffer.from(material)).find(entry => entry.name === sectionName);
  const picture = sectionEntry.read().toString('utf8').match(/<hp:pic\b[\s\S]*?<\/hp:pic>/)?.[0];
  if (!picture) throw Error('Synthetic picture control missing');
  const float = (id, x, y) => picture.replace(/(<hp:pic id=")[^"]+/, '$1'+id)
    .replace('flowWithText="0"', 'flowWithText="1"')
    .replaceAll('RelTo="PAPER"', 'RelTo="PARA"')
    .replace('vertOffset="0" horzOffset="0"', `vertOffset="${y}" horzOffset="${x}"`);
  const column = '<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>';
  const photoCell = paragraph('PICTURE_LEAD',{control:column+float('501',8000,1600)})
    + paragraph('',{vpos:1600,control:float('502',overlapping?7900:1000,0)});
  const row = (index, width, height, content) =>
    `<hp:tr>${cell(index,0,content,height,{width,align:'TOP'})}</hp:tr>`;

  if (savedOpening) {
    const photoRows = row(0,18000,1200,paragraph('PHOTO_GRID_HEADER'))
      + row(1,18000,2800,photoCell) + row(2,18000,1400,paragraph('PHOTO_GRID_TAIL'));
    const photoGrid = table(200,3,1,photoRows,4000,{width:18000});
    const gridRow = (index, entries) => `<hp:tr>${entries.map(
      ([width,height,content], col) => cell(index,col,content,height,{width})).join('')}</hp:tr>`;
    const lead = paragraph('FRAME_LEAD') + paragraph('',{vpos:1600,width:0,control:photoGrid})
      + paragraph('FRAME_TAIL',{vpos:8900});
    const rows = gridRow(0,[[4000,2400,paragraph('HDR_A')],
      [20000,2400,paragraph('GRID_HEAD_B')],[4000,2400,paragraph('HDR_C')]])
      + gridRow(1,[[4000,9100,paragraph('LEFT')],
        [20000,6200,lead],[4000,9100+peerHeightDelta,paragraph('RIGHT')]]);
    const grid = table(100,2,3,rows,11500,{width:28000});
    const wrapperRows = row(0,30000,4000,paragraph('WRAPPER_HEADER'))
      + row(1,30000,14200,paragraph('',{control:grid,width:0}));
    const wrapper = table(50,2,1,wrapperRows,18200,{width:30000,margin:0});
    const section = '<hp:secPr id="0"><hp:pagePr width="33000" height="19000" landscape="WIDELY"><hp:margin left="0" right="0" top="0" bottom="0" header="0" footer="0" gutter="0"/></hp:pagePr></hp:secPr>';
    return mapHwpxMember(material,sectionName,xml =>
      xml.replace(/(<hs:sec\b[^>]*>)[\s\S]*<\/hs:sec>/,'$1'+paragraph('',{height:700,control:section+wrapper})+'</hs:sec>'));
  }
  const innerRows = row(0,18000,2600,paragraph('PICTURE_HEAD'))
    + row(1,18000,10500,photoCell) + row(2,18000,2000,paragraph('PICTURE_TAIL'));
  const inner = table(200,3,1,innerRows,15100,{width:18000});
  const outerRows = row(0,22000,5600,paragraph('FIRST_PAGE'))
    + row(1,22000,15700,paragraph('',{control:inner,width:0}));
  const outer = table(100,2,1,outerRows,21300,{width:22000,margin:0});
  const section = '<hp:secPr id="0"><hp:pagePr width="26000" height="15000" landscape="WIDELY"><hp:margin left="0" right="0" top="0" bottom="0" header="0" footer="0" gutter="0"/></hp:pagePr></hp:secPr>';
  return mapHwpxMember(material,sectionName,xml =>
    xml.replace(/(<hs:sec\b[^>]*>)[\s\S]*<\/hs:sec>/,'$1'+paragraph('',{height:700,control:section+outer})+'</hs:sec>'));
}
