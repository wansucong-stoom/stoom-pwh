import fs from 'node:fs/promises';import path from 'node:path';
const once=(text,from,to,label)=>{if(text.split(from).length!==2)throw Error('Unsupported canvas metric reuse anchor: '+label);return text.replace(from,to);};
export async function patchCanvasMetricReuse(studio){
 await fs.copyFile(new URL('../src/canvas-metric-mutations.mjs',import.meta.url),path.join(studio,'src/core/pwh-canvas-metric-mutations.mjs'));
 const bridgeFile=path.join(studio,'src/core/wasm-bridge.ts');let bridge=await fs.readFile(bridgeFile,'utf8');
 if(!bridge.includes('// Pwh canvas metric dependency lifetime')){
  bridge=`// Pwh canvas metric dependency lifetime\nimport {installCanvasMetricMutationGuards} from ${JSON.stringify('./pwh-canvas-metric-mutations.mjs')};\nimport {MUTATING_METHODS} from ${JSON.stringify('./mutation-method-registry')};\n`+bridge;
  bridge=once(bridge,'export class WasmBridge {',`export class WasmBridge {
  constructor() {
    installCanvasMetricMutationGuards(this, MUTATING_METHODS, () => this.canvasMetrics.invalidateRequests());
  }
  noteCanvasMetricMutation(stable: boolean): void {
    if (!stable) this.canvasMetrics.invalidateRequests();
  }`,'bridge lifetime');await fs.writeFile(bridgeFile,bridge);
 }
 const sessionFile=path.join(studio,'src/core/canvas-metric-session.ts');let session=await fs.readFile(sessionFile,'utf8');
 if(!session.includes('// Pwh prepared metric reuse')){
  session=once(session,'  private epoch = 0;',`  private epoch = 0;
  // Pwh prepared metric reuse: invalidated by content/style/font dependencies.
  private prepared: {doc: CanvasMetricDocument; document: number; fonts: number; enabled: boolean} | null = null;`,'prepared owner');
  session=once(session,'  invalidate(): void { this.epoch += 1; this.provider.dispose(); }',`  invalidate(): void { this.epoch += 1; this.prepared = null; this.provider.dispose(); }
  /** Content changes require a new request set, but unchanged glyph/font keys stay reusable. */
  invalidateRequests(): void { this.epoch += 1; this.prepared = null; }`,'invalidate');
  session=once(session,'    const epoch = ++this.epoch;',`    const cached = this.prepared;
    if (backend === 'canvas2d' && cached?.doc === doc && cached.document === generation.document && cached.fonts === generation.fonts) {
      return isCurrent() ? doc.selectCanvasMetrics(cached.enabled) : false;
    }
    const epoch = ++this.epoch;`,'reuse');
  session=once(session,'      this.lastError = null;',`      this.prepared = {doc, document: generation.document, fonts: generation.fonts, enabled: replies.length > 0};
      this.lastError = null;`,'publication');await fs.writeFile(sessionFile,session);
 }
 const inputFile=path.join(studio,'src/engine/input-handler.ts');let input=await fs.readFile(inputFile,'utf8');
 if(!input.includes('// Pwh vertical paragraph metric stability')){
  input=`// Pwh vertical paragraph metric stability\nimport {isVerticalParagraphFormat} from ${JSON.stringify('../core/pwh-canvas-metric-mutations.mjs')};\n`+input;
  input=once(input,'  private executeParaFormatCommand(', '  private pwhCanvasMetricsStableDepth = 0;\n  private executeParaFormatCommand(','scoped field');
  const start=input.indexOf('  private executeParaFormatCommand('),end=input.indexOf('\n  private ',start+12);let method=input.slice(start,end);
  const from="    this.executeOperation({ kind: 'command', command: cmd });\n    return true;";
  if(!method.includes(from))throw Error('Unsupported paragraph command execution');
  method=method.replace(from,`    const stable = isVerticalParagraphFormat(props);
    if (stable) this.pwhCanvasMetricsStableDepth += 1;
    try {
      this.executeOperation({ kind: 'command', command: cmd });
      return true;
    } finally { if (stable) this.pwhCanvasMetricsStableDepth -= 1; }`);
  input=input.slice(0,start)+method+input.slice(end);
  const after=input.indexOf('  private afterEdit('),afterEnd=input.indexOf('\n  /**',after+12);let block=input.slice(after,afterEnd);
  block=once(block,"    this.eventBus.emit('document-mutated', 'input-handler-edit');","    this.eventBus.emit('document-mutated', this.pwhCanvasMetricsStableDepth ? 'input-handler-paragraph-geometry' : 'input-handler-edit');",'stable mutation reason');input=input.slice(0,after)+block+input.slice(afterEnd);await fs.writeFile(inputFile,input);
 }
 const mainFile=path.join(studio,'src/main.ts');let main=await fs.readFile(mainFile,'utf8');
 if(!main.includes('// Pwh canvas metric mutation dependencies')){
  main=once(main,"  eventBus.on('document-mutated', (reason) => {",`  // Pwh canvas metric mutation dependencies
  eventBus.on('document-mutated', (reason) => {
    wasm.noteCanvasMetricMutation(reason === 'input-handler-paragraph-geometry');`,'mutation event');await fs.writeFile(mainFile,main);
 }
}
