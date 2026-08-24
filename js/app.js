import * as db from './db.js';
import * as viewer from './viewer.js';

const $ = sel => document.querySelector(sel);
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

const state = {
  songs: [],
  folders: [],
  sort: 'az',
  folderSort: 'manual',
  query: '',
  route: { name: 'songs' },
  navList: [],       // ids na ordem em que o visualizador navega
  navIndex: -1,
  wakeLock: null,
};

/* ---------------------------------------------------------------- utils */

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined) el.append(kid);
  return el;
}

function titleFromFile(name) {
  return name.replace(/\.[^.]+$/, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim() || name;
}

const byTitle = (a, b) => collator.compare(a.title, b.title);

function sortSongs(list, mode) {
  const out = [...list];
  if (mode === 'az') out.sort(byTitle);
  else if (mode === 'za') out.sort((a, b) => byTitle(b, a));
  else if (mode === 'new') out.sort((a, b) => b.addedAt - a.addedAt);
  return out;
}

const songById = id => state.songs.find(s => s.id === id);
const foldersOf = id => state.folders.filter(f => f.songIds.includes(id));

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ---------------------------------------------------------------- sheet */

function closeSheet() {
  $('#sheet').hidden = true;
  $('#sheet').replaceChildren();
  $('#sheet-backdrop').hidden = true;
}

function openSheet(...content) {
  const sheet = $('#sheet');
  sheet.replaceChildren(h('div', { class: 'sheet-grip' }), ...content.filter(Boolean));
  sheet.hidden = false;
  $('#sheet-backdrop').hidden = false;
  sheet.scrollTop = 0;
}

function sheetItem(icon, label, onclick, extra) {
  return h('button', { class: 'sheet-item', onclick },
    h('span', { class: 'row-ico', html: icon }),
    h('span', { class: 'row-text row-title' }, label),
    h('span', { class: 'check', html: extra || '' }));
}

function askText({ title, value = '', ok = 'Salvar', placeholder = '' }) {
  return new Promise(resolve => {
    const input = h('input', { class: 'sheet-input', value, placeholder, enterkeyhint: 'done' });
    const done = v => { closeSheet(); resolve(v); };
    openSheet(
      h('h2', {}, title),
      input,
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn', onclick: () => done(null) }, 'Cancelar'),
        h('button', { class: 'btn btn-primary', onclick: () => done(input.value.trim() || null) }, ok)),
    );
    input.addEventListener('keydown', e => { if (e.key === 'Enter') done(input.value.trim() || null); });
    setTimeout(() => input.focus(), 60);
  });
}

function askConfirm({ title, text, ok = 'Confirmar', danger = false }) {
  return new Promise(resolve => {
    const done = v => { closeSheet(); resolve(v); };
    openSheet(
      h('h2', {}, title),
      text ? h('p', { class: 'muted' }, text) : null,
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn', onclick: () => done(false) }, 'Cancelar'),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => done(true) }, ok)),
    );
  });
}

/* ------------------------------------------------------------ importar */

function pickFiles() {
  $('#file-input').value = '';
  $('#file-input').click();
}

async function onFilesChosen(files) {
  if (!files.length) return;
  const target = await askImportTarget();
  if (target === undefined) return;              // cancelou

  let folder = null;
  if (target === '__new__') {
    const name = await askText({ title: 'Nome da pasta', placeholder: 'Missa de domingo', ok: 'Criar' });
    if (!name) return;
    folder = db.newFolder(name);
    state.folders.push(folder);
  } else if (target) {
    folder = state.folders.find(f => f.id === target) || null;
  }

  const seen = new Set(state.songs.map(s => `${s.fileName}|${s.size}`));
  let added = 0, dup = 0, ignored = 0;

  for (const file of files) {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const isImg = (file.type || '').startsWith('image/');
    if (!isPdf && !isImg) { ignored++; continue; }

    const key = `${file.name}|${file.size}`;
    if (seen.has(key)) {
      dup++;
      if (folder) {
        const existing = state.songs.find(s => `${s.fileName}|${s.size}` === key);
        if (existing && !folder.songIds.includes(existing.id)) folder.songIds.push(existing.id);
      }
      continue;
    }
    seen.add(key);

    const song = db.newSong(file, titleFromFile(file.name));
    await db.putSong(song);
    state.songs.push(song);
    if (folder) folder.songIds.push(song.id);
    added++;
  }

  if (folder) await db.putFolder(folder);
  await keepStorage();

  const parts = [];
  if (added) parts.push(`${added} ${added === 1 ? 'canto carregado' : 'cantos carregados'}`);
  if (dup) parts.push(`${dup} já ${dup === 1 ? 'estava aqui' : 'estavam aqui'}`);
  if (ignored) parts.push(`${ignored} ${ignored === 1 ? 'arquivo ignorado' : 'arquivos ignorados'}`);
  toast(parts.join(' · ') || 'Nada para carregar');

  if (folder && (added || dup)) location.hash = `#/pasta/${folder.id}`;
  else render();
}

