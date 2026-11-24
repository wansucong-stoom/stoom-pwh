import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash, randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const machine = createHash('sha256').update(os.hostname().toLowerCase()).digest('hex').slice(0,16);
const ownerName = /^([a-f0-9]{16})-(\d+)-[a-f0-9-]{36}$/;
const conflict = '파일이 다른 곳에서 변경되었습니다. 다른 이름으로 저장하세요.';
const missing = error => error.code === 'ENOENT';

export async function regularFileState(file) {
  let handle;
  try {
    const stat = await fs.lstat(file, {bigint:true});
    if (!stat.isFile()) throw Error('일반 파일을 선택하세요.');
    handle = await fs.open(file,'r');
    const before = await handle.stat({bigint:true});
    const version = info=>[info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':');
    if (version(stat)!==version(before)) throw Error(conflict);
    const hash=createHash('sha256');
    for await (const bytes of handle.createReadStream({autoClose:false})) hash.update(bytes);
    if (version(before)!==version(await handle.stat({bigint:true}))) throw Error(conflict);
    // A replacement during the read leaves the opened handle unchanged.
    if (version(before)!==version(await fs.lstat(file,{bigint:true}))) throw Error(conflict);
    return hash.digest('hex');
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  } finally { await handle?.close(); }
}

export async function canonicalSavePath(file) {
  const name=path.basename(file);
  const parent=await fs.realpath(path.dirname(file));
  const candidate=path.join(parent,name);
  try {
    if (!(await fs.lstat(candidate)).isFile()) throw Error('일반 파일을 선택하세요.');
    return await fs.realpath(candidate);
  } catch (error) {
    if (missing(error)) return candidate;
    throw error;
  }
}

async function removeEntry(file) {
  await fs.unlink(file).catch(error=>{if (!missing(error)) throw error;});
}
async function removeEmptyDirectory(dir) {
  await fs.rmdir(dir).catch(error=>{
    if (!['ENOENT','ENOTEMPTY','EEXIST'].includes(error.code)) throw error;
  });
}
async function clearAbandonedLock(dir) {
  let names;
  try {
    if (!(await fs.lstat(dir)).isDirectory()) throw Error('파일 저장 잠금 경로를 확인해 주세요.');
    names=await fs.readdir(dir);
  }
  catch (error) { if (missing(error)) return; throw error; }
  if (names.length===0) {
    await removeEmptyDirectory(dir);
    return;
  }
  const owner=names.length===1 && ownerName.exec(names[0]);
  if (!owner || owner[1]!==machine) return;
  let alive=true;
  try { process.kill(Number(owner[2]),0); }
  catch (error) { if (error.code==='ESRCH') alive=false; }
  if (alive) return;
  // The owner file is unique. A contender can only publish a nonempty
  // directory, so cleanup cannot remove a newer lock.
  await removeEntry(path.join(dir,names[0]));
  await removeEmptyDirectory(dir);
}

export async function withFileTransaction(file, operation) {
  const canonical=await canonicalSavePath(file);
  const parent=path.dirname(canonical);
  const name=path.basename(canonical);
  const key=process.platform==='linux'?name:name.normalize('NFC').toLowerCase();
  const lock=path.join(parent,'.pwh-save-lock-'+createHash('sha256').update(key).digest('hex').slice(0,32));
  const staging=await fs.mkdtemp(path.join(parent,'.pwh-lock-'));
  const owner=machine+'-'+process.pid+'-'+randomUUID();
  let acquired=false;
  try {
    await fs.writeFile(path.join(staging,owner),'',{flag:'wx'});
    const until=Date.now()+15000;
    while (!acquired) {
      try {
        await fs.rename(staging,lock);
        acquired=true;
      } catch (error) {
        if (!['ENOTEMPTY','EEXIST','EPERM','EACCES'].includes(error.code)) throw error;
        await clearAbandonedLock(lock);
        if (Date.now()>=until) throw Error('다른 창에서 이 파일을 저장하고 있습니다. 잠시 후 다시 시도하세요.');
        await delay(50);
      }
    }
    return await operation(canonical);
  } finally {
    const dir=acquired?lock:staging;
    await removeEntry(path.join(dir,owner)).then(()=>removeEmptyDirectory(dir)).catch(()=>{});
  }
}
