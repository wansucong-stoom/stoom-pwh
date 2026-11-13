export function createRibbonStyles(source:HTMLSelectElement|null,openSettings:()=>void){
 const element=document.createElement('div');element.className='pwh-ribbon-style-gallery';
 const viewport=document.createElement('div');viewport.className='pwh-style-viewport';viewport.setAttribute('aria-label','문서 스타일');
 const grid=document.createElement('div');grid.className='pwh-style-grid';viewport.append(grid);
 const navigation=document.createElement('div');navigation.className='pwh-style-navigation';
 const nav=(label:string,text:string)=>{const b=document.createElement('button');b.type='button';b.setAttribute('aria-label',label);b.title=label;b.textContent=text;b.addEventListener('mousedown',e=>e.preventDefault());navigation.append(b);return b;};
 const up=nav('이전 스타일','⌃'),down=nav('다음 스타일','⌄'),more=nav('스타일 전체 펼치기','⌄');more.className='pwh-style-expand';more.setAttribute('aria-expanded','false');more.setAttribute('aria-haspopup','listbox');
 const popup=document.createElement('div');popup.className='pwh-style-popup';popup.hidden=true;
 const list=document.createElement('div');list.className='pwh-style-list';list.setAttribute('role','listbox');list.setAttribute('aria-label','문서의 전체 스타일');
 const settings=document.createElement('button');settings.type='button';settings.className='pwh-style-settings';settings.textContent='스타일 설정…';settings.addEventListener('click',()=>{close();openSettings();});popup.append(list,settings);element.append(viewport,navigation);
 let lastValue:string|undefined;
 const controls=()=>[...grid.querySelectorAll<HTMLButtonElement>('button'),...list.querySelectorAll<HTMLButtonElement>('button')];
 function close(){popup.hidden=true;more.setAttribute('aria-expanded','false');}
 function bounds(){up.disabled=!source||source.disabled||viewport.scrollTop<1;down.disabled=!source||source.disabled||viewport.scrollTop+viewport.clientHeight>=viewport.scrollHeight-1;more.disabled=!source||source.disabled||!source.options.length;}
 function apply(value:string){if(!source||source.disabled)return;source.value=value;source.dispatchEvent(new Event('change',{bubbles:true}));sync();close();}
 function option(text:string,value:string,expanded:boolean){const b=document.createElement('button');b.type='button';b.textContent=text;b.title=text+' 스타일 적용';b.dataset.styleValue=value;b.className=expanded?'pwh-ribbon-style-option':'pwh-ribbon-style';if(expanded)b.setAttribute('role','option');b.addEventListener('mousedown',e=>e.preventDefault());b.addEventListener('click',()=>apply(value));return b;}
 function refresh(){const scroll=viewport.scrollTop;grid.replaceChildren();list.replaceChildren();for(const item of [...source?.options||[]]){grid.append(option(item.text,item.value,false));list.append(option(item.text,item.value,true));}viewport.scrollTop=scroll;sync();}
 function sync(){
  for(const b of controls()){b.disabled=!source||source.disabled;const selected=source?.value===b.dataset.styleValue;b.setAttribute(b.getAttribute('role')==='option'?'aria-selected':'aria-pressed',String(selected));}
  if(source&&source.value!==lastValue){lastValue=source.value;const index=[...source.options].findIndex(o=>o.value===source.value),row=Math.floor(index/2);if(row*28<viewport.scrollTop)viewport.scrollTop=row*28;else if((row+1)*28>viewport.scrollTop+56)viewport.scrollTop=Math.max(0,(row-1)*28);}
  bounds();
 }
 up.addEventListener('click',()=>{viewport.scrollTop-=28;bounds();});down.addEventListener('click',()=>{viewport.scrollTop+=28;bounds();});viewport.addEventListener('scroll',bounds);
 more.addEventListener('click',()=>{
  if(!popup.hidden){close();return;}document.body.append(popup);popup.hidden=false;const r=element.getBoundingClientRect(),width=Math.min(400,innerWidth-16);popup.style.width=width+'px';popup.style.left=Math.max(8,Math.min(r.left,innerWidth-width-8))+'px';popup.style.top=Math.max(8,Math.min(r.bottom+3,innerHeight-160))+'px';popup.style.maxHeight=Math.max(120,innerHeight-parseFloat(popup.style.top)-8)+'px';more.setAttribute('aria-expanded','true');(list.querySelector<HTMLElement>('[aria-selected="true"]')||list.querySelector<HTMLElement>('button'))?.focus({preventScroll:true});
 });
 popup.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();more.focus();return;}const keys=['ArrowDown','ArrowUp','ArrowRight','ArrowLeft','Home','End'];if(!keys.includes(event.key))return;event.preventDefault();event.stopPropagation();const buttons=[...list.querySelectorAll<HTMLButtonElement>('button')],at=buttons.indexOf(document.activeElement as HTMLButtonElement);const step=event.key==='ArrowDown'?2:event.key==='ArrowUp'?-2:event.key==='ArrowRight'?1:-1;const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,at+step));buttons[next]?.focus();});
 document.addEventListener('mousedown',event=>{if(!element.contains(event.target as Node)&&!popup.contains(event.target as Node))close();});window.addEventListener('resize',close);
 if(source){new MutationObserver(refresh).observe(source,{childList:true,subtree:true});new MutationObserver(sync).observe(source,{attributes:true,attributeFilter:['disabled']});source.addEventListener('change',sync);}
 refresh();return {element,sync};
}