function askImportTarget() {
  return new Promise(resolve => {
    const done = v => { closeSheet(); resolve(v); };
    openSheet(
      h('h2', {}, 'Onde colocar estes cantos?'),
      sheetItem('&#9834;', 'Só na biblioteca', () => done(null)),
      state.folders.length ? h('p', { class: 'muted' }, 'Ou dentro de uma pasta:') : null,
      ...state.folders.slice().sort((a, b) => collator.compare(a.name, b.name))
        .map(f => sheetItem('&#128193;', f.name, () => done(f.id))),
      sheetItem('&#10133;', 'Nova pasta...', () => done('__new__')),
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn wide', onclick: () => done(undefined) }, 'Cancelar')),
    );
  });
}

async function keepStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch { /* navegador sem suporte: segue normal */ }
}

/* -------------------------------------------------------------- menus */

function songMenu(song, { folder = null } = {}) {
  openSheet(
    h('h2', {}, song.title),
    sheetItem('&#9998;', 'Renomear', async () => {
      closeSheet();
      const name = await askText({ title: 'Nome do canto', value: song.title });
      if (!name) return;
      song.title = name;
      await db.putSong(song);
      render();
    }),
    sheetItem('&#128193;', 'Pastas deste canto', () => { closeSheet(); folderPicker(song); }),
    folder
      ? sheetItem('&#10006;', 'Tirar desta pasta', async () => {
          closeSheet();
          folder.songIds = folder.songIds.filter(id => id !== song.id);
          await db.putFolder(folder);
          render();
          toast('Tirado da pasta — o canto continua na biblioteca');
        })
      : null,
    sheetItem('&#128465;', 'Excluir da biblioteca', async () => {
      closeSheet();
      const yes = await askConfirm({
        title: `Excluir "${song.title}"?`,
        text: 'O arquivo sai do app e de todas as pastas. Dá para carregar de novo depois.',
        ok: 'Excluir', danger: true,
      });
      if (!yes) return;
      await db.deleteSong(song.id);
      state.songs = state.songs.filter(s => s.id !== song.id);
      state.folders = await db.getFolders();
      render();
      toast('Canto excluído');
    }),
  );
}

function folderPicker(song) {
  const draw = () => {
    const list = state.folders.slice().sort((a, b) => collator.compare(a.name, b.name));
    openSheet(
      h('h2', {}, 'Pastas deste canto'),
      list.length ? null : h('p', { class: 'muted' }, 'Você ainda não tem pastas.'),
      ...list.map(f => {
        const inside = f.songIds.includes(song.id);
        return sheetItem('&#128193;', f.name, async () => {
          if (inside) f.songIds = f.songIds.filter(id => id !== song.id);
          else f.songIds.push(song.id);
          await db.putFolder(f);
          draw();
          render();
        }, inside ? '&#10003;' : '');
      }),
      sheetItem('&#10133;', 'Nova pasta...', async () => {
        closeSheet();
        const name = await askText({ title: 'Nome da pasta', placeholder: 'Missa de domingo', ok: 'Criar' });
        if (!name) return;
        const f = db.newFolder(name);
        f.songIds.push(song.id);
        await db.putFolder(f);
        state.folders.push(f);
        render();
        toast(`Adicionado em "${name}"`);
      }),
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn wide btn-primary', onclick: closeSheet }, 'Pronto')),
    );
  };
  draw();
}

