type Inputs = Record<string, HTMLInputElement>;
interface Controls {
  inputs: Inputs;
  width: HTMLInputElement;
  height: HTMLInputElement;
  paper: HTMLSelectElement;
  orientation: HTMLInputElement[];
  binding: HTMLInputElement[];
}
const refreshers = new WeakMap<HTMLElement, () => void>();
const labels: Record<string, string> = {
  marginTop: '위쪽', marginBottom: '아래쪽', marginLeft: '왼쪽', marginRight: '오른쪽',
  marginHeader: '머리말', marginFooter: '꼬리말', marginGutter: '제본',
};
const CSS = `
.pwh-margin-map{display:grid;grid-template-columns:minmax(105px,1fr) minmax(140px,210px) minmax(105px,1fr);gap:9px 12px;align-items:center;padding:8px 0}
.pwh-margin-map .pwh-margin-above{grid-column:2;grid-row:1;display:grid;gap:6px}
.pwh-margin-map .pwh-margin-below{grid-column:2;grid-row:3;display:grid;gap:6px}
.pwh-margin-map .pwh-margin-left{grid-column:1;grid-row:2;display:grid;gap:16px}
.pwh-margin-map .pwh-margin-right{grid-column:3;grid-row:2}
.pwh-margin-map .pwh-margin-paper{grid-column:2;grid-row:2;display:block;width:100%;height:190px}
.pwh-margin-map label{display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center;color:#294b5a;font-size:12px}
.pwh-margin-map label>span:first-child{min-width:40px}.pwh-margin-map input{width:65px!important;min-width:0;box-sizing:border-box}
.pwh-margin-map label:focus-within{color:#086c83;font-weight:600}.pwh-margin-map .pwh-margin-unit{color:#6e858d;font-weight:400}
.pwh-margin-paper [data-margin]{fill:#e9f0f2;stroke:#b9cdd4;stroke-width:.5;cursor:pointer}
.pwh-margin-paper [data-margin].active{fill:#9ad8e3;stroke:#16758a;stroke-width:1.5}
.pwh-margin-paper [data-margin]:focus-visible{outline:2px solid #16758a;outline-offset:1px}
.pwh-margin-note{font-size:11px;color:#677e88;margin:6px 0 0;line-height:1.5}
@media(max-width:520px){.pwh-margin-map{gap:6px;grid-template-columns:minmax(85px,1fr) minmax(110px,1.3fr) minmax(85px,1fr)}.pwh-margin-map input{width:58px!important}.pwh-margin-map .pwh-margin-paper{height:170px}}
`;

