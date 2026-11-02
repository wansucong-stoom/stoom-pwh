#!/usr/bin/env node
// Consume complete physical-page reports and separately verified audits.
// A high raster score is never evidence of complete text or geometry by itself.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';

export const LAYOUT_GATE_POLICY=Object.freeze({
 id:'pwh-physical-page-quality-v1',normalMinF1:0.95,darkMinF1:0.90,
 dpi:150,tolerancePixels:2,normalThreshold:245,darkThreshold:180,
 alignment:'Same page origin and physical scale; no fitting, translation or page remapping.',
});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const shaPattern=/^[a-f0-9]{64}$/;
function invalid(message){throw new Error(message);}
function object(value,label){if(!isObject(value))invalid(label+' must be an object');return value;}
function integer(value,label,min=0){if(!Number.isSafeInteger(value)||value<min)invalid(label+' must be a finite integer');return value;}
function score(value,label){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)invalid(label+' must be finite and between zero and one');return value;}
function sha(value,label){if(typeof value!=='string'||!shaPattern.test(value))invalid(label+' must be a SHA256');return value;}
function parse(bytes,label){
 if(typeof bytes!=='string'&&!Buffer.isBuffer(bytes)&&!(bytes instanceof Uint8Array))invalid(label+' bytes are required');
 let value;try{value=JSON.parse(Buffer.from(bytes).toString('utf8'));}catch{invalid(label+' is not valid JSON');}
 return object(value,label);
}
function ratioPrecision(ref,actual,hits){return actual?hits/actual:Number(ref===0);}
function ratioRecall(ref,actual,hits){return ref?hits/ref:Number(actual===0);}
function f1(precision,recall){return precision+recall?2*precision*recall/(precision+recall):0;}
function near(actual,expected,label){if(Math.abs(actual-expected)>0.000002)invalid(label+' disagrees with ink counts');}
function validateComparedPage(page,label){
 integer(page.width,label+' width',1);integer(page.height,label+' height',1);
 const ref=integer(page.referenceInkPixels,label+' reference ink');
 const actual=integer(page.pwhInkPixels,label+' Pwh ink');
 const refHits=integer(page.referenceInkWithinTolerance,label+' reference hits');
 const actualHits=integer(page.pwhInkWithinTolerance,label+' Pwh hits');
 if(refHits>ref||actualHits>actual||Math.max(ref,actual)>page.width*page.height)invalid(label+' has impossible ink counts');
 const precision=score(page.tolerantInkPrecision,label+' precision'),recall=score(page.tolerantInkRecall,label+' recall');
 score(page.tolerantInkF1,label+' F1');
 near(precision,ratioPrecision(ref,actual,actualHits),label+' precision');
 near(recall,ratioRecall(ref,actual,refHits),label+' recall');
 near(page.tolerantInkF1,f1(precision,recall),label+' F1');
 if(page.paperRoundingPoints!==undefined&&(typeof page.paperRoundingPoints!=='number'||!Number.isFinite(page.paperRoundingPoints)||page.paperRoundingPoints<0||page.paperRoundingPoints>1))invalid(label+' changes the physical paper size');
}
function validateReport(report,label,threshold){
 const policy=LAYOUT_GATE_POLICY,hashes=object(report.sha256,label+' hashes');
 for(const key of ['source','hancom','pwh'])sha(hashes[key],label+' '+key+' hash');
 if(report.threshold!==threshold||report.dpi!==policy.dpi||report.tolerancePixels!==policy.tolerancePixels||report.alignment!==policy.alignment)invalid(label+' comparison policy does not match the fixed physical-page policy');
 const counts=object(report.pageCounts,label+' page counts');
 integer(counts.hancom,label+' Hancom page count',1);integer(counts.pwh,label+' Pwh page count',1);
 const count=Math.max(counts.hancom,counts.pwh);
 if(!Array.isArray(report.pages)||report.pages.length!==count)invalid(label+' must cover every physical page, including missing or extra pages');
 const aggregate=object(report.aggregate,label+' aggregate');
 if(aggregate.complete!==true)invalid(label+' comparison is incomplete');
 score(aggregate.tolerantInkF1,label+' aggregate F1');
 let refs=0,actuals=0,refHits=0,actualHits=0;
 for(let i=0;i<count;i++){
  const page=object(report.pages[i],label+' page');
  if(page.page!==i+1)invalid(label+' pages must be consecutive physical pages from one');
  const expected=i>=counts.hancom?'extra-pwh-page':i>=counts.pwh?'missing-pwh-page':'compared';
  if(page.status!==expected)invalid(label+' physical page status disagrees with page counts');
  if(page.status==='compared')validateComparedPage(page,label+' page '+page.page);
  else{
   integer(page.referenceInkPixels,label+' missing/extra reference ink');
   integer(page.pwhInkPixels,label+' missing/extra Pwh ink');
   if(page.status==='extra-pwh-page'&&page.referenceInkPixels!==0)invalid(label+' extra page has reference ink');
   if(page.status==='missing-pwh-page'&&page.pwhInkPixels!==0)invalid(label+' missing page has Pwh ink');
   if(page.tolerantInkF1!==undefined)invalid(label+' missing/extra page cannot have a compared F1');
  }
  refs+=page.referenceInkPixels;actuals+=page.pwhInkPixels;
  refHits+=page.referenceInkWithinTolerance||0;actualHits+=page.pwhInkWithinTolerance||0;
 }
 near(aggregate.tolerantInkF1,f1(ratioPrecision(refs,actuals,actualHits),ratioRecall(refs,actuals,refHits)),label+' aggregate F1');
 return count;
}
function validateAudit(audit,binding,count){
 if(audit.schemaVersion!==1)invalid('Unsupported audit schema');
 const reports=object(audit.reportSha256,'audit report hashes'),source=object(audit.sha256,'audit source hashes');
 for(const key of ['normal','dark'])if(sha(reports[key],'audit '+key+' report hash')!==binding[key])invalid('Audit is bound to different report bytes');
 for(const key of ['source','hancom','pwh'])if(sha(source[key],'audit '+key+' hash')!==binding[key])invalid('Audit is bound to different source or output bytes');
 if(!Array.isArray(audit.pages))invalid('Audit pages must be an explicit array');
 const records=new Map();
 for(const record of audit.pages){
  object(record,'audit page');integer(record.page,'audit page number',1);
  if(record.page>count||records.has(record.page))invalid('Audit page is out of range or duplicated');
  for(const [name,fields]of [['content',['missing','duplicated']],['geometry',['overflow']]]){
   const group=object(record[name],'audit '+name);
   if(typeof group.verified!=='boolean')invalid('Audit verification must be an explicit boolean');
   for(const field of fields)if(group.verified||group[field]!==undefined)integer(group[field],'audit '+name+' '+field);
  }
  records.set(record.page,record);
 }
 return records;
}
function validatePrevious(previous,normal){
 if(!previous)return 0;
 if(previous.schemaVersion!==1)invalid('Unsupported previous gate schema');
 const policy=object(previous.policy,'previous gate policy');
 for(const [key,value]of Object.entries(LAYOUT_GATE_POLICY))if(policy[key]!==value)invalid('Previous gate used a different or weaker policy');
 const hashes=object(previous.sha256,'previous gate hashes');
 for(const key of ['source','hancom'])if(hashes[key]!==normal.sha256[key])invalid('Previous gate uses a different source or reference');
 const counts=object(previous.pageCounts,'previous gate page counts');
 if(counts.hancom!==normal.pageCounts.hancom)invalid('Previous reference page count changed');
 const through=integer(previous.acceptedThrough,'previous accepted prefix');
 if(through>counts.hancom||!Array.isArray(previous.pages)||previous.pages.length<through)invalid('Previous accepted prefix is incomplete');
 for(let i=0;i<previous.pages.length;i++){
  const page=object(previous.pages[i],'previous gate page');
  if(page.page!==i+1||(i<through?page.status!=='accepted':page.status==='accepted'))invalid('Previous gate has a nonsequential accepted prefix');
  if(i<through){
   if(score(page.normalF1,'previous normal F1')<policy.normalMinF1||score(page.darkF1,'previous dark F1')<policy.darkMinF1||page.contentVerified!==true||page.geometryVerified!==true||page.missingText!==0||page.duplicatedText!==0||page.overflow!==0)invalid('Previous accepted page did not meet the fixed requirements');
  }
 }
 return through;
}

