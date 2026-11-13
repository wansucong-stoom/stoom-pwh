import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {packagePlugin} from '../scripts/package.mjs';

test('public plugin archive includes every recorded editor source input for rebuilding',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-package-inputs-'));
 t.after(async()=>{assert.equal(path.dirname(dir),os.tmpdir());await fs.rm(dir,{recursive:true,force:true});});
 const result=await packagePlugin({output:path.join(dir,'plugin.zip')});
 const marker=JSON.parse(await fs.readFile(new URL('../client/.pwh-install.json',import.meta.url),'utf8'));
 const packaged=new Set(result.files);
 for(const file of marker.buildInputs.files)assert.ok(packaged.has(file.path),'Missing rebuild input: '+file.path);
});
