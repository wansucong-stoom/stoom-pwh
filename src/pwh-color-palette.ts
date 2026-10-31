import './pwh-color-palette.css';

// Fixed palette follows the user's Hancom reference, rather than regenerating
// shades, so the same visible swatch always means the same stored color.
const THEMES=[
 ['#ffffff','#000000','#faf3db','#3a3c84','#6182d6','#ff843a','#b2b2b2','#ffd700','#289b6e','#9d5cbb'],
 ['#f2f2f2','#808080','#f4e5b2','#d3d3eb','#dfe6f7','#ffe7d8','#f0f0f0','#fff7cc','#cdf2e4','#ebdef1'],
 ['#d9d9d9','#595959','#ecd174','#a6a7d8','#c0cdef','#ffceb0','#e0e0e0','#ffef99','#9be5c8','#d8bee4'],
 ['#bfbfbf','#404040','#cea61d','#7a7cc4','#a0b4e6','#ffb689','#d1d1d1','#ffe766','#69d8ad','#c49dd6'],
 ['#a6a6a6','#262626','#67530e','#2b2d63','#3057b9','#eb5800','#858585','#bfa100','#1e7452','#783e94'],
 ['#808080','#0d0d0d','#292106','#1d1e42','#203a7b','#9c3b00','#595959','#806b00','#144e37','#502962'],
];
const STANDARD=['#000000','#ff0000','#ff6600','#ffff00','#baff1a','#008000','#42c7f1','#0000ff','#1b1760','#800080'];
const LINE_SAMPLES:Record<string,string>={'0':'','1':'━━━━━━━━','2':'━━ ━━ ━━','3':'············','4':'━━ · ━━ ·','5':'━━ ·· ━━ ··','6':'━━━━ ━━━━','7':'○ ○ ○ ○ ○','8':'════════','9':'━━━━━━━','10':'━━━━━━━','11':'≡≡≡≡≡≡','12':'∿∿∿∿∿∿','13':'≈≈≈≈≈≈','14':'━━━━━━━━','15':'━━━━━━━━','16':'━━━━━━━━','17':'━━━━━━━━'};
const normalize=(v:string)=>/^#[0-9a-f]{6}$/i.test(v)?v.toLowerCase():null;
let recent:string[]=[];let active:HTMLElement|null=null;let lastActivator:HTMLElement|null=null;let returnFocus:HTMLElement|null=null;let keyboardInteraction=false;let installed=false;

