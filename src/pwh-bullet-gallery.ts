import type {CommandServices} from '@/command/types';
import './pwh-bullet-gallery.css';
let closeCurrent:(()=>void)|null=null;
const recent:string[]=[];
const bullets=['●','·','■','▪','◆','♦','▶','○','□','◇','▷','★','☆','♠','♣','♥','✓','→','-'];
export function showBulletGallery(services:CommandServices,anchor:HTMLElement|undefined,settings:()=>void):void{
 if(closeCurrent){closeCurrent();return;}
 const input=services.getInputHandler();if(!input)return;
 const popup=document.createElement('div');popup.className='pwh-bullet-gallery';popup.setAttribute('role','dialog');popup.setAttribute('aria-label','글머리표 선택');
 const close=()=>{popup.remove();document.removeEventListener('mousedown',outside);window.removeEventListener('resize',close);closeCurrent=null;};
 const outside=(event:MouseEvent)=>{if(!popup.contains(event.target as Node)&&!anchor?.contains(event.target as Node))close();};
 const section=(title:string,values:string[],none=false)=>{
  const heading=document.createElement('div');heading.className='pwh-bullet-heading';heading.textContent=title;popup.append(heading);const grid=document.createElement('div');grid.className='pwh-bullet-grid';popup.append(grid);
  for(const value of [...(none?['']:[]),...values]){
   const button=document.createElement('button');button.type='button';button.className='pwh-bullet-choice';button.title=value||'글머리표 없음';button.setAttribute('aria-label',button.title);button.dataset.bullet=value;
   if(!value){button.textContent='없음';button.classList.add('pwh-bullet-none');}else for(let i=0;i<3;i++){const row=document.createElement('span');row.className='pwh-bullet-sample';const mark=document.createElement('span');mark.textContent=value;const line=document.createElement('i');row.append(mark,line);button.append(row);}
   button.addEventListener('mousedown',event=>event.preventDefault());button.addEventListener('click',()=>{close();if(value){input.applyBullet(value);const at=recent.indexOf(value);if(at>=0)recent.splice(at,1);recent.unshift(value);recent.splice(6);}else input.applyParaPropsAtCursor({headType:'None',numberingId:0});input.focus();});grid.append(button);
  }
 };
 if(recent.length)section('최근 사용한 항목',recent);
 section('글머리표',bullets,true);section('확인용 글머리표',['□','☑','○','⊙','✓']);
 const footer=document.createElement('button');footer.type='button';footer.className='pwh-bullet-settings';footer.textContent='글머리표 모양…';footer.addEventListener('mousedown',event=>event.preventDefault());footer.addEventListener('click',()=>{close();settings();});popup.append(footer);
 document.body.append(popup);const fallback=document.querySelector<HTMLElement>('[data-menu="format"] .menu-title')||document.getElementById('menu-bar')!;
 const preferred=anchor?.getBoundingClientRect();const r=preferred&&preferred.width>0&&preferred.height>0?preferred:fallback.getBoundingClientRect();const width=Math.min(360,innerWidth-16);popup.style.width=width+'px';popup.style.left=Math.max(8,Math.min(r.left,innerWidth-width-8))+'px';const top=Math.max(8,Math.min(r.bottom+3,innerHeight-200));popup.style.top=top+'px';popup.style.maxHeight=Math.max(160,innerHeight-top-8)+'px';
 closeCurrent=close;document.addEventListener('mousedown',outside);window.addEventListener('resize',close);
 popup.querySelector<HTMLButtonElement>('.pwh-bullet-choice')?.focus({preventScroll:true});
 popup.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();input.focus();return;}if(!['ArrowRight','ArrowLeft','ArrowDown','ArrowUp'].includes(event.key))return;event.preventDefault();event.stopPropagation();const buttons=[...popup.querySelectorAll<HTMLButtonElement>('.pwh-bullet-choice')],at=buttons.indexOf(document.activeElement as HTMLButtonElement),step=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:event.key==='ArrowDown'?5:-5;buttons[Math.max(0,Math.min(buttons.length-1,at+step))]?.focus();});
}
