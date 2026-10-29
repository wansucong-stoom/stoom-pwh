import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {promises as fs} from 'node:fs';
import {desktopVersion,addDesktopVersion} from './version-info.mjs';

test('shows distinct Desktop and Pwh versions, using the actual package metadata',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-versions-'));
 try{
  await fs.writeFile(path.join(dir,'version.json'),JSON.stringify({version:'7.8.9'}));
  const version=await desktopVersion(dir),html=addDesktopVersion('<small id="pwh-version">pwh 0.6.27</small>',version);
  assert.equal(version,'7.8.9');assert.match(html,/Desktop 7\.8\.9/);assert.match(html,/pwh 0\.6\.27/);
  await fs.writeFile(path.join(dir,'version.json'),'{"version":"<script>"}');
  assert.equal(await desktopVersion(dir),null);assert.match(addDesktopVersion('<small id="pwh-version">pwh</small>',null),/Desktop 버전 확인 불가/);
  assert.throws(()=>addDesktopVersion('missing marker',version));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
