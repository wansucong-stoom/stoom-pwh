import test from 'node:test';import assert from 'node:assert/strict';import {promises as fs} from 'node:fs';import path from 'node:path';import os from 'node:os';import {findPython,exec,pythonOptions} from './helpers/hwpx-fixture.mjs';
const python=await findPython();process.env.PWH_PYTHON_PATH=python;
const {registerReplacementImage,replacementImageChunk}=await import('../src/replacement-image.mjs');
test('replacement payload is inspected frozen and restricted to the owning editor session',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-replacement-'));try{
  const image=path.join(dir,'new.png');await exec(python,['-c',`import sys,struct,zlib\ndef c(k,p):return struct.pack('>I',len(p))+k+p+struct.pack('>I',zlib.crc32(k+p)&0xffffffff)\nopen(sys.argv[1],'wb').write(b'\\x89PNG\\r\\n\\x1a\\n'+c(b'IHDR',struct.pack('>IIBBBBB',2,2,8,2,0,0,0))+c(b'IDAT',zlib.compress((b'\\0'+bytes([10,20,30])*2)*2))+c(b'IEND',b''))`,image],pythonOptions);
  const original=await fs.readFile(image),asset=await registerReplacementImage(image,'owner');assert.equal(asset.width,2);assert.equal(asset.extension,'png');await fs.writeFile(image,'changed');
  const chunk=replacementImageChunk({assetId:asset.assetId,sessionId:'owner',offset:0});assert.deepEqual(Buffer.from(chunk._meta['pwh/image-bytes'],'base64'),original);
  assert.throws(()=>replacementImageChunk({assetId:asset.assetId,sessionId:'other',offset:0}),/만료/);await assert.rejects(registerReplacementImage(image,'owner'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
