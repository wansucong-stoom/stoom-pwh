import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

const maximumFileBytes = 64 * 1024 * 1024;
const maximumRecent = 30;
const validId = id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);
const validFile = file => typeof file === 'string' && path.isAbsolute(file) && file.length <= 32767 && /\.hwpx?$/i.test(file);
const fileId = file => createHash('sha256').update(process.platform === 'win32' ? path.normalize(file).toLowerCase() : path.normalize(file)).digest('hex');

export function createRecentDocuments(dataRoot) {
  const directory = path.join(dataRoot, 'recent-documents');
  const entryPath = id => path.join(directory, `${id}.json`);
  async function read(id) {
    if (!validId(id)) throw Error('최근 문서 정보를 확인하지 못했습니다.');
    try {
      const file = entryPath(id), stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) return null;
      const entry = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!validFile(entry?.path) || fileId(entry.path) !== id || !Number.isSafeInteger(entry.openedAt) || entry.openedAt < 0 || entry.openedAt > 8640000000000000) return null;
      return {id, path:entry.path, name:path.basename(entry.path), openedAt:entry.openedAt};
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }
  async function available(file) {
    try {
      const stat = await fs.lstat(file);
      return stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximumFileBytes;
    } catch {return false;}
  }
  return {
    async record(file) {
      if (!validFile(file)) throw Error('최근 문서 경로가 올바르지 않습니다.');
      const normalized = path.normalize(file), id = fileId(normalized);
      await fs.mkdir(directory, {recursive:true});
      const temporary = path.join(directory, `.recent-${randomUUID()}.tmp`);
      try {
        await fs.writeFile(temporary, JSON.stringify({path:normalized, openedAt:Date.now()}) + '\n', {flag:'wx', mode:0o600});
        await fs.rename(temporary, entryPath(id));
      } finally {await fs.unlink(temporary).catch(error => {if (error.code !== 'ENOENT') throw error;});}
    },
    async list() {
      let names;
      try {names = await fs.readdir(directory);} catch (error) {if (error.code === 'ENOENT') return []; throw error;}
      const candidates = names.filter(name => /^[a-f0-9]{64}\.json$/.test(name)), entries = [];
      for (let offset=0; offset<candidates.length; offset+=32) {
        entries.push(...(await Promise.all(candidates.slice(offset,offset+32).map(name => read(name.slice(0,64))))).filter(Boolean));
      }
      entries.sort((a,b) => b.openedAt - a.openedAt || a.name.localeCompare(b.name, 'ko'));
      return Promise.all(entries.slice(0, maximumRecent).map(async entry => ({...entry, available:await available(entry.path)})));
    },
    async open(id) {
      const entry = await read(id);
      if (!entry || !await available(entry.path)) throw Error('파일을 찾을 수 없습니다. 위치를 확인하거나 목록에서 제거해 주세요.');
      return entry.path;
    },
    async remove(id) {
      if (!validId(id)) throw Error('최근 문서 정보를 확인하지 못했습니다.');
      await fs.unlink(entryPath(id)).catch(error => {if (error.code !== 'ENOENT') throw error;});
    },
  };
}
