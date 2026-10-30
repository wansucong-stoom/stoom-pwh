#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';

const project=fileURLToPath(new URL('../',import.meta.url)),mode=process.argv[2];
const files=process.argv.slice(3);
if(files.some(name=>!/^tests\/[\w/.-]+\.test\.mjs$/.test(name)||name.includes('..')))throw Error('Focused tests must be repository test files');
if(!['core','browser'].includes(mode)||!process.env.PWH_RUNTIME_ROOT)throw Error('Use core|browser with an isolated PWH_RUNTIME_ROOT');
const work=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-ci-tests-'));
const env={...process.env,PWH_CORE_JS:path.join(process.env.PWH_RUNTIME_ROOT,'core/rhwp.js'),PWH_CORE_WASM:path.join(process.env.PWH_RUNTIME_ROOT,'core/rhwp_bg.wasm'),PWH_OUTPUT_ROOT:path.join(work,'outputs'),PWH_FONT_ROOT:path.join(process.env.PWH_RUNTIME_ROOT,'fonts')};
// Account-, clipboard- and native-window tests require separate authorization.
for(const key of ['PWH_CHATGPT_LIVE','PWH_CODEX_LIVE','PWH_HANCOM_CLIPBOARD','PWH_HANCOM_TARGET','PWH_TEST_CHATGPT_DATA','PWH_TEST_CODEX_RUNTIME','PWH_CODEX_TEST_EXE','PWH_NATIVE_TEST_LAUNCHER','PWH_ELECTRON_EXE','PWH_TEST_DESKTOP_PAYLOAD','PWH_ENGINE_TESTS','PWH_TEMPLATE_TEST_FILE'])delete env[key];
if(mode==='browser'){
  if(!env.PWH_PLAYWRIGHT_MODULE)throw Error('Set PWH_PLAYWRIGHT_MODULE to the pinned Playwright ESM entry');
  const desktop=path.join(work,'standalone-pwh');await fs.cp(path.join(project,'desktop/standalone-pwh'),desktop,{recursive:true});
  await fs.cp(path.join(project,'desktop/bridge'),path.join(work,'bridge'),{recursive:true});
  await fs.symlink(project,path.join(work,'release-source'),process.platform==='win32'?'junction':'dir');
  env.PWH_DESKTOP_SOURCE_ROOT=desktop;env.PWH_BROWSER_TESTS='1';
  env.PWH_STANDALONE_DATA=path.join(work,'profile');
  const core=await import(pathToFileURL(env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(env.PWH_CORE_WASM)});
  const doc=core.HwpDocument.createEmpty();
  try{doc.createBlankDocument();doc.insertText(0,0,0,'Synthetic CI document');env.PWH_TEST_HWP=path.join(work,'synthetic.hwp');await fs.writeFile(env.PWH_TEST_HWP,doc.exportHwp());}finally{doc.free();}
}else{
  for(const key of ['PWH_BROWSER_TESTS','PWH_PLAYWRIGHT_MODULE','PWH_DESKTOP_SOURCE_ROOT','PWH_TEST_HWP'])delete env[key];
}
const report=path.join(work,'tests.tap');const log=await fs.open(report,'wx');let output='';
const code=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--test','--test-concurrency=2','--test-reporter=tap',...files],{cwd:project,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{output+=bytes;process.stdout.write(bytes);});
  child.on('error',reject);child.on('exit',resolve);
});
try{await log.writeFile(output);}finally{await log.close();}
const skips=output.split(/\r?\n/).filter(line=>/ # SKIP\b/.test(line));
const missing=skips.filter(line=>/PWH_CORE_JS|PWH_CORE_WASM/.test(line)||(mode==='browser'&&/PWH_BROWSER_TESTS|PWH_DESKTOP_SOURCE_ROOT|Requires browser module/.test(line)));
console.log(JSON.stringify({mode,report,skipped:skips.length,missingConfiguredPrerequisites:missing}));
if(code!==0||missing.length)process.exitCode=code||1;
