/**
 * DITUNE IndexedDB Storage Engine
 * Manages tracks metadata, audio binary blobs, album cover art, and user settings.
 */

const DB_NAME = 'ditune_db';
const DB_VERSION = 1;

let dbInstance = null;

export function openDB() {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Tracks metadata
      if (!db.objectStoreNames.contains('tracks')) {
        const trackStore = db.createObjectStore('tracks', { keyPath: 'id' });
        trackStore.createIndex('artist', 'artist', { unique: false });
        trackStore.createIndex('album', 'album', { unique: false });
        trackStore.createIndex('title', 'title', { unique: false });
        trackStore.createIndex('cachedAt', 'cachedAt', { unique: false });
      }

      // Audio binary blobs
      if (!db.objectStoreNames.contains('audio_blobs')) {
        db.createObjectStore('audio_blobs', { keyPath: 'id' });
      }

      // Album covers
      if (!db.objectStoreNames.contains('covers')) {
        db.createObjectStore('covers', { keyPath: 'id' });
      }

      // App settings
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('Failed to open IndexedDB:', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Perform a transaction helper
 */
async function getStore(storeName, mode = 'readonly') {
  const db = await openDB();
  const tx = db.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

// ================= TRACKS =================

export async function saveTrack(track) {
  const store = await getStore('tracks', 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(track);
    req.onsuccess = () => resolve(track);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function saveTracks(tracks) {
  const db = await openDB();
  const tx = db.transaction('tracks', 'readwrite');
  const store = tx.objectStore('tracks');

  return new Promise((resolve, reject) => {
    tracks.forEach((track) => store.put(track));
    tx.oncomplete = () => resolve(tracks);
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function getAllTracks() {
  const store = await getStore('tracks', 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function getTrack(id) {
  const store = await getStore('tracks', 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function deleteTrack(id) {
  const db = await openDB();
  const tx = db.transaction(['tracks', 'audio_blobs', 'covers'], 'readwrite');
  tx.objectStore('tracks').delete(id);
  tx.objectStore('audio_blobs').delete(id);
  tx.objectStore('covers').delete(id);

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
}

// ================= AUDIO BLOBS =================

export async function saveAudioBlob(id, blob, mimeType = 'audio/mpeg') {
  const db = await openDB();
  const tx = db.transaction(['audio_blobs', 'tracks'], 'readwrite');
  const blobStore = tx.objectStore('audio_blobs');
  const trackStore = tx.objectStore('tracks');

  const blobData = {
    id,
    blob,
    mimeType,
    size: blob.size,
    savedAt: Date.now(),
  };

  blobStore.put(blobData);

  // Update track cache status if track exists
  const trackReq = trackStore.get(id);
  trackReq.onsuccess = () => {
    if (trackReq.result) {
      const updatedTrack = {
        ...trackReq.result,
        isCached: true,
        cachedAt: Date.now(),
        size: blob.size,
      };
      trackStore.put(updatedTrack);
    }
  };

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(blobData);
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function getAudioBlob(id) {
  const store = await getStore('audio_blobs', 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result ? req.result.blob : null);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function removeAudioBlob(id) {
  const db = await openDB();
  const tx = db.transaction(['audio_blobs', 'tracks'], 'readwrite');
  tx.objectStore('audio_blobs').delete(id);

  const trackStore = tx.objectStore('tracks');
  const trackReq = trackStore.get(id);
  trackReq.onsuccess = () => {
    if (trackReq.result) {
      const updatedTrack = {
        ...trackReq.result,
        isCached: false,
        cachedAt: null,
      };
      trackStore.put(updatedTrack);
    }
  };

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
}

// ================= ALBUM COVERS =================

export async function saveCover(id, blob, mimeType = 'image/jpeg') {
  const store = await getStore('covers', 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put({ id, blob, mimeType });
    req.onsuccess = () => resolve(true);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function getCover(id) {
  const store = await getStore('covers', 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result ? req.result.blob : null);
    req.onerror = (e) => reject(e.target.error);
  });
}

// ================= SETTINGS =================

export async function getSetting(key, defaultValue = null) {
  const store = await getStore('settings', 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => {
      resolve(req.result !== undefined ? req.result.value : defaultValue);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function setSetting(key, value) {
  const store = await getStore('settings', 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put({ key, value });
    req.onsuccess = () => resolve(value);
    req.onerror = (e) => reject(e.target.error);
  });
}

// ================= STORAGE STATS & MAINTENANCE =================

export async function getStorageStats() {
  const tracks = await getAllTracks();
  const totalTracks = tracks.length;
  let cachedCount = 0;
  let totalBytes = 0;

  for (const track of tracks) {
    if (track.isCached) {
      cachedCount++;
      totalBytes += Number(track.size || 0);
    }
  }

  return {
    totalTracks,
    cachedCount,
    totalBytes,
  };
}

export async function clearAllCache() {
  const db = await openDB();
  const tx = db.transaction(['audio_blobs', 'covers', 'tracks'], 'readwrite');
  tx.objectStore('audio_blobs').clear();
  tx.objectStore('covers').clear();

  const trackStore = tx.objectStore('tracks');
  const req = trackStore.getAll();
  req.onsuccess = () => {
    const tracks = req.result || [];
    tracks.forEach((track) => {
      trackStore.put({
        ...track,
        isCached: false,
        cachedAt: null,
        hasCover: false,
      });
    });
  };

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function clearAllData() {
  const db = await openDB();
  const tx = db.transaction(['tracks', 'audio_blobs', 'covers'], 'readwrite');
  tx.objectStore('tracks').clear();
  tx.objectStore('audio_blobs').clear();
  tx.objectStore('covers').clear();

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
}
