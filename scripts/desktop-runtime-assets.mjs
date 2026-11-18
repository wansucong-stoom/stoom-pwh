import fs from 'node:fs/promises';
import path from 'node:path';

const extensions=new Set(['.mjs','.cjs','.js','.html','.css','.ps1','.json','.svg','.ico','.png','.ttf','.txt']);
const generated=new Set(['version.json','distribution.json','NODE-LICENSE.txt','install.ps1','install.cmd','preview-core.mjs']);
const excludedDirectories=new Set(['node_modules','codex-runtime','.git']);

// All runtime modules, including inactive OS adapters, travel together. A newly
// imported module must not depend on a second hand-maintained packaging list.
export async function desktopRuntimeFiles(source){
  const result=[];
  async function walk(relative=''){
    const directory=path.join(source,relative);
    for(const name of (await fs.readdir(directory)).sort()){
      if(excludedDirectories.has(name)||name.startsWith('.'))continue;
      const rel=path.join(relative,name),stat=await fs.lstat(path.join(source,rel));
      if(stat.isSymbolicLink())throw Error('Desktop runtime sources must not contain symbolic links');
      if(stat.isDirectory()){await walk(rel);continue;}
      if(!stat.isFile()||!extensions.has(path.extname(name))||name.startsWith('build-')||generated.has(name))continue;
      result.push(rel);
    }
  }
  await walk();return result;
}

export async function copyDesktopRuntime(source,destination){
  const files=await desktopRuntimeFiles(source);
  for(const relative of files){const target=path.join(destination,relative);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(source,relative),target,fs.constants.COPYFILE_EXCL);}
  return files;
}
