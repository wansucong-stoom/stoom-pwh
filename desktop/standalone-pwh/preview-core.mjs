import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const coreFiles=['rhwp.js','rhwp.d.ts','rhwp_bg.wasm','rhwp_bg.wasm.d.ts'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
async function plainFile(file){const info=await fs.lstat(file);if(!info.isFile()||info.isSymbolicLink())throw Error('시험 코어 입력은 일반 파일이어야 합니다.');return fs.readFile(file);}

export async function verifyPreviewCore({candidateDir,pluginRoot,lock}){
 const recordBytes=await plainFile(path.join(candidateDir,'BUILD-RECORD.json'));
 if(recordBytes.length>1024*1024)throw Error('시험 코어 빌드 기록이 너무 큽니다.');
 const record=JSON.parse(recordBytes.toString('utf8'));
 const source=lock.preservationAssets?.find(asset=>/^pwh-upstream-rhwp-[\w.-]+\.zip$/.test(asset.file));
 if(record.schemaVersion!==1||record.upstreamCommit!==lock.upstreamCommit||!source||record.sourceArchiveSha256!==source.sha256||record.target!=='wasm32-unknown-unknown'||record.features!=='upstream defaults'||!Array.isArray(record.buildArgs)||!record.buildArgs.includes('--release')||record.lockAudit?.addedPackages!==0||record.lockAudit?.changedRetainedPackages!==0)throw Error('시험 코어의 원본·빌드 기록을 확인하지 못했습니다.');
 const patchRoot=path.join(pluginRoot,'docs','engine-patches'),expectedPatches=(await fs.readdir(patchRoot)).filter(name=>name.endsWith('.patch')).sort();
 if(!Array.isArray(record.patches)||record.patches.length!==expectedPatches.length||new Set(record.patches.map(p=>p.file)).size!==expectedPatches.length)throw Error('시험 코어 패치 목록이 현재 소스와 다릅니다.');
 for(const patch of record.patches){
  if(!expectedPatches.includes(patch.file)||!digest(patch.sha256)||sha(await plainFile(path.join(patchRoot,patch.file)))!==patch.sha256||!Array.isArray(patch.sources)||patch.sources.length===0||patch.sources.some(source=>!digest(source.originalSha256)||!digest(source.patchedSha256)||typeof source.path!=='string'||source.path.includes('..')||path.isAbsolute(source.path)))throw Error('시험 코어 패치 체크섬이 현재 소스와 다릅니다.');
 }
 if(!record.files||Object.keys(record.files).sort().join('|')!==[...coreFiles].sort().join('|'))throw Error('시험 코어 파일 목록이 올바르지 않습니다.');
 const files=new Map();
 for(const name of coreFiles){const bytes=await plainFile(path.join(candidateDir,name)),entry=record.files[name];if(!entry||entry.size!==bytes.length||!digest(entry.sha256)||entry.sha256!==sha(bytes))throw Error('시험 코어 파일 체크섬이 다릅니다: '+name);files.set(name,bytes);}
 if(record.unchangedGlueSha256!==sha(files.get('rhwp.js')))throw Error('시험 코어의 JavaScript 연결 파일을 확인하지 못했습니다.');
 return {record,recordBytes,recordSha256:sha(recordBytes),files};
}

export async function stagePreviewCore({candidateDir,runtimeRoot,pluginRoot,lock}){
 const verified=await verifyPreviewCore({candidateDir,pluginRoot,lock}),core=path.join(runtimeRoot,'core');
 if(path.resolve(candidateDir)===path.resolve(core))throw Error('시험 코어 입력과 MSI 스테이징 경로가 같습니다.');
 const marker=JSON.parse(await plainFile(path.join(core,'.pwh-install.json'))),receipt=JSON.parse(await plainFile(path.join(runtimeRoot,'.preserved-runtime.json')));
 if(marker.kind!=='core'||marker.sourceCommit!==lock.upstreamCommit||receipt.id!==lock.id||receipt.archiveSha256!==lock.runtime.sha256||marker.files?.['rhwp.js']!==verified.record.unchangedGlueSha256)throw Error('시험 코어를 넣을 기본 보존 런타임이 일치하지 않습니다.');
 for(const name of coreFiles)if(marker.files[name]!==sha(await plainFile(path.join(core,name))))throw Error('기본 보존 코어가 이미 변경되었습니다.');
 const candidate={id:verified.record.id,buildRecordSha256:verified.recordSha256,wasmSha256:verified.record.files['rhwp_bg.wasm'].sha256,patches:verified.record.patches.map(({file,sha256})=>({file,sha256}))};
 for(const [name,bytes]of verified.files){await fs.writeFile(path.join(core,name),bytes);marker.files[name]=sha(bytes);}
 await fs.writeFile(path.join(core,'BUILD-RECORD.json'),verified.recordBytes);marker.files['BUILD-RECORD.json']=verified.recordSha256;
 marker.runtimeVariant='local-candidate';marker.candidate=candidate;
 await fs.writeFile(path.join(core,'.pwh-install.json'),JSON.stringify(marker,null,2)+'\n');
 const previewReceipt={...receipt,id:`${lock.id}-local-candidate-${candidate.wasmSha256.slice(0,12)}`,basePreservedRuntime:{id:receipt.id,archiveSha256:receipt.archiveSha256},variant:'local-candidate',coreCandidate:candidate};
 delete previewReceipt.archiveSha256;
 await fs.writeFile(path.join(runtimeRoot,'.preserved-runtime.json'),JSON.stringify(previewReceipt,null,2)+'\n');
 return candidate;
}
