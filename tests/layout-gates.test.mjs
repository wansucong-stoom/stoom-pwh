import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {evaluateLayoutGates,LAYOUT_GATE_POLICY} from '../scripts/check-layout-gates.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value);
const hashes={source:'a'.repeat(64),hancom:'b'.repeat(64),pwh:'c'.repeat(64)};
function report(scores,threshold){
 const pages=scores.map((value,i)=>({page:i+1,status:'compared',width:1000,height:1000,paperRoundingPoints:0,
  referenceInkPixels:100000,pwhInkPixels:100000,referenceInkWithinTolerance:Math.round(value*100000),pwhInkWithinTolerance:Math.round(value*100000),
  tolerantInkPrecision:value,tolerantInkRecall:value,tolerantInkF1:value}));
 return {sha256:{...hashes},pageCounts:{hancom:scores.length,pwh:scores.length},threshold,dpi:150,tolerancePixels:2,alignment:LAYOUT_GATE_POLICY.alignment,
  aggregate:{complete:true,tolerantInkF1:scores.reduce((sum,value)=>sum+value,0)/scores.length},pages};
}
function inputs({normal=[0.99,0.99,0.99],dark=[0.96,0.96,0.96],auditPages,normalReport,darkReport}={}){
 const a=normalReport||report(normal,245),b=darkReport||report(dark,180),normalBytes=json(a),darkBytes=json(b);
 const audit={schemaVersion:1,reportSha256:{normal:hash(normalBytes),dark:hash(darkBytes)},sha256:{...a.sha256},
  pages:auditPages||a.pages.map(({page})=>({page,content:{verified:true,missing:0,duplicated:0},geometry:{verified:true,overflow:0}}))};
 return {normalBytes,darkBytes,auditBytes:json(audit)};
}
const replaceAudit=(input,change)=>{const audit=JSON.parse(input.auditBytes);change(audit);return {...input,auditBytes:json(audit)};};
const wasm=Buffer.from([0,97,115,109,1,0,0,0]);
function withEngine(input,engineWasmBytes=wasm){
 const sha256=hash(engineWasmBytes),report=JSON.parse(input.normalBytes);
 const receipt={sourceHash:report.sha256.source,sha256:report.sha256.pwh,sourceUnchanged:true,dirty:false,
  codeBinding:{expected:{'rhwp_bg.wasm':sha256},wasmVerified:true,observedWasm:[{sha256,bytes:engineWasmBytes.length,error:null}]}};
 return {...input,engineWasmBytes,exportBytes:json(receipt)};
}

test('a complete audited physical prefix passes inclusive fixed thresholds',()=>{
 const result=evaluateLayoutGates(inputs({normal:[.95,.99],dark:[.90,.95]}));
 assert.equal(result.status,'complete');assert.equal(result.acceptedThrough,2);assert.equal(result.currentPage,null);
 assert.deepEqual(result.pages.map(page=>page.status),['accepted','accepted']);
 assert.equal(result.policy.normalMinF1,.95);assert.equal(result.policy.darkMinF1,.90);
});

test('later high scores cannot advance past the first lower-quality page',()=>{
 const result=evaluateLayoutGates(inputs({normal:[.99,.94,1],dark:[.96,.96,1]}));
 assert.equal(result.status,'blocked');assert.equal(result.acceptedThrough,1);assert.equal(result.currentPage,2);
 assert.equal(result.frontier.currentPage,2);assert.deepEqual(result.pages.map(page=>page.status),['accepted','blocked','not-reached']);
 assert.equal(result.pages[2].meetsRequirements,true);
 assert.deepEqual(result.pages[1].reasons,['normal-f1-below-0.95']);
});

test('a dark-score failure independently blocks a high normal score',()=>{
 const result=evaluateLayoutGates(inputs({normal:[1,1],dark:[.90,.89999]}));
 assert.equal(result.currentPage,2);assert.deepEqual(result.pages[1].reasons,['dark-f1-below-0.90']);
});

