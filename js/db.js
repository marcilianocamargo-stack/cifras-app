/* Camada de dados: IndexedDB.
   songs   -> { id, title, fileName, type, size, blob, addedAt, zoom? }
   folders -> { id, name, songIds: [], createdAt }
   settings-> { key, value }                                        */

const DB_NAME = 'cifras';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));

/* ---------- músicas ---------- */
export const getSongs = () => tx('songs', 'readonly', s => s.getAll());
export const getSong = id => tx('songs', 'readonly', s => s.get(id));
export const putSong = song => tx('songs', 'readwrite', s => s.put(song));

export function newSong(file, title, isImage = false) {
  return {
    id: uid(),
    title,
    fileName: file.name,
    // O tipo relatado pelo Android para PDFs nem sempre é confiável (às vezes vem
    // vazio ou genérico), então quem decide se é imagem é quem já checou a extensão.
    type: isImage ? (file.type || 'image/*') : 'application/pdf',
    size: file.size,
    blob: file,
    addedAt: Date.now(),
  };
}

export async function deleteSong(id) {
  await tx('songs', 'readwrite', s => s.delete(id));
  const folders = await getFolders();
  for (const f of folders) {
    if (f.songIds.includes(id)) {
      f.songIds = f.songIds.filter(x => x !== id);
      await putFolder(f);
    }
  }
}

/* ---------- pastas ---------- */
export const getFolders = () => tx('folders', 'readonly', s => s.getAll());
export const getFolder = id => tx('folders', 'readonly', s => s.get(id));
export const putFolder = folder => tx('folders', 'readwrite', s => s.put(folder));
export const deleteFolder = id => tx('folders', 'readwrite', s => s.delete(id));

export function newFolder(name) {
  return { id: uid(), name, songIds: [], createdAt: Date.now() };
}

/* ---------- preferências ---------- */
export async function getSetting(key, fallback) {
  const row = await tx('settings', 'readonly', s => s.get(key));
  return row === undefined ? fallback : row.value;
}
export const setSetting = (key, value) => tx('settings', 'readwrite', s => s.put({ key, value }));
