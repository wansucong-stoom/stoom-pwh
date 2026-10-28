import {promises as fs} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[2]);
const studio=path.join(root,'rhwp-studio');
await fs.copyFile(new URL('../src/document-state-cache.mjs',import.meta.url),path.join(studio,'src/document-agent/pwh-document-state-cache.mjs'));
const agentPath=path.join(studio,'src/document-agent/controller.ts');
let agentSource=await fs.readFile(agentPath,'utf8');
if(!agentSource.includes('pwh presentation digest cache')){
 const method='  getDocumentState(): RhwpDocumentStateV1 {';
 if(!agentSource.includes(method)||!agentSource.includes('export class DocumentAgentController {'))throw Error('Unsupported document agent state bridge');
 agentSource='// pwh presentation digest cache; authoritative getDocumentState stays fresh.\nimport {createDocumentStateDigestCache} from '+JSON.stringify('./pwh-document-state-cache.mjs')+';\n'+agentSource;
 agentSource=agentSource.replace('export class DocumentAgentController {',`export class DocumentAgentController {
  private readonly pwhStateCache=createDocumentStateDigestCache();
  private pwhStateCacheOff: (()=>void)|null=null;
  getPresentationDocumentState(): RhwpDocumentStateV1 {
    this.syncGeneration();
    if(!this.pwhStateCacheOff){const offs=['document-mutated','document-changed'].map(event=>this.deps.eventBus.on(event,()=>this.pwhStateCache.invalidate()));this.pwhStateCacheOff=()=>offs.forEach(off=>off());}
    const revision={documentEpoch:this.documentEpoch,changeSeq:this.changeSeq,format:this.currentFormat(),pageCount:this.deps.wasm.pageCount,dirty:this.deps.isDirty()};
    return {schemaVersion:1,...revision,documentSha256:this.pwhStateCache.read(revision,()=>exportDocumentSha256(this.deps.wasm,revision.format))};
  }`);
 agentSource=agentSource.replace('    this.offMutation();','    this.offMutation();\n    this.pwhStateCacheOff?.();');
 await fs.writeFile(agentPath,agentSource);
}
await fs.copyFile(new URL('../src/local-font-face.mjs',import.meta.url),path.join(studio,'src/core/pwh-local-font-face.mjs'));
const hostCanvasPath=path.join(studio,'src/core/host-canvas-fonts.ts');
let hostCanvas=await fs.readFile(hostCanvasPath,'utf8');
if(!hostCanvas.includes('pwh exact local face first')){
 const begin='            const data = await loadRendererLocalFont(record);';
 const finish='            await font.load();';
 const from=hostCanvas.indexOf(begin),to=hostCanvas.indexOf(finish,from);
 if(from<0||to<0)throw Error('Unsupported host canvas font preparation');
 hostCanvas='// pwh exact local face first; verified bytes remain the fallback.\nimport {tryLoadExactLocalFont} from '+JSON.stringify('./pwh-local-font-face.mjs')+';\nimport {getLocalFontRecords} from "./local-fonts.ts";\n'+hostCanvas.slice(0,from)+`            const alias = \`__rhwp_host_face_\${this.id}_\${++this.serial}\`;
            const face = record.hostReference!.face;
            const localFace:any={...face};
            const catalog=getLocalFontRecords({includeRegistered:true});
            for(const field of ['fullName','postscriptName']){
              const wanted=String((face as any)[field]||'').normalize('NFC').toLowerCase();
              const matches=new Set(catalog.filter(candidate=>[candidate.hostReference?.face.fullName,candidate.hostReference?.face.postscriptName].some(name=>name&&name.normalize('NFC').toLowerCase()===wanted)).map(candidate=>candidate.hostReference?.face.id));
              if(!wanted||matches.size!==1||!matches.has(face.id))delete localFace[field];
            }
            let font=await tryLoadExactLocalFont(alias,localFace);
            const pwhLocalFace=!!font;
            if(stale())return;
            if(!font){
              const data=await loadRendererLocalFont(record);
              if(stale())return;
              const bytes=data?normalizeFontFaceData(data.bytes,data.faceIndex??0):null;
              if(!bytes)throw new Error('Host font has no usable face');
              font=new FontFace(alias,bytes,{weight:String(face.weight??400),style:face.slant??'normal'});
              await font.load();
            }
            if(!stale()){const field=pwhLocalFace?'pwhLocalFontLoads':'pwhTransferredFontLoads';document.documentElement.dataset[field]=String(Number(document.documentElement.dataset[field]||0)+1);}`+hostCanvas.slice(to+finish.length);
 await fs.writeFile(hostCanvasPath,hostCanvas);
}
// Repair builds made before the lightweight diagnostic count was added.
if(hostCanvas.includes('pwh exact local face first')&&!hostCanvas.includes('const pwhLocalFace=')){
 hostCanvas=hostCanvas.replace('let font=await tryLoadExactLocalFont(alias,localFace);','let font=await tryLoadExactLocalFont(alias,localFace);\n            const pwhLocalFace=!!font;');
 hostCanvas=hostCanvas.replace('            this.fontSet!.add(font);',"            const pwhField=pwhLocalFace?'pwhLocalFontLoads':'pwhTransferredFontLoads';document.documentElement.dataset[pwhField]=String(Number(document.documentElement.dataset[pwhField]||0)+1);\n            this.fontSet!.add(font);");
 await fs.writeFile(hostCanvasPath,hostCanvas);
}
await fs.copyFile(new URL('../src/clipboard-structure.mjs',import.meta.url),path.join(studio,'src/engine/pwh-clipboard-structure.mjs'));
const keyboardPath=path.join(studio,'src/engine/input-handler-keyboard.ts');
let keyboard=await fs.readFile(keyboardPath,'utf8');
await fs.copyFile(new URL('../src/cell-delete-selection.mjs',import.meta.url),path.join(studio,'src/pwh-cell-delete-selection.mjs'));
await fs.copyFile(new URL('../src/cell-delete-dialog.ts',import.meta.url),path.join(studio,'src/pwh-cell-delete-dialog.ts'));
if(!keyboard.includes('pwh cell delete confirmation')){
 const prior=`      if (!this.cursor.isProtectedCellSelectionMode()) {
        this.clearSelectedCellBlock();
        this.updateCellSelection();
      }`;
 if(!keyboard.includes(prior))throw new Error('Unsupported Studio cell deletion handler');
 keyboard="// pwh cell delete confirmation\nimport {confirmCellBlockDelete} from '@/pwh-cell-delete-dialog';\n"+keyboard.replace(prior,`      if (!this.cursor.isProtectedCellSelectionMode()) confirmCellBlockDelete(this);`);
 await fs.writeFile(keyboardPath,keyboard);
}
if(!keyboard.includes('pwh structured cell clipboard guard')){
 const internalAnchor='  // 내부 복사 marker가 있으면 내부 클립보드를 사용한다.';
 const externalAnchor='function pasteExternalHtml(this: any, html: string, text: string, hasSelection: boolean): void {';
 if(!keyboard.includes(internalAnchor)||!keyboard.includes(externalAnchor))throw new Error('Unsupported Studio clipboard bridge: review upstream paste handlers');
 keyboard='// pwh structured cell clipboard guard\nimport {clipboardCellWarning} from '+JSON.stringify('./pwh-clipboard-structure.mjs')+';\nimport {showToast as pwhClipboardToast} from "@/ui/toast";\n'+keyboard;
 keyboard=keyboard.replace(internalAnchor,`  if(useInternalClipboard){
    const warning=clipboardCellWarning(pos,html,this.wasm.clipboardHasControl());
    if(warning){pwhClipboardToast({message:warning,durationMs:12000});return;}
  }
`+internalAnchor);
 keyboard=keyboard.replace(externalAnchor,externalAnchor+`
  const warning=clipboardCellWarning(this.cursor.getPosition(),html);
  if(warning){pwhClipboardToast({message:warning,durationMs:12000});return;}
`);
 await fs.writeFile(keyboardPath,keyboard);
}
await fs.copyFile(new URL('../src/selection-layout.mjs',import.meta.url),path.join(studio,'src/core/pwh-selection-layout.mjs'));
if(!keyboard.includes('pwh prefer editable table over bitmap preview')){
 const imageGate='  if (items) {';
 const bitmapStart='    const img = new Image();';
 const bitmapEnd='    // px → HWPUNIT (1px = 75 HWPUNIT at 96 DPI)';
 const from=keyboard.indexOf(bitmapStart,keyboard.indexOf('async function pasteImageFile'));
 const to=keyboard.indexOf(bitmapEnd,from);
 if(!keyboard.includes(imageGate)||from<0||to<0)throw Error('Unsupported clipboard image priority/decode path');
 keyboard=keyboard.replace('import {clipboardCellWarning}', 'import {clipboardCellWarning,preferStructuredClipboardHtml}');
 keyboard=keyboard.replace(imageGate,'  // pwh prefer editable table over bitmap preview\n  if (items && !preferStructuredClipboardHtml(html)) {');
 const start=keyboard.indexOf(bitmapStart,keyboard.indexOf('async function pasteImageFile'));
 const end=keyboard.indexOf(bitmapEnd,start);
 keyboard=keyboard.slice(0,start)+`    // Decode local clipboard bytes without a blob URL blocked by host image CSP.
    const img = await createImageBitmap(file);
    const imageWidth=img.width,imageHeight=img.height;img.close();

`+keyboard.slice(end);
 const pasteStart=keyboard.indexOf('async function pasteImageFile'),pasteEnd=keyboard.indexOf('/** 기존 컨트롤 선택 상태',pasteStart);
 if(pasteEnd<0)throw Error('Unsupported clipboard image function boundary');
 keyboard=keyboard.slice(0,pasteStart)+keyboard.slice(pasteStart,pasteEnd).replaceAll('img.naturalWidth','imageWidth').replaceAll('img.naturalHeight','imageHeight')+keyboard.slice(pasteEnd);
 await fs.writeFile(keyboardPath,keyboard);
}
// A Hancom model includes the original image and object properties, whereas
// the clipboard bitmap is only a preview. Prefer the model when available.
const oldImageGate='if (items && !preferStructuredClipboardHtml(html)) {';
if(keyboard.includes(oldImageGate)){
 keyboard=keyboard.replace(oldImageGate,'if (items && !preferStructuredClipboardHtml(html) && !extractHwpJsonModel(html)) {');
 await fs.writeFile(keyboardPath,keyboard);
}
await fs.copyFile(new URL('../src/table-style.mjs',import.meta.url),path.join(studio,'src/pwh-table-style.mjs'));
await fs.copyFile(new URL('../src/table-content.mjs',import.meta.url),path.join(studio,'src/pwh-table-content.mjs'));
await fs.copyFile(new URL('../src/request-state.mjs',import.meta.url),path.join(studio,'src/pwh-request-state.mjs'));
await fs.copyFile(new URL('../src/table-clipboard.mjs',import.meta.url),path.join(studio,'src/pwh-table-clipboard.mjs'));
await fs.copyFile(new URL('../src/nested-table-paste.mjs',import.meta.url),path.join(studio,'src/pwh-nested-table-paste.mjs'));
await fs.copyFile(new URL('../src/table-paste-dialog.ts',import.meta.url),path.join(studio,'src/pwh-table-paste-dialog.ts'));
// The source module uses package-relative imports; the Studio overlay uses prefixed names.
for(const name of ['pwh-table-content.mjs','pwh-table-clipboard.mjs','pwh-nested-table-paste.mjs']){
 const file=path.join(studio,'src',name);
 await fs.writeFile(file,(await fs.readFile(file,'utf8')).replaceAll("'./table-style.mjs'","'./pwh-table-style.mjs'").replaceAll("'./request-state.mjs'","'./pwh-request-state.mjs'").replaceAll("'./table-content.mjs'","'./pwh-table-content.mjs'").replaceAll("'./nested-table-paste.mjs'","'./pwh-nested-table-paste.mjs'"));
}
const editCommandsPath=path.join(studio,'src/command/commands/edit.ts');
let editCommands=await fs.readFile(editCommandsPath,'utf8');
if(!editCommands.includes('pwh cell clipboard command')){
 const predicate='ctx.hasSelection || ctx.inPictureObjectSelection || ctx.inTableObjectSelection';
 if(!editCommands.includes(predicate))throw Error('Unsupported copy command eligibility');
 editCommands=editCommands.replace(predicate,'ctx.hasSelection || ctx.inCellSelectionMode /* pwh cell clipboard command */ || ctx.inPictureObjectSelection || ctx.inTableObjectSelection');
 await fs.writeFile(editCommandsPath,editCommands);
}
await fs.copyFile(new URL('../src/collaboration-target.ts',import.meta.url),path.join(studio,'src/pwh-collaboration-target.ts'));
await fs.copyFile(new URL('../src/picture-replace.ts',import.meta.url),path.join(studio,'src/pwh-picture-replace.ts'));
await fs.copyFile(new URL('../src/page-layout.ts',import.meta.url),path.join(studio,'src/pwh-page-layout.ts'));
await fs.copyFile(new URL('../src/blank-compose.ts',import.meta.url),path.join(studio,'src/pwh-blank-compose.ts'));
await fs.copyFile(new URL('../src/studio-selection.ts',import.meta.url),path.join(studio,'src/collaboration-selection.ts'));
await fs.copyFile(new URL('../src/studio-inline-adapter.ts',import.meta.url),path.join(studio,'src/pwh-inline-adapter.ts'));
let main=await fs.readFile(path.join(studio,'src/main.ts'),'utf8');
if(!main.includes("import './style.css'"))main="import './style.css';\n"+main;
if(!main.includes('pwh selection layout invalidation'))main+=`\n// pwh selection layout invalidation\nfor(const event of ['document-mutated','document-changed','document-page-invalidated','document-view-changed','local-fonts-changed'])eventBus.on(event,()=>wasm.invalidatePwhSelectionLayout());\n`;
main=main.replace("'document-changed','page-invalidated','document-view-changed'","'document-changed','document-page-invalidated','document-view-changed'");
if(!main.includes('pwh propagate host document initialization failure'))main=main.replace("console.error('[initDoc] 오류:', error);","console.error('[initDoc] 오류:', error);\n    // pwh propagate host document initialization failure\n    if(options.suppressDialogs)throw error;");
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
if(!/import\s*\{[^}]*\brenderedBodySelectionRects\b/.test(wasm))wasm='import {renderedBodySelectionRects} from '+JSON.stringify('./pwh-selection-layout.mjs')+';\n'+wasm;
if(wasm.includes('import {renderedBodySelectionRects,createBodySelectionLayoutCache}'))wasm=wasm.replace(/^import\s+\{renderedBodySelectionRects\}\s+from[^\r\n]+\r?\n/gm,'');
wasm=wasm.replace('return JSON.parse(this.doc.getSelectionRects(sec, startPara, startOffset, endPara, endOffset));','return renderedBodySelectionRects(this.doc,sec,startPara,startOffset,endPara,endOffset,JSON.parse(this.doc.getSelectionRects(sec,startPara,startOffset,endPara,endOffset)));');
if(!wasm.includes('return renderedBodySelectionRects(this.doc,'))throw new Error('Unsupported Studio selection bridge: review upstream getSelectionRects');
if(!wasm.includes('pwh gesture scoped selection layout cache')){
 wasm=wasm.replace('import {renderedBodySelectionRects}', 'import {renderedBodySelectionRects,createBodySelectionLayoutCache}');
 wasm=`// pwh gesture scoped selection layout cache\n`+wasm;
 const moduleAnchor='export class WasmBridge {';
 if(!wasm.includes(moduleAnchor))throw Error('Unsupported WasmBridge selection cache owner');
 wasm=wasm.replace(moduleAnchor,`const pwhBodySelectionCache=createBodySelectionLayoutCache();
if(typeof window!=='undefined'){
 window.addEventListener('pointerdown',()=>pwhBodySelectionCache.begin(),{capture:true});
 for(const event of ['pointerup','pointercancel','blur'])window.addEventListener(event,()=>pwhBodySelectionCache.end(),{capture:true});
 for(const event of ['keydown','beforeinput'])window.addEventListener(event,()=>pwhBodySelectionCache.invalidate(),{capture:true});
}
export class WasmBridge {
  invalidatePwhSelectionLayout():void {pwhBodySelectionCache.invalidate();}`);
 wasm=wasm.replace('  invalidateCanvasMetrics(): void {','  invalidateCanvasMetrics(): void {\n    pwhBodySelectionCache.invalidate();');
 wasm=wasm.replace('JSON.parse(this.doc.getSelectionRects(sec,startPara,startOffset,endPara,endOffset)));','JSON.parse(this.doc.getSelectionRects(sec,startPara,startOffset,endPara,endOffset)),pwhBodySelectionCache);');
}
if(!wasm.includes('pwh scratch paragraph operations')){
 const anchor='export class WasmBridge {';if(!wasm.includes(anchor))throw Error('Unsupported Studio paragraph bridge');
 wasm=wasm.replace(anchor,`${anchor}
  // pwh scratch paragraph operations: append and remove without splitting existing anchors.
  insertPwhScratchParagraph(sec:number,index:number):string {if(!this.doc)throw new Error('문서가 로드되지 않았습니다');return this.doc.insertParagraph(sec,index);}
  deletePwhScratchParagraph(sec:number,index:number):string {if(!this.doc)throw new Error('문서가 로드되지 않았습니다');return this.doc.deleteParagraph(sec,index);}`);
}

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
