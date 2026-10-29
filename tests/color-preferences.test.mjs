import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';

test('recent colors persist, normalize, deduplicate and are limited to twelve',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-colors-'));process.env.PWH_COLOR_PREFERENCES_DIR=dir;
 const prefs=await import('../src/color-preferences.mjs');
 assert.deepEqual(await prefs.recentColors(),{colors:[]});
 await Promise.all(['#AABBCC','#102030','#aabbcc'].map(color=>prefs.recentColors({color})));
 assert.deepEqual((await prefs.recentColors()).colors,['#aabbcc','#102030']);
 for(let i=0;i<13;i++)await prefs.recentColors({color:'#'+i.toString(16).padStart(6,'0')});
 const reread=await import('../src/color-preferences.mjs?new-session');const stored=await reread.recentColors();assert.equal(stored.colors.length,12);assert.equal(stored.colors[0],'#00000c');
 await assert.rejects(prefs.recentColors({color:'../no'}));assert.equal((await reread.recentColors()).colors.length,12);
 await fs.rm(dir,{recursive:true,force:true});
});