function folderMenu(folder) {
  openSheet(
    h('h2', {}, folder.name),
    sheetItem('&#9998;', 'Renomear pasta', async () => {
      closeSheet();
      const name = await askText({ title: 'Nome da pasta', value: folder.name });
      if (!name) return;
      folder.name = name;
      await db.putFolder(folder);
      render();
    }),
    sheetItem('&#128465;', 'Excluir pasta', async () => {
      closeSheet();
      const yes = await askConfirm({
        title: `Excluir a pasta "${folder.name}"?`,
        text: 'Os cantos continuam na biblioteca — só a pasta é apagada.',
        ok: 'Excluir pasta', danger: true,
      });
      if (!yes) return;
      await db.deleteFolder(folder.id);
      state.folders = state.folders.filter(f => f.id !== folder.id);
      if (state.route.name === 'folder') location.hash = '#/pastas';
      else render();
      toast('Pasta excluída');
    }),
  );
}

/* ------------------------------------------------------- listas / views */

function songRow(song, { folder = null, index = -1, total = 0, sortable = false } = {}) {
  const subs = foldersOf(song.id).map(f => f.name);
  const sub = subs.length ? subs.join(' · ') : (song.type === 'application/pdf' ? 'PDF' : 'Imagem');
  const href = folder ? `#/canto/${song.id}?pasta=${folder.id}` : `#/canto/${song.id}`;

  return h('li', { class: 'row' },
    sortable ? h('div', { class: 'move-btns' },
      h('button', {
        class: 'icon-btn', html: '&#9650;', 'aria-label': 'Subir', disabled: index === 0,
        onclick: () => moveInFolder(folder, index, -1),
      }),
      h('button', {
        class: 'icon-btn', html: '&#9660;', 'aria-label': 'Descer', disabled: index === total - 1,
        onclick: () => moveInFolder(folder, index, 1),
      })) : null,
    h('button', { class: 'row-main', onclick: () => { location.hash = href; } },
      h('span', { class: 'row-ico', html: sortable ? `${index + 1}.` : '&#9834;' }),
      h('span', { class: 'row-text' },
        h('div', { class: 'row-title' }, song.title),
        h('div', { class: 'row-sub' }, sub))),
    h('div', { class: 'row-actions' },
      h('button', {
        class: 'icon-btn', html: '&#8942;', 'aria-label': 'Opções',
        onclick: () => songMenu(song, { folder }),
      })),
  );
}

async function moveInFolder(folder, index, delta) {
  const to = index + delta;
  if (to < 0 || to >= folder.songIds.length) return;
  const ids = folder.songIds;
  [ids[index], ids[to]] = [ids[to], ids[index]];
  await db.putFolder(folder);
  render();
}

function renderSongs() {
  const q = state.query.trim().toLowerCase();
  let list = state.songs;
  if (q) list = list.filter(s => s.title.toLowerCase().includes(q) || s.fileName.toLowerCase().includes(q));
  list = sortSongs(list, state.sort);

  $('#song-list').replaceChildren(...list.map(s => songRow(s)));
  $('#songs-empty').hidden = state.songs.length > 0;
  if (state.songs.length && !list.length) {
    $('#song-list').append(h('li', { class: 'empty' }, `Nenhum canto com "${state.query}"`));
  }
}

function renderFolders() {
  const list = state.folders.slice().sort((a, b) => collator.compare(a.name, b.name));
  $('#folder-list').replaceChildren(...list.map(f => h('li', { class: 'row' },
    h('button', { class: 'row-main', onclick: () => { location.hash = `#/pasta/${f.id}`; } },
      h('span', { class: 'row-ico', html: '&#128193;' }),
      h('span', { class: 'row-text' },
        h('div', { class: 'row-title' }, f.name),
        h('div', { class: 'row-sub' }, `${f.songIds.length} ${f.songIds.length === 1 ? 'canto' : 'cantos'}`))),
    h('div', { class: 'row-actions' },
      h('button', { class: 'icon-btn', html: '&#8942;', 'aria-label': 'Opções', onclick: () => folderMenu(f) })))));
  $('#folders-empty').hidden = list.length > 0;
}

function songsOfFolder(folder) {
  let songs = folder.songIds.map(songById).filter(Boolean);
  if (state.folderSort !== 'manual') songs = sortSongs(songs, state.folderSort);
  return songs;
}

function renderFolder(folder) {
  const songs = songsOfFolder(folder);
  const sortable = state.folderSort === 'manual';
  $('#folder-song-list').replaceChildren(...songs.map((s, i) => songRow(s, {
    folder,
    index: sortable ? folder.songIds.indexOf(s.id) : i,
    total: songs.length,
    sortable,
  })));
  $('#folder-empty').hidden = songs.length > 0;
}

