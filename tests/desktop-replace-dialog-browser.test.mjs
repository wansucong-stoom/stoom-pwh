import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('Desktop only prompts for an actual unsaved change and offers save, discard and cancel', {
  skip: process.env.PWH_BROWSER_TESTS !== '1' || !process.env.PWH_DESKTOP_SOURCE_ROOT ? 'Set Desktop build and browser paths' : false,
  timeout: 120000,
}, async () => {
  const {chromium} = await import(process.env.PWH_PLAYWRIGHT_MODULE || 'playwright');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pwh-replace-dialog-'));
  process.env.PWH_STANDALONE_DATA = path.join(dir, 'data');
  const {createWorkspaceServer} = await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT, 'workspace-shell.mjs')));
  const app = await createWorkspaceServer({updateServices: {check: async () => null}});
  const browser = await chromium.launch({headless: true, executablePath: process.env.PWH_BROWSER_EXECUTABLE});
  try {
    const page = await browser.newPage({viewport: {width: 1200, height: 850}});
    if (process.env.PWH_PICTURE_DEBUG) page.on('console', m => console.log('BROWSER', m.type(), m.text()));
    await page.goto(app.url);
    await page.getByRole('button', {name: '새 문서 빈 문서에서 시작하기'}).click();
    const child = page.frameLocator('#documents iframe').first(), editor = child.frameLocator('#editor');
    await editor.locator('textarea[aria-label="문서 편집 입력"]').waitFor({state: 'attached', timeout: 60000});
    await editor.locator('body').evaluate(async () => {
      for (let i = 0; i < 600; i++) {
        if (window.pwhRecoveryReady?.() === true) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw Error('editor did not finish loading');
    });
    const state = () => editor.locator('body').evaluate(() => window.pwhEditor.context().documentState);
    assert.equal((await state()).dirty, false, 'opening a blank document is not an edit');
    const area = editor.locator('#scroll-content'); const box = await area.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + 200);
    assert.equal((await state()).dirty, false, 'placing the caret is not an edit');
    await editor.getByRole('textbox', {name: '문서 편집 입력'}).focus();
    await page.keyboard.type('test');
    assert.equal((await state()).dirty, true, 'typing is an edit');
    await editor.locator('[data-menu="file"] .menu-title').click();
    await editor.locator('[data-pwh-file="new"]').click();
    const dialog = child.getByRole('dialog', {name: '변경 내용 저장'});
    await dialog.waitFor({state: 'visible'});
    assert.equal(await dialog.getByRole('button', {name: '저장', exact: true}).isVisible(), true);
    assert.equal(await dialog.getByRole('button', {name: '저장하지 않음'}).isVisible(), true);
    await dialog.getByRole('button', {name: '취소', exact: true}).click();
    assert.equal((await state()).dirty, true, 'cancel preserves the unsaved document');
    await editor.locator('[data-menu="file"] .menu-title').click();
    await editor.locator('[data-pwh-file="new"]').click();
    const oldSource=await child.locator('#editor').getAttribute('src');
    await dialog.getByRole('button', {name: '저장하지 않음'}).click();
    const replaced=await child.locator('body').evaluate(async(_body,previous)=>{
      for(let i=0;i<600;i++){
        const frame=document.getElementById('editor');
        try{if(frame?.getAttribute('src')!==previous&&frame?.contentWindow.location.href===frame?.src&&frame?.contentWindow.pwhRecoveryReady?.()===true)return true;}catch{/* The frame is navigating. */}
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      return false;
    },oldSource);
    assert.equal(replaced,true,'wait for the replacement document, not the still-attached old iframe');
    assert.equal((await state()).dirty, false, 'discard opens a clean blank document');
  } finally {
    await browser.close(); await new Promise(resolve => app.server.close(resolve));
    await fs.rm(dir, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
  }
});
