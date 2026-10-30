import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setupCodexPlugin} from '../desktop/standalone-pwh/codex-plugin-setup.mjs';

async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-codex-setup-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const installRoot=path.join(dir,'installed app'),dataRoot=path.join(dir,'user data');
 for(const relative of ['release-source/.codex-plugin','release-source/skills/pwh','release-source/scripts','node','engine/core','engine/rhwp'])await fs.mkdir(path.join(installRoot,relative),{recursive:true});
 await fs.writeFile(path.join(installRoot,'release-source/package.json'),JSON.stringify({name:'pwh',version:'0.6.30'}));
 await fs.writeFile(path.join(installRoot,'release-source/.codex-plugin/plugin.json'),JSON.stringify({name:'pwh',version:'0.6.30',skills:'./skills',mcpServers:'./.mcp.json'}));
 await fs.writeFile(path.join(installRoot,'release-source/skills/pwh/SKILL.md'),'---\nname: pwh\ndescription: test fixture\n---\n');
 await fs.writeFile(path.join(installRoot,'release-source/scripts/launch.mjs'),'// Fixture server entry point.\n');
 const mcp={mcpServers:{pwh:{type:'stdio',command:'node',args:['${PLUGIN_ROOT}/scripts/launch.mjs','pwh'],cwd:'${PLUGIN_ROOT}'},'rhwp-core':{type:'stdio',command:'node',args:['${PLUGIN_ROOT}/scripts/launch.mjs','rhwp-core'],cwd:'${PLUGIN_ROOT}'}}};
 await fs.writeFile(path.join(installRoot,'release-source/.mcp.json'),JSON.stringify(mcp));
 await fs.writeFile(path.join(installRoot,'release-source/mcp.json'),JSON.stringify(mcp));
 await fs.writeFile(path.join(installRoot,'node/node.exe'),'node fixture');
 await fs.writeFile(path.join(installRoot,'engine/.preserved-runtime.json'),JSON.stringify({id:'test',archiveSha256:'a'.repeat(64)}));
 await fs.writeFile(path.join(installRoot,'engine/core/rhwp_bg.wasm'),'wasm fixture');
 await fs.writeFile(path.join(installRoot,'engine/rhwp/rhwp.exe'),'engine fixture');
 // Never inherit a developer's PWH_RUNTIME_ROOT or PWH_CONFIG into an
 // isolated install fixture. Explicit-override behavior is tested below.
 return {dir,installRoot,dataRoot,home:path.join(dir,'user-home'),env:{}};
}
const gitPlugin=version=>({pluginId:'pwh@pwh',version,marketplaceSource:{sourceType:'git',source:'https://github.com/wansucong-stoom/stoom-pwh.git'}});

test('updates the existing official Git plugin in place and verifies the version',async t=>{
 const f=await fixture(t),calls=[];let updated=false;
 const base=path.join(f.home,'.stoom-pwh'),old=path.join(base,'runtimes','old');await fs.mkdir(path.join(old,'core'),{recursive:true});
 await fs.writeFile(path.join(old,'core','.pwh-install.json'),JSON.stringify({kind:'core'}));
 await fs.writeFile(path.join(base,'config.json'),JSON.stringify({schemaVersion:1,runtimeRoot:old,outputRoot:path.join(base,'documents'),fontRoot:path.join(base,'fonts'),custom:'preserved'}));
 const run=async(_exe,args)=>{calls.push(args.join(' '));if(args[1]==='list')return {installed:[gitPlugin(updated?'0.6.30':'0.6.29')]};if(args[1]==='add')updated=true;return {};};
 const result=await setupCodexPlugin({...f,executable:'codex',run});
 assert.equal(result.version,'0.6.30');assert.deepEqual(calls,['plugin list --json','plugin marketplace upgrade pwh --json','plugin add pwh@pwh --json','plugin list --json']);
 const config=JSON.parse(await fs.readFile(path.join(base,'config.json'),'utf8'));assert.ok(config.runtimeRoot.startsWith(path.join(f.dataRoot,'codex-runtimes')));assert.equal(config.outputRoot,path.join(base,'documents'));assert.equal(config.fontRoot,path.join(base,'fonts'));assert.equal(config.custom,'preserved');
 assert.equal(await fs.readFile(path.join(config.runtimeRoot,'core/rhwp_bg.wasm'),'utf8'),'wasm fixture');assert.equal(JSON.parse(await fs.readFile(path.join(old,'core/.pwh-install.json'),'utf8')).kind,'core');assert.ok((await fs.readdir(base)).some(name=>name.startsWith('.pwh-config-backup-')));
});

test('an already updated Git plugin also receives the bundled engine without changing custom paths',async t=>{
 const f=await fixture(t),base=path.join(f.home,'.stoom-pwh'),old=path.join(base,'runtimes','old');await fs.mkdir(path.join(old,'core'),{recursive:true});
 await fs.writeFile(path.join(old,'core','.pwh-install.json'),JSON.stringify({kind:'core'}));await fs.writeFile(path.join(base,'config.json'),JSON.stringify({schemaVersion:1,runtimeRoot:old}));
 const result=await setupCodexPlugin({...f,executable:'codex',run:async()=>({installed:[gitPlugin('0.6.30')]})});assert.equal(result.status,'ready');
 const config=JSON.parse(await fs.readFile(path.join(base,'config.json'),'utf8'));assert.ok(config.runtimeRoot.startsWith(path.join(f.dataRoot,'codex-runtimes')));assert.equal(config.outputRoot,path.join(old,'documents'));assert.equal(config.fontRoot,path.join(old,'fonts'));
});

