import {zipEntries} from '../../scripts/setup.mjs';
import {mapHwpxMember} from '../engine-source-ownership/hwpx-fixture-utils.mjs';

export function groupedTextboxFixture(core,{multiple=false,nested=false}={}){
  const doc=core.HwpDocument.createEmpty();doc.createBlankDocument();
  const ok=result=>{const value=JSON.parse(result);if(value.ok!==true)throw Error(result);return value;};
  try{
    const group=ok(doc.createShapeControl(JSON.stringify({shapeType:'textbox',width:24000,height:3400,horzOffset:7200,vertOffset:7200,treatAsChar:false,textWrap:'InFrontOfText'})));
    ok(doc.insertTextInCell(0,group.paraIdx,group.controlIdx,0,0,0,'Grouped heading'));
    const bytes=mapHwpxMember(doc.exportHwpx(),'Contents/section0.xml',xml=>{
      const match=/<hp:rect\b[\s\S]*?<\/hp:rect>/.exec(xml);if(!match)throw Error('Synthetic textbox missing');
      const rect=match[0].replace('groupLevel="0"','groupLevel="1"').replace(/<hp:sz\b[^>]*\/>|<hp:pos\b[^>]*\/>|<hp:outMargin\b[^>]*\/>/g,'');
      const wrap=(children,level)=>`<hp:container id="12345" zOrder="1" numberingType="PICTURE" textWrap="IN_FRONT_OF_TEXT" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="${level}" instid="12345"><hp:offset x="0" y="0"/><hp:orgSz width="24000" height="${multiple?6800:3400}"/><hp:curSz width="24000" height="${multiple?6800:3400}"/><hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0" centerX="12000" centerY="1700" rotateimage="1"/><hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>${children}<hp:sz width="24000" widthRelTo="ABSOLUTE" height="${multiple?6800:3400}" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="0" allowOverlap="1" holdAnchorAndSO="0" vertRelTo="PAPER" horzRelTo="PAPER" vertAlign="TOP" horzAlign="LEFT" vertOffset="7200" horzOffset="7200"/><hp:outMargin left="0" right="0" top="0" bottom="0"/></hp:container>`;
      let content=wrap(rect+(multiple?rect.replace('Grouped heading','Second heading'):''),nested?1:0);
      if(nested)content=wrap(content,0);
      return xml.slice(0,match.index)+content+xml.slice(match.index+match[0].length);
    });return {bytes,group};
  }finally{doc.free();}
}
export function groupMember(bytes){return zipEntries(Buffer.from(bytes)).find(e=>e.name==='Contents/section0.xml').read().toString('utf8');}
