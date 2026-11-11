import {zipEntries} from '../../scripts/setup.mjs';
import {textLinePictureCaretFixture} from '../engine-cursor/text-line-caret-fixture.mjs';
import {mapHwpxMember} from './hwpx-fixture-utils.mjs';

function paragraph(text, y, height = 1100, spacing = 500, control = '') {
  return '<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
    + '<hp:run charPrIDRef="0">' + control + '<hp:t>' + text + '</hp:t></hp:run>'
    + '<hp:linesegarray><hp:lineseg textpos="0" vertpos="' + y + '" vertsize="' + height
    + '" textheight="' + height + '" baseline="' + Math.min(900, height) + '" spacing="' + spacing
    + '" horzpos="0" horzsize="21800" flags="393216"/></hp:linesegarray></hp:p>';
}

function table(id, content, height, cellHeight, inline = false) {
  const width = inline ? 20000 : 22000;
  return '<hp:tbl id="' + id + '" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM"'
    + ' textFlow="BOTH_SIDES" pageBreak="CELL" repeatHeader="0" noAdjust="1" rowCnt="1" colCnt="1"'
    + ' cellSpacing="0" borderFillIDRef="1"><hp:sz width="' + width + '" height="' + height
    + '" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE"/><hp:pos treatAsChar="' + Number(inline)
    + '" affectLSpacing="0" flowWithText="1" allowOverlap="0" vertRelTo="PARA" horzRelTo="PARA"'
    + ' vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
    + '<hp:outMargin left="0" right="0" top="0" bottom="0"/>'
    + '<hp:inMargin left="100" right="100" top="100" bottom="100"/>'
    + '<hp:tr><hp:tc hasMargin="1" borderFillIDRef="1">'
    + '<hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP">' + content
    + '</hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/>'
    + '<hp:cellSz width="' + width + '" height="' + cellHeight
    + '"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/></hp:tc></hp:tr></hp:tbl>';
}


export function continuedFlowPictureFixture(core, {headings = 2, flow = true, relativeTo = 'PARA'} = {}) {
  const material = textLinePictureCaretFixture(core), member = 'Contents/section0.xml';
  const original = zipEntries(material).find(entry => entry.name === member).read().toString('utf8');
  const picture = original.match(/<hp:pic\b[\s\S]*?<\/hp:pic>/)[0]
    .replace(/treatAsChar="\d"/, 'treatAsChar="0"')
    .replace(/flowWithText="\d"/, 'flowWithText="' + Number(flow) + '"')
    .replace(/allowOverlap="\d"/, 'allowOverlap="0"')
    .replace(/textWrap="[^"]+"/, 'textWrap="TOP_AND_BOTTOM"')
    .replace(/vertRelTo="[^"]+"/, 'vertRelTo="' + relativeTo + '"')
    .replace(/horzRelTo="[^"]+"/, 'horzRelTo="COLUMN"');
  const lead = Array.from({length: 11}, (_, i) => paragraph('FIRST_' + i, i * 1600)).join('');
  const prefix = Array.from({length: headings}, (_, i) => paragraph('HEADING_' + i, 200 + i * 1600)).join('');
  const band = 200 + headings * 1600;
  const body = lead + prefix + paragraph('  ', band + 6000, 1100, 500, picture)
    + paragraph('AFTER_PICTURE', band + 7600);
  const paper = '<hp:secPr id="0"><hp:pagePr width="30000" height="23800" landscape="WIDELY">'
    + '<hp:margin left="0" right="0" top="0" bottom="0" header="0" footer="0" gutter="0"/>'
    + '</hp:pagePr></hp:secPr>';
  return mapHwpxMember(material, member, xml => xml
    .replace(/(<hs:sec\b[^>]*>)[\s\S]*<\/hs:sec>/, '$1'
      + paragraph('', 0, 800, 0, paper + table(10, body, 23800, 48000)) + '</hs:sec>')
    .replace(/<hs:sec\b[^>]*>/, tag => /\bxmlns:hc=/.test(tag) ? tag
      : tag.slice(0, -1) + ' xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">'));
}
