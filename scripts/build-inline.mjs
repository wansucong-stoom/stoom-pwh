import {promises as fs} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[2]);
const studio=path.join(root,'rhwp-studio');
await fs.copyFile(new URL('../src/selection-layout.mjs',import.meta.url),path.join(studio,'src/core/pwh-selection-layout.mjs'));
await fs.copyFile(new URL('../src/table-style.mjs',import.meta.url),path.join(studio,'src/pwh-table-style.mjs'));
await fs.copyFile(new URL('../src/collaboration-target.ts',import.meta.url),path.join(studio,'src/pwh-collaboration-target.ts'));
await fs.copyFile(new URL('../src/picture-replace.ts',import.meta.url),path.join(studio,'src/pwh-picture-replace.ts'));
await fs.copyFile(new URL('../src/page-layout.ts',import.meta.url),path.join(studio,'src/pwh-page-layout.ts'));
await fs.copyFile(new URL('../src/blank-compose.ts',import.meta.url),path.join(studio,'src/pwh-blank-compose.ts'));
await fs.copyFile(new URL('../src/studio-selection.ts',import.meta.url),path.join(studio,'src/collaboration-selection.ts'));
await fs.copyFile(new URL('../src/studio-inline-adapter.ts',import.meta.url),path.join(studio,'src/pwh-inline-adapter.ts'));
let main=await fs.readFile(path.join(studio,'src/main.ts'),'utf8');
if(!main.includes("import './style.css'"))main="import './style.css';\n"+main;
main=main.replace("const { CanvasKitLayerRenderer } = await import('@/view/canvaskit-renderer');","const CanvasKitLayerRenderer={create(){throw new Error('This client uses the Canvas2D editor backend')}};");
main=main.replace('resolveChromeModeRequest(window.location.search)',"resolveChromeModeRequest('?chrome=embed')");
main=main.replace('maybeShowSkinOnboarding();','/* host owns startup */');
if(!main.includes('installInlineEditor'))main+=`\nimport {installInlineEditor} from './pwh-inline-adapter';\ninstallInlineEditor({registry,ready:initPromise, getInputHandler:()=>inputHandler,wasm,getDocumentAgent:()=>documentAgent,getCanvasView:()=>canvasView,load:(bytes,name)=>loadBytes(bytes,name,null,undefined,{suppressDialogs:true}),saved:completeHostSave,recovered:()=>documentState.markDirty('pwh-recovered'),legacyDrafts:listAutosaveDrafts});\n`;
main=main.replace('saved:completeHostSave});',"saved:completeHostSave,recovered:()=>documentState.markDirty('pwh-recovered'),legacyDrafts:listAutosaveDrafts});");
main=main.replace('installInlineEditor({ready:initPromise','installInlineEditor({registry,ready:initPromise');
await fs.writeFile(path.join(studio,'src/main.ts'),main);
main=main.replace("recovered:()=>documentState.markDirty('pwh-recovered')});","recovered:()=>documentState.markDirty('pwh-recovered'),legacyDrafts:listAutosaveDrafts});");
await fs.writeFile(path.join(studio,'src/main.ts'),main);
const menuPath=path.join(studio,'src/ui/context-menu.ts');
let menu=await fs.readFile(menuPath,'utf8');
if(!menu.includes("commandId:'pwh:ai-rewrite-request'"))menu=menu.replace('    this.hide();',"    items=[{type:'command',commandId:'pwh:ai-rewrite-request',label:'AI 수정 요청'},{type:'separator'},...items];\n    this.hide();");
await fs.writeFile(menuPath,menu);
const localFontsPath=path.join(studio,'src/core/local-fonts.ts');
let localFonts=await fs.readFile(localFontsPath,'utf8');
if(!localFonts.includes('pwh host fonts in menu'))localFonts=localFonts.replace('export function getLocalFontRecords(options: GetLocalFontsOptions = {}): LocalFontRecord[] {',`export function getLocalFontRecords(options: GetLocalFontsOptions = {}): LocalFontRecord[] {
  // pwh host fonts in menu: system inventory and renderer share the same source.
  if (hostFontSource.active) return currentHostRecords().filter(record => options.includeRegistered || !record.aliases.some(name => REGISTERED_FONTS.has(name)));`);
await fs.writeFile(localFontsPath,localFonts);
const wasmPath=path.join(studio,'src/core/wasm-bridge.ts');
let wasm=await fs.readFile(wasmPath,'utf8');
if(!wasm.includes('import {renderedBodySelectionRects}'))wasm='import {renderedBodySelectionRects} from '+JSON.stringify('./pwh-selection-layout.mjs')+';\n'+wasm;
wasm=wasm.replace('return JSON.parse(this.doc.getSelectionRects(sec, startPara, startOffset, endPara, endOffset));','return renderedBodySelectionRects(this.doc,sec,startPara,startOffset,endPara,endOffset,JSON.parse(this.doc.getSelectionRects(sec,startPara,startOffset,endPara,endOffset)));');
if(!wasm.includes('return renderedBodySelectionRects(this.doc,'))throw new Error('Unsupported Studio selection bridge: review upstream getSelectionRects');

wasm=wasm.replace('await init() as',"await init({module_or_path:await (window as any).pwhWasmBytes}) as");
await fs.writeFile(wasmPath,wasm);
const glue=path.join(root,'pkg/rhwp.js');
await fs.writeFile(glue,(await fs.readFile(glue,'utf8')).replace("new URL('rhwp_bg.wasm', import.meta.url)","(()=>{throw new Error('Host WASM bytes required')})()"));
const {build}=await import(pathToFileURL(path.join(studio,'node_modules/vite/dist/node/index.js')));
await build({configFile:false,root:studio,publicDir:false,define:{__APP_VERSION__:JSON.stringify('0.8.7'),__RHWP_DISABLE_EXTERNAL_WEBFONTS__:'true',__RHWP_HWPCTRL__:'false'},resolve:{alias:{'@':path.join(studio,'src'),'@wasm':path.join(root,'pkg')}},build:{outDir:path.join(root,'inline-dist'),target:'es2022',modulePreload:false,cssCodeSplit:false,lib:{entry:path.join(studio,'src/main.ts'),formats:['es'],fileName:()=> 'editor.js'},rollupOptions:{output:{inlineDynamicImports:true}}}});
const cssPath=path.join(root,'inline-dist/rhwp-studio.css');
let css=await fs.readFile(cssPath,'utf8');
for(const name of ['icon_small_ko.svg','icon_small_ko_dark.svg']){
 const bytes=await fs.readFile(path.join(studio,'public/images',name));
 css=css.replaceAll(`/images/${name}`,`data:image/svg+xml;base64,${bytes.toString('base64')}`);
}
if(css.includes('/images/icon_small_ko'))throw new Error('Editor icon sprites must be embedded');
await fs.writeFile(cssPath,css);
const html=await fs.readFile(path.join(studio,'index.html'),'utf8');
await fs.writeFile(path.join(root,'inline-dist/editor-body.html'),html.slice(html.indexOf('<body>')+6,html.lastIndexOf('</body>')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
console.log('Inline Studio build ready');
