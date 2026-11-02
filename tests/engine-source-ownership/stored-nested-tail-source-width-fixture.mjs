import { terminalRowContentHeightFixture } from './stored-nested-tail-content-height-fixture.mjs';
import { mapHwpxMember } from './hwpx-fixture-utils.mjs';
import {zipEntries} from '../../scripts/setup.mjs';

// The source line widths fit the owning cells. Preserve earlier fixtures so a
// mismatched source-width negative remains distinguishable from this positive.
export function terminalRowSourceWidthFixture(options = {}) {
  return mapHwpxMember(terminalRowContentHeightFixture(options), 'Contents/section0.xml', xml => {
    for (const marker of ['WRAPPER', 'LEAD_0', 'LEAD_1', 'LEAD_2', 'AFTER_TABLE', ...Array.from({ length: 6 }, (_, row) => [0, 1].map(col => `ROW_${row}_${col}`)).flat()]) {
      const position = xml.indexOf(`<hp:t>${marker}</hp:t>`);
      if (position < 0) continue;
      const start = xml.lastIndexOf('<hp:p ', position), end = xml.indexOf('</hp:p>', position) + 7;
      const width = marker.startsWith('ROW_') ? 9800 : 21800;
      const paragraph = xml.slice(start, end).replace(/horzsize="\d+"/g, `horzsize="${width}"`);
      xml = xml.slice(0, start) + paragraph + xml.slice(end);
    }
    // The root paragraph is object-only; its final linesegarray is the root's.
    const closing = xml.lastIndexOf('</hs:sec>');
    const start = xml.lastIndexOf('<hp:linesegarray>', closing);
    xml = xml.slice(0, start) + xml.slice(start).replace(/horzsize="\d+"/, 'horzsize="0"');
    return xml;
  });
}

// Build through the public insertion API, then place its synthetic 1x1 PNG in
// an original cell. The fixture contains anonymous markers and no user assets.
export function terminalRowSourceWidthPictureFixture(core, marker = 'ROW_4_1') {
  const original = terminalRowSourceWidthFixture(), doc = new core.HwpDocument(original);
  let material;
  try {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=', 'base64');
    const result = JSON.parse(doc.insertPicture(0, 0, 0, '[]', png, 800, 800, 1, 1, 'png', 'Synthetic prefix picture'));
    if (!result.ok) throw Error('Synthetic image insertion failed');
    material = doc.exportHwpx();
  } finally { doc.free(); }
  const member = (bytes, name) => zipEntries(Buffer.from(bytes)).find(entry => entry.name === name).read().toString('utf8');
  const picture = member(material, 'Contents/section0.xml').match(/<hp:pic\b[\s\S]*?<\/hp:pic>/)?.[0];
  if (!picture) throw Error('Synthetic picture control missing');
  const section = member(original, 'Contents/section0.xml').replace(`<hp:t>${marker}</hp:t>`, picture + `<hp:t>${marker}</hp:t>`);
  return mapHwpxMember(material, 'Contents/section0.xml', () => section);
}
