import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {checkDesktopReleaseRef} from '../scripts/check-desktop-release-ref.mjs';
import {desktopPackageVersion} from '../desktop/standalone-pwh/version-info.mjs';

const exec=promisify(execFile);

test('a different commit with the same versions cannot supply Desktop release assets',async t=>{
  const temp=await fs.realpath(os.tmpdir());
  const project=await fs.mkdtemp(path.join(temp,'pwh-release-ref-'));
  t.after(async()=>{
    assert.equal(path.dirname(path.resolve(project)),temp);
    await fs.rm(project,{recursive:true,force:true});
  });
  const git=(...args)=>exec('git',['-c','user.name=Pwh Tests','-c','user.email=pwh-tests@example.invalid',
    '-c','commit.gpgsign=false','-c','tag.gpgsign=false',...args],{cwd:project,windowsHide:true});
  await git('init');
  await fs.mkdir(path.join(project,'desktop/standalone-pwh'),{recursive:true});
  await fs.writeFile(path.join(project,'package.json'),'{"version":"1.2.3"}');
  await fs.writeFile(path.join(project,'desktop/standalone-pwh/version.json'),'{"version":"1.4.2"}');
  const desktop=path.join(project,'desktop','standalone-pwh');
  assert.equal(await desktopPackageVersion(desktop),'1.4.2');
  assert.equal(await desktopPackageVersion(desktop,'1.4.2'),'1.4.2');
  await assert.rejects(desktopPackageVersion(desktop,'1.4.1'),/differs from version.json/);
  await git('add','--all');
  await git('commit','-m','Release source');
  await git('tag','-a','v1.2.3','-m','Release');
  const exact=await checkDesktopReleaseRef('v1.2.3',{project});
  assert.equal(exact.desktopVersion,'1.4.2');
  assert.match(exact.commit,/^[a-f0-9]{40,64}$/);
  await git('commit','--allow-empty','-m','Unreleased commit with the same versions');
  await assert.rejects(checkDesktopReleaseRef('v1.2.3',{project}),/commit differs/);
  await git('tag','--force','v1.2.3');
  await assert.rejects(checkDesktopReleaseRef('v1.2.3',{project,eventCommit:exact.commit}),/differs from the published event/);
  await assert.rejects(checkDesktopReleaseRef('main',{project}),/stable Pwh release tag/);
});
