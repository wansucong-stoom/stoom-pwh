import fs from'node:fs/promises';import path from'node:path';
function once(source,from,to){if(source.split(from).length!==2)throw Error('Unsupported host-font settings source: '+from.slice(0,70));return source.replace(from,to);}
export async function patchHostFontSettings(studio){
 const moduleName='pwh-host-font-settings.mjs';
 await fs.copyFile(new URL('../src/host-font-settings.mjs',import.meta.url),path.join(studio,'src/core',moduleName));
 const file=path.join(studio,'src/core/local-fonts.ts');let source=(await fs.readFile(file,'utf8')).replaceAll('\r\n','\n');
 if(!source.includes('// Pwh host font settings')){
  source=`// Pwh host font settings\nimport {hostFontSettingsState,detectHostFontSettings} from './${moduleName}';\n`+source;
  source=once(source,"export type LocalFontDetectionSource = 'local-font-access' | 'font-presence-probe';","export type LocalFontDetectionSource = 'local-font-access' | 'font-presence-probe' | 'host-font-provider';");
  source=once(source,'export async function detectLocalFonts(options: DetectLocalFontsOptions = {}): Promise<string[]> {',`export async function detectLocalFonts(options: DetectLocalFontsOptions = {}): Promise<string[]> {
  const hostFonts = await detectHostFontSettings(hostFontSource, getLocalFonts, options);
  if (hostFonts !== null) return hostFonts;`);
  source=once(source,'export function getLocalFontState(): LocalFontState {',`export function getLocalFontState(): LocalFontState {
  const hostState = hostFontSettingsState(hostFontSource);
  if (hostState) return hostState;`);
  await fs.writeFile(file,source);
 }
 const dialogFile=path.join(studio,'src/ui/options-dialog.ts');let dialog=(await fs.readFile(dialogFile,'utf8')).replaceAll('\r\n','\n');
 if(!dialog.includes('// Pwh settings share the renderer catalog')){
  dialog="// Pwh settings share the renderer catalog\nimport {hasHostFontProvider,prepareHostFontCatalog} from '@/core/local-fonts';\n"+dialog;
  dialog=once(dialog,"    localDesc.textContent = i18nText('dialog.options.localDesc.text');",`    localDesc.textContent = hasHostFontProvider()
      ? '앱이 읽은 PC의 시스템 글꼴 목록을 문서와 글꼴 메뉴에서 함께 사용합니다. 브라우저의 글꼴 접근 권한은 필요하지 않습니다.'
      : i18nText('dialog.options.localDesc.text');`);
  dialog=once(dialog,"      localBtn.textContent = state.stored ? i18nText('dialog.options.localBtn.text.x827ff8') : i18nText('dialog.options.localBtn.text');",`      localBtn.textContent = state.source === 'host-font-provider' ? '시스템 글꼴 목록 확인'
        : state.stored ? i18nText('dialog.options.localBtn.text.x827ff8') : i18nText('dialog.options.localBtn.text');`);
  dialog=once(dialog,'    void loadStoredLocalFonts().then(','    void (hasHostFontProvider() ? prepareHostFontCatalog() : loadStoredLocalFonts()).then(');
  dialog=once(dialog,'      if (!isLocalFontAccessSupported()) {','      if (!hasHostFontProvider() && !isLocalFontAccessSupported()) {');
  dialog=once(dialog,"        updateLocalStatus(i18nText('dialog.options.updateLocalStatus.label.x97c46b', { p1: fonts.length }));",`        updateLocalStatus(hasHostFontProvider() ? undefined : i18nText('dialog.options.updateLocalStatus.label.x97c46b', { p1: fonts.length }));`);
  dialog=once(dialog,'function formatLocalFontStatus(state: LocalFontState): string {',`function formatLocalFontStatus(state: LocalFontState): string {
  if (state.source === 'host-font-provider') return state.lastError
    ? '앱의 시스템 글꼴 목록을 확인하지 못했습니다. 문서를 저장한 뒤 앱을 다시 열어 주세요.'
    : \`앱 시스템 글꼴: \${state.count}개 face · 문서와 같은 목록을 사용합니다. 새 글꼴을 설치한 뒤에는 앱을 다시 열어 주세요.\`;`);
  await fs.writeFile(dialogFile,dialog);
 }
}