test('perfect raster overlap cannot substitute for omitted content or missing geometry audits',()=>{
 const input=inputs({normal:[1,1,1],dark:[1,1,1]});
 for(const change of [
  audit=>{audit.pages[0].content.missing=1;},
  audit=>{audit.pages[0].content.duplicated=1;},
  audit=>{audit.pages[0].content.misplaced=1;},
  audit=>{audit.pages[0].geometry.overflow=1;},
  audit=>{audit.pages[0].geometry.verified=false;},
  audit=>{audit.pages.splice(0,1);},
 ]){
  const result=evaluateLayoutGates(replaceAudit(input,change));assert.equal(result.currentPage,1);assert.equal(result.acceptedThrough,0);
  assert.equal(result.pages[1].status,'not-reached');
 }
});

test('unaudited placeholders remain blocked instead of implying zero missing text',()=>{
 const result=evaluateLayoutGates(inputs({auditPages:[{page:1,content:{verified:false},geometry:{verified:false}}]}));
 assert.equal(result.currentPage,1);assert.equal(result.pages[0].missingText,null);assert.equal(result.pages[0].overflow,null);
 assert.deepEqual(result.pages[0].reasons,['content-not-audited','geometry-not-audited']);
});

test('normal/dark hash differences and stale audit report bytes are rejected',()=>{
 for(const key of ['source','hancom','pwh']){
  const a=report([.99],245),b=report([.96],180);b.sha256[key]='d'.repeat(64);
  assert.throws(()=>evaluateLayoutGates(inputs({normalReport:a,darkReport:b})),/hashes differ/);
 }
 const input=inputs();
 assert.throws(()=>evaluateLayoutGates(replaceAudit(input,audit=>{audit.reportSha256.normal='e'.repeat(64);})),/different report bytes/);
 assert.throws(()=>evaluateLayoutGates(replaceAudit(input,audit=>{audit.sha256.pwh='d'.repeat(64);})),/different source or output bytes/);
 const normal=JSON.parse(input.normalBytes);normal.provenance='same metrics, changed report bytes';
 assert.throws(()=>evaluateLayoutGates({...input,normalBytes:json(normal)}),/different report bytes/);
});

test('mismatched DPI, tolerance, thresholds and physical alignment cannot weaken the comparison',()=>{
 for(const [key,value]of [['dpi',72],['tolerancePixels',10],['threshold',240],['alignment','fit to reference']]){
  const a=report([.99],245),b=report([.96],180);a[key]=value;
  assert.throws(()=>evaluateLayoutGates(inputs({normalReport:a,darkReport:b})),/fixed physical-page policy/);
 }
});

test('NaN, non-finite, absent metrics, impossible counts and partial reports are rejected',()=>{
 for(const change of [
  a=>{a.pages[0].tolerantInkF1=null;},
  a=>{a.pages[0].tolerantInkF1=1.1;},
  a=>{delete a.pages[0].tolerantInkF1;},
  a=>{a.pages[0].referenceInkWithinTolerance=100001;},
  a=>{a.pages[0].tolerantInkF1=.96;},
  a=>{a.pages.pop();},
  a=>{a.pages[0].page=2;},
  a=>{a.aggregate.complete=false;},
  a=>{delete a.aggregate;},
 ]){
  const a=report([.99,.99],245);change(a);
  assert.throws(()=>evaluateLayoutGates(inputs({normalReport:a,darkReport:report([.96,.96],180)})));
 }
 const input=inputs();
 assert.throws(()=>evaluateLayoutGates({...input,normalBytes:input.normalBytes.replace('0.99','NaN')}),/valid JSON/);
});

test('missing or extra output pages remain physical failures instead of being remapped',()=>{
 const a=report([.99,.99],245),b=report([.96,.96],180);
 for(const r of [a,b]){
  r.pageCounts.pwh=1;r.pages[1]={page:2,status:'missing-pwh-page',referenceInkPixels:100000,pwhInkPixels:0,referenceInkWithinTolerance:0,pwhInkWithinTolerance:0};
  const precision=r.pages[0].tolerantInkPrecision,recall=precision/2;r.aggregate.tolerantInkF1=2*precision*recall/(precision+recall);
 }
 const result=evaluateLayoutGates(inputs({normalReport:a,darkReport:b}));
 assert.equal(result.currentPage,2);assert.ok(result.pages[1].reasons.includes('missing-pwh-page'));
});

