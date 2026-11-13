import fs from 'node:fs/promises';
import path from 'node:path';

function once(source,anchor,replacement,label){
 if(source.split(anchor).length!==2)throw Error('Unsupported contextual ribbon anchor: '+label);
 return source.replace(anchor,replacement);
}
export async function patchContextRibbon(studio){
 for(const name of ['pwh-context-ribbon.ts','pwh-context-ribbon.css','pwh-ribbon-model.mjs','pwh-ribbon-icons.ts'])
  await fs.copyFile(new URL('../src/'+name,import.meta.url),path.join(studio,'src/ui',name));
 const mainPath=path.join(studio,'src/main.ts');let main=(await fs.readFile(mainPath,'utf8')).replaceAll('\r\n','\n');
 if(!main.includes('// pwh contextual ribbon')){
  main="// pwh contextual ribbon\nimport {installContextRibbon,placeRibbonMenu} from './ui/pwh-context-ribbon';\n"+main;
  main=once(main,"    new MenuBar(document.getElementById('menu-bar')!, eventBus, dispatcher, registry, {",`    const pwhRibbon=installContextRibbon({menu:document.getElementById('menu-bar')!,toolbar:document.getElementById('icon-toolbar')!,registry,dispatcher,eventBus,onChange:()=>iconToolbarScroller?.resetToStart()});
    new MenuBar(document.getElementById('menu-bar')!, eventBus, dispatcher, registry, {
      onTabSelect: name=>pwhRibbon.select(name),`,'menu construction');
  main=once(main,'      onMenuOpen: (menuName) => {','      onMenuOpen: (menuName,menuEl) => {\n        placeRibbonMenu(menuEl);','menu placement');
  const marker="        if (cmd) dispatcher.dispatch(cmd, { anchorEl: btn as HTMLElement });";
  if(main.split(marker).length!==3)throw Error('Unsupported icon command routing');
  main=main.replaceAll(marker,`        if (cmd) {
          const params:Record<string,unknown>={anchorEl:btn as HTMLElement};
          for(const [key,value]of Object.entries((btn as HTMLElement).dataset))if(key!=='cmd'&&!key.startsWith('pwh'))params[key]=value;
          dispatcher.dispatch(cmd,params);
        }`);
  await fs.writeFile(mainPath,main);
 }
 const menuPath=path.join(studio,'src/ui/menu-bar.ts');let menu=(await fs.readFile(menuPath,'utf8')).replaceAll('\r\n','\n');
 if(!menu.includes('// pwh tab and menu split')){
  menu='// pwh tab and menu split\n'+menu;
  menu=once(menu,'export interface MenuBarOptions {','export interface MenuBarOptions {\n  onTabSelect?: (menuName:string)=>void;','menu option');
  menu=once(menu,'  private onMenuOpen?: (menuName: string, menuEl: HTMLElement) => void;','  private onMenuOpen?: (menuName: string, menuEl: HTMLElement) => void;\n  private onTabSelect?: (menuName:string)=>void;','menu field');
  menu=once(menu,'    this.onMenuOpen = options.onMenuOpen;','    this.onMenuOpen = options.onMenuOpen;\n    this.onTabSelect = options.onTabSelect;','menu callback');
  const start=menu.indexOf('  private setupTitleClicks(): void {');const end=menu.indexOf('  /** 열린 상태에서 다른 메뉴 hover',start);
  if(start<0||end<start)throw Error('Unsupported title input handlers');
  menu=menu.slice(0,start)+`  private setupTitleClicks(): void {
    for(const item of this.menuItems){
      const name=item.dataset.menu??'';
      const activate=(dropdown:boolean)=>{
        if(!dropdown&&name!=='file'&&this.onTabSelect){this.closeAll();this.onTabSelect(name);return;}
        if(this.openMenu===item){this.closeAll();return;}
        this.closeAll();item.classList.add('open');this.openMenu=item;
        item.querySelector('.pwh-menu-more')?.setAttribute('aria-expanded','true');
        this.updateMenuStates(item);this.onMenuOpen?.(name,item);
      };
      for(const trigger of item.querySelectorAll<HTMLElement>('.menu-title,.pwh-menu-more')){
        const dropdown=trigger.classList.contains('pwh-menu-more');
        trigger.addEventListener('mousedown',event=>{event.preventDefault();activate(dropdown);});
        trigger.addEventListener('click',event=>{if((event as MouseEvent).detail===0)activate(dropdown);});
        if(name==='file'){
          trigger.tabIndex=0;trigger.setAttribute('role','button');trigger.setAttribute('aria-haspopup','menu');
          trigger.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '||event.key==='ArrowDown'){event.preventDefault();event.stopPropagation();activate(true);}});
        }
      }
    }
  }

`+menu.slice(end);
  menu=once(menu,"  private closeAll(): void {\n    this.openMenu?.classList.remove('open');","  private closeAll(): void {\n    this.openMenu?.querySelector('.pwh-menu-more')?.setAttribute('aria-expanded','false');\n    this.openMenu?.classList.remove('open');",'close expanded state');
  menu=once(menu,"          this.openMenu.classList.remove('open');","          this.openMenu.querySelector('.pwh-menu-more')?.setAttribute('aria-expanded','false');\n          this.openMenu.classList.remove('open');",'hover expanded state');
  await fs.writeFile(menuPath,menu);
 }
 const dispatcherPath=path.join(studio,'src/command/dispatcher.ts');let dispatcher=(await fs.readFile(dispatcherPath,'utf8')).replaceAll('\r\n','\n');
 if(!dispatcher.includes('// pwh shared enabled-state snapshot')){
  const start=dispatcher.indexOf('  isEnabled(commandId: string): boolean {');const end=dispatcher.indexOf('\n  }',start);
  if(start<0||end<start)throw Error('Unsupported dispatcher enablement');
  dispatcher=dispatcher.slice(0,start)+`  // pwh shared enabled-state snapshot: one context read for an active ribbon.
  private enabledInContext(commandId:string,ctx:EditorContext):boolean {
    const def=this.registry.get(commandId);
    return !!def&&!isBlockedInFormMode(commandId,ctx)&&(!def.canExecute||def.canExecute(ctx));
  }
  getEnabledStates(commandIds:Iterable<string>):Map<string,boolean> {
    const ctx=this.services.getContext();
    return new Map(Array.from(commandIds,id=>[id,this.enabledInContext(id,ctx)] as [string,boolean]));
  }
  isEnabled(commandId:string):boolean {return this.enabledInContext(commandId,this.services.getContext());}`+dispatcher.slice(end+4);
  await fs.writeFile(dispatcherPath,dispatcher);
 }
 const scrollerPath=path.join(studio,'src/ui/icon-toolbar-scroller.ts');let scroller=await fs.readFile(scrollerPath,'utf8');
 if(!scroller.includes('pwh-ribbon-section')){
  scroller=once(scroller,"const DIVIDER_SELECTOR = ':scope > .tb-sep';","const DIVIDER_SELECTOR = ':scope > .tb-sep, :scope > .pwh-ribbon-panel[data-active=\"true\"] > .pwh-ribbon-section';",'group navigation');await fs.writeFile(scrollerPath,scroller);
 }
}
