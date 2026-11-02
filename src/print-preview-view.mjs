/** Screen-only controls. Page boxes and SVG content remain unchanged for print. */
export function installPrintPreviewView(view, printPages = []) {
  // The integrated printer window owns its own preview and zoom controls.
  if (new URLSearchParams(view.location.search).get('pwhDirect') === '1') return;
  const doc = view.document, bar = doc.querySelector('.print-preview-bar');
  const pages = [...doc.querySelectorAll('body > .page')];
  if (!bar || !pages.length || bar.querySelector('[data-pwh-preview-controls]')) return;
  const style = doc.createElement('style');
  style.textContent = `
@media screen {
 body.rhwp-print-preview { align-items:flex-start; padding-top:76px; }
 body.rhwp-print-preview > .page { flex:none; margin-inline:auto; zoom:var(--pwh-preview-scale,1); content-visibility:auto; }
 .print-preview-bar { flex-wrap:wrap; gap:8px; background:#173c4d; }
 .print-preview-bar .print-preview-title { flex:1; min-width:80px; }
 .pwh-preview-controls { display:flex; align-items:center; gap:6px; margin-left:auto; }
 .print-preview-bar .pwh-preview-controls button { min-width:34px; padding:0 8px; }
 .pwh-preview-controls select { font:inherit; height:32px; border:1px solid #647e89; border-radius:5px; background:#fff; color:#173c4d; padding:0 8px; }
 .pwh-preview-controls output { min-width:45px; text-align:center; font-variant-numeric:tabular-nums; }
 .pwh-preview-controls :focus-visible { outline:2px solid #7bd0e0; outline-offset:2px; }
}
@media print {
 body.rhwp-print-preview { padding:0!important; display:block!important; }
 body.rhwp-print-preview > .page { zoom:1!important; content-visibility:visible!important; margin:0!important; }
 .print-preview-bar { display:none!important; }
}`;
  doc.head.append(style);
  const group = doc.createElement('div');
  group.className = 'pwh-preview-controls'; group.dataset.pwhPreviewControls = '';
  group.innerHTML = '<button type="button" aria-label="미리보기 축소" title="축소 (Ctrl+-)">−</button><select aria-label="미리보기 배율"><option value="width">쪽 너비에 맞춤</option><option value="page">한 쪽 전체</option>'
    + [25, 50, 75, 100, 125, 150, 200, 300].map(n => `<option value="${n}">${n}%</option>`).join('')
    + '</select><button type="button" aria-label="미리보기 확대" title="확대 (Ctrl++)">+</button><output aria-label="현재 배율"></output>';
  bar.append(group);
  const [minus, plus] = group.querySelectorAll('button'), select = group.querySelector('select'), output = group.querySelector('output');
  const size = printPages.length ? printPages.map(page => ({width:page.widthMm*96/25.4,height:page.heightMm*96/25.4}))
    : pages.map(page => { const css = view.getComputedStyle(page); return {width:parseFloat(css.width), height:parseFloat(css.height)}; });
  let scale = 1, mode = 'width', pending = 0;
  function apply() {
    pending = 0;
    const width = Math.max(...size.map(s => s.width)), height = Math.max(...size.map(s => s.height));
    const availableWidth = Math.max(1, doc.documentElement.clientWidth - 32);
    const availableHeight = Math.max(1, view.innerHeight - bar.offsetHeight - 48);
    scale = mode === 'width' ? availableWidth / width : mode === 'page' ? Math.min(availableWidth / width, availableHeight / height) : Number(mode) / 100;
    scale = Math.max(.1, Math.min(4, scale));
    doc.body.style.setProperty('--pwh-preview-scale', String(scale));
    doc.body.style.paddingTop = (bar.offsetHeight + 20) + 'px';
    output.value = Math.round(scale * 100) + '%';
    minus.disabled = scale <= .1; plus.disabled = scale >= 4;
  }
  function schedule() { if (!pending) pending = view.requestAnimationFrame(apply); }
  function step(direction) {
    const next = Math.max(10, Math.min(400, Math.round(scale * 100 / 10) * 10 + direction * 10));
    mode = String(next);
    let custom = select.querySelector('[data-custom]');
    if (![...select.options].some(option => option.value === mode)) {
      if (!custom) { custom = doc.createElement('option'); custom.dataset.custom = ''; select.append(custom); }
      custom.value = mode; custom.textContent = next + '%';
    }
    select.value = mode; apply();
  }
  select.value = mode; select.onchange = () => { mode = select.value; apply(); };
  minus.onclick = () => step(-1); plus.onclick = () => step(1);
  const wheel = event => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); step(event.deltaY > 0 ? -1 : 1); } };
  const key = event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); step(event.key === '-' ? -1 : 1); }
    if (event.key === '0') { event.preventDefault(); mode = '100'; select.value = mode; apply(); }
  };
  view.addEventListener('resize', schedule);
  view.addEventListener('wheel', wheel, {passive:false});
  view.addEventListener('keydown', key);
  view.addEventListener('beforeunload', () => {
    view.removeEventListener('resize', schedule); view.removeEventListener('wheel', wheel); view.removeEventListener('keydown', key);
    if (pending) view.cancelAnimationFrame(pending);
  }, {once:true});
  apply();
}
