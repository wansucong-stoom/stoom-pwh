import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {convertHwp} from './convert-hwp.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
test('verified HWP conversion preserves source and reports changed stored layout', {skip:!process.env.PWH_TEST_RHWP||!process.env.PWH_TEST_HWP},async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-hwp-convert-'));
 try{const source=process.env.PWH_TEST_HWP,before=digest(await fs.readFile(source));const result=await convertHwp({executable:process.env.PWH_TEST_RHWP,source,output:path.join(directory,'out.hwpx')});assert.equal(result.layoutWarning,true);assert.equal(digest(await fs.readFile(source)),before);}finally{await fs.rm(directory,{recursive:true,force:true});}
});
test('conversion rejects a reported content difference even if output exists',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-hwp-reject-'));
 try{const output=path.join(directory,'out.hwpx');await fs.writeFile(output,'PKfixture');const exec=async()=>{const e=Error('bad');e.code=3;e.stdout=JSON.stringify({format:'hwpx',verify:{diffCount:1}});e.stderr='[차이] paragraph[0] text: mismatch';throw e;};await assert.rejects(convertHwp({executable:'mock',source:'input',output,exec}),/구조 차이/);}finally{await fs.rm(directory,{recursive:true,force:true});}
});