/** Reuses the dialog's original inputs and confirm/undo path. */
export function createPwhMarginLayout(controls: Controls): HTMLElement {
  const doc = controls.width.ownerDocument;
  if (!doc.getElementById('pwh-page-margin-style')) {
    const style = doc.createElement('style'); style.id = 'pwh-page-margin-style'; style.textContent = CSS; doc.head.append(style);
  }
  const root = doc.createElement('div'); root.className = 'pwh-margin-map';
  const area = (name: string) => { const node = doc.createElement('div'); node.className = 'pwh-margin-' + name; root.append(node); return node; };
  const above = area('above'), left = area('left'), right = area('right'), below = area('below');
  const fields: Record<string, HTMLLabelElement> = {};
  for (const key of Object.keys(labels)) {
    const field = doc.createElement('label'), text = doc.createElement('span'), unit = doc.createElement('span');
    text.textContent = labels[key]; unit.textContent = 'mm'; unit.className = 'pwh-margin-unit';
    controls.inputs[key].setAttribute('aria-label', labels[key] + ' 여백(mm)');
    field.append(text, controls.inputs[key], unit); fields[key] = field;
  }
  above.append(fields.marginTop, fields.marginHeader); left.append(fields.marginLeft, fields.marginGutter);
  right.append(fields.marginRight); below.append(fields.marginFooter, fields.marginBottom);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(ns, 'svg'); svg.classList.add('pwh-margin-paper'); svg.setAttribute('viewBox', '0 0 220 200');
  svg.setAttribute('aria-label', '용지 여백 위치 미리보기'); root.append(svg);
  const make = (tag: string, attrs: Record<string, string | number>) => {
    const node = doc.createElementNS(ns, tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value)); svg.append(node); return node;
  };
  const paper = make('rect', {fill:'#fff',stroke:'#879ea7','stroke-width':1});
  const bands: Record<string, SVGElement> = {};
  let active = 'marginTop';
  const highlight = (key: string) => { active = key; for (const [name, band] of Object.entries(bands)) band.classList.toggle('active', name === active); };
  for (const key of Object.keys(labels)) {
    const band = make('rect', {'data-margin':key,tabindex:0,role:'button','aria-label':labels[key] + ' 여백 선택'});
    const focus = () => { controls.inputs[key].focus(); controls.inputs[key].select(); };
    band.addEventListener('click', focus); band.addEventListener('focus', () => highlight(key));
    band.addEventListener('keydown', event => { const e = event as KeyboardEvent; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focus(); } });
    controls.inputs[key].addEventListener('focus', () => highlight(key)); bands[key] = band;
  }
  const body = make('rect', {fill:'#fff',stroke:'#506b77','stroke-width':.7,'pointer-events':'none'});
  const lines = Array.from({length:8}, () => make('line', {stroke:'#9aabb2','stroke-width':1,'pointer-events':'none'}));
  const note = doc.createElement('p'); note.className = 'pwh-margin-note'; note.style.gridColumn = '1 / -1';
  note.textContent = '입력 칸이나 그림의 여백을 선택하면 해당 위치가 강조됩니다.'; root.append(note);
  const box = (node: Element, x: number, y: number, w: number, h: number) => {
    for (const [key, value] of Object.entries({x,y,width:Math.max(0,w),height:Math.max(0,h)})) node.setAttribute(key, String(value));
  };
  const render = () => {
    const value = (input: HTMLInputElement) => Math.max(0, parseFloat(input.value) || 0);
    const w = Math.max(1,value(controls.width)), h = Math.max(1,value(controls.height)), scale = Math.min(204 / w,184 / h);
    const x = (220 - w * scale) / 2, y = (200 - h * scale) / 2;
    const m = Object.fromEntries(Object.entries(controls.inputs).map(([key, input]) => [key,value(input)]));
    const topBinding = controls.binding.find(radio => radio.checked)?.value === '2';
    if (topBinding) above.insertBefore(fields.marginGutter, fields.marginHeader); else left.append(fields.marginGutter);
    const gutterX = topBinding ? 0 : m.marginGutter, gutterY = topBinding ? m.marginGutter : 0;
    const bx = m.marginLeft + gutterX, by = m.marginTop + gutterY + m.marginHeader;
    const bw = Math.max(0,w - bx - m.marginRight), bh = Math.max(0,h - by - m.marginBottom - m.marginFooter);
    box(paper,x,y,w*scale,h*scale);
    const band = (key: string, mx: number, my: number, mw: number, mh: number) => box(bands[key],x+mx*scale,y+my*scale,mw*scale,mh*scale);
    band('marginTop',0,0,w,Math.min(h,m.marginTop));
    band('marginBottom',0,Math.max(0,h-m.marginBottom),w,Math.min(h,m.marginBottom));
    band('marginLeft',0,by,Math.min(w,m.marginLeft),bh);
    band('marginRight',Math.max(0,w-m.marginRight),by,Math.min(w,m.marginRight),bh);
    band('marginHeader',bx,m.marginTop+gutterY,bw,m.marginHeader);
    band('marginFooter',bx,Math.max(0,h-m.marginBottom-m.marginFooter),bw,m.marginFooter);
    band('marginGutter',topBinding?0:m.marginLeft,topBinding?m.marginTop:by,topBinding?w:m.marginGutter,topBinding?m.marginGutter:bh);
    box(body,x+bx*scale,y+by*scale,bw*scale,bh*scale);
    lines.forEach((line,i) => {
      const ly = y + (by + bh*(i+1)/10)*scale;
      line.setAttribute('x1',String(x+(bx+bw*.08)*scale)); line.setAttribute('x2',String(x+(bx+bw*(i%3===2?.65:.92))*scale));
      line.setAttribute('y1',String(ly));line.setAttribute('y2',String(ly));
    });
    highlight(active);
  };
  for (const input of [...Object.values(controls.inputs),controls.width,controls.height,controls.paper,...controls.orientation,...controls.binding]) {
    input.addEventListener('input', render); input.addEventListener('change', render);
  }
  refreshers.set(root,render); render(); return root;
}

export function refreshPwhMarginLayout(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.pwh-margin-map').forEach(node => refreshers.get(node)?.());
}
