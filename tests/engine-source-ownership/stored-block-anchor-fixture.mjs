import {mixedBlockFixture} from './mixed-block-fixture.mjs';
import {mapHwpxMember} from './hwpx-fixture-utils.mjs';

// The XML anchor can precede the host text while the original paragraph-relative
// vertical offset places this floating block below that text line. Its declared
// opening frame closes after the first 1600-HU row; all three rows occupy 4800 HU.
// This differs from a complete single-frame float. No private
// document, identifiers or measured coordinates are used.
export function storedBlockAnchorFixture({pageHeight=9300,controlBefore=true,offset=1100,openingHeight=1600}={}) {
 return mapHwpxMember(mixedBlockFixture({tableFirst:false,pageHeight}),'Contents/section0.xml',xml=>{
  const child=xml.match(/<hp:tbl id="20"[\s\S]*?<\/hp:tbl>/)?.[0];
  if(!child)throw Error('Synthetic child table is missing');
  const block=child.replace('vertOffset="0"',`vertOffset="${offset}"`).replace('height="4800"',`height="${openingHeight}"`);
  const original='<hp:t>HOST_TEXT</hp:t>'+child;
  if(!xml.includes(original))throw Error('Synthetic host boundary changed');
  return xml.replace(original,controlBefore?block+'<hp:t>HOST_TEXT</hp:t>':'<hp:t>HOST_TEXT</hp:t>'+block);
 });
}
