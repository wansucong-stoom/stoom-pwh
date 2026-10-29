import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRecentDocuments} from '../desktop/standalone-pwh/recent-documents.mjs';

test('recent documents keep original paths, handle missing files, and remove only the list entry', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pwh-recent-test-'));
  try {
    const docs = createRecentDocuments(path.join(dir, 'data'));
    const first = path.join(dir, '업무.hwpx'), second = path.join(dir, '자료.hwp');
    await fs.writeFile(first, 'first'); await fs.writeFile(second, 'second');
    assert.deepEqual(await docs.list(), []);
    await Promise.all([docs.record(first), docs.record(second)]);
    let entries = await docs.list();
    assert.deepEqual(new Set(entries.map(item => item.name)), new Set(['업무.hwpx','자료.hwp']));
    assert.ok(entries.every(item => item.available));
    const firstId = entries.find(item => item.path === first).id;
    assert.equal(await docs.open(firstId), first);
    await fs.unlink(first);
    entries = await docs.list();
    assert.equal(entries.find(item => item.id === firstId).available, false);
    await assert.rejects(docs.open(firstId), /파일을 찾을 수 없습니다/);
    await docs.remove(firstId);
    assert.deepEqual((await docs.list()).map(item => item.name), ['자료.hwp']);
    assert.equal(await fs.readFile(second, 'utf8'), 'second');
    await assert.rejects(docs.open('../자료.hwp'), /최근 문서 정보를/);
    await assert.rejects(docs.record(path.join(dir, '다른.txt')), /경로가/);
  } finally {await fs.rm(dir, {recursive:true, force:true, maxRetries:10, retryDelay:100});}
});