function readLocal(){try{const data=JSON.parse(localStorage.getItem('pwh.recent-colors')||'[]');return Array.isArray(data)?data.map(normalize).filter(Boolean).slice(0,12) as string[]:[];}catch{return [];}}
function saveLocal(){try{localStorage.setItem('pwh.recent-colors',JSON.stringify(recent));}catch{}}
function remember(color:string){
 const value=normalize(color);if(!value)return;
 recent=[value,...recent.filter(c=>c!==value)].slice(0,12);saveLocal();
 const fn=(window as any).pwhRecentColors;if(typeof fn==='function')void fn(value).catch(()=>{});
}
function close(restore=false){const shouldRestore=restore&&!!active?.contains(document.activeElement);active?.remove();active=null;if(shouldRestore&&returnFocus?.isConnected)returnFocus.focus();returnFocus=null;}
function swatch(color:string,choose:(color:string)=>void){
 const button=document.createElement('button');button.type='button';button.className='pwh-color-swatch';button.style.background=color;
 button.title=color.toUpperCase();button.setAttribute('aria-label',`색상 ${color.toUpperCase()}`);button.dataset.color=color;
 button.addEventListener('mousedown',e=>e.preventDefault());button.addEventListener('click',()=>choose(color));return button;
}
export function openPwhColorPalette(input:HTMLInputElement,anchor?:HTMLElement|null,options:{allowNone?:boolean}={}){
 if(input.disabled)return;close();
 const popup=document.createElement('div');popup.className='pwh-color-popover';popup.setAttribute('role','dialog');popup.setAttribute('aria-label','색상 선택');popup.tabIndex=-1;
 const source=input.value;recent=[...new Set([...recent,...readLocal()])].slice(0,12);
 const choose=(color:string)=>{const value=normalize(color);if(!value)return;input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));remember(value);close(true);};
 const heading=document.createElement('div');heading.className='pwh-color-heading';heading.textContent='색상 선택';
 const section=(title:string,cls:string)=>{const label=document.createElement('div');label.className='pwh-color-label';label.textContent=title;const grid=document.createElement('div');grid.className=cls;popup.append(label,grid);return grid;};
 popup.append(heading);
 const themes=section('테마 색','pwh-color-grid pwh-color-themes');
 for(const row of THEMES)for(const color of row)themes.append(swatch(color,choose));
 const standards=section('기본 색','pwh-color-grid pwh-color-standards');for(const color of STANDARD)standards.append(swatch(color,choose));
 const recentGrid=section('최근 사용한 색','pwh-color-grid pwh-color-recents');
 const renderRecent=()=>{recentGrid.replaceChildren();if(!recent.length){const empty=document.createElement('span');empty.className='pwh-color-empty';empty.textContent='선택한 색이 여기에 표시됩니다';recentGrid.append(empty);}else for(const color of recent)recentGrid.append(swatch(color,choose));};renderRecent();
 const row=document.createElement('div');row.className='pwh-color-custom';const label=document.createElement('label');label.textContent='색상 코드';
 const code=document.createElement('input');code.type='text';code.maxLength=7;code.value=source.toUpperCase();code.setAttribute('aria-label','색상 코드');code.spellcheck=false;label.append(code);
 const apply=document.createElement('button');apply.type='button';apply.textContent='적용';
 const applyCode=()=>{const value=normalize(code.value.trim());if(!value){code.setCustomValidity('#RRGGBB 형식으로 입력하세요.');code.reportValidity();return;}code.setCustomValidity('');choose(value);};
 code.addEventListener('input',()=>code.setCustomValidity(''));code.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();applyCode();}});apply.addEventListener('click',applyCode);
 const nativeLabel=document.createElement('label');nativeLabel.className='pwh-color-native';nativeLabel.textContent='직접 선택';
 const native=document.createElement('input');native.type='color';native.value=source;native.dataset.pwhNativeColor='1';native.setAttribute('aria-label','직접 색상 선택');native.addEventListener('input',()=>{code.value=native.value.toUpperCase();});native.addEventListener('change',()=>choose(native.value));nativeLabel.append(native);
 row.append(label,apply,nativeLabel);popup.append(row);
 if(options.allowNone){const clear=document.createElement('button');clear.type='button';clear.className='pwh-color-clear';clear.textContent='색 없음';clear.addEventListener('mousedown',e=>e.preventDefault());clear.addEventListener('click',()=>choose('#ffffff'));popup.append(clear);}
 popup.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);}});
 document.body.append(popup);active=popup;
 const target=anchor?.isConnected?anchor:input;returnFocus=target;const box=target.getBoundingClientRect(),width=popup.offsetWidth,height=popup.offsetHeight;
 popup.style.left=Math.max(8,Math.min(window.innerWidth-width-8,box.left))+'px';popup.style.top=Math.max(8,Math.min(window.innerHeight-height-8,box.bottom+6))+'px';
 if(keyboardInteraction)popup.querySelector<HTMLButtonElement>('.pwh-color-swatch')?.focus();
 const fn=(window as any).pwhRecentColors;if(typeof fn==='function')void fn().then((values:string[])=>{if(active!==popup||!Array.isArray(values))return;recent=[...new Set([...values.map(normalize).filter(Boolean),...recent])].slice(0,12) as string[];saveLocal();renderRecent();}).catch(()=>{});
}
export function installPwhColorPalette(){
 if(installed)return;installed=true;
 const decorate=(root:ParentNode)=>{const selects=[...(root instanceof HTMLSelectElement?[root]:[]),...Array.from(root.querySelectorAll?.('select')||[])];for(const select of selects){if(select.dataset.pwhLineSamples)continue;const labels=Array.from(select.options).map(o=>o.textContent||'').join(' ');if(!(/실선/.test(labels)&&/파선/.test(labels)&&/점선/.test(labels)))continue;select.dataset.pwhLineSamples='1';for(const option of Array.from(select.options)){const sample=LINE_SAMPLES[option.value];if(sample)option.textContent=(option.textContent||'').trim()+'   '+sample;}}};
 decorate(document);let scheduled=false;new MutationObserver(records=>{if(scheduled||!records.some(r=>r.addedNodes.length))return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;decorate(document);});}).observe(document.documentElement,{childList:true,subtree:true});
 document.addEventListener('mousedown',()=>{keyboardInteraction=false;},true);
 document.addEventListener('keydown',event=>{keyboardInteraction=true;if(active&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close(true);}},true);
 document.addEventListener('click',event=>{
  const target=event.target as HTMLElement|null;if(!target)return;
  if(target instanceof HTMLInputElement&&target.type==='color'&&!target.dataset.pwhNativeColor){
   if(target.disabled)return;event.preventDefault();event.stopPropagation();
   const box=target.getBoundingClientRect(),visible=box.width>4&&box.height>4&&getComputedStyle(target).visibility!=='hidden';
   openPwhColorPalette(target,visible?target:lastActivator);return;
  }
  if(!target.closest('.pwh-color-popover')){close();lastActivator=target;}
 },true);
}
