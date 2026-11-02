import assert from 'node:assert/strict';
import {mixedBlockFixture} from './mixed-block-fixture.mjs';
import {mapHwpxMember} from './hwpx-fixture-utils.mjs';

export function floatingHostLineFixture({offset=1200, hostBefore=true}={}) {
  const bytes = mixedBlockFixture({tableFirst:true, hostText:'ANCHOR_HOST'});
  return mapHwpxMember(bytes,'Contents/section0.xml',xml=>{
    const start=xml.indexOf('<hp:tbl id="20"'); assert.ok(start>=0);
    const end=xml.indexOf('</hp:tbl>',start)+9;
    const table=xml.slice(start,end), changed=table.replace('vertOffset="0"',`vertOffset="${offset}"`);
    assert.ok(changed.includes(`vertOffset="${offset}"`)); xml=xml.slice(0,start)+changed+xml.slice(end);
    const saved='vertpos="5900"'; assert.equal(xml.split(saved).length,2);
    const hostOrigin=hostBefore?1100:1100+offset+4800;
    xml=xml.replace(saved,`vertpos="${hostOrigin}"`);
    const tail=hostBefore?1100+offset+4800:hostOrigin+1100;
    assert.equal(xml.split('vertpos="7000"').length,2);
    xml=xml.replace('vertpos="7000"',`vertpos="${tail}"`);
    return xml;
  });
}