/* -------------------------------------------------------------- rotas */

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const params = new URLSearchParams(qs || '');
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'pastas') return { name: 'folders' };
  if (parts[0] === 'pasta' && parts[1]) return { name: 'folder', id: parts[1] };
  if (parts[0] === 'canto' && parts[1]) return { name: 'song', id: parts[1], folderId: params.get('pasta') };
  return { name: 'songs' };
}

function showView(name) {
  $('#view-songs').hidden = name !== 'songs';
  $('#view-folders').hidden = name !== 'folders';
  $('#view-folder').hidden = name !== 'folder';
  $('#view-song').hidden = name !== 'song';
  document.body.classList.toggle('reading', name === 'song');
  $('#tab-songs').classList.toggle('is-active', name === 'songs');
  $('#tab-folders').classList.toggle('is-active', name === 'folders' || name === 'folder');
  $('#btn-back').hidden = name === 'songs' || name === 'folders';
}

function render() {
  const r = state.route;

  if (r.name === 'songs') {
    $('#topbar-title').textContent = 'Cifras';
    renderSongs();
  } else if (r.name === 'folders') {
    $('#topbar-title').textContent = 'Pastas';
    renderFolders();
  } else if (r.name === 'folder') {
    const folder = state.folders.find(f => f.id === r.id);
    if (!folder) { location.hash = '#/pastas'; return; }
    $('#topbar-title').textContent = folder.name;
    renderFolder(folder);
  } else if (r.name === 'song') {
    const song = songById(r.id);
    if (song) $('#topbar-title').textContent = song.title;
  }
  showView(r.name);
}

async function route() {
  const prev = state.route;
  state.route = parseHash();

  if (prev.name === 'song' && state.route.name !== 'song') {
    viewer.destroy();
    releaseWakeLock();
  }
  closeSheet();
  render();

  if (state.route.name === 'song') await openSong(state.route);
  else window.scrollTo(0, 0);
}

/* ------------------------------------------------------- visualizador */

async function openSong({ id, folderId }) {
  const song = songById(id);
  if (!song) { location.hash = '#/'; return; }

  // Ordem de navegação: a ordem da pasta, ou a ordem atual da biblioteca.
  const folder = folderId ? state.folders.find(f => f.id === folderId) : null;
  state.navList = folder
    ? songsOfFolder(folder).map(s => s.id)
    : sortSongs(state.songs, state.sort).map(s => s.id);
  state.navIndex = state.navList.indexOf(id);

  $('#v-count').textContent = state.navList.length > 1
    ? `${state.navIndex + 1} de ${state.navList.length}` : '';
  $('#v-prev').disabled = state.navIndex <= 0;
  $('#v-next').disabled = state.navIndex < 0 || state.navIndex >= state.navList.length - 1;

  window.scrollTo(0, 0);
  await viewer.show(song, $('#pages'), $('#viewer-status'));
  requestWakeLock();
}

function goSibling(delta) {
  const next = state.navIndex + delta;
  if (next < 0 || next >= state.navList.length) return false;
  const fid = state.route.folderId;
  location.replace(`#/canto/${state.navList[next]}${fid ? `?pasta=${fid}` : ''}`);
  return true;
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !state.wakeLock) {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
    }
  } catch { /* sem suporte ou negado: a tela apaga normalmente */ }
}

function releaseWakeLock() {
  try { state.wakeLock?.release(); } catch {}
  state.wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.route.name === 'song') requestWakeLock();
});

/* ------------------------------------------------------------- eventos */

$('#tab-load').addEventListener('click', pickFiles);
$('#file-input').addEventListener('change', e => onFilesChosen([...e.target.files]));
$('#sheet-backdrop').addEventListener('click', closeSheet);

$('#search').addEventListener('input', e => { state.query = e.target.value; renderSongs(); });

$('#sort').addEventListener('change', async e => {
  state.sort = e.target.value;
  await db.setSetting('sort', state.sort);
  renderSongs();
});

$('#folder-sort').addEventListener('change', async e => {
  state.folderSort = e.target.value;
  await db.setSetting('folderSort', state.folderSort);
  render();
});

