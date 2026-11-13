#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {msixIdentity, msixManifest, runMsixTool} from './msix-package.mjs';
import {officialRuntimeFiles} from '../desktop/standalone-pwh/official-codex-runtime.mjs';

const repository = 'wansucong-stoom/stoom-pwh';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const requiredDesktop = ['host.mjs','app.js','app.html','workspace-shell.mjs','workspace.js',
  'native-paste.cjs','paste-bridge.mjs',
  'electron-shell.cjs','electron-preload.cjs','electron-controller.mjs','official-codex-runtime.mjs',
  'chatgpt-store.mjs','desktop-distribution.mjs','store-update-check.mjs','stoom.ico','client/editor.js','client/manifest.json'];

export function storeReleaseAsset(release, {pwhVersion, desktopVersion}) {
  if (!release || release.draft !== false || release.prerelease !== false
    || release.tag_name !== 'v' + pwhVersion) throw Error('Store updates require the matching published stable Pwh release');
  const name = `PwhDesktop-${desktopVersion}-store-x64.msix`;
  const assets = (release.assets || []).filter(asset => asset.name === name);
  if (assets.length !== 1 || assets[0].state !== 'uploaded') throw Error('Release must include exactly one completed ' + name);
  const asset = assets[0];
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 1024 ** 3
    || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')) throw Error('Store release asset needs a valid size and GitHub SHA-256 digest');
  const url = new URL(asset.browser_download_url);
  if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash
    || decodeURIComponent(url.pathname) !== '/' + repository + '/releases/download/' + release.tag_name + '/' + name) {
    throw Error('Unexpected Store release asset URL');
  }
  return asset;
}

export function verifyStoreDownload(bytes, asset) {
  if (bytes.length !== asset.size || 'sha256:' + sha(bytes) !== asset.digest) throw Error('Store release download differs from GitHub asset digest');
}

export async function verifyStoreFiles(read, {sourceRoot, runtimeRoot, identity, desktopVersion}) {
  const expected = msixIdentity({channel:'store', version:desktopVersion, identity});
  const manifest = (await read('AppxManifest.xml')).toString('utf8').replace(/^\uFEFF/, '').replaceAll('\r\n','\n').trim();
  if (manifest !== msixManifest(expected).trim()) throw Error('Store package identity, version, architecture or capabilities differ');
  const distribution = JSON.parse(await read('standalone-pwh/distribution.json'));
  if (distribution.schema !== 1 || distribution.channel !== 'microsoft-store' || distribution.name !== expected.name) throw Error('Store package distribution differs');
  const compare = async (member, file) => {
    if (sha(await read(member)) !== sha(await fs.readFile(file))) throw Error('Store package/source mismatch: ' + member);
  };
  for (const relative of requiredDesktop) await compare('standalone-pwh/' + relative, path.join(sourceRoot,'desktop/standalone-pwh',relative));
  for (const relative of ['package.json','client/editor.js','client/.pwh-install.json']) await compare('release-source/' + relative,path.join(sourceRoot,relative));
  for (const relative of ['core/rhwp.js','core/rhwp_bg.wasm']) await compare('engine/' + relative,path.join(runtimeRoot,relative));
  for (const [relative,[size,digest]] of Object.entries(officialRuntimeFiles)) {
    const bytes = await read('standalone-pwh/codex-runtime/' + relative);
    if (bytes.length !== size || sha(bytes) !== digest) throw Error('Store package official AI runtime mismatch');
  }
  return {desktopVersion, channel:'microsoft-store', checkedDesktopFiles:requiredDesktop.length,
    commonEditorVerified:true, pinnedCoreVerified:true, officialAiRuntimeVerified:true};
}

export async function verifyStorePackage(packageFile, options) {
  if (process.platform !== 'win32' || !path.isAbsolute(packageFile) || !path.isAbsolute(options.sdkDirectory || '')) throw Error('Store verification requires Windows SDK and absolute paths');
  const work = await fs.mkdtemp(path.join(os.tmpdir(),'pwh-store-verify-'));
  if (path.dirname(work) !== os.tmpdir() || !path.basename(work).startsWith('pwh-store-verify-')) throw Error('Unexpected verification cleanup path');
  const payload = path.join(work,'payload');
  try {
    await runMsixTool(path.join(options.sdkDirectory,'makeappx.exe'),['unpack','/p',packageFile,'/d',payload]);
    return await verifyStoreFiles(name => fs.readFile(path.join(payload,name)),options);
  } finally {
    await fs.rm(work,{recursive:true,force:true});
  }
}

async function main() {
  const root = fileURLToPath(new URL('../',import.meta.url));
  const {version:pwhVersion} = JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
  const {version:desktopVersion} = JSON.parse(await fs.readFile(path.join(root,'desktop/standalone-pwh/version.json'),'utf8'));
  const event = JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
  if (process.env.GITHUB_EVENT_NAME !== 'release' || process.env.GITHUB_REPOSITORY !== repository) throw Error('Only this repository stable release event can submit to Store');
  const asset = storeReleaseAsset(event.release,{pwhVersion,desktopVersion});
  const identity = JSON.parse(process.env.MSSTORE_IDENTITY_JSON || '{}');
  msixIdentity({channel:'store',version:desktopVersion,identity});
  const response = await fetch(asset.browser_download_url,{signal:AbortSignal.timeout(300000)});
  if (!response.ok || Number(response.headers.get('content-length')) > asset.size) throw Error('Store package download failed');
  const bytes = Buffer.from(await response.arrayBuffer());verifyStoreDownload(bytes,asset);
  const outputRoot = path.resolve(process.env.RUNNER_TEMP,'pwh-store-release');await fs.mkdir(outputRoot,{recursive:true});
  const output = path.join(outputRoot,asset.name);await fs.writeFile(output,bytes,{flag:'wx'});
  const report = await verifyStorePackage(output,{sourceRoot:root,runtimeRoot:path.resolve(process.env.PWH_RUNTIME_ROOT),sdkDirectory:process.env.PWH_WINDOWS_SDK_DIR,identity,desktopVersion});
  const record = {...report,pwhVersion,releaseTag:event.release.tag_name,releaseId:event.release.id,sha256:sha(bytes),bytes:bytes.length};
  await fs.writeFile(path.join(outputRoot,'verification.json'),JSON.stringify(record,null,2)+'\n');
  if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT,'package='+output+'\n');
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
    '### Verified Store package\n\nRelease `'+record.releaseTag+'`, Desktop `'+desktopVersion+'`.\n\nSHA-256: `'+record.sha256+'`.\n\nSubmission is a separate step; this check does not mean Store certification passed.\n');
  console.log(JSON.stringify(record));
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {console.error(error.message);process.exitCode = 1;});
}
