import {promises as fs} from 'node:fs';
import {createHash} from 'node:crypto';

// Only explicitly configured font files can be served. Paths never come from HTTP.
export async function documentFontFiles(definitions = []) {
  const files = new Map();
  const faces = [];
  for (const definition of definitions) {
    const {path, ...face} = definition;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(face.id) || files.has(face.id)) throw new Error('글꼴 ID가 올바르지 않습니다.');
    const bytes = await fs.readFile(path);
    if (!bytes.length || bytes.length > 64 * 1024 * 1024) throw new Error(`글꼴 크기가 올바르지 않습니다: ${face.id}`);
    faces.push({...face, sha256: createHash('sha256').update(bytes).digest('hex')});
    files.set(face.id, bytes);
  }
  const revision = createHash('sha256').update(JSON.stringify(faces)).digest('hex');
  return {manifest: {schemaVersion: 1, revision, faces}, files};
}
