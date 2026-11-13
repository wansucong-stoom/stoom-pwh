import type { CommandRegistry } from '@/command/registry';
import type { CommandDispatcher } from '@/command/dispatcher';
import type { EventBus } from '@/core/event-bus';
import { ribbonTabs, availableRibbonGroups } from './pwh-ribbon-model.mjs';
import { createRibbonIcon } from './pwh-ribbon-icons';
import './pwh-context-ribbon.css';

type Entry = {command?:string;label:string;icon:string;special?:string;toggle?:boolean};
type Options = {menu:HTMLElement;toolbar:HTMLElement;registry:CommandRegistry;dispatcher:CommandDispatcher;eventBus:EventBus;onChange?:()=>void};

export function installContextRibbon({menu,toolbar,registry,dispatcher,eventBus,onChange}:Options) {
 const track=toolbar.querySelector<HTMLElement>('.tb-scroll-track');
 if (!track) throw new Error('Missing editor toolbar track');
 toolbar.classList.add('pwh-context-ribbon');menu.classList.add('pwh-ribbon-menubar');
 const bank=document.createElement('div');bank.className='pwh-ribbon-bank';bank.hidden=true;
 const reusable=new Map<string,HTMLButtonElement[]>();
 for(const group of [...track.children]) {
  if(group.matches('.tb-headerfooter-group,.tb-note-group,.tb-rotate-group'))continue;
  for(const button of group.querySelectorAll<HTMLButtonElement>('.tb-btn[data-cmd]')) {
   const key=button.dataset.cmd!;reusable.set(key,[...(reusable.get(key)||[]),button]);
  }
  bank.append(group);
 }
 track.prepend(bank);
 const panels=new Map<string,HTMLElement>();
 const titles=new Map<string,HTMLElement>();
 const styleGalleries:HTMLElement[]=[];
 let active='edit';let pending=0;
 const fileItem=menu.querySelector<HTMLElement>('[data-menu="file"]');
 const tablist=document.createElement('div');tablist.className='pwh-ribbon-tabs';tablist.setAttribute('role','tablist');tablist.setAttribute('aria-label','문서 메뉴');
 if(fileItem)fileItem.after(tablist);else menu.prepend(tablist);
 const overflow=document.createElement('button');overflow.type='button';overflow.className='pwh-ribbon-more-tabs';overflow.textContent='»';overflow.title='다른 메뉴';overflow.setAttribute('aria-label','다른 메뉴');overflow.setAttribute('aria-haspopup','menu');overflow.setAttribute('aria-expanded','false');overflow.hidden=true;
 tablist.after(overflow);
 const overflowMenu=document.createElement('div');overflowMenu.className='pwh-ribbon-tabs-popup';overflowMenu.setAttribute('role','menu');overflowMenu.hidden=true;menu.append(overflowMenu);

 function decorate(button:HTMLButtonElement,entry:Entry) {
  const old=button.querySelector('.tb-sprite,.tb-icon-text,.pwh-ribbon-icon');
  const icon=createRibbonIcon(entry.icon);if(old)old.replaceWith(icon);else button.prepend(icon);
  let label=button.querySelector<HTMLElement>('.tb-label');
  if(!label){label=document.createElement('span');label.className='tb-label';button.append(label);}
  label.textContent=entry.label;
  const def=entry.command?registry.get(entry.command):null;
  button.title=entry.label+(def?.shortcutLabel?' ('+def.shortcutLabel+')':'');
  button.setAttribute('aria-label',entry.label);button.dataset.pwhRibbonCommand=entry.command||'';
  if(entry.toggle)button.setAttribute('aria-pressed','false');
 }
 function command(entry:Entry):HTMLElement {
  const existing=reusable.get(entry.command!)?.shift();
  const button=existing||document.createElement('button');button.type='button';button.classList.add('tb-btn');button.dataset.cmd=entry.command!;
  decorate(button,entry);
  return existing?.closest<HTMLElement>('.tb-split')||button;
 }
 function styles():HTMLElement {
  const gallery=document.createElement('div');gallery.className='pwh-ribbon-style-gallery';gallery.setAttribute('role','group');gallery.setAttribute('aria-label','문서 스타일');
  const source=document.querySelector<HTMLSelectElement>('#style-name');
  const refresh=()=>{
   gallery.replaceChildren();
   for(const option of [...(source?.options||[])].slice(0,4)) {
    const button=document.createElement('button');button.type='button';button.className='pwh-ribbon-style';button.dataset.styleValue=option.value;button.textContent=option.textContent;button.title=option.textContent+' 스타일 적용';
    button.addEventListener('mousedown',e=>e.preventDefault());
    button.addEventListener('click',()=>{if(!source||source.disabled)return;source.value=option.value;source.dispatchEvent(new Event('change',{bubbles:true}));syncStyles();});
    gallery.append(button);
   }
   syncStyles();
  };
  styleGalleries.push(gallery);
  if(source){new MutationObserver(refresh).observe(source,{childList:true,subtree:true});source.addEventListener('change',syncStyles);new MutationObserver(syncStyles).observe(source,{attributes:true,attributeFilter:['disabled']});}
  refresh();return gallery;
 }
 function syncStyles(){
  const source=document.querySelector<HTMLSelectElement>('#style-name');
  for(const gallery of styleGalleries)for(const button of gallery.querySelectorAll<HTMLButtonElement>('button')){
   button.disabled=!source||source.disabled;button.setAttribute('aria-pressed',String(source?.value===button.dataset.styleValue));
  }
 }
 for(const tab of ribbonTabs) {
  const item=menu.querySelector<HTMLElement>('[data-menu="'+tab.id+'"]');
  const title=item?.querySelector<HTMLElement>('.menu-title');
  if(!item||!title)continue;
  tablist.append(item);title.setAttribute('role','tab');title.id='pwh-ribbon-tab-'+tab.id;title.tabIndex=tab.id===active?0:-1;title.setAttribute('aria-controls','pwh-ribbon-panel-'+tab.id);titles.set(tab.id,title);
  const arrow=document.createElement('button');arrow.type='button';arrow.className='pwh-menu-more';arrow.textContent='⌄';arrow.title=tab.label+' 메뉴 펼치기';arrow.setAttribute('aria-label',arrow.title);arrow.setAttribute('aria-haspopup','menu');arrow.setAttribute('aria-expanded','false');arrow.tabIndex=-1;title.after(arrow);
  title.addEventListener('keydown',event=>{
   const keys=['ArrowLeft','ArrowRight','Home','End','Enter',' '];
   if(event.altKey&&event.key==='ArrowDown'){event.preventDefault();event.stopPropagation();arrow.click();return;}
   if(!keys.includes(event.key)||event.ctrlKey||event.altKey||event.metaKey)return;
   event.preventDefault();event.stopPropagation();let next=tab.id;const ids=[...titles.keys()];const at=ids.indexOf(tab.id);
   if(event.key==='ArrowLeft')next=ids[(at+ids.length-1)%ids.length];
   if(event.key==='ArrowRight')next=ids[(at+1)%ids.length];
   if(event.key==='Home')next=ids[0];if(event.key==='End')next=ids[ids.length-1];
   titles.get(next)?.click();titles.get(next)?.focus({preventScroll:true});
  });
  const panel=document.createElement('div');panel.className='tb-group pwh-ribbon-panel';panel.id='pwh-ribbon-panel-'+tab.id;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',title.id);panel.dataset.ribbonTab=tab.id;
  for(const group of availableRibbonGroups(tab,(id:string)=>registry.has(id))) {
   const section=document.createElement('div');section.className='pwh-ribbon-section';section.setAttribute('role','group');section.setAttribute('aria-label',group.label);
   const buttons=document.createElement('div');buttons.className='pwh-ribbon-commands';
   for(const entry of group.items as Entry[])buttons.append(entry.special==='styles'?styles():command(entry));
   const label=document.createElement('div');label.className='pwh-ribbon-section-label';label.textContent=group.label;section.append(buttons,label);panel.append(section);
  }
  track.insertBefore(panel,track.querySelector('.tb-headerfooter-group'));panels.set(tab.id,panel);
  const choice=document.createElement('button');choice.type='button';choice.setAttribute('role','menuitemradio');choice.textContent=tab.label;choice.dataset.tab=tab.id;
  choice.addEventListener('click',()=>{titles.get(tab.id)?.click();closeOverflow();titles.get(tab.id)?.focus({preventScroll:true});});overflowMenu.append(choice);
 }
 // Contextual note/header tools keep their original listeners and lifecycle.
 for(const button of track.querySelectorAll<HTMLButtonElement>('.tb-headerfooter-group .tb-btn,.tb-note-group .tb-btn,.tb-rotate-group .tb-btn')) {
  const label=button.querySelector('.tb-label')?.textContent||button.title||'도구';
  const id=button.dataset.cmd||'';decorate(button,{label,icon:id.includes('footnote')?'footnote':id.includes('endnote')?'endnote':id.includes('delete')?'cut':id.includes('close')?'undo':'page',command:id});
 }
 function updateState(){
  pending=0;const panel=panels.get(active);if(!panel)return;
  if(active==='format')syncStyles();
  const buttons=[...panel.querySelectorAll<HTMLButtonElement>('button[data-cmd]')];
  const enabledStates=dispatcher.getEnabledStates(buttons.map(button=>button.dataset.cmd!));
  for(const button of buttons) {
   const enabled=enabledStates.get(button.dataset.cmd!)===true;if(button.disabled===enabled)button.disabled=!enabled;
   button.setAttribute('aria-disabled',String(!enabled));
   if(button.hasAttribute('aria-pressed')){
    const cmd=button.dataset.cmd!;const lower=({ 'format:bold':'btn-bold','format:italic':'btn-italic','format:underline':'btn-underline','format:strikethrough':'btn-strike'} as Record<string,string>)[cmd];
    const state=lower?document.getElementById(lower):menu.querySelector<HTMLElement>('[data-cmd="'+cmd+'"]');
    const pressed=state?.classList.contains('active')||false;button.setAttribute('aria-pressed',String(pressed));button.classList.toggle('active',pressed);
   }
  }
 }
 const schedule=()=>{if(!pending)pending=requestAnimationFrame(updateState);};
 for(const event of ['command-state-changed','document-loaded','selection-changed','cell-selection-phase-changed','cursor-cell-changed','cursor-format-changed','cursor-para-changed','table-object-selection-changed','picture-object-selection-changed'])eventBus.on(event,schedule);
 function closeOverflow(){overflowMenu.hidden=true;overflow.setAttribute('aria-expanded','false');}
 function select(id:string){
  if(!panels.has(id))return;active=id;
  for(const [name,panel]of panels){panel.dataset.active=String(name===id);panel.setAttribute('aria-hidden',String(name!==id));}
  for(const [name,title]of titles){title.setAttribute('aria-selected',String(name===id));title.tabIndex=name===id?0:-1;title.parentElement?.classList.toggle('pwh-ribbon-selected',name===id);}
  for(const choice of overflowMenu.querySelectorAll<HTMLElement>('[data-tab]'))choice.setAttribute('aria-checked',String(choice.dataset.tab===id));
  const title=titles.get(id);if(title){const rect=title.getBoundingClientRect(),view=tablist.getBoundingClientRect();if(rect.left<view.left)tablist.scrollLeft-=view.left-rect.left;if(rect.right>view.right)tablist.scrollLeft+=rect.right-view.right;}
  toolbar.dataset.ribbonTab=id;updateState();onChange?.();
 }
 overflow.addEventListener('mousedown',e=>e.preventDefault());
 overflow.addEventListener('click',()=>{const open=overflowMenu.hidden;overflowMenu.hidden=!open;overflow.setAttribute('aria-expanded',String(open));if(open){const rect=overflow.getBoundingClientRect();overflowMenu.style.right=Math.max(4,innerWidth-rect.right)+'px';overflowMenu.style.top=rect.bottom+'px';overflowMenu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();}});
 document.addEventListener('mousedown',e=>{if(!overflow.contains(e.target as Node)&&!overflowMenu.contains(e.target as Node))closeOverflow();});
 overflowMenu.addEventListener('keydown',e=>{
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeOverflow();overflow.focus();return;}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
  e.preventDefault();e.stopPropagation();const choices=[...overflowMenu.querySelectorAll<HTMLButtonElement>('button')];const at=choices.indexOf(document.activeElement as HTMLButtonElement);
  const index=e.key==='Home'?0:e.key==='End'?choices.length-1:(at+(e.key==='ArrowDown'?1:-1)+choices.length)%choices.length;choices[index]?.focus();
 });
 new ResizeObserver(()=>{overflow.hidden=tablist.scrollWidth<=tablist.clientWidth+1;}).observe(tablist);
 select(active);
 return {select,get active(){return active;}};
}

export function placeRibbonMenu(menu:HTMLElement):void {
 menu.querySelector('.pwh-menu-more')?.setAttribute('aria-expanded','true');
 const dropdown=menu.querySelector<HTMLElement>(':scope > .menu-dropdown');if(!dropdown)return;
 const anchor=menu.getBoundingClientRect();dropdown.style.position='fixed';dropdown.style.top=anchor.bottom+'px';dropdown.style.left=Math.max(4,Math.min(anchor.left,innerWidth-(dropdown.offsetWidth||220)-4))+'px';
}
