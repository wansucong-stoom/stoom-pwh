import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import path from 'node:path';
import {findPython, testTempDirectory, exec, pythonOptions} from './helpers/hwpx-fixture.mjs';

const python = await findPython();
process.env.PWH_PYTHON_PATH = python;
const {replaceDocumentImage} = await import('../src/images.mjs');
const {callTool, TOOLS} = await import('../src/server.mjs');
const hash = async filename => createHash('sha256').update(await fs.readFile(filename)).digest('hex');

// Synthetic raster files and layout controls only; no institution assets.
const buildFixture = String.raw`
import sys,zipfile,struct,zlib
from pathlib import Path
out=Path(sys.argv[1])
def png(w,h,color):
 def chunk(kind,payload):return struct.pack('>I',len(payload))+kind+payload+struct.pack('>I',zlib.crc32(kind+payload)&0xffffffff)
 scan=b''.join(b'\0'+bytes(color)*w for _ in range(h))
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(scan))+chunk(b'IEND',b'')
def jpeg(quant):
 def marker(kind,payload):return b'\xff'+bytes([kind])+struct.pack('>H',len(payload)+2)+payload
 # One valid constant grayscale 8x8 baseline JPEG block (DC=0, AC=EOB).
 dht=bytes([0,2]+[0]*15+[0,1])+bytes([0x10,1]+[0]*15+[0])
 return b'\xff\xd8'+marker(0xdb,bytes([0])+bytes([quant])*64)+marker(0xc0,struct.pack('>BHHB',8,8,8,1)+bytes([1,0x11,0]))+marker(0xc4,dht)+marker(0xda,bytes([1,1,0,0,63,0]))+b'\x3f\xff\xd9'
def bmp(w,h,color):
 stride=((w*24+31)//32)*4
 pixels=(bytes(color)*w+b'\0'*(stride-w*3))*h
 return b'BM'+struct.pack('<IHHI',54+len(pixels),0,0,54)+struct.pack('<IiiHHIIiiII',40,w,h,1,24,0,len(pixels),0,0,0,0)+pixels
old={'png':png(2,2,[20,40,60]),'jpg':jpeg(1),'bmp':bmp(2,2,[20,40,60])}
new={'png':png(6,2,[60,80,100]),'jpg':jpeg(2),'bmp':bmp(4,2,[60,80,100])}
for ext,data in new.items():(out/('replacement.'+ext)).write_bytes(data)
corrupt=bytearray(new['png']);corrupt[-1]^=1
(out/'broken.png').write_bytes(corrupt)
package=b'''<?xml version="1.0"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf"><opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/><opf:item id="image1" href="BinData/image1.png" media-type="image/png" isEmbeded="1"/><opf:item id="image1alias" href="../BinData/image1.png" media-type="image/png" isEmbeded="1"/><opf:item id="image2" href="BinData/image2.jpg" media-type="image/jpeg" isEmbeded="1"/><opf:item id="image3" href="BinData/image3.bmp" media-type="image/bmp" isEmbeded="1"/></opf:manifest><opf:spine><opf:itemref idref="section0"/></opf:spine></opf:package>'''
pics=''
for n,item in enumerate(['image1','image1alias','image2','image3']):
 pics+=f'<hp:p id="{n}" paraPrIDRef="0" pageBreak="0"><hp:run charPrIDRef="5"><hp:pic id="{n+100}" textWrap="SQUARE"><hp:offset x="10" y="20"/><hp:sz width="9000" height="4500"/><hp:pos treatAsChar="1" vertRelTo="PARA" horzRelTo="PARA" vertOffset="50" horzOffset="70"/><hp:rotationInfo angle="7" centerX="4500" centerY="2250"/><hp:imgClip left="100" right="8900" top="80" bottom="4420"/><hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt2 x="9000" y="4500"/></hp:imgRect><hc:img binaryItemIDRef="{item}" bright="0" contrast="0" effect="REAL_PIC" alpha="255"/></hp:pic></hp:run></hp:p>'
section=('<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">'+pics+'</hs:sec>').encode()
with zipfile.ZipFile(out/'images.hwpx','x',compression=zipfile.ZIP_DEFLATED) as z:
 z.comment=b'Preserve archive comment'
 z.writestr('mimetype','application/hwp+zip',compress_type=zipfile.ZIP_STORED)
 z.writestr('Contents/content.hpf',package)
 z.writestr('Contents/header.xml',b'<head><charPr id="5"/><paraPr id="0"/></head>')
 z.writestr('Contents/section0.xml',section)
 z.writestr('Preview/PrvImage.png',old['png'])
 for n,ext in enumerate(['png','jpg','bmp'],1):z.writestr(f'BinData/image{n}.{ext}',old[ext])
`;