/** Inputs are raw UTF-8 report/audit bytes so the audit binding cannot drift. */
export function evaluateLayoutGates({normalBytes,darkBytes,auditBytes,previousBytes}={}){
 const normal=parse(normalBytes,'normal report'),dark=parse(darkBytes,'dark report');
 const count=validateReport(normal,'normal',LAYOUT_GATE_POLICY.normalThreshold);
 validateReport(dark,'dark',LAYOUT_GATE_POLICY.darkThreshold);
 for(const key of ['source','hancom','pwh'])if(normal.sha256[key]!==dark.sha256[key])invalid('Normal/dark source or output hashes differ');
 if(normal.pageCounts.hancom!==dark.pageCounts.hancom||normal.pageCounts.pwh!==dark.pageCounts.pwh)invalid('Normal/dark page counts differ');
 const binding={normal:digest(normalBytes),dark:digest(darkBytes),...normal.sha256};
 const audits=validateAudit(parse(auditBytes,'audit'),binding,count);
 const previous=previousBytes===undefined?null:parse(previousBytes,'previous gate');
 const previousThrough=validatePrevious(previous,normal),regressions=[];
 let acceptedThrough=0,blocked=false;
 const pages=normal.pages.map((page,i)=>{
  const other=dark.pages[i],audit=audits.get(page.page),reasons=[];
  if(page.status!=='compared')reasons.push(page.status);
  if(page.status==='compared'&&page.tolerantInkF1<LAYOUT_GATE_POLICY.normalMinF1)reasons.push('normal-f1-below-0.95');
  if(other.status==='compared'&&other.tolerantInkF1<LAYOUT_GATE_POLICY.darkMinF1)reasons.push('dark-f1-below-0.90');
  const contentVerified=audit?.content.verified===true,geometryVerified=audit?.geometry.verified===true;
  if(!contentVerified)reasons.push('content-not-audited');
  else if(audit.content.missing||audit.content.duplicated)reasons.push('text-omission-or-duplication');
  if(!geometryVerified)reasons.push('geometry-not-audited');
  else if(audit.geometry.overflow)reasons.push('geometry-overflow');
  const meetsRequirements=reasons.length===0;
  if(page.page<=previousThrough&&!meetsRequirements){regressions.push(page.page);reasons.unshift('previous-prefix-regression');}
  const status=blocked?'not-reached':meetsRequirements?'accepted':'blocked';
  if(!blocked&&meetsRequirements)acceptedThrough=page.page;else if(!meetsRequirements)blocked=true;
  return {page:page.page,status,meetsRequirements,normalF1:page.status==='compared'?page.tolerantInkF1:null,darkF1:other.status==='compared'?other.tolerantInkF1:null,contentVerified,geometryVerified,missingText:contentVerified?audit.content.missing:null,duplicatedText:contentVerified?audit.content.duplicated:null,overflow:geometryVerified?audit.geometry.overflow:null,reasons};
 });
 const currentPage=blocked?acceptedThrough+1:null;
 return {schemaVersion:1,status:blocked?'blocked':'complete',policy:{...LAYOUT_GATE_POLICY},sha256:{...normal.sha256,normalReport:binding.normal,darkReport:binding.dark,auditReport:digest(auditBytes),...(previousBytes===undefined?{}:{previousGate:digest(previousBytes)})},pageCounts:{...normal.pageCounts},acceptedThrough,currentPage,frontier:{acceptedThrough,currentPage,status:blocked?'blocked':'complete'},previousPrefix:{requiredThrough:previousThrough,preserved:regressions.length===0,regressions},pages};
}