$('#btn-new-folder').addEventListener('click', async () => {
  const name = await askText({ title: 'Nova pasta', placeholder: 'Missa de domingo', ok: 'Criar' });
  if (!name) return;
  const f = db.newFolder(name);
  await db.putFolder(f);
  state.folders.push(f);
  location.hash = `#/pasta/${f.id}`;
});

$('#btn-folder-add').addEventListener('click', () => {
  const folder = state.folders.find(f => f.id === state.route.id);
  if (!folder) return;
  const available = sortSongs(state.songs, 'az');

  const draw = () => openSheet(
    h('h2', {}, `Cantos em "${folder.name}"`),
    available.length ? null : h('p', { class: 'muted' }, 'Sua biblioteca está vazia — use Carregar para trazer os PDFs.'),
    ...available.map(s => {
      const inside = folder.songIds.includes(s.id);
      return sheetItem('&#9834;', s.title, async () => {
        if (inside) folder.songIds = folder.songIds.filter(id => id !== s.id);
        else folder.songIds.push(s.id);
        await db.putFolder(folder);
        draw();
        render();
      }, inside ? '&#10003;' : '');
    }),
    h('div', { class: 'sheet-actions' },
      h('button', { class: 'btn wide', onclick: () => { closeSheet(); pickFiles(); } }, 'Carregar novos'),
      h('button', { class: 'btn btn-primary wide', onclick: closeSheet }, 'Pronto')),
  );
  draw();
});

$('#btn-folder-menu').addEventListener('click', () => {
  const folder = state.folders.find(f => f.id === state.route.id);
  if (folder) folderMenu(folder);
});

$('#btn-back').addEventListener('click', () => {
  if (history.length > 1) history.back();
  else location.hash = state.route.name === 'song' && state.route.folderId
    ? `#/pasta/${state.route.folderId}` : '#/';
});

$('#btn-theme').addEventListener('click', async () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
  await db.setSetting('theme', next);
});

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name=theme-color]').content = theme === 'light' ? '#f6f4ef' : '#12161d';
}

$('#v-prev').addEventListener('click', () => goSibling(-1));
$('#v-next').addEventListener('click', () => goSibling(1));
$('#v-zoom-in').addEventListener('click', () => viewer.setZoom(viewer.getZoom() + 0.25));
$('#v-zoom-out').addEventListener('click', () => viewer.setZoom(viewer.getZoom() - 0.25));

$('#v-invert').addEventListener('click', async () => {
  const on = document.documentElement.dataset.invert === '1' ? '' : '1';
  document.documentElement.dataset.invert = on;
  $('#v-invert').classList.toggle('is-on', on === '1');
  await db.setSetting('invert', on);
});

// Pedal de virar página / teclado: rola a tela e, no fim, pula para o próximo canto.
document.addEventListener('keydown', e => {
  if (state.route.name !== 'song') return;
  if (e.target instanceof HTMLInputElement) return;
  const fwd = ['PageDown', 'ArrowRight', 'ArrowDown', ' '].includes(e.key);
  const back = ['PageUp', 'ArrowLeft', 'ArrowUp'].includes(e.key);
  if (!fwd && !back) return;
  e.preventDefault();
  const step = window.innerHeight * 0.85;
  const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
  const atTop = window.scrollY <= 2;
  if (fwd) { if (atBottom) goSibling(1); else window.scrollBy({ top: step, behavior: 'smooth' }); }
  else if (atTop) goSibling(-1);
  else window.scrollBy({ top: -step, behavior: 'smooth' });
});

let resizeTimer;
window.addEventListener('resize', () => {
  if (state.route.name !== 'song') return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => viewer.refresh(), 250);
});

window.addEventListener('hashchange', route);

/* --------------------------------------------------------------- boot */

async function boot() {
  const [songs, folders, theme, sort, folderSort, invert] = await Promise.all([
    db.getSongs(),
    db.getFolders(),
    db.getSetting('theme', matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'),
    db.getSetting('sort', 'az'),
    db.getSetting('folderSort', 'manual'),
    db.getSetting('invert', ''),
  ]);

  state.songs = songs;
  state.folders = folders.map(f => ({ ...f, songIds: f.songIds || [] }));
  state.sort = sort;
  state.folderSort = folderSort;

  applyTheme(theme);
  document.documentElement.dataset.invert = invert;
  $('#v-invert').classList.toggle('is-on', invert === '1');
  $('#sort').value = sort;
  $('#folder-sort').value = folderSort;

  await route();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
