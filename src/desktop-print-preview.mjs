import {createPrintPlan,selectedPrintPages} from './print-plan.mjs';

const CSS=`
body.pwh-print-ui{margin:0;padding:0;display:block;background:#eef1f3;color:#183c4d;font:13px/1.5 "Malgun Gothic","Segoe UI",sans-serif}
.pwh-print-ui *{box-sizing:border-box}
.pwh-print-ui [hidden]{display:none!important}
.pwh-print-shell{position:fixed;inset:0;display:grid;grid-template-columns:300px minmax(0,1fr);grid-template-rows:minmax(0,1fr) auto;background:#fff}
.pwh-print-settings{overflow:auto;padding:24px;border-right:1px solid #e0e7eb}
.pwh-print-settings h1{font-size:21px;line-height:1.4;margin:0 0 6px;font-weight:700}
.pwh-print-filename{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#6c8390;margin-bottom:22px}
.pwh-print-field{display:block;margin:0 0 16px;font-weight:600}
.pwh-print-field>span{display:block;margin-bottom:6px}
.pwh-print-field select,.pwh-print-field input{width:100%;height:36px;border:1px solid #d5dfe4;background:#fff;color:#183c4d;border-radius:6px;padding:0 9px;font:inherit;font-weight:400}
.pwh-print-field input[type=checkbox]{width:16px;height:16px;accent-color:#183c4d;vertical-align:middle;margin-right:7px}
.pwh-print-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.pwh-print-ui button{font:inherit;cursor:pointer;border:1px solid #cad8df;border-radius:6px;background:#fff;color:#183c4d;padding:8px 15px}
.pwh-print-ui button:disabled{opacity:.45;cursor:default}
.pwh-print-ui button:focus-visible,.pwh-print-ui input:focus-visible,.pwh-print-ui select:focus-visible{outline:2px solid #5b9caf;outline-offset:2px}
.pwh-print-details{border-top:1px solid #e4eaed;padding-top:12px;margin-top:6px}
.pwh-print-details summary{cursor:pointer;margin-bottom:12px;color:#527889}
.pwh-print-message{min-height:20px;color:#6c8390;overflow-wrap:anywhere;font-size:12px}
.pwh-print-message[role=alert]{color:#a32d2d}
.pwh-print-preview{min-width:0;display:flex;flex-direction:column;background:#edf0f2;overflow:hidden}
.pwh-print-toolbar{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:12px;min-height:56px;padding:8px 16px;border-bottom:1px solid #dde4e8;background:#f7f9fa}
.pwh-print-toolbar button{height:32px;padding:3px 10px}
.pwh-print-toolbar select{font:inherit;color:inherit;background:transparent;border:1px solid #d3dfe5;border-radius:4px;padding:5px}
.pwh-print-canvas{flex:1;min-height:0;overflow:auto;padding:24px;display:flex;align-items:flex-start;justify-content:center}
.pwh-print-paper-holder{flex:none;position:relative}
.pwh-print-sheet{position:relative;overflow:hidden;background:#fff;color:#000;transform-origin:top left;box-shadow:0 1px 8px #17364d24}
body.pwh-print-ui .pwh-print-sheet .page{position:absolute!important;break-after:auto!important;page-break-after:auto!important;page:auto!important;box-shadow:none!important;transform-origin:top left;overflow:hidden;margin:0!important;padding:0!important}
.pwh-print-footer{grid-column:1/-1;display:flex;align-items:center;gap:10px;justify-content:flex-end;padding:14px 24px;border-top:1px solid #e0e7eb;background:#fff}
.pwh-print-footer .pwh-print-total{flex:1;color:#6c8390;font-size:12px}
.pwh-print-footer .pwh-print-submit{background:#183c4d;border-color:#183c4d;color:white;min-width:88px}
#pwh-print-output,#pwh-print-source{display:none}
@media(max-width:820px){.pwh-print-shell{grid-template-columns:260px minmax(0,1fr)}.pwh-print-settings{padding:18px}.pwh-print-canvas{padding:16px}}
@media print{
 body.pwh-print-ui{display:block;background:white;margin:0!important;padding:0!important}
 .pwh-print-shell,#pwh-print-source{display:none!important}
 #pwh-print-output{display:block!important}
 .pwh-print-sheet{box-shadow:none!important;transform:none!important;break-after:page;page-break-after:always;break-inside:avoid;page-break-inside:avoid}
 .pwh-print-sheet:last-child{break-after:auto;page-break-after:auto}
}
`;

