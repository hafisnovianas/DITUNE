/**
 * DITUNE IndexedDB Storage Engine
 * Manages tracks metadata, audio binary blobs, album cover art, and user settings.
 */

const DB_NAME = 'ditune_db';
const DB_VERSION = 2;

let dbInstance = null;
let openPromise = null;

function invalidateDbInstance(targetDb = null) {
  if (!targetDb || dbInstance === targetDb) {
    dbInstance = null;
  }
}

export function openDB() {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }
  if (openPromise) {
    return openPromise;
  }

  openPromise = new Promise((resolve, reject) => {
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

      // Custom playlists (v2)
      if (!db.objectStoreNames.contains('playlists')) {
        db.createObjectStore('playlists', { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => {
      const db = event.target.result;
      db.onversionchange = () => {
        try {
          db.close();
        } catch {
          // ignore close errors
        }
        invalidateDbInstance(db);
      };
      db.onclose = () => {
        invalidateDbInstance(db);
      };
      dbInstance = db;
      resolve(db);
    };

    request.onerror = (event) => {
      console.error('Failed to open IndexedDB:', event.target.error);
      reject(event.target.error);
    };

    request.onblocked = () => {
      invalidateDbInstance();
    };
  }).finally(() => {
    openPromise = null;
  });

  return openPromise;
}

/**
 * Open an IDBTransaction and transparently reopen if the cached DB connection is closing/closed
 */
async function createTransaction(storeNames, mode = 'readonly') {
  const db = await openDB();
  try {
    return db.transaction(storeNames, mode);
  } catch (err) {
    if (err?.name === 'InvalidStateError') {
      invalidateDbInstance(db);
      const freshDb = await openDB();
      return freshDb.transaction(storeNames, mode);
    }
    throw err;
  }
}

/**
 * Perform a transaction helper
 */
async function getStore(storeName, mode = 'readonly') {
  const tx = await createTransaction(storeName, mode);
  return tx.objectStore(storeName);
}

// ================= TRACKS =================

export async function saveTrack(track) {
  const tx = await createTransaction(['tracks', 'audio_blobs'], 'readwrite');
  const trackStore = tx.objectStore('tracks');
  const blobStore = tx.objectStore('audio_blobs');

  let savedTrack = track;
  const blobReq = blobStore.get(track.id);
  blobReq.onsuccess = () => {
    const blobRecord = blobReq.result;
    const hasBlob = !!blobRecord;
    const blobSize = hasBlob ? (blobRecord.size || (blobRecord.blob && blobRecord.blob.size) || 0) : 0;
    savedTrack = {
      ...track,
      isCached: hasBlob,
      size: (hasBlob && blobSize) ? blobSize : (track.size || 0),
    };
    if (hasBlob && !savedTrack.cachedAt) {
      savedTrack.cachedAt = blobRecord.savedAt || Date.now();
    } else if (!hasBlob) {
      savedTrack.cachedAt = null;
    }
    trackStore.put(savedTrack);
  };

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      if (track && typeof track === 'object') {
        Object.assign(track, savedTrack);
      }
      resolve(savedTrack);
    };
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function saveTracks(tracks) {
  const tx = await createTransaction(['tracks', 'audio_blobs'], 'readwrite');
  const trackStore = tx.objectStore('tracks');
  const blobStore = tx.objectStore('audio_blobs');

  const keysReq = blobStore.getAllKeys ? blobStore.getAllKeys() : blobStore.getAll();
  keysReq.onsuccess = () => {
    const blobKeys = blobStore.getAllKeys
      ? new Set(keysReq.result || [])
      : new Set((keysReq.result || []).map((b) => b.id));

    tracks.forEach((track) => {
      const hasBlob = blobKeys.has(track.id);
      track.isCached = hasBlob;
      if (hasBlob && !track.cachedAt) {
        track.cachedAt = Date.now();
      } else if (!hasBlob) {
        track.cachedAt = null;
      }
      trackStore.put(track);
    });
  };

  return new Promise((resolve, reject) => {
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
  const tx = await createTransaction(['tracks', 'audio_blobs', 'covers'], 'readwrite');
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
  const tx = await createTransaction(['audio_blobs', 'tracks'], 'readwrite');
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

export async function getAllAudioBlobs() {
  const store = await getStore('audio_blobs', 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function getAllAudioBlobIds() {
  const store = await getStore('audio_blobs', 'readonly');
  return new Promise((resolve, reject) => {
    if (store.getAllKeys) {
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(new Set(req.result || []));
      req.onerror = (e) => reject(e.target.error);
    } else {
      const req = store.getAll();
      req.onsuccess = () => resolve(new Set((req.result || []).map((b) => b.id)));
      req.onerror = (e) => reject(e.target.error);
    }
  });
}

export async function removeAudioBlob(id) {
  const tx = await createTransaction(['audio_blobs', 'tracks'], 'readwrite');
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

// ================= IGNORED TRACKS =================

export async function getIgnoredTracks() {
  const list = await getSetting('ignored_tracks');
  return Array.isArray(list) ? list : [];
}

export async function ignoreTrack(track) {
  const list = await getIgnoredTracks();
  if (!list.some((item) => item.id === track.id)) {
    list.push({
      id: track.id,
      name: track.name || track.title || 'Unknown Track',
      title: track.title || track.name || 'Unknown Track',
      artist: track.artist || 'Unknown Artist',
      album: track.album || 'Unknown Album',
      ignoredAt: Date.now(),
    });
    await setSetting('ignored_tracks', list);
  }
  await deleteTrack(track.id);
  return true;
}

export async function unignoreTrack(trackId) {
  const list = await getIgnoredTracks();
  const updated = list.filter((t) => t.id !== trackId);
  await setSetting('ignored_tracks', updated);
  return true;
}

export async function clearIgnoredTracks() {
  await setSetting('ignored_tracks', []);
  return true;
}

// ================= PLAYLISTS =================

export async function getAllPlaylists() {
  const store = await getStore('playlists');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function getPlaylist(id) {
  const store = await getStore('playlists');
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function savePlaylist(playlist) {
  const store = await getStore('playlists', 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(playlist);
    req.onsuccess = () => resolve(true);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function deletePlaylist(id) {
  const store = await getStore('playlists', 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = (e) => reject(e.target.error);
  });
}

// ================= STORAGE STATS & MAINTENANCE =================

export async function getStorageStats() {
  const tracks = await getAllTracks();
  const blobs = await getAllAudioBlobs();

  const blobMap = new Map();
  let totalBytes = 0;
  for (const b of blobs) {
    const size = b.size || (b.blob ? b.blob.size : 0) || 0;
    blobMap.set(b.id, size);
    totalBytes += size;
  }

  const totalTracks = tracks.length;
  let cachedCount = 0;
  const tracksToHeal = [];

  for (const track of tracks) {
    const hasBlob = blobMap.has(track.id);
    if (hasBlob) {
      cachedCount++;
      if (!track.isCached || (!track.size && blobMap.get(track.id))) {
        track.isCached = true;
        if (!track.size) track.size = blobMap.get(track.id);
        if (!track.cachedAt) track.cachedAt = Date.now();
        tracksToHeal.push(track);
      }
    } else if (track.isCached) {
      track.isCached = false;
      track.cachedAt = null;
      tracksToHeal.push(track);
    }
  }

  if (totalTracks === 0 && blobMap.size > 0) {
    cachedCount = blobMap.size;
  }

  if (tracksToHeal.length > 0) {
    try {
      await saveTracks(tracksToHeal);
    } catch {
      // non-fatal healing attempt
    }
  }

  return {
    totalTracks,
    cachedCount,
    totalBytes,
  };
}

export async function clearAllCache() {
  const tx = await createTransaction(['audio_blobs', 'covers', 'tracks'], 'readwrite');
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
  const tx = await createTransaction(['tracks', 'audio_blobs', 'covers', 'playlists'], 'readwrite');
  tx.objectStore('tracks').clear();
  tx.objectStore('audio_blobs').clear();
  tx.objectStore('covers').clear();
  tx.objectStore('playlists').clear();

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
}
