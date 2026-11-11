import fs from 'node:fs/promises';
import path from 'node:path';

export async function desktopDistribution(appRoot) {
  let value;
  try { value = JSON.parse(await fs.readFile(path.join(appRoot,'distribution.json'),'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {schema:1,channel:'msi'}; throw error; }
  if (value.schema !== 1 || !['msix-preview','microsoft-store'].includes(value.channel)) throw Error('Pwh 배포 채널 정보가 올바르지 않습니다.');
  return value;
}