const usage=`Usage: node scripts/check-layout-gates.mjs --normal REPORT.json --dark REPORT.json --audit AUDIT.json [--previous GATE.json] [--output NEW.json]
Fixed gates: physical pages from 1, 150 dpi, 2 px, thresholds 245/180,
normal F1 >= 0.95, dark F1 >= 0.90, explicit content and geometry audits.
Audit schema: {schemaVersion:1,reportSha256:{normal,dark},sha256:{source,hancom,pwh},
 pages:[{page:1,content:{verified:true,missing:0,duplicated:0},geometry:{verified:true,overflow:0}}]}
Report hashes identify exact file bytes. Missing audit pages block advancement.
The previous accepted prefix must pass again for the new output and audit.
Exit: 0 complete, 1 blocked, 2 invalid input. Output files are never overwritten.
`;
async function main(args){
 if(args.length===1&&['--help','-h'].includes(args[0])){process.stdout.write(usage);return 0;}
 const options={};
 for(let i=0;i<args.length;i+=2){
  const key=args[i];if(!['--normal','--dark','--audit','--previous','--output'].includes(key)||options[key]||!args[i+1]||args[i+1].startsWith('--'))invalid('Invalid arguments; use --help');
  options[key]=path.resolve(args[i+1]);
 }
 for(const key of ['--normal','--dark','--audit'])if(!options[key])invalid('Normal, dark and audit files are required');
 if(options['--output']&&Object.entries(options).some(([key,value])=>key!=='--output'&&value===options['--output']))invalid('Output cannot replace an input');
 const read=async key=>{try{return await fs.readFile(options[key]);}catch(error){invalid('Cannot read '+key.slice(2)+' input ('+String(error.code||'READ_ERROR')+')');}};
 const input={normalBytes:await read('--normal'),darkBytes:await read('--dark'),auditBytes:await read('--audit'),...(options['--previous']?{previousBytes:await read('--previous')}:{})};
 const result=evaluateLayoutGates(input),json=JSON.stringify(result,null,2)+'\n';
 if(options['--output']){
  try{await fs.writeFile(options['--output'],json,{flag:'wx'});}catch(error){invalid('Cannot create fresh output ('+String(error.code||'WRITE_ERROR')+')');}
 }
 process.stdout.write(json);return result.status==='complete'?0:1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.exitCode=await main(process.argv.slice(2));}
 catch(error){process.stderr.write(JSON.stringify({ok:false,error:'INVALID_LAYOUT_GATE_INPUT',reason:error.message})+'\n');process.exitCode=2;}
}