const verifyPayloads = String.raw`
import sys,zipfile,json
from pathlib import Path
with zipfile.ZipFile(sys.argv[1]) as a,zipfile.ZipFile(sys.argv[2]) as b:
 assert a.namelist()==b.namelist()
 assert a.comment==b.comment
 changes=[]
 for name in a.namelist():
  if a.read(name)!=b.read(name):changes.append(name)
  for field in ['date_time','compress_type','comment','extra','external_attr']:
   assert getattr(a.getinfo(name),field)==getattr(b.getinfo(name),field),(name,field)
 assert changes==[sys.argv[3]],changes
 assert b.read(sys.argv[3])==Path(sys.argv[4]).read_bytes()
 assert a.read('Contents/section0.xml')==b.read('Contents/section0.xml')
 assert a.read('Contents/header.xml')==b.read('Contents/header.xml')
 assert a.read('Contents/content.hpf')==b.read('Contents/content.hpf')
 assert a.read('Preview/PrvImage.png')==b.read('Preview/PrvImage.png')
 print(json.dumps(changes))
`;

async function fixture(t) {
  const directory = await testTempDirectory('pwh-images-test-');
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  await exec(python, ['-B', '-c', buildFixture, directory], pythonOptions);
  const input = path.join(directory, 'images.hwpx');
  return {directory, input, sourceHash: await hash(input),
    request(extra = {}) {return {input, output: path.join(directory, `${randomUUID()}.hwpx`),
      expectedSourceSha256: this.sourceHash, image: path.join(directory, 'replacement.png'), binaryItemId: 'image1', ...extra};}};
}

async function verify(f, result, entry, image) {
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse((await exec(python, ['-B', '-c', verifyPayloads, f.input, result.output, entry, image], pythonOptions)).stdout), [entry]);
  assert.equal(await hash(f.input), f.sourceHash, 'source must remain byte-identical');
  assert.deepEqual(result.changedEntries, [entry]);
  assert.equal(result.verification.picturePropertiesUnchanged, true);
  assert.equal(result.verification.allXmlPayloadsByteIdentical, true);
  assert.equal(result.outputSha256, await hash(result.output));
}

test('MCP image replacement preserves anchors/crop/XML and reports shared references and changed aspect ratio', {timeout: 120000}, async t => {
  const f = await fixture(t);
  assert.ok(TOOLS.some(tool => tool.name === 'pwh_replace_image'));
  const request = f.request();
  const response = await callTool('pwh_replace_image', request);
  const result = response.structuredContent;
  await verify(f, result, 'BinData/image1.png', request.image);
  assert.deepEqual(result.target.binaryItemIds, ['image1', 'image1alias']);
  assert.equal(result.referenceCount, 2);
  assert.equal(result.sharedImage, true);
  assert.equal(result.aspectRatioChanged, true);
  assert.equal(result.requiresVisualReview, true);
  assert.deepEqual([result.replacementImage.width, result.replacementImage.height], [6, 2]);
});

test('exact manifest href and binary ID support same-format JPEG and BMP replacements', {timeout: 120000}, async t => {
  const f = await fixture(t);
  for (const [ext, id, format] of [['jpg', 'image2', 'JPEG'], ['bmp', 'image3', 'BMP']]) {
    const request = f.request({image: path.join(f.directory, `replacement.${ext}`)});
    delete request.binaryItemId;
    request.manifestHref = `BinData/${id}.${ext}`;
    const result = await replaceDocumentImage(request);
    await verify(f, result, `BinData/${id}.${ext}`, request.image);
    assert.equal(result.replacementImage.format, format);
    assert.equal(result.sharedImage, false);
    assert.equal(result.aspectRatioChanged, ext === 'bmp');
  }
});

test('stale source, output collisions, bad image data, conversion and ambiguous requests publish nothing', {timeout: 120000}, async t => {
  const f = await fixture(t);
  const cases = [
    [{expectedSourceSha256: '0'.repeat(64)}, /SHA256/i],
    [{binaryItemId: 'missing'}, /does not exist/i],
    [{manifestHref: 'BinData/image1.png'}, /exactly|하나/i],
    [{image: path.join(f.directory, 'broken.png')}, /CRC/i],
    [{image: path.join(f.directory, 'replacement.jpg')}, /format|media type|conversion/i],
  ];
  for (const [extra, message] of cases) {
    const request = f.request(extra);
    await assert.rejects(replaceDocumentImage(request), message);
    await assert.rejects(fs.access(request.output), {code: 'ENOENT'});
  }
  const request = f.request();
  await fs.writeFile(request.output, 'existing file must remain');
  const before = await hash(request.output);
  await assert.rejects(replaceDocumentImage(request), /already exists/i);
  assert.equal(await hash(request.output), before);
  await assert.rejects(replaceDocumentImage({...request, output: f.input}), /already exists/i);
  assert.equal(await hash(f.input), f.sourceHash);
});