/** A single app-owned print window. Preview and output share the same layout. */
export async function showPwhPrintPreview(view,metadata={}){
 const doc=view.document,native=view.pwhNative;
 if(!native?.getPrinters||!native?.printDocument)throw Error('Pwh 인쇄 연결을 확인하지 못했습니다.');
 const originals=[...doc.querySelectorAll('body>.page')];
 if(!originals.length)throw Error('인쇄할 문서가 없습니다.');
 const pages=originals.map((el,index)=>{
  const style=view.getComputedStyle(el),original=metadata.pages?.[index],physical=metadata.printPages?.[index];
  const snap=value=>Math.round(value*1000)/1000;
  return {widthMm:physical?.widthMm??snap(parseFloat(style.width)*25.4/96),heightMm:physical?.heightMm??snap(parseFloat(style.height)*25.4/96),sectionIndex:original?.sectionIndex??0};
 });
 const context={pages,currentPage:metadata.currentPage||0,selectedPages:metadata.selectedPages||[]};
 const name=metadata.name||doc.title.replace(/\s*[—–-]\s*인쇄.*$/,'');
 doc.title='인쇄';doc.body.className='pwh-print-ui';
 const style=doc.createElement('style');style.textContent=CSS;doc.head.append(style);
 const source=doc.createElement('div');source.id='pwh-print-source';source.append(...originals);
 doc.body.replaceChildren(source);
 const root=doc.createElement('main');root.className='pwh-print-shell';root.innerHTML=`
 <section class="pwh-print-settings" aria-label="인쇄 설정">
  <h1>인쇄</h1><p class="pwh-print-filename"></p>
  <label class="pwh-print-field"><span>프린터</span><select id="pwh-printer" disabled><option>프린터 확인 중…</option></select></label>
  <p id="pwh-printer-status" class="pwh-print-message" aria-live="polite"></p>
  <div class="pwh-print-row">
   <label class="pwh-print-field"><span>인쇄 매수</span><input id="pwh-copies" type="number" min="1" max="999" step="1" value="1"></label>
   <label class="pwh-print-field"><span>쪽 범위</span><select id="pwh-range"><option value="all">모든 쪽</option><option value="current">현재 쪽</option><option value="section">현재 구역</option><option value="through">현재까지</option><option value="from">현재부터</option><option value="selected">선택한 쪽</option><option value="custom">일부</option></select></label>
  </div>
  <label class="pwh-print-field" id="pwh-range-field" hidden><span>인쇄할 쪽</span><input id="pwh-range-text" placeholder="예: 1, 3, 5-7" autocomplete="off"></label>
  <label class="pwh-print-field"><span>용지</span><select id="pwh-paper"><option value="document">문서 크기</option><option>A4</option><option>A3</option><option>A5</option><option>B4</option><option>B5</option><option>Letter</option><option>Legal</option></select></label>
  <div class="pwh-print-row">
   <label class="pwh-print-field"><span>인쇄 방향</span><select id="pwh-orientation"><option value="document">문서에 맞춤</option><option value="portrait">세로</option><option value="landscape">가로</option></select></label>
   <label class="pwh-print-field"><span>색상</span><select id="pwh-color"><option value="color">컬러</option><option value="gray">흑백</option></select></label>
  </div>
  <details class="pwh-print-details"><summary>기타 설정</summary>
   <label class="pwh-print-field"><span>인쇄 크기</span><select id="pwh-fit"><option value="fit">용지에 맞춤</option><option value="actual">실제 크기</option></select></label>
   <label class="pwh-print-field"><span>모아 찍기</span><select id="pwh-per-sheet"><option value="1">1쪽</option><option value="2">2쪽</option><option value="4">4쪽</option><option value="6">6쪽</option><option value="9">9쪽</option><option value="16">16쪽</option></select></label>
   <label class="pwh-print-field"><span>양면 인쇄</span><select id="pwh-duplex"><option value="simplex">단면</option><option value="longEdge">양면 · 긴 쪽 넘김</option><option value="shortEdge">양면 · 짧은 쪽 넘김</option></select></label>
   <label class="pwh-print-field"><input id="pwh-collate" type="checkbox" checked>한 부씩 인쇄</label>
  </details>
  <p id="pwh-print-message" class="pwh-print-message" aria-live="polite"></p>
 </section>
 <section class="pwh-print-preview" aria-label="인쇄 미리보기">
  <nav class="pwh-print-toolbar" aria-label="미리보기 쪽 이동">
   <button type="button" id="pwh-prev" aria-label="이전 용지">‹</button><span id="pwh-sheet-number"></span><button type="button" id="pwh-next" aria-label="다음 용지">›</button>
   <select id="pwh-print-zoom" aria-label="미리보기 확대"><option value="fit">화면에 맞춤</option><option value=".5">50%</option><option value=".75">75%</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option></select>
  </nav>
  <div class="pwh-print-canvas"><div class="pwh-print-paper-holder"></div></div>
 </section>
 <footer class="pwh-print-footer"><span class="pwh-print-total"></span><button type="button" id="pwh-print-cancel">취소</button><button type="button" id="pwh-print-submit" class="pwh-print-submit" disabled>인쇄</button></footer>`;
 doc.body.append(root);const output=doc.createElement('div');output.id='pwh-print-output';doc.body.append(output);
 const $=id=>doc.getElementById(id),message=$('pwh-print-message'),submit=$('pwh-print-submit'),printer=$('pwh-printer'),canvas=root.querySelector('.pwh-print-canvas'),holder=root.querySelector('.pwh-print-paper-holder');
 root.querySelector('.pwh-print-filename').textContent=name;root.querySelector('.pwh-print-filename').title=name;
 $('pwh-range').querySelector('[value=selected]').disabled=!context.selectedPages.length;
 $('pwh-paper').firstElementChild.textContent=`문서 크기 (${pages[0].widthMm.toFixed(1)} × ${pages[0].heightMm.toFixed(1)} mm)`;
 let plan=null,sheetIndex=0,printing=false,finished=false,resolveResult;
 const result=new Promise(resolve=>{resolveResult=resolve;});
 const finish=value=>{if(finished)return;finished=true;resolveResult(value);};
 view.addEventListener('beforeunload',()=>finish({ok:false,cancelled:true}),{once:true});
 $('pwh-print-cancel').onclick=()=>{if(!printing)finish({ok:false,cancelled:true});};
 view.addEventListener('keydown',event=>{if(event.key==='Escape'&&!printing){event.preventDefault();finish({ok:false,cancelled:true});}});
 let cloneId=0;
 function sheetElement(sheet){
  const el=doc.createElement('div');el.className='pwh-print-sheet';el.style.width=sheet.widthMm+'mm';el.style.height=sheet.heightMm+'mm';
  if($('pwh-color').value==='gray')el.style.filter='grayscale(1)';
  for(const placement of sheet.placements){
   const page=originals[placement.pageIndex].cloneNode(true),prefix='pwh-copy-'+(++cloneId)+'-',ids=new Map();
   for(const item of page.querySelectorAll('[id]')){ids.set(item.id,prefix+item.id);item.id=prefix+item.id;}
   for(const item of page.querySelectorAll('*'))for(const attribute of [...item.attributes]){
    let value=attribute.value;
    for(const [oldId,newId] of ids){if(value==='#'+oldId)value='#'+newId;value=value.replaceAll('url(#'+oldId+')','url(#'+newId+')').replaceAll('url("#'+oldId+'")','url("#'+newId+'")').replaceAll("url('#"+oldId+"')","url('#"+newId+"')");}
    if(value!==attribute.value)item.setAttribute(attribute.name,value);
   }
   page.style.width=placement.widthMm+'mm';page.style.height=placement.heightMm+'mm';page.style.left=placement.leftMm+'mm';page.style.top=placement.topMm+'mm';page.style.transform=`scale(${placement.scale})`;page.dataset.pwhPage=String(placement.pageIndex+1);el.append(page);
  }
  return el;
 }
 function zoomPreview(){
  const sheet=holder.firstElementChild;if(!sheet||!plan)return;
  const w=plan.widthMm*96/25.4,h=plan.heightMm*96/25.4,chosen=$('pwh-print-zoom').value;
  const inset=view.innerWidth<=820?32:48;
  const scale=chosen==='fit'?Math.max(.05,Math.min((canvas.clientWidth-inset)/w,(canvas.clientHeight-inset)/h)):Number(chosen);
  sheet.style.transform=`scale(${scale})`;holder.style.width=w*scale+'px';holder.style.height=h*scale+'px';
 }
 function render(){
  if(finished)return;
  $('pwh-range-field').hidden=$('pwh-range').value!=='custom';message.textContent='';message.removeAttribute('role');
  try{
   const copies=Number($('pwh-copies').value);if(!Number.isInteger(copies)||copies<1||copies>999)throw Error('인쇄 매수는 1~999를 입력해 주세요.');
   const indexes=selectedPrintPages($('pwh-range').value,context,$('pwh-range-text').value);
   plan=createPrintPlan(pages,indexes,{paper:$('pwh-paper').value,orientation:$('pwh-orientation').value,fit:$('pwh-fit').value,perSheet:Number($('pwh-per-sheet').value)});
   sheetIndex=Math.min(sheetIndex,plan.sheets.length-1);holder.replaceChildren(sheetElement(plan.sheets[sheetIndex]));
   const numbers=plan.sheets[sheetIndex].placements.map(p=>p.pageIndex+1).join(', ');
   $('pwh-sheet-number').textContent=`${sheetIndex+1} / ${plan.sheets.length} 용지 · ${numbers}쪽`;
   $('pwh-prev').disabled=sheetIndex===0;$('pwh-next').disabled=sheetIndex===plan.sheets.length-1;
   root.querySelector('.pwh-print-total').textContent=`${plan.pageCount}쪽 · ${copies}부 · ${plan.sheets.length*copies}면`;
   submit.disabled=printing||printer.disabled||!printer.value;zoomPreview();
  }catch(error){plan=null;submit.disabled=true;holder.replaceChildren();message.setAttribute('role','alert');message.textContent=error.message;}
 }
 root.querySelectorAll('select,input').forEach(el=>{el.addEventListener('change',render);if(el.tagName==='INPUT')el.addEventListener('input',render);});
 $('pwh-prev').onclick=()=>{sheetIndex--;render();};$('pwh-next').onclick=()=>{sheetIndex++;render();};
 const resize=new view.ResizeObserver(zoomPreview);resize.observe(canvas);result.finally(()=>resize.disconnect());
 submit.onclick=async()=>{
  render();if(!plan||submit.disabled||printing)return;printing=true;submit.disabled=true;
  root.querySelectorAll('input,select,button').forEach(el=>{el.disabled=true;});message.textContent='프린터로 전송하고 있습니다.';
  try{
   output.replaceChildren(...plan.sheets.map(sheetElement));
   const rules=doc.createElement('style');rules.id='pwh-print-sheet-rules';rules.textContent=`@page pwh-output { size:${plan.widthMm}mm ${plan.heightMm}mm; margin:0; } #pwh-print-output .pwh-print-sheet {page:pwh-output;}`;doc.getElementById(rules.id)?.remove();doc.head.append(rules);
   await doc.fonts.ready;await new Promise(resolve=>view.requestAnimationFrame(()=>view.requestAnimationFrame(resolve)));
   const response=await native.printDocument({printer:printer.value,copies:Number($('pwh-copies').value),collate:$('pwh-collate').checked,color:$('pwh-color').value==='color',duplexMode:$('pwh-duplex').value,paper:{width:Math.round(plan.widthMm*1000),height:Math.round(plan.heightMm*1000)},jobName:name});
   if(response?.ok){finish({ok:true});return;}
   throw Error(response?.cancelled?'인쇄를 취소했습니다.':response?.error||'인쇄하지 못했습니다. 프린터 상태를 확인해 주세요.');
  }catch(error){message.setAttribute('role','alert');message.textContent=error.message;}
  finally{printing=false;root.querySelectorAll('input,select,button').forEach(el=>{el.disabled=false;});$('pwh-range').querySelector('[value=selected]').disabled=!context.selectedPages.length;submit.disabled=!plan||!printer.value;$('pwh-prev').disabled=sheetIndex===0;$('pwh-next').disabled=!plan||sheetIndex===plan.sheets.length-1;}
 };
 render();await native.showPrintWindow();
 try{
  const devices=await native.getPrinters();if(finished)return result;printer.replaceChildren();
  for(const device of devices){const option=doc.createElement('option');option.value=device.name;option.textContent=device.displayName||device.name;option.selected=device.isDefault===true;printer.append(option);}
  printer.disabled=!devices.length;$('pwh-printer-status').textContent=devices.length?'': '설치된 프린터가 없습니다. Windows에서 프린터를 추가해 주세요.';
  if(!devices.length){const option=doc.createElement('option');option.textContent='프린터 없음';option.value='';printer.append(option);}
  render();
 }catch(error){$('pwh-printer-status').textContent='프린터 목록을 불러오지 못했습니다. 창을 닫고 다시 시도해 주세요.';}
 return result;
}
