import {promises as fs, constants} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID, createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const formats = new Map([['.png','png'],['.jpg','jpeg'],['.jpeg','jpeg'],['.bmp','bmp'],['.gif','gif'],['.tif','tiff'],['.tiff','tiff']]);
const pngMagic = Buffer.from('89504e470d0a1a0a','hex');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exec = promisify(execFile);
const convert = async (source, destination, format) => {
  if (format === 'png') return fs.copyFile(source, destination, constants.COPYFILE_EXCL);
  await exec('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',fileURLToPath(new URL('./image-convert.ps1',import.meta.url)),'-InputPath',source,'-OutputPath',destination,'-Format',format], {windowsHide:true,timeout:120000,maxBuffer:65536});
};

export function createImageExportManager({choose, convertImage=convert, tempRoot=os.tmpdir()}={}) {
  if (typeof choose !== 'function') throw new TypeError('A save dialog is required');
  const jobs = new Map(); let dialogBusy = false;
  async function cleanup(job) {
    for (const file of job.temporaryFiles) await fs.unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});
    await fs.rmdir(job.directory).catch(e=>{if(e.code!=='ENOENT')throw e;});
  }
  const find = (id, documentId) => {
    const job = jobs.get(id);
    if (!job || job.documentId !== documentId || Date.now()-job.createdAt > 30*60*1000) throw Error('그림 저장 요청이 만료되었습니다. 다시 시도해 주세요.');
    return job;
  };
  return {
    async start({documentId, pages, suggestedName}) {
      if (dialogBusy) throw Error('파일 선택창이 이미 열려 있습니다.');
      if (typeof documentId!=='string'||!documentId||!Array.isArray(pages)||pages.length<1||pages.length>200||pages.some(p=>!Number.isSafeInteger(p)||p<1)||new Set(pages).size!==pages.length) throw Error('저장할 쪽 범위를 확인해 주세요.');
      dialogBusy=true;let picked;
      try { picked=await choose({mode:'Image', suggestedName: `${path.parse(suggestedName||'문서').name}.png`}); } finally { dialogBusy=false; }
      if(picked.cancelled)return {cancelled:true};
      if(typeof picked.path!=='string'||!path.isAbsolute(picked.path))throw Error('저장할 위치를 확인해 주세요.');
      const target=path.parse(picked.path),ext=target.ext.toLowerCase(),format=formats.get(ext);
      if(!format||!target.name||target.name==='.'||target.name==='..')throw Error('지원하는 그림 형식을 선택해 주세요.');
      const destinations=pages.map(page=>path.join(target.dir,`${target.name}-${page}${ext}`));
      for(const destination of destinations){try{await fs.lstat(destination);throw Error(`이미 같은 이름의 파일이 있습니다: ${path.basename(destination)}`);}catch(error){if(error.code!=='ENOENT')throw error;}}
      const directory=await fs.mkdtemp(path.join(tempRoot,'pwh-image-export-')),id=randomUUID();
      jobs.set(id,{directory,destinations,pages,format,documentId,createdAt:Date.now(),temporaryFiles:[],staged:new Map(),busy:false});
      return {cancelled:false,ticket:id,count:pages.length,format};
    },
    async add({ticket,documentId,page,bytes}) {
      const job=find(ticket,documentId);
      if(job.busy)throw Error('이전 쪽을 저장하고 있습니다.');
      if(!job.pages.includes(page)||job.staged.has(page)||!Buffer.isBuffer(bytes)||bytes.length<24||bytes.length>32*1024*1024||!bytes.subarray(0,8).equals(pngMagic)||bytes.subarray(12,16).toString()!=='IHDR')throw Error('그림 데이터가 올바르지 않습니다.');
      const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(!width||!height||width*height>64*1024*1024)throw Error('그림 크기를 확인해 주세요.');
      job.busy=true;const source=path.join(job.directory,`${page}.png`),out=path.join(job.directory,`${page}.out`);
      job.temporaryFiles.push(source,out);
      try{await fs.writeFile(source,bytes,{flag:'wx'});await convertImage(source,out,job.format);const result=await fs.readFile(out);if(!result.length)throw Error('그림 형식 변환에 실패했습니다.');job.staged.set(page,{path:out,sha256:hash(result)});return {ok:true,page};}finally{job.busy=false;}
    },
    async finish({ticket,documentId}) {
      const job=find(ticket,documentId);if(job.busy||job.staged.size!==job.pages.length)throw Error('모든 쪽의 그림 준비가 끝나지 않았습니다.');
      job.busy=true;const created=[];
      try{
        for(let i=0;i<job.pages.length;i++){
          const item=job.staged.get(job.pages[i]),destination=job.destinations[i];
          await fs.copyFile(item.path,destination,constants.COPYFILE_EXCL);
          const stat=await fs.stat(destination);created.push({destination,sha256:item.sha256,ino:stat.ino,size:stat.size,mtimeMs:stat.mtimeMs});
        }
        jobs.delete(ticket);await cleanup(job);return {ok:true,count:created.length,files:created.map(x=>x.destination)};
      }catch(error){
        for(const file of created)try{const stat=await fs.stat(file.destination);if(stat.ino===file.ino&&stat.size===file.size&&stat.mtimeMs===file.mtimeMs&&hash(await fs.readFile(file.destination))===file.sha256)await fs.unlink(file.destination);}catch{}
        throw error;
      }finally{job.busy=false;}
    },
    async cancel({ticket,documentId}) {const job=jobs.get(ticket);if(!job)return {cancelled:false};if(job.documentId!==documentId||job.busy)throw Error('그림 저장을 취소할 수 없습니다.');jobs.delete(ticket);await cleanup(job);return {cancelled:true};},
    async dispose(){for(const [id,job] of jobs){if(job.busy)continue;jobs.delete(id);await cleanup(job).catch(()=>{});}},
  };
}