test('previously accepted pages must remain passing and be audited for the new output',()=>{
 const previous=evaluateLayoutGates(inputs());
 const normal=report([.99,.94,.99],245),dark=report([.96,.96,.96],180);
 normal.sha256.pwh='d'.repeat(64);dark.sha256.pwh='d'.repeat(64);
 const next=inputs({normalReport:normal,darkReport:dark});
 const result=evaluateLayoutGates({...next,previousBytes:json(previous)});
 assert.equal(result.currentPage,2);assert.equal(result.previousPrefix.requiredThrough,3);assert.equal(result.previousPrefix.preserved,false);
 assert.deepEqual(result.previousPrefix.regressions,[2]);assert.equal(result.pages[1].reasons[0],'previous-prefix-regression');
 assert.throws(()=>evaluateLayoutGates({...next,auditBytes:inputs().auditBytes,previousBytes:json(previous)}),/different report bytes/);
 const reaudited=evaluateLayoutGates({...replaceAudit(inputs(),audit=>{audit.pages.splice(1,1);}),previousBytes:json(previous)});
 assert.equal(reaudited.currentPage,2);assert.equal(reaudited.pages[1].contentVerified,false);
});

test('a previous weaker policy, different reference or nonsequential acceptance cannot authorize progress',()=>{
 for(const change of [
  previous=>{previous.policy.normalMinF1=.5;},
  previous=>{previous.policy.darkMinF1=.5;},
  previous=>{previous.sha256.hancom='d'.repeat(64);},
  previous=>{previous.pages[0].status='not-reached';},
  previous=>{previous.acceptedThrough=1;},
  previous=>{previous.pages[0].misplacedText=1;},
 ]){
  const previous=evaluateLayoutGates(inputs());change(previous);
  assert.throws(()=>evaluateLayoutGates({...inputs(),previousBytes:json(previous)}));
 }
});

test('engine-bound gates identify actual renderer input and the exact export receipt',()=>{
 const input=withEngine(inputs()),result=evaluateLayoutGates(input);
 assert.deepEqual(result.engineBinding,{wasmSha256:hash(wasm),wasmBytes:wasm.length,exportReceiptSha256:hash(input.exportBytes),observed:true});
 for(const change of [
  receipt=>{receipt.sourceHash='d'.repeat(64);},
  receipt=>{receipt.sha256='d'.repeat(64);},
  receipt=>{receipt.sourceUnchanged=false;},
  receipt=>{receipt.dirty=true;},
  receipt=>{receipt.codeBinding.expected['rhwp_bg.wasm']='d'.repeat(64);},
  receipt=>{receipt.codeBinding.wasmVerified=false;},
  receipt=>{receipt.codeBinding.observedWasm=[];},
  receipt=>{receipt.codeBinding.observedWasm[0].sha256='d'.repeat(64);},
  receipt=>{receipt.codeBinding.observedWasm[0].bytes+=1;},
  receipt=>{receipt.codeBinding.observedWasm[0].error='compile failed';},
  receipt=>{receipt.codeBinding.observedWasm.push({sha256:'d'.repeat(64),bytes:wasm.length,error:null});},
 ]){
  const receipt=JSON.parse(input.exportBytes);change(receipt);
  assert.throws(()=>evaluateLayoutGates({...input,exportBytes:json(receipt)}));
 }
 assert.throws(()=>evaluateLayoutGates({...input,engineWasmBytes:Buffer.from('not a wasm')}),/not a WASM/);
 assert.throws(()=>evaluateLayoutGates({...input,engineWasmBytes:undefined}),/supplied together/);
 assert.throws(()=>evaluateLayoutGates({...input,exportBytes:undefined}),/supplied together/);
});

test('a cumulative new engine needs a fresh export and reaudits every previously accepted page',()=>{
 const old=withEngine(inputs()),previous=evaluateLayoutGates(old),previousBytes=json(previous);
 assert.throws(()=>evaluateLayoutGates({...inputs(),previousBytes}),/requires current engine/);
 const nextWasm=Buffer.concat([wasm,Buffer.from([0,1,0])]);
 const a=report([.99,.99,.99],245),b=report([.96,.96,.96],180);
 a.sha256.pwh='e'.repeat(64);b.sha256.pwh='e'.repeat(64);
 const fresh=withEngine(inputs({normalReport:a,darkReport:b}),nextWasm);
 assert.throws(()=>evaluateLayoutGates({...fresh,exportBytes:old.exportBytes,previousBytes}),/different source or output/);
 const result=evaluateLayoutGates({...fresh,previousBytes});
 assert.equal(result.status,'complete');assert.equal(result.engineBinding.wasmSha256,hash(nextWasm));
 assert.equal(result.previousPrefix.requiredThrough,3);assert.equal(result.previousPrefix.preserved,true);
 const regressed=replaceAudit(fresh,audit=>{audit.pages[1].content.missing=1;});
 const blocked=evaluateLayoutGates({...regressed,previousBytes});
 assert.equal(blocked.currentPage,2);assert.equal(blocked.previousPrefix.preserved,false);
 assert.equal(blocked.pages[2].status,'not-reached');
});

