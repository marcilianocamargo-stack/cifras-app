/* Renderização do canto na tela: PDF (via pdf.js) ou imagem.
   As páginas são desenhadas sob demanda, conforme entram na tela. */

const MAX_DPR = 2;

let pdfjs = null;
let session = 0;          // invalida renderizações antigas
let doc = null;           // PDFDocumentProxy atual
let observer = null;
let pageEls = [];
let tasks = new Set();
let zoom = 1;
let container = null;

async function loadPdfjs() {
  if (!pdfjs) {
    pdfjs = await import('../vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
  }
  return pdfjs;
}

export function destroy() {
  session++;
  observer?.disconnect();
  observer = null;
  for (const t of tasks) { try { t.cancel(); } catch {} }
  tasks.clear();
  doc?.destroy?.();
  doc = null;
  pageEls = [];
  if (container) container.innerHTML = '';
}

export function getZoom() { return zoom; }

export function setZoom(z) {
  zoom = Math.min(4, Math.max(0.5, Math.round(z * 10) / 10));
  applyZoom();
  return zoom;
}

function applyZoom() {
  for (const el of pageEls) {
    el.style.width = zoom === 1 ? '100%' : `${zoom * 100}%`;
    el.dataset.rendered = '';           // força redesenho na nova largura
  }
  renderVisible();
}

/** Redesenha o que está visível (usado no zoom e ao girar a tela). */
export function refresh() { applyZoom(); }

function makePage(ratio) {
  const el = document.createElement('div');
  el.className = 'page';
  el.style.aspectRatio = String(ratio);
  el.style.width = zoom === 1 ? '100%' : `${zoom * 100}%`;
  return el;
}

function renderVisible() {
  if (!observer) return;
  for (const el of pageEls) {
    const r = el.getBoundingClientRect();
    const near = r.bottom > -400 && r.top < window.innerHeight + 400;
    if (near && el.dataset.rendered !== '1') drawPage(el);
  }
}

async function drawPage(el) {
  const mySession = session;
  const num = Number(el.dataset.page);
  if (!doc || el.dataset.rendered === '1') return;
  el.dataset.rendered = '1';
  try {
    const page = await doc.getPage(num);
    if (mySession !== session) return;
    const width = el.clientWidth || container.clientWidth;
    const base = page.getViewport({ scale: 1 });
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const viewport = page.getViewport({ scale: (width / base.width) * dpr });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const task = page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport });
    tasks.add(task);
    await task.promise;
    tasks.delete(task);
    if (mySession !== session) return;
    el.replaceChildren(canvas);
  } catch (err) {
    if (err?.name !== 'RenderingCancelledException') {
      el.dataset.rendered = '';
      console.warn('Falha ao desenhar página', num, err);
    }
  }
}

/**
 * Mostra um canto.
 * @returns {Promise<number>} número de páginas
 */
export async function show(song, pagesEl, statusEl) {
  destroy();
  container = pagesEl;
  const mySession = session;
  statusEl.hidden = false;
  statusEl.textContent = 'Abrindo...';

  try {
    if (song.type?.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(song.blob);
      img.alt = song.title;
      img.onload = () => URL.revokeObjectURL(img.src);
      const el = makePage('auto');
      el.style.aspectRatio = '';
      el.dataset.rendered = '1';
      el.append(img);
      pageEls = [el];
      pagesEl.replaceChildren(el);
      statusEl.hidden = true;
      return 1;
    }

    const lib = await loadPdfjs();
    if (mySession !== session) return 0;
    const data = await song.blob.arrayBuffer();
    if (mySession !== session) return 0;

    doc = await lib.getDocument({ data, disableAutoFetch: true, isEvalSupported: false }).promise;
    if (mySession !== session) { doc.destroy(); doc = null; return 0; }

    const frag = document.createDocumentFragment();
    pageEls = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      if (mySession !== session) return 0;
      const vp = page.getViewport({ scale: 1 });
      const el = makePage(vp.width / vp.height);
      el.dataset.page = String(i);
      pageEls.push(el);
      frag.append(el);
    }
    pagesEl.replaceChildren(frag);
    statusEl.hidden = true;

    observer = new IntersectionObserver(
      entries => { for (const e of entries) if (e.isIntersecting) drawPage(e.target); },
      { rootMargin: '400px 0px' }
    );
    for (const el of pageEls) observer.observe(el);
    renderVisible();
    return doc.numPages;
  } catch (err) {
    console.error(err);
    statusEl.hidden = false;
    statusEl.textContent = 'Não consegui abrir este arquivo. Ele pode estar corrompido ou protegido por senha.';
    return 0;
  }
}