test('a custom Git plugin engine or explicit override is preserved',async t=>{
 const f=await fixture(t),base=path.join(f.home,'.stoom-pwh');await fs.mkdir(base,{recursive:true});const config=JSON.stringify({schemaVersion:1,runtimeRoot:path.join(f.dir,'custom-engine')});await fs.writeFile(path.join(base,'config.json'),config);
 const run=async()=>({installed:[gitPlugin('0.6.30')]});
 await assert.rejects(setupCodexPlugin({...f,executable:'codex',run,env:{}}),/사용자 지정 엔진/);assert.equal(await fs.readFile(path.join(base,'config.json'),'utf8'),config);
 await assert.rejects(setupCodexPlugin({...f,executable:'codex',run,env:{PWH_RUNTIME_ROOT:'custom'}}),/별도 엔진 설정/);assert.equal(await fs.readFile(path.join(base,'config.json'),'utf8'),config);
});
test('preserves newer and unrelated installations, and does not claim a failed Git refresh',async t=>{
 const f=await fixture(t);let calls=0;
 const newer=await setupCodexPlugin({...f,executable:'codex',run:async()=>{calls++;return {installed:[gitPlugin('0.6.31')]};}});assert.equal(newer.version,'0.6.31');assert.equal(calls,1);
 await assert.rejects(setupCodexPlugin({...f,executable:'codex',run:async()=>({installed:[{...gitPlugin('0.6.29'),marketplaceSource:{sourceType:'git',source:'https://example.com/unrelated.git'}}]})}),/출처/);
 await assert.rejects(setupCodexPlugin({...f,executable:'codex',run:async(_exe,args)=>{if(args[1]==='list')return {installed:[gitPlugin('0.6.29')]};throw Error('offline');}}),/offline/);
});
test('registers an offline local plugin with a persistent runtime and skill',async t=>{
 const f=await fixture(t);let registered=false;const calls=[];
 const run=async(_exe,args)=>{calls.push(args);if(args[1]==='list')return {installed:registered?[{pluginId:'pwh@pwh',version:'0.6.30'}]:[]};if(args[1]==='add')registered=true;return {};};
 const result=await setupCodexPlugin({...f,executable:'codex',run});assert.equal(result.status,'ready');
 const market=path.join(f.dataRoot,'codex-marketplace'),config=JSON.parse(await fs.readFile(path.join(market,'.mcp.json'),'utf8'));
 assert.equal(JSON.parse(await fs.readFile(path.join(market,'.agents/plugins/marketplace.json'),'utf8')).name,'pwh');
 assert.match(await fs.readFile(path.join(market,'skills/pwh/SKILL.md'),'utf8'),/name: pwh/);
 const server=config.mcpServers.pwh;assert.ok(server.command.startsWith(f.dataRoot));assert.ok(server.env.PWH_RUNTIME_ROOT.startsWith(f.dataRoot));
 assert.equal(server.env.PWH_OUTPUT_ROOT,path.join(f.dataRoot,'codex-documents'));
 await fs.rm(f.installRoot,{recursive:true});assert.equal(await fs.readFile(server.command,'utf8'),'node fixture');assert.equal(await fs.readFile(path.join(server.env.PWH_RUNTIME_ROOT,'core/rhwp_bg.wasm'),'utf8'),'wasm fixture');
 assert.ok(calls.some(x=>x[1]==='marketplace'&&x[2]==='add'));assert.ok(!calls.some(x=>x.includes('remove')));
});
test('leaves Desktop available when Codex is absent',async t=>{const f=await fixture(t);const result=await setupCodexPlugin({...f,env:{PATH:'',LOCALAPPDATA:f.home}});assert.equal(result.status,'not-installed');assert.match(result.message,/설치되면/);});

test('the actual Codex CLI installs and upgrades the bundled local marketplace in an isolated home',{skip:!process.env.PWH_CODEX_TEST_EXE,timeout:120000},async t=>{
 const f=await fixture(t),home=path.join(f.dir,'isolated-codex-home');await fs.mkdir(home);const env={...process.env,CODEX_HOME:home};
 const packageFile=path.join(f.installRoot,'release-source/package.json'),pluginFile=path.join(f.installRoot,'release-source/.codex-plugin/plugin.json');
 for(const file of [packageFile,pluginFile]){const item=JSON.parse(await fs.readFile(file,'utf8'));item.version='0.6.29';await fs.writeFile(file,JSON.stringify(item));}
 const first=await setupCodexPlugin({...f,executable:process.env.PWH_CODEX_TEST_EXE,env});assert.equal(first.version,'0.6.29');
 for(const file of [packageFile,pluginFile]){const item=JSON.parse(await fs.readFile(file,'utf8'));item.version='0.6.30';await fs.writeFile(file,JSON.stringify(item));}
 const next=await setupCodexPlugin({...f,executable:process.env.PWH_CODEX_TEST_EXE,env});assert.equal(next.version,'0.6.30');
 const local=JSON.parse(await fs.readFile(path.join(f.dataRoot,'codex-marketplace/.mcp.json'),'utf8'));assert.ok(local.mcpServers.pwh.command.startsWith(f.dataRoot));
});