test('malformed or duplicated audit records cannot silently become approvals',()=>{
 for(const change of [
  audit=>{audit.pages[0].content.verified='true';},
  audit=>{delete audit.pages[0].content.missing;},
  audit=>{audit.pages[0].content.missing=-1;},
  audit=>{audit.pages[0].content.misplaced=-1;},
  audit=>{audit.pages.push({...audit.pages[0]});},
  audit=>{audit.pages[0].page=99;},
 ])assert.throws(()=>evaluateLayoutGates(replaceAudit(inputs(),change)));
});

test('unique text emitted on the wrong physical page fails even with perfect scores',()=>{
 const input=replaceAudit(inputs({normal:[1,1,1],dark:[1,1,1]}),audit=>{audit.pages[1].content.misplaced=21;});
 const result=evaluateLayoutGates(input);
 assert.equal(result.acceptedThrough,1);assert.equal(result.currentPage,2);
 assert.equal(result.pages[1].misplacedText,21);assert.equal(result.pages[1].missingText,0);
 assert.equal(result.pages[1].duplicatedText,0);assert.equal(result.pages[1].contentVerified,true);
 assert.deepEqual(result.pages[1].reasons,['text-on-wrong-physical-page']);
 assert.equal(result.pages[2].status,'not-reached');
});

test('CLI separates blocked, invalid and complete status and never overwrites inputs or outputs',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-layout-gates-'));
 const script=fileURLToPath(new URL('../scripts/check-layout-gates.mjs',import.meta.url));
 const run=args=>spawnSync(process.execPath,[script,...args],{encoding:'utf8',windowsHide:true});
 try{
  const input=inputs({normal:[.94,.99] ,dark:[.96,.96]}),files={};
  for(const [key,value]of Object.entries(input)){const file=path.join(root,key+'.json');await fs.writeFile(file,value);files[key]=file;}
  const args=['--normal',files.normalBytes,'--dark',files.darkBytes,'--audit',files.auditBytes];
  const blocked=run(args);assert.equal(blocked.status,1,blocked.stderr);assert.equal(JSON.parse(blocked.stdout).currentPage,1);
  assert.equal(run([...args,'--normal-min','0.5']).status,2);
  const original=await fs.readFile(files.normalBytes);assert.equal(run([...args,'--output',files.normalBytes]).status,2);assert.deepEqual(await fs.readFile(files.normalBytes),original);
  const out=path.join(root,'gate.json');assert.equal(run([...args,'--output',out]).status,1);const before=await fs.readFile(out);
  assert.equal(run([...args,'--output',out]).status,2);assert.deepEqual(await fs.readFile(out),before);
  const complete=inputs({normal:[.99],dark:[.96]});for(const [key,value]of Object.entries(complete))await fs.writeFile(files[key],value);
  const good=run(args);assert.equal(good.status,0,good.stderr);assert.equal(JSON.parse(good.stdout).status,'complete');
  const bound=withEngine(complete),engineFile=path.join(root,'core.wasm'),exportFile=path.join(root,'export.json');
  await fs.writeFile(engineFile,bound.engineWasmBytes);await fs.writeFile(exportFile,bound.exportBytes);
  assert.equal(run([...args,'--engine-wasm',engineFile]).status,2);
  const actual=run([...args,'--engine-wasm',engineFile,'--export',exportFile]);
  assert.equal(actual.status,0,actual.stderr);assert.equal(JSON.parse(actual.stdout).engineBinding.wasmSha256,hash(wasm));
  const help=run(['--help']);assert.equal(help.status,0);assert.match(help.stdout,/normal F1 >= 0.95/);
 }finally{
  assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('pwh-layout-gates-'));
  await fs.rm(root,{recursive:true,force:true});
 }
});
