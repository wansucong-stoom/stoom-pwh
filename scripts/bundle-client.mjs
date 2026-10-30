import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {normalizeEditorBundle,editorBuildInputs} from './editor-build-contract.mjs';
const build=path.resolve(process.argv[2]),root=new URL('../client/',import.meta.url);
await fs.mkdir(root,{recursive:true});
const files={};
for(const name of ['editor.js','rhwp-studio.css','editor-body.html']){
 let bytes=await fs.readFile(path.join(build,'inline-dist',name));
 if(name==='editor.js')bytes=Buffer.from(normalizeEditorBundle(bytes.toString('utf8')));
 if(name==='editor-body.html')bytes=Buffer.from(bytes.toString('utf8').trimEnd()+'\n');
 files[name]=createHash('sha256').update(bytes).digest('hex');await fs.writeFile(new URL(name,root),bytes);
}
const pkg=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8'));
const buildInputs=await editorBuildInputs(fileURLToPath(new URL('../',import.meta.url)));
await fs.writeFile(new URL('.pwh-install.json',root),JSON.stringify({kind:'studio-inline',version:pkg.version,upstreamVersion:'0.8.7',upstreamCommit:'1a76570e833917d15817415a53c09ad61ab3203f',files,buildInputs},null,2)+'\n');
console.log('Versioned editor client ready: '+pkg.version);
