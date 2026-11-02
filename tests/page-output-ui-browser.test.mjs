import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

const skip=process.env.PWH_BROWSER_TESTS!=='1'||!process.env.PWH_PLAYWRIGHT_MODULE?'Requires browser module and PWH_BROWSER_TESTS=1':false;
const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
async function browserPage(){
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE);
 const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 return {browser,page:await browser.newPage({viewport:{width:1100,height:850}})};
}

test('preview zoom fits the viewport and never changes printed page geometry',{skip},async()=>{
 const {browser,page}=await browserPage();
 try{
  await page.setContent(`<style>@page{size:A4;margin:0}body{margin:0;display:flex;flex-direction:column;align-items:center;gap:16px;padding:16px}.page{width:210mm;height:297mm;flex:none;overflow:hidden}.page svg{width:100%;height:100%}.print-preview-bar{position:fixed;top:0;left:0;right:0;display:flex;align-items:center;padding:8px;min-height:48px}</style><body class="rhwp-print-preview"><div class="print-preview-bar"><button id="close-btn">닫기</button><span class="print-preview-title">시험 문서 · 40쪽</span></div>${Array.from({length:40},()=>'<div class="page"><svg viewBox="0 0 210 297"><rect x="20" y="20" width="170" height="240" fill="none" stroke="black"/><text x="30" y="50">PRINT CONTENT</text></svg></div>').join('')}</body>`);
  const source=await fs.readFile(new URL('../src/print-preview-view.mjs',import.meta.url),'utf8');
  await page.evaluate(async url=>{(await import(url)).installPrintPreviewView(window);},moduleUrl(source));
  const initial=await page.locator('.page').first().boundingBox();
  assert.ok(initial.width<=1100&&initial.x>=0,'fit width must not crop the left side');
  const svg=await page.locator('.page svg').first().evaluate(el=>el.outerHTML);
  const zoom=page.getByRole('combobox',{name:'미리보기 배율'});
  await zoom.selectOption('100');const actual=await page.locator('.page').first().boundingBox();
  await zoom.selectOption('200');const doubled=await page.locator('.page').first().boundingBox();
  assert.ok(Math.abs(doubled.width/actual.width-2)<.001);
  assert.equal(await page.locator('.page svg').first().evaluate(el=>el.outerHTML),svg);
  await page.getByRole('button',{name:'미리보기 축소'}).click();assert.equal(await zoom.inputValue(),'190');
  await page.keyboard.press('Control+0');assert.equal(await zoom.inputValue(),'100');
  await zoom.selectOption('page');const fitted=await page.locator('.page').first().boundingBox();
  assert.ok(fitted.height<850&&fitted.width<1100);
  await page.setViewportSize({width:650,height:650});await zoom.selectOption('width');
  assert.ok((await page.locator('.page').first().boundingBox()).width<=650);
  await zoom.selectOption('200');await page.emulateMedia({media:'print'});
  const printed=await page.locator('.page').first().boundingBox();
  assert.ok(Math.abs(printed.width-210*96/25.4)<.1,'screen zoom must not rescale print');
  assert.equal(await page.locator('.page').last().evaluate(el=>getComputedStyle(el).contentVisibility),'visible');
  assert.equal(await page.locator('.print-preview-bar').isVisible(),false);
  await page.route('http://pwh-preview.test/**',route=>route.fulfill({contentType:'text/html',body:'<div class="print-preview-bar"></div><div class="page"></div>'}));
  await page.goto('http://pwh-preview.test/print.html?pwhDirect=1');
  await page.evaluate(async url=>{(await import(url)).installPrintPreviewView(window);},moduleUrl(source));
  assert.equal(await page.locator('[data-pwh-preview-controls]').count(),0,'the printer workflow must keep its own controls');
 }finally{await browser.close();}
});

test('paper margins surround a live page diagram and retain the original inputs',{skip},async()=>{
 const {browser,page}=await browserPage();
 try{
  await page.setContent('<style>body{font:13px "Malgun Gothic",sans-serif;margin:20px}.dialog{width:540px}input{height:26px}</style><main class="dialog"></main>');
  const source=stripTypeScriptTypes(await fs.readFile(new URL('../src/pwh-page-margin-layout.ts',import.meta.url),'utf8'),{mode:'strip'});
  await page.evaluate(async url=>{
   const module=await import(url),form=document.querySelector('main');
   const input=value=>{const element=document.createElement('input');element.type='number';element.value=String(value);return element;};
   const inputs=Object.fromEntries(Object.entries({marginTop:20,marginBottom:15,marginLeft:25,marginRight:20,marginHeader:10,marginFooter:10,marginGutter:5}).map(([key,value])=>[key,input(value)]));
   const width=input(210),height=input(297),paper=document.createElement('select');
   const binding=[0,1,2].map(value=>{const element=input(value);element.type='radio';element.name='binding';element.dataset.binding=String(value);form.append(element);return element;});binding[0].checked=true;
   const root=module.createPwhMarginLayout({inputs,width,height,paper,orientation:[],binding});form.append(root);
   window.__marginControls={inputs,width,height,root};
  },moduleUrl(source));
  const diagram=page.getByLabel('용지 여백 위치 미리보기'),paperBox=await diagram.boundingBox();
  const top=await page.getByRole('spinbutton',{name:'위쪽 여백(mm)'}).boundingBox();
  const left=page.getByRole('spinbutton',{name:'왼쪽 여백(mm)'});
  const right=await page.getByRole('spinbutton',{name:'오른쪽 여백(mm)'}).boundingBox();
  const bottom=await page.getByRole('spinbutton',{name:'아래쪽 여백(mm)'}).boundingBox();
  assert.ok(top.y+top.height<paperBox.y&&bottom.y>paperBox.y+paperBox.height);
  assert.ok((await left.boundingBox()).x<paperBox.x&&right.x>paperBox.x+paperBox.width);
  await left.focus();assert.equal(await diagram.locator('[data-margin=marginLeft]').getAttribute('class'),'active');
  const before=await diagram.locator('[data-margin=marginLeft]').getAttribute('width');
  await left.fill('35');assert.ok(Number(await diagram.locator('[data-margin=marginLeft]').getAttribute('width'))>Number(before));
  await diagram.getByRole('button',{name:'꼬리말 여백 선택'}).click();
  assert.equal(await page.getByRole('spinbutton',{name:'꼬리말 여백(mm)'}).evaluate(el=>el===document.activeElement),true);
  await page.locator('[data-binding="2"]').check();
  const gutter=await page.getByRole('spinbutton',{name:'제본 여백(mm)'}).boundingBox();assert.ok(gutter.y<paperBox.y);
  const band=diagram.locator('[data-margin=marginGutter]');assert.ok(Number(await band.getAttribute('width'))>Number(await band.getAttribute('height')));
  await page.evaluate(()=>{const c=window.__marginControls;c.width.value='297';c.height.value='210';c.width.dispatchEvent(new Event('change'));});
  const rect=diagram.locator('rect').first();assert.ok(Number(await rect.getAttribute('width'))>Number(await rect.getAttribute('height')));
  assert.equal(await page.evaluate(()=>window.__marginControls.inputs.marginLeft.value),'35','the original confirm input must be retained');
 }finally{await browser.close();}
});
