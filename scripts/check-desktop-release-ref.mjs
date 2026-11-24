import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';

const exec=promisify(execFile);
const root=fileURLToPath(new URL('../',import.meta.url));
const versionPattern=/^\d+\.\d+\.\d+$/;

export async function checkDesktopReleaseRef(tag,{project=root,eventCommit}={}){
  if(!/^v\d+\.\d+\.\d+$/.test(tag??''))throw Error('A stable Pwh release tag is required');
  const git=async ref=>(await exec('git',['rev-parse','--verify',ref],{cwd:project,windowsHide:true})).stdout.trim();
  const tagged=await git('refs/tags/'+tag+'^{commit}').catch(()=>{throw Error('Release tag is missing from the checkout');});
  const commit=await git('HEAD^{commit}');
  if(commit!==tagged)throw Error('The checkout commit differs from the release tag');
  if(eventCommit&&commit!==eventCommit)throw Error('The release tag commit differs from the published event');
  const read=async name=>JSON.parse(await fs.readFile(path.join(project,name),'utf8'));
  const [pwh,desktop]=await Promise.all([read('package.json'),read('desktop/standalone-pwh/version.json')]);
  if(tag!=='v'+pwh.version||!versionPattern.test(desktop.version??''))throw Error('Release and checkout versions differ');
  return {tag,commit,pwhVersion:pwh.version,desktopVersion:desktop.version};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const eventCommit=process.env.GITHUB_EVENT_NAME==='release'?process.env.GITHUB_SHA:undefined;
  const result=await checkDesktopReleaseRef(process.env.RELEASE_TAG,{eventCommit});
  if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,'desktop='+result.desktopVersion+'\n');
  console.log(JSON.stringify(result));
}
