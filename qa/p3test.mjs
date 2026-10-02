// usage: node qa/p3test.mjs [base]   p. ej. https://www.connectingcuba.com/  o  http://127.0.0.1:8787/ (wrangler dev)
// P3: remolques, galería (filtros, Cargar más, visor, videos), accesibilidad y respaldo. Requiere Chrome instalado.
// qa/ está en .assetsignore: no se publica en el sitio.
import { spawn } from 'node:child_process';
import os from 'node:os';
const BASE = process.argv[2] || 'http://localhost:5500/';
const SCR = `${os.tmpdir().replace(/\\/g, '/')}/connectingcuba-qa`; // perfil temporal de Chrome
const PORT = 9345;
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=${SCR}/chrome-p3test`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl; for (let i = 0; i < 50 && !wsUrl; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); wsUrl = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!wsUrl) await sleep(200); }
const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pend = new Map(); const jsErrors = []; let netLog = []; const netBad = [];
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') jsErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Network.requestWillBeSent') netLog.push(m.params.request.url);
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) netBad.push(m.params.response.status + ' ' + m.params.response.url); });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description + '\n' + expr.slice(0, 200)); return r.result?.result?.value; };
const key = async (k, code, kc, mods = 0, text) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: kc, modifiers: mods, ...(text ? { text } : {}) }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: kc, modifiers: mods }); };
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
const results = []; let fails = 0;
const check = (name, cond, detail = '') => { results.push(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!cond) fails++; };
const setVP = (w, h = 900, landscape = false) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 || landscape, ...(landscape ? { screenOrientation: { type: 'landscapePrimary', angle: 90 } } : { screenOrientation: { type: 'portraitPrimary', angle: 0 } }) });
const load = async (hash, w = 1440, h = 900, landscape = false) => { await setVP(w, h, landscape); await send('Page.navigate', { url: 'about:blank' }); await sleep(80); netLog = []; await send('Page.navigate', { url: BASE + '#' + hash }); await sleep(1500); await ev('document.fonts.ready.then(() => 1)'); await ev(`document.querySelectorAll('.reveal').forEach(e => e.classList.add('in')); 1`); await sleep(650); };
const H = `const q = s => document.querySelector(s); const $$ = s => [...document.querySelectorAll(s)]; const R = el => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const noOverflow = () => { const de = document.documentElement; document.body.style.overflowX = 'visible'; const ok = de.scrollWidth <= de.clientWidth; const sw = de.scrollWidth, cw = de.clientWidth; document.body.style.overflowX = ''; return { ok, sw, cw }; };
  const lbOpen = () => !q('#lightbox').hidden; const fabShown = () => getComputedStyle(q('.fab')).visibility !== 'hidden';
  const showRemolques = () => { document.querySelectorAll('[data-page]').forEach(el => { el.hidden = el.dataset.page !== 'remolques'; }); $$('#remolques .reveal').forEach(e => e.classList.add('in')); };
  const galCols = () => getComputedStyle(q('#gal-grid')).gridTemplateColumns.split(' ').length;`;
const X = code => ev(`(async () => { ${H}; ${code} })()`);
const WIDTHS = [1920, 1440, 1280, 1024, 834, 768, 430, 390, 360];

// ===== Performance: nada pesado de la galería al abrir Inicio =====
await load('inicio');
await sleep(800);
const heavyOnHome = netLog.filter(u => /img\/(puertos|entregas|video-posters|trailer-)|\.mp4/.test(u));
check('Rendimiento: Inicio no descarga fotos, pósters, remolques ni videos de la galería', heavyOnHome.length === 0, heavyOnHome.slice(0, 3).join(' '));

// ===== A/B. Remolques (sección oculta por diseño; se fuerza su visualización) =====
for (const w of WIDTHS) {
  await load('inicio', w);
  const r = await X(`showRemolques(); await new Promise(r => setTimeout(r, 100)); const lazyAttrs = $$('.trailer-card img').every(i => i.getAttribute('width') && i.getAttribute('height') && i.getAttribute('loading') === 'lazy' && i.getAttribute('decoding') === 'async'); await Promise.all($$('#remolques img').map(i => { i.loading = 'eager'; return i.decode().catch(() => {}); }));
    const cards = $$('.trailer-card'); const imgs = $$('.trailer-card img');
    const cols = getComputedStyle(q('.trailer-grid')).gridTemplateColumns.split(' ').length;
    const rows = [...new Set(cards.map(c => Math.round(c.getBoundingClientRect().top)))];
    const rowH = rows.map(t => [...new Set(cards.filter(c => Math.round(c.getBoundingClientRect().top) === t).map(c => Math.round(c.getBoundingClientRect().height)))].length);
    return { cols, rows: rows.length, sameHeightPerRow: rowH.every(n => n === 1), ratios: imgs.map(i => +(i.getBoundingClientRect().width / i.getBoundingClientRect().height).toFixed(2)), fit: imgs.every(i => getComputedStyle(i).objectFit === 'cover'), attrs: lazyAttrs, titles: $$('.trailer-card h3').map(h => h.textContent).join('|'), ov: noOverflow() };`);
  const expCols = w >= 900 ? 4 : w >= 640 ? 2 : 1;
  check(`${w < 768 ? 'B' : 'A'} Remolques ${w}px`, r.cols === expCols && r.sameHeightPerRow && r.ratios.every(x => Math.abs(x - 1.6) < 0.02) && r.fit && r.attrs && r.ov.ok && r.titles === 'Low Bed Trailer|Flatbed Trailer|Fuel Tanker Trailer|Cargo Trailer', `${r.cols} col, ${r.rows} filas, proporción ${r.ratios[0]}`);
  // Respaldo (en Grupo)
  await load('grupo', w);
  const t = await X(`return { cols: getComputedStyle(q('.trust .wrap')).gridTemplateColumns.split(' ').length, svgHidden: $$('.trust svg').every(s => s.getAttribute('aria-hidden') === 'true'), ov: noOverflow() }`);
  check(`Respaldo (3 bloques) ${w}px`, t.cols === (w >= 800 ? 3 : 1) && t.svgHidden && t.ov.ok, `${t.cols} col`);
}

// ===== C–F. Galería =====
// Comportamiento aprobado (f9999ef / 912cdb5): cada carga revela ~12 y se redondea HACIA ARRIBA a filas completas según las
// columnas reales de la cuadrícula; solo la última carga, sin más contenido, puede dejar la fila a medias. Entregas: 5 videos fijos.
const PAGE = 12, TOTAL = { puerto: 82, entregas: 90, proceso: 52 }, VIDEOS_ENTREGAS = 5;
const firstPage = (total, cols) => Math.min(total, Math.ceil(PAGE / cols) * cols);
const nextPage = (shown, total, cols) => Math.min(total, Math.ceil((shown + PAGE) / cols) * cols);
const seqFrom = (start, total, cols) => { const s = []; for (let n = start; n < total;) { n = nextPage(n, total, cols); s.push(n); } return s; };
await load('galeria');
const c0 = await X(`return { pressed: $$('.gal-tab').map(t => t.dataset.gal + ':' + t.getAttribute('aria-pressed') + ':' + t.classList.contains('active')), role: q('.gal-tabs').getAttribute('role'), noTab: !q('[role=tab]'), items: $$('#gal-grid .gal-item').length, more: !q('#gal-more').hidden, cols: galCols() }`);
check(`C estado inicial: "Vehículos en los puertos" activo, primera página completada a filas (${firstPage(TOTAL.puerto, c0.cols)} fotos con ${c0.cols} columnas), Cargar más visible`, c0.pressed.join() === 'puerto:true:true,entregas:false:false,proceso:false:false' && c0.items === firstPage(TOTAL.puerto, c0.cols) && c0.items % c0.cols === 0 && c0.more && c0.role === 'group' && c0.noTab, `${c0.items} fotos · ${c0.cols} columnas`);
const cats = await X(`const out = {}; for (const [g, re] of [['entregas', /img\\/galeria\\/miniaturas\\/entregas\\//], ['proceso', /operaciones-/], ['puerto', /img\\/galeria\\/miniaturas\\/puertos\\//]]) { q('.gal-tab[data-gal=' + g + ']').click(); await new Promise(r => setTimeout(r, 100));
    const media = $$('#gal-grid img, #gal-grid video source').map(e => e.getAttribute('src'));
    out[g] = { n: media.length, cols: galCols(), allMatch: media.every(s => re.test(s)), videosTop: $$('#gal-videos video').length, topHidden: q('#gal-videos').hidden, pressed: $$('.gal-tab[aria-pressed=true]').map(t => t.dataset.gal).join(), active: $$('.gal-tab.active').map(t => t.dataset.gal).join(), more: !q('#gal-more').hidden }; } return out;`);
check(`C filtro Entregas: primera página completada a filas (${firstPage(TOTAL.entregas, cats.entregas.cols)} fotos) + ${VIDEOS_ENTREGAS} videos fijos arriba`, cats.entregas.n === firstPage(TOTAL.entregas, cats.entregas.cols) && cats.entregas.allMatch && cats.entregas.videosTop === VIDEOS_ENTREGAS && !cats.entregas.topHidden && cats.entregas.pressed === 'entregas' && cats.entregas.active === 'entregas', JSON.stringify(cats.entregas));
check(`C filtro Video del proceso: primera página completada a filas (${firstPage(TOTAL.proceso, cats.proceso.cols)} videos de operaciones)`, cats.proceso.n === firstPage(TOTAL.proceso, cats.proceso.cols) && cats.proceso.allMatch && cats.proceso.topHidden && cats.proceso.pressed === 'proceso', JSON.stringify(cats.proceso));
check(`C filtro Puertos: vuelve a su primera página (${firstPage(TOTAL.puerto, cats.puerto.cols)} fotos de puertos)`, cats.puerto.n === firstPage(TOTAL.puerto, cats.puerto.cols) && cats.puerto.allMatch && cats.puerto.topHidden && cats.puerto.pressed === 'puerto');
const d = await X(`const start = $$('#gal-grid .gal-item').length, cols = galCols(); const counts = []; let guard = 0; while (!q('#gal-more').hidden && guard++ < 20) { const y0 = scrollY; q('#gal-more').click(); await new Promise(r => setTimeout(r, 60)); counts.push($$('#gal-grid .gal-item').length); }
  const idx = $$('#gal-grid .gal-item').map(b => +b.dataset.index); const srcs = $$('#gal-grid img').map(i => i.getAttribute('src'));
  return { start, cols, counts, total: idx.length, inOrder: idx.every((v, i) => v === i), unique: new Set(srcs).size === srcs.length, last: srcs[srcs.length - 1], moreHidden: q('#gal-more').hidden };`);
const dExp = seqFrom(d.start, TOTAL.puerto, d.cols);
check(`D Cargar más en Puertos: cada carga termina en fila completa hasta el final (${[d.start, ...dExp].join('→')}), sin duplicados ni saltos`, d.start === firstPage(TOTAL.puerto, d.cols) && JSON.stringify(d.counts) === JSON.stringify(dExp) && d.counts.slice(0, -1).every(n => n % d.cols === 0) && d.total === TOTAL.puerto && d.inOrder && d.unique, `${d.cols} columnas · ${[d.start, ...d.counts].join('→')}`);
check('E fin de contenido: Cargar más desaparece con el último elemento', d.moreHidden && d.last === 'img/galeria/miniaturas/puertos/puerto-82.jpg');
const f = await X(`q('.gal-tab[data-gal=entregas]').click(); await new Promise(r => setTimeout(r, 80)); const a = { n: $$('#gal-grid .gal-item').length, cols: galCols(), more: !q('#gal-more').hidden, allEnt: $$('#gal-grid img').every(i => /entregas/.test(i.src)) };
  const firstVideo = q('#gal-videos video'); firstVideo.__marker = 1; q('#gal-more').click(); await new Promise(r => setTimeout(r, 80));
  const b = { n: $$('#gal-grid .gal-item').length, sameVideo: q('#gal-videos video').__marker === 1, allEnt: $$('#gal-grid img').every(i => /entregas/.test(i.src)) };
  q('.gal-tab[data-gal=puerto]').click(); await new Promise(r => setTimeout(r, 80)); const c = { n: $$('#gal-grid .gal-item').length, cols: galCols(), allPuerto: $$('#gal-grid img').every(i => /puertos/.test(i.src)) };
  q('.gal-tab[data-gal=puerto]').click(); const same = $$('#gal-grid .gal-item').length; return { a, b, c, same };`);
check('F cambiar filtro tras Cargar más: reinicia a su primera página (completada a filas) y sin items de otra categoría', f.a.n === firstPage(TOTAL.entregas, f.a.cols) && f.a.allEnt && f.b.n === nextPage(f.a.n, TOTAL.entregas, f.a.cols) && f.b.allEnt && f.c.n === firstPage(TOTAL.puerto, f.c.cols) && f.c.allPuerto, JSON.stringify(f));
check('F Cargar más no destruye los videos en reproducción', f.b.sameVideo);
const sc = await X(`window.scrollTo({top: 0, behavior: 'instant'}); q('#gal-more').scrollIntoView({block: 'center', behavior: 'instant'}); await new Promise(r => setTimeout(r, 100)); const y0 = scrollY; q('#gal-more').focus(); q('#gal-more').click(); await new Promise(r => setTimeout(r, 200)); return { y0, y1: scrollY, focus: document.activeElement.id }`);
check('D Cargar más no mueve el scroll', Math.abs(sc.y1 - sc.y0) <= 2 && sc.focus === 'gal-more', `${sc.y0}→${sc.y1}`);
await X(`q('#gal-more').focus(); return 1`);
const beforeKb = await X(`return { n: $$('#gal-grid .gal-item').length, cols: galCols(), tab: q('.gal-tab.active').dataset.gal }`);
await key('Enter', 'Enter', 13, 0, '\r'); await sleep(150);
const afterKb = await X(`return { n: $$('#gal-grid .gal-item').length, outline: getComputedStyle(q('#gal-more')).outlineStyle }`);
check('D Cargar más con teclado y foco visible (la carga termina en fila completa)', afterKb.n === nextPage(beforeKb.n, TOTAL[beforeKb.tab], beforeKb.cols) && afterKb.n > beforeKb.n && afterKb.outline !== 'none', `${beforeKb.n}→${afterKb.n} · ${beforeKb.cols} columnas`);
await ev(`document.querySelector('.gal-tab[data-gal=entregas]').focus()`);
await key(' ', 'Space', 32, 0, ' '); await sleep(150);
const kbTab = await X(`return { pressed: q('.gal-tab[data-gal=entregas]').getAttribute('aria-pressed'), outline: getComputedStyle(document.activeElement).outlineStyle }`);
check('C filtros con teclado (Espacio) y foco visible', kbTab.pressed === 'true' && kbTab.outline !== 'none');

// ===== G–L. Lightbox =====
await load('galeria');
const g = await X(`const btn = $$('#gal-grid .gal-item')[3]; btn.focus(); btn.click(); await new Promise(r => setTimeout(r, 400));
  return { open: lbOpen(), role: q('#lightbox').getAttribute('role'), modal: q('#lightbox').getAttribute('aria-modal'), label: q('#lightbox').getAttribute('aria-label'), src: q('#lightbox-img').getAttribute('src'), alt: q('#lightbox-img').alt, focus: document.activeElement.id, bodyOv: getComputedStyle(document.body).overflowY, inert: !!q('#galeria').closest('[inert]'), fab: fabShown(), labels: $$('#lightbox button').map(b => b.getAttribute('aria-label')).join('|') }`);
check('G abrir foto: diálogo modal, foco en Cerrar, fondo inerte y sin scroll', g.open && g.role === 'dialog' && g.modal === 'true' && g.label && g.src === 'img/puertos/puerto-04.jpg' && g.alt.length > 5 && g.focus === 'lightbox-close' && g.bodyOv === 'hidden' && g.inert, JSON.stringify(g));
check('G controles con nombre accesible', g.labels === 'Cerrar|Foto anterior|Foto siguiente');
check('X WhatsApp oculto con el visor abierto', !g.fab);
const tabs = []; for (let i = 0; i < 5; i++) { await key('Tab', 'Tab', 9); await sleep(30); tabs.push(await ev('document.activeElement.id')); }
for (let i = 0; i < 2; i++) { await key('Tab', 'Tab', 9, 8); await sleep(30); tabs.push(await ev('document.activeElement.id')); }
check('J TAB/Shift+TAB no escapa del visor', tabs.every(t => t.startsWith('lightbox-')), tabs.join(' → '));
const k = await X(`q('#lightbox-next').click(); const a = q('#lightbox-img').getAttribute('src'); q('#lightbox-prev').click(); q('#lightbox-prev').click(); const b = q('#lightbox-img').getAttribute('src'); return { a, b }`);
check('K siguiente / anterior', k.a === 'img/puertos/puerto-05.jpg' && k.b === 'img/puertos/puerto-03.jpg', `${k.a} / ${k.b}`);
await key('ArrowRight', 'ArrowRight', 39); await sleep(50);
const ka = await X(`return q('#lightbox-img').getAttribute('src')`);
check('K flechas del teclado navegan', ka === 'img/puertos/puerto-04.jpg', ka);
await key('Escape', 'Escape', 27); await sleep(100);
const i1 = await X(`return { open: lbOpen(), focus: document.activeElement.className + ':' + document.activeElement.dataset.index, bodyOv: getComputedStyle(document.body).overflowY, inert: !!q('#galeria').closest('[inert]'), pad: document.body.style.paddingRight }`);
check('I ESC cierra y devuelve el foco a la foto que lo abrió', !i1.open && i1.focus === 'gal-item:3' && i1.bodyOv !== 'hidden' && !i1.inert && i1.pad === '', JSON.stringify(i1));
const l = await X(`$$('#gal-grid .gal-item')[0].click(); await new Promise(r => setTimeout(r, 100)); q('#lightbox-prev').click(); const last = q('#lightbox-img').getAttribute('src'); q('#lightbox-next').click(); const first = q('#lightbox-img').getAttribute('src'); q('#lightbox-close').click(); await new Promise(r => setTimeout(r, 100)); return { last, first, open: lbOpen(), focus: document.activeElement.dataset.index }`);
check('L primero ↔ último (navegación circular, comportamiento actual)', l.last === 'img/puertos/puerto-82.jpg' && l.first === 'img/puertos/puerto-01.jpg');
check('H botón Cerrar cierra y devuelve el foco', !l.open && l.focus === '0');
const bd = await X(`$$('#gal-grid .gal-item')[1].click(); await new Promise(r => setTimeout(r, 100)); q('#lightbox').dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise(r => setTimeout(r, 100)); return { open: lbOpen() }`);
check('H clic en el fondo cierra', !bd.open);
const ge = await X(`q('.gal-tab[data-gal=entregas]').click(); await new Promise(r => setTimeout(r, 80)); $$('#gal-grid .gal-item')[2].click(); await new Promise(r => setTimeout(r, 100)); const s = q('#lightbox-img').getAttribute('src'); q('#lightbox-close').click(); return s`);
check('G abrir foto de Entregas', ge === 'img/entregas/entrega-03.jpg', ge);
// M. Video
await load('galeria'); netLog = [];
const m = await X(`q('.gal-tab[data-gal=proceso]').click(); await new Promise(r => setTimeout(r, 500)); const vids = $$('#gal-grid video'); return { n: vids.length, cols: galCols(), preload: vids.every(v => v.getAttribute('preload') === 'none'), poster: vids.every(v => v.getAttribute('poster')), autoplay: vids.some(v => v.autoplay), label: vids.every(v => /Video del proceso \\d+/.test(v.getAttribute('aria-label'))), controls: vids.every(v => v.controls), buttonsInGrid: $$('#gal-grid .gal-item').length }`);
await sleep(800);
const mp4 = netLog.filter(u => /\.mp4/.test(u));
check('M videos: controles, sin autoplay, preload=none con póster, sin descargar .mp4 hasta reproducir', m.n === firstPage(TOTAL.proceso, m.cols) && m.preload && m.poster && !m.autoplay && m.label && m.controls && mp4.length === 0, `mp4 descargados=${mp4.length}`);
check('M los videos se reproducen en línea (el visor es solo para fotos, como antes)', m.buttonsInGrid === 0);

// ===== N/O. Visor en móvil =====
for (const [w, h, land] of [[430, 900, false], [390, 844, false], [360, 740, false], [740, 360, true], [844, 390, true]]) {
  await load('galeria', w, h, land);
  for (const idx of [0, 1]) {
    const r = await X(`$$('#gal-grid .gal-item')[${idx}].click(); await q('#lightbox-img').decode().catch(() => {}); await new Promise(r => setTimeout(r, 150));
      const vw = document.documentElement.clientWidth, vh = innerHeight; const img = R(q('#lightbox-img')); const ctrls = $$('#lightbox button').map(R);
      const inside = b => b.l >= 0 && b.t >= 0 && b.r <= vw + .5 && b.b <= vh + .5; const inter = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
      const res = { imgInside: inside(img), ctrlsInside: ctrls.every(inside), minTarget: Math.min(...ctrls.map(c => Math.min(c.w, c.h))), overlapsImg: ctrls.filter(c => inter(c, img)).length, img: [Math.round(img.w), Math.round(img.h)] };
      q('#lightbox-close').click(); await new Promise(r => setTimeout(r, 80)); return res;`);
    check(`${land ? 'O' : 'N'} visor ${w}x${h} (foto ${idx ? 'vertical/otra' : '1'})`, r.imgInside && r.ctrlsInside && r.minTarget >= 42 && (land || r.overlapsImg === 0), `img ${r.img.join('x')}, controles sobre la foto=${r.overlapsImg}`);
  }
}

// ===== P–R. FAQ =====
await load('preguntas-frecuentes');
const p = await X(`const ds = $$('#preguntas-frecuentes details'); const res = ds.map(d => { const s = d.querySelector('summary'); s.click(); const openVisible = d.open && [...d.querySelectorAll('p')].every(p => p.checkVisibility()); s.click(); const closedHidden = !d.open && [...d.querySelectorAll('p')].every(p => !p.checkVisibility()); return openVisible && closedHidden; });
  const nums = ds.map(d => parseInt(d.querySelector('summary').textContent, 10)); ds[0].open = true; ds[1].open = true; const multi = ds[0].open && ds[1].open; ds.forEach(d => d.open = false);
  return { n: ds.length, allToggle: res.every(Boolean), nums: nums.join(','), blocks: $$('.faq-block-title').map(b => b.textContent.split('·')[0].trim()).join('|'), multi, initialClosed: true }`);
check('P 21 preguntas, cada una abre y cierra con contenido coherente', p.n === 21 && p.allToggle && p.nums === Array.from({ length: 21 }, (_, i) => i + 1).join(','), `bloques: ${p.blocks}`);
check('P se conserva el comportamiento: varias abiertas a la vez', p.multi);
await ev(`document.querySelectorAll('#preguntas-frecuentes summary')[4].focus()`);
await key('Enter', 'Enter', 13, 0, '\r'); await sleep(80);
const q0 = await X(`return { outline: getComputedStyle(document.activeElement).outlineStyle, color: getComputedStyle(document.activeElement).outlineColor }`);
const q1 = await X(`return $$('#preguntas-frecuentes details')[4].open`);
await key(' ', 'Space', 32, 0, ' '); await sleep(80);
const q2 = await X(`return $$('#preguntas-frecuentes details')[4].open`);
check('Q FAQ con teclado: Enter abre, Espacio cierra, foco visible del sitio', q1 === true && q2 === false && q0.outline === 'solid', `${q0.outline} ${q0.color}`);
const scr = await X(`const ds = $$('#preguntas-frecuentes details'); const d = ds[20]; d.scrollIntoView({block: 'end', behavior: 'instant'}); await new Promise(r => setTimeout(r, 100)); const y0 = scrollY; d.querySelector('summary').click(); await new Promise(r => setTimeout(r, 150)); const y1 = scrollY; d.open = false; return { y0, y1 }`);
check('Q abrir una pregunta al final del viewport no desplaza la página', Math.abs(scr.y1 - scr.y0) <= 2, `${scr.y0}→${scr.y1}`);
const r0 = await X(`const links = $$('#preguntas-frecuentes a'); return links.map(a => ({ href: a.getAttribute('href'), target: a.target, rel: a.rel }))`);
check('R enlaces del FAQ: externos con noopener noreferrer', r0.filter(a => a.target === '_blank').every(a => /noopener/.test(a.rel) && /noreferrer/.test(a.rel)) && r0.length === 4, JSON.stringify(r0.map(a => a.href)));
const r1 = await X(`q('#preguntas-frecuentes a[href="#calculadora"]').click(); await new Promise(r => setTimeout(r, 700)); return { vis: !q('#calculadora').hidden, eb: q('#calculadora .eyebrow').getBoundingClientRect().top, hdr: q('header.site').getBoundingClientRect().bottom }`);
check('R "Cotiza tu envío" lleva a Cotizar con el título visible', r1.vis && r1.eb >= r1.hdr, JSON.stringify(r1));

// ===== S/T/U/V. Contacto =====
await load('calculadora');
await X(`q('input[name=cfg-tier][value=regular]').click(); const set = (id, v) => { const e = q('#' + id); e.value = v; e.dispatchEvent(new Event('change')); }; set('cfg-marca', 'TOYOTA'); set('cfg-modelo', '4Runner'); set('cfg-ano', '2024'); return 1`);
await X(`location.hash = 'contacto'; await new Promise(r => setTimeout(r, 600)); return 1`);
const s = await X(`let body; window.fetch = (u, o) => { body = [...o.body.entries()].map(([k]) => k); return Promise.resolve(new Response('{"success":true}')); }; q('#f-name').value = 'A'; q('#f-email').value = 'a@example.com'; q('#contacto-form button[type=submit]').click(); await new Promise(r => setTimeout(r, 200));
  return { keys: body, labels: $$('#contacto-form label').map(l => l.textContent), sentRole: q('#contacto-form .sent').getAttribute('role'), errRole: q('#contacto-form .err').getAttribute('role'), sent: !q('#contacto-form .sent').hidden }`);
check('S formulario Contacto: 4 campos, sin datos del cotizador, mensajes accesibles', JSON.stringify(s.labels) === JSON.stringify(['Nombre', 'Correo electrónico*', 'Asunto', 'Mensaje']) && JSON.stringify(s.keys) === JSON.stringify(['access_key', 'subject', 'name', 'email', 'asunto', 'mensaje']) && s.sentRole === 'status' && s.errRole === 'alert' && s.sent, JSON.stringify(s.keys));
const t = await X(`const card = q('.contact-card'); const links = [...card.querySelectorAll('a')].map(a => ({ href: a.getAttribute('href'), text: a.textContent.replace(/\\s+/g, ' ').trim(), target: a.target, rel: a.rel, h: Math.round(a.getBoundingClientRect().height) }));
  return { links, hours: card.textContent.includes('9:00\\u00a0a.m. a 8:00\\u00a0p.m.'), svgs: [...card.querySelectorAll('svg')].every(s => s.getAttribute('aria-hidden') === 'true') }`);
check('T EE. UU.: teléfono y WhatsApp clicables con los números actuales', t.links[0].href === 'tel:+13056156007,0' && t.links[0].text === '+1 305 615 6007 ext. 0' && t.links[1].href === 'https://wa.me/17865200009' && t.links[1].text.startsWith('+1 786 520 0009') && /noreferrer/.test(t.links[1].rel) && t.links[2].href === 'https://wa.me/17865200009' && /noreferrer/.test(t.links[2].rel) && t.hours && t.svgs, JSON.stringify(t.links.map(x => x.href + ' ' + x.h + 'px')));
const u = await X(`return [...q('.cuba-support-rows').querySelectorAll('a')].map(a => ({ href: a.getAttribute('href'), text: a.textContent.replace(/\\s+/g, ' ').trim(), target: a.target, rel: a.rel }))`);
check('U Cuba: tel, WhatsApp y email correctos', u[0].href === 'tel:+53563687207' && u[0].text === '+53 5 6368 7207' && u[1].href === 'https://wa.me/53563687207' && /noreferrer/.test(u[1].rel) && u[1].target === '_blank' && u[2].href === 'mailto:info@connectingcuba.com' && u[2].text === 'info@connectingcuba.com', JSON.stringify(u.map(x => x.href)));
check('X WhatsApp flotante oculto en Contacto (la página ya tiene sus CTA)', !(await X(`return fabShown()`)));
await load('proceso');
const v = await X(`q('a[href="#soporte-cuba"]').click(); await new Promise(r => setTimeout(r, 1300)); return { top: q('#soporte-cuba').getBoundingClientRect().top, hdr: q('header.site').getBoundingClientRect().bottom }`);
check('V ancla #soporte-cuba sigue llegando bajo el header', v.top >= v.hdr - 1 && v.top < 300, JSON.stringify(v));

// ===== W. Footer =====
await load('inicio');
const wlinks = await X(`return [...document.querySelectorAll('footer a')].map(a => ({ href: a.getAttribute('href'), text: a.textContent.replace(/\\s+/g, ' ').trim(), rel: a.rel, target: a.target, h: Math.round(a.getBoundingClientRect().height) }))`);
const legalOk = await Promise.all(['privacidad', 'terminos'].map(async pg => (await fetch(BASE + pg)).status));
const logo = await X(`const i = q('.footer-badge'); return { w: i.getAttribute('width'), h: i.getAttribute('height'), alt: i.alt, rendered: Math.round(i.getBoundingClientRect().height) }`);
check('W footer: enlaces y destinos', wlinks.map(x => x.href).join(' ') === '#calculadora #vehiculos #preguntas-frecuentes tel:+13056156007,0 https://wa.me/17865200009 #contacto /privacidad /terminos' && legalOk.every(s => s === 200) && /noreferrer/.test(wlinks[4].rel), wlinks.map(x => x.text).join(' | '));
check('W footer: área táctil ≥ 24 px en todos los enlaces', wlinks.every(x => x.h >= 24), wlinks.map(x => x.h).join(','));
const soc = await X(`const row = q('.social-row'); const kids = [...row.children]; return { hidden: row.getAttribute('aria-hidden'), tags: kids.map(k => k.tagName).join(','), focusable: kids.filter(k => k.matches('a, button, [tabindex]') || k.tabIndex >= 0).length, size: kids.map(k => Math.round(k.getBoundingClientRect().width) + 'x' + Math.round(k.getBoundingClientRect().height)).join(','), svgs: kids.every(k => k.querySelector('svg')) }`);
check('W redes sociales sin URL: mismos iconos 34x34, no enfocables ni anunciados como controles', soc.hidden === 'true' && soc.tags === 'SPAN,SPAN,SPAN' && soc.focusable === 0 && soc.size === '34x34,34x34,34x34' && soc.svgs, JSON.stringify(soc));
check('W footer: logo con dimensiones intrínsecas', logo.w === '1024' && logo.h === '1024' && logo.rendered === 78, JSON.stringify(logo));
for (const [label, pg] of [['Configura tu envío', 'calculadora'], ['Vehículos autorizados', 'vehiculos'], ['Preguntas frecuentes', 'preguntas-frecuentes'], ['Formulario', 'contacto']]) {
  await load('inicio');
  const r = await X(`window.scrollTo({top: document.documentElement.scrollHeight, behavior: 'instant'}); [...document.querySelectorAll('footer a')].find(a => a.textContent.trim() === '${label}').click(); await new Promise(r => setTimeout(r, 700)); return { vis: !q('#${pg}').hidden, eb: q('#${pg} .eyebrow').getBoundingClientRect().top, hdr: q('header.site').getBoundingClientRect().bottom }`);
  check(`W footer "${label}" → ${pg} con título visible`, r.vis && r.eb >= r.hdr, JSON.stringify(r));
}

// ===== X. WhatsApp flotante =====
for (const w of [390, 360, 1024, 1440]) {
  await load('galeria', w);
  const r = await X(`const a = fabShown(); window.scrollTo({top: document.documentElement.scrollHeight, behavior: 'instant'}); await new Promise(r => setTimeout(r, 500)); const endShown = fabShown();
    const f = q('.fab').getBoundingClientRect(); const overFooterBottom = [...document.querySelectorAll('.footer-bottom > *')].some(el => { const b = el.getBoundingClientRect(); return b.left < f.right && b.right > f.left && b.top < f.bottom && b.bottom > f.top; });
    location.hash = 'preguntas-frecuentes'; await new Promise(r => setTimeout(r, 500)); const faq = fabShown(); return { a, endShown, overFooterBottom, faq }`);
  check(`X WhatsApp ${w}px: ${w >= 1280 ? 'visible' : 'apartado'} sobre la rejilla de Galería, no tapa el footer, oculto en FAQ`, (w >= 1280 ? r.a : !r.a) && !(r.endShown && r.overFooterBottom) && !r.faq, JSON.stringify(r));
}
await load('galeria', 390);
const xm = await X(`q('#navToggle').click(); await new Promise(r => setTimeout(r, 400)); const m = fabShown(); q('#navToggle').click(); return m`);
check('X WhatsApp oculto con el menú móvil abierto', !xm);

// ===== Y. Overflow en todas las resoluciones =====
for (const w of WIDTHS) {
  const probs = [];
  for (const [hash, setup] of [['galeria', `q('#gal-more').click(); q('#gal-more').click();`], ['galeria', `q('.gal-tab[data-gal=entregas]').click();`], ['galeria', `q('.gal-tab[data-gal=proceso]').click();`], ['preguntas-frecuentes', `$$('#preguntas-frecuentes details').forEach(d => d.open = true);`], ['contacto', ''], ['grupo', ''], ['inicio', `showRemolques();`]]) {
    await load(hash, w);
    const r = await X(`${setup} await new Promise(r => setTimeout(r, 150)); const o = noOverflow(); const cw = document.documentElement.clientWidth; const outside = $$('.cuba-support-item, .contact-row a, footer a, .gal-tab, #gal-more, .trailer-card, .faq-closing .btn').filter(e => e.offsetParent && (e.getBoundingClientRect().right > cw + .5 || e.getBoundingClientRect().left < -.5)).map(e => e.className || e.tagName); return { o, outside }`);
    if (!r.o.ok) probs.push(`${hash}: overflow ${r.o.sw}/${r.o.cw}`);
    if (r.outside.length) probs.push(`${hash}: fuera del contenedor ${r.outside.join(',')}`);
  }
  check(`Y sin overflow ${w}px (galería x3, FAQ abierto, contacto, grupo, remolques)`, probs.length === 0, probs.join('; '));
}
check('Z sin errores JavaScript', jsErrors.length === 0, jsErrors.join(' | '));
check('Sin recursos 404', netBad.length === 0, netBad.slice(0, 5).join(' | '));
console.log(results.join('\n'));
console.log(`\nTOTAL: ${results.length - fails}/${results.length} OK, ${fails} FAIL`);
ws.close(); chrome.kill(); process.exit(0);
