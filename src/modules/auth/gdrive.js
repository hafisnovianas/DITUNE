/**
 * DITUNE Google Drive & Google Identity Services (GIS) Module
 * Handles OAuth 2.0 (scope: drive.file), Google Picker API, folder management,
 * resumable uploads, authorized file listing, and audio streaming.
 */

export const SCOPES = 'https://www.googleapis.com/auth/drive.file';
export const DITUNE_FOLDER_NAME = 'DITUNE Music';
const SESSION_TOKEN_KEY = 'ditune_oauth_token';
const SESSION_EXPIRES_KEY = 'ditune_oauth_expires_at';
const SESSION_SCOPE_KEY = 'ditune_oauth_scope';

const AUDIO_MIME_BY_EXT = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  webm: 'audio/webm',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
};

let gisLoaded = false;
let gapiLoaded = false;
let tokenClient = null;
let tokenClientApiRef = null;
let currentAccessToken = null;
let tokenExpiresAt = 0;
let pendingTokenPromise = null;
const pendingScripts = new Map();

function getWebStorages() {
  const storages = [];
  if (typeof localStorage !== 'undefined') storages.push(localStorage);
  if (typeof sessionStorage !== 'undefined') storages.push(sessionStorage);
  return storages;
}

/**
 * Clean up any legacy custom credentials from browser localStorage
 */
if (typeof localStorage !== 'undefined') {
  localStorage.removeItem('ditune_client_id');
  localStorage.removeItem('ditune_api_key');
}

/**
 * Get Google API credentials from project environment (.env)
 */
export function getCredentials() {
  const nodeEnv = typeof process !== 'undefined' ? process.env : undefined;
  const clientId = (import.meta.env?.VITE_GOOGLE_CLIENT_ID || nodeEnv?.VITE_GOOGLE_CLIENT_ID || '').trim();
  const apiKey = (import.meta.env?.VITE_GOOGLE_API_KEY || nodeEnv?.VITE_GOOGLE_API_KEY || '').trim();

  return {
    clientId,
    apiKey,
  };
}

/**
 * Check if credentials are configured
 */
export function hasCredentials() {
  const { clientId, apiKey } = getCredentials();
  return Boolean(clientId && apiKey);
}

/**
 * Check if an unexpired OAuth session matching SCOPES currently exists locally
 */
export function hasActiveSession() {
  if (currentAccessToken && Date.now() < tokenExpiresAt - 60000) {
    return true;
  }

  try {
    for (const storage of getWebStorages()) {
      const savedToken = storage.getItem(SESSION_TOKEN_KEY);
      const savedExpires = Number(storage.getItem(SESSION_EXPIRES_KEY)) || 0;
      const savedScope = storage.getItem(SESSION_SCOPE_KEY);

      if (savedToken && savedScope === SCOPES && Date.now() < savedExpires - 60000) {
        return true;
      }
    }
  } catch (e) {
    console.debug('Failed to check active session:', e);
  }

  return false;
}

/**
 * Load external script dynamically (deduplicated across concurrent calls)
 */
function loadScript(src) {
  if (pendingScripts.has(src)) {
    return pendingScripts.get(src);
  }

  if (typeof document === 'undefined') {
    return Promise.reject(new Error(`Document tidak tersedia untuk memuat script: ${src}`));
  }

  if (document.querySelector(`script[src="${src}"]`)) {
    return Promise.resolve();
  }

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      pendingScripts.delete(src);
      resolve();
    };
    script.onerror = () => {
      pendingScripts.delete(src);
      script.remove();
      reject(new Error(`Gagal memuat script: ${src}`));
    };
    document.head.appendChild(script);
  });

  pendingScripts.set(src, promise);
  return promise;
}

/**
 * Ensure Google Identity Services (GIS) OAuth script is loaded
 */
export async function ensureGisLoaded() {
  if (typeof window !== 'undefined' && window.google?.accounts?.oauth2) {
    gisLoaded = true;
    return;
  }
  await loadScript('https://accounts.google.com/gsi/client');
  gisLoaded = true;
}

/**
 * Ensure Google Picker (GAPI) library is loaded
 */
export async function ensurePickerLoaded() {
  if (typeof window !== 'undefined' && window.google?.picker) {
    gapiLoaded = true;
    return;
  }
  await loadScript('https://apis.google.com/js/api.js');
  gapiLoaded = true;

  if (typeof window !== 'undefined' && window.gapi && !window.google?.picker) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Waktu memuat Google Picker habis. Mohon periksa koneksi internet.'));
      }, 15000);
      if (timer && typeof timer.unref === 'function') timer.unref();
      window.gapi.load('picker', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

/**
 * Initialize Google API and GIS libraries (background preloader)
 */
export async function initGoogleAuth() {
  await Promise.allSettled([
    ensureGisLoaded(),
    ensurePickerLoaded(),
  ]);
}

/**
 * Clear stored access token and scope metadata
 */
export function clearSessionToken() {
  currentAccessToken = null;
  tokenExpiresAt = 0;
  try {
    for (const storage of getWebStorages()) {
      storage.removeItem(SESSION_TOKEN_KEY);
      storage.removeItem(SESSION_EXPIRES_KEY);
      storage.removeItem(SESSION_SCOPE_KEY);
    }
  } catch (e) {
    console.debug('Failed to clear stored token:', e);
  }
}

/**
 * Get or request a valid access token for the current SCOPES (single-flight safe)
 */
export async function getAccessToken(interactive = true) {
  // If token is still valid in memory (with 60s buffer)
  if (currentAccessToken && Date.now() < tokenExpiresAt - 60000) {
    return currentAccessToken;
  }

  // Restore from localStorage (or fallback sessionStorage) if scope matches and not expired
  try {
    for (const storage of getWebStorages()) {
      const savedToken = storage.getItem(SESSION_TOKEN_KEY);
      const savedExpires = Number(storage.getItem(SESSION_EXPIRES_KEY)) || 0;
      const savedScope = storage.getItem(SESSION_SCOPE_KEY);

      // Invalidate legacy tokens (e.g. drive.readonly or missing scope) so user grants drive.file cleanly
      if (savedToken && savedScope !== SCOPES) {
        clearSessionToken();
        break;
      }

      if (savedToken && Date.now() < savedExpires - 60000) {
        currentAccessToken = savedToken;
        tokenExpiresAt = savedExpires;
        return currentAccessToken;
      }
    }
  } catch (e) {
    console.debug('Failed to read stored token:', e);
  }

  // Deduplicate concurrent OAuth popup/refresh requests across parallel workers
  if (pendingTokenPromise) {
    return pendingTokenPromise;
  }

  const { clientId } = getCredentials();
  if (!clientId) {
    throw new Error('Google Client ID belum dikonfigurasi. Silakan buka Pengaturan.');
  }

  pendingTokenPromise = (async () => {
    if (typeof window === 'undefined' || !window.google?.accounts?.oauth2) {
      await ensureGisLoaded();
    }

    if (typeof window === 'undefined' || !window.google?.accounts?.oauth2) {
      throw new Error('Google Identity Services belum siap. Mohon periksa koneksi internet.');
    }

    return new Promise((resolve, reject) => {
      try {
        if (!tokenClient || tokenClientApiRef !== window.google.accounts.oauth2) {
          tokenClientApiRef = window.google.accounts.oauth2;
          tokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: SCOPES,
            callback: '', // handled dynamically below
            error_callback: '', // handled dynamically below
          });
        }

        tokenClient.callback = (resp) => {
          if (resp.error) {
            console.error('[GIS] OAuth error:', resp);
            reject(new Error(resp.error_description || resp.error || 'Autentikasi Google gagal.'));
            return;
          }
          if (typeof resp.scope === 'string' && !resp.scope.split(/\s+/).includes(SCOPES)) {
            reject(new Error('Izin Google Drive (drive.file) diperlukan untuk menggunakan DITUNE.'));
            return;
          }
          if (!resp.access_token) {
            reject(new Error('Token akses Google tidak diterima.'));
            return;
          }

          currentAccessToken = resp.access_token;
          const expiresInSec = Number(resp.expires_in) || 3600;
          tokenExpiresAt = Date.now() + expiresInSec * 1000;

          try {
            for (const storage of getWebStorages()) {
              storage.setItem(SESSION_TOKEN_KEY, currentAccessToken);
              storage.setItem(SESSION_EXPIRES_KEY, String(tokenExpiresAt));
              storage.setItem(SESSION_SCOPE_KEY, SCOPES);
            }
          } catch (e) {
            console.debug('Failed to save stored token:', e);
          }

          resolve(currentAccessToken);
        };

        tokenClient.error_callback = (err) => {
          const msg =
            err?.type === 'popup_closed'
              ? 'Popup login Google ditutup sebelum selesai.'
              : err?.type === 'popup_failed_to_open'
                ? 'Popup login Google diblokir oleh browser.'
                : err?.message || 'Autentikasi Google dibatalkan atau gagal.';
          reject(new Error(msg));
        };

        tokenClient.requestAccessToken({
          prompt: interactive ? '' : 'none',
        });
      } catch (err) {
        reject(err);
      }
    });
  })().finally(() => {
    pendingTokenPromise = null;
  });

  return pendingTokenPromise;
}

function extractDriveErrorFromBody(errorBody, fallbackMessage) {
  return errorBody?.error?.message || fallbackMessage;
}

async function parseDriveErrorMessage(resp, fallbackMessage) {
  const errorBody = await resp.json().catch(() => ({}));
  return extractDriveErrorFromBody(errorBody, fallbackMessage);
}

/**
 * Authenticated fetch wrapper for Google Drive API with single-flight-safe 401 retry
 */
export async function fetchDriveWithAuth(url, options = {}, interactive = true) {
  let token = await getAccessToken(interactive);
  const buildInit = (bearer) => ({
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${bearer}`,
    },
  });

  let resp = await fetch(url, buildInit(token));
  if (resp.status === 401) {
    // Only invalidate if no other concurrent request already rotated the token
    if (currentAccessToken === token) {
      clearSessionToken();
    }
    token = await getAccessToken(interactive);
    resp = await fetch(url, buildInit(token));
  }
  return resp;
}

/**
 * Open Google Picker to multi-select audio files from Google Drive (drive.file)
 */
export async function openGooglePicker() {
  const { clientId, apiKey } = getCredentials();
  if (!clientId || !apiKey) {
    throw new Error('CONFIG_NEEDED');
  }

  const pickerLoadPromise =
    typeof window !== 'undefined' && window.google?.picker
      ? Promise.resolve()
      : ensurePickerLoaded().catch((err) => err);

  const hadCachedToken = hasActiveSession();
  let token = await getAccessToken(true);

  // Verify cached token hasn't been revoked remotely before handing it to Picker iframe
  if (hadCachedToken) {
    const verifyResp = await fetchDriveWithAuth(
      'https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)',
      {},
      true
    );
    if (!verifyResp.ok) {
      throw new Error(await parseDriveErrorMessage(verifyResp, `Gagal memverifikasi sesi Google Drive (${verifyResp.status})`));
    }
    token = await getAccessToken(true);
  }

  const pickerLoadErr = await pickerLoadPromise;
  if (pickerLoadErr instanceof Error) {
    throw pickerLoadErr;
  }

  if (typeof window === 'undefined' || !window.google?.picker) {
    throw new Error('Google Picker API belum siap. Mohon periksa koneksi internet.');
  }

  return new Promise((resolve, reject) => {
    try {
      const audioView = new window.google.picker.DocsView()
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false)
        .setMimeTypes('audio/mpeg,audio/mp3,audio/flac,audio/x-flac,audio/x-m4a,audio/m4a,audio/mp4,audio/wav,audio/x-wav,audio/ogg,application/ogg,audio/opus,audio/aac,audio/webm,video/mp4,video/webm,application/octet-stream')
        .setMode(window.google.picker.DocsViewMode.LIST)
        .setLabel('File Audio / Musik');

      const appId = clientId.split('-')[0] || '';

      const picker = new window.google.picker.PickerBuilder()
        .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
        .setAppId(appId)
        .setOAuthToken(token)
        .addView(audioView)
        .setDeveloperKey(apiKey)
        .setTitle('DITUNE - Impor File Audio dari Google Drive')
        .setCallback((data) => {
          if (data.action === window.google.picker.Action.PICKED) {
            const docs = data[window.google.picker.Response.DOCUMENTS] || [];
            resolve(processPickedDocuments(docs));
          } else if (data.action === window.google.picker.Action.CANCEL) {
            resolve(null);
          } else if (window.google.picker.Action?.ERROR && data.action === window.google.picker.Action.ERROR) {
            reject(new Error('Google Picker mengalami kesalahan saat memuat daftar file.'));
          }
        })
        .build();

      picker.setVisible(true);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Map picked audio documents from Google Picker into track file metadata
 */
function processPickedDocuments(docs = []) {
  const resultFiles = [];

  for (const doc of docs) {
    if (isAudioMediaItem(doc)) {
      resultFiles.push({
        id: doc.id,
        name: doc.name,
        mimeType: inferAudioMimeType(doc.name, doc.mimeType),
        size: Number(doc.sizeBytes || doc.size || 0),
      });
    }
  }

  return { files: resultFiles, folder: null };
}

/**
 * Find the existing "DITUNE Music" folder owned by the app without creating one
 * @returns {Promise<{id: string, name: string}|null>}
 */
export async function findDituneFolder() {
  const query = `name = '${DITUNE_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent('files(id,name)')}&pageSize=10`;

  const searchResp = await fetchDriveWithAuth(searchUrl);
  if (!searchResp.ok) {
    throw new Error(await parseDriveErrorMessage(searchResp, `Gagal memeriksa folder ${DITUNE_FOLDER_NAME} (${searchResp.status})`));
  }

  const searchData = await searchResp.json();
  if (searchData.files && searchData.files.length > 0) {
    return {
      id: searchData.files[0].id,
      name: searchData.files[0].name || DITUNE_FOLDER_NAME,
    };
  }
  return null;
}

/**
 * Find or create the dedicated "DITUNE Music" folder owned by the app
 * @returns {Promise<{id: string, name: string}>}
 */
export async function findOrCreateDituneFolder() {
  const existing = await findDituneFolder();
  if (existing) {
    return existing;
  }

  const createResp = await fetchDriveWithAuth('https://www.googleapis.com/drive/v3/files?fields=id,name', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      name: DITUNE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });

  if (!createResp.ok) {
    throw new Error(await parseDriveErrorMessage(createResp, `Gagal membuat folder ${DITUNE_FOLDER_NAME} (${createResp.status})`));
  }

  const created = await createResp.json();
  return {
    id: created.id,
    name: created.name || DITUNE_FOLDER_NAME,
  };
}

/**
 * List all audio files authorized for this app (DITUNE Music uploads + Picker imports)
 * @returns {Promise<Array<{id: string, name: string, mimeType: string, size: number, parents: string[]}>>}
 */
export async function listAuthorizedAudioFiles() {
  const audioFiles = [];
  let pageToken = '';
  const query = "trashed = false and mimeType != 'application/vnd.google-apps.folder'";

  do {
    let url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent('nextPageToken,files(id,name,mimeType,size,parents)')}&pageSize=500`;
    if (pageToken) {
      url += `&pageToken=${encodeURIComponent(pageToken)}`;
    }

    const resp = await fetchDriveWithAuth(url);
    if (!resp.ok) {
      throw new Error(await parseDriveErrorMessage(resp, `Gagal menyinkronkan daftar lagu Drive (${resp.status})`));
    }

    const data = await resp.json();
    for (const file of data.files || []) {
      if (isAudioMediaItem(file)) {
        audioFiles.push({
          id: file.id,
          name: file.name,
          mimeType: inferAudioMimeType(file.name, file.mimeType),
          size: Number(file.size || 0),
          parents: file.parents || [],
        });
      }
    }

    pageToken = data.nextPageToken || '';
  } while (pageToken);

  return audioFiles;
}

function uploadBinaryToSessionUri(sessionUri, file, mimeType, onProgress = null) {
  if (typeof XMLHttpRequest === 'undefined') {
    return fetch(sessionUri, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType,
      },
      body: file,
    }).then(async (resp) => {
      if (!resp.ok) {
        throw new Error(await parseDriveErrorMessage(resp, `Gagal mengunggah file (${resp.status})`));
      }
      if (onProgress) onProgress(100);
      return resp.json();
    });
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', sessionUri);
    xhr.setRequestHeader('Content-Type', mimeType);

    if (onProgress) {
      onProgress(0);
      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable && evt.total > 0) {
          const percent = Math.min(99, Math.round((evt.loaded / evt.total) * 100));
          onProgress(percent);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (onProgress) onProgress(100);
        try {
          resolve(JSON.parse(xhr.responseText || '{}'));
        } catch {
          reject(new Error('Respons metadata upload Google Drive tidak valid.'));
        }
      } else {
        let errBody = {};
        try {
          errBody = JSON.parse(xhr.responseText || '{}');
        } catch {
          // keep empty object
        }
        reject(new Error(extractDriveErrorFromBody(errBody, `Gagal mengunggah file (${xhr.status})`)));
      }
    };

    xhr.onerror = () => reject(new Error('Koneksi terputus saat mengunggah file ke Google Drive.'));
    xhr.onabort = () => reject(new Error('Pengunggahan file dibatalkan.'));
    xhr.send(file);
  });
}

/**
 * Upload an audio File/Blob to Google Drive using Resumable Upload
 * @param {File} file
 * @param {string|null} [folderId]
 * @param {function(number): void} [onProgress]
 * @returns {Promise<{id: string, name: string, mimeType: string, size: number, parents: string[]}>}
 */
export async function uploadAudioToDrive(file, folderId = null, onProgress = null) {
  const mimeType = inferAudioMimeType(file.name, file.type);
  const metadata = {
    name: file.name,
    mimeType,
    ...(folderId ? { parents: [folderId] } : {}),
  };

  const initResp = await fetchDriveWithAuth(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,parents',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(file.size || 0),
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!initResp.ok) {
    throw new Error(await parseDriveErrorMessage(initResp, `Gagal memulai upload ke Google Drive (${initResp.status})`));
  }

  const sessionUri = initResp.headers.get('Location');
  if (!sessionUri) {
    throw new Error('Header Location sesi upload tidak ditemukan pada respons Google Drive.');
  }

  const uploaded = await uploadBinaryToSessionUri(sessionUri, file, mimeType, onProgress);
  if (!uploaded?.id) {
    throw new Error('Google Drive tidak mengembalikan ID berkas hasil upload.');
  }

  return {
    id: uploaded.id,
    name: uploaded.name || file.name,
    mimeType: uploaded.mimeType || mimeType,
    size: Number(uploaded.size || file.size || 0),
    parents: uploaded.parents || (folderId ? [folderId] : []),
  };
}

export function buildUploadDuplicateKey(name, size) {
  return `${String(name || '').trim().toLowerCase()}::${Number(size || 0)}`;
}

export function inferAudioMimeType(fileName = '', providedType = '') {
  if (providedType && providedType !== 'application/octet-stream') {
    return providedType;
  }
  const ext = String(fileName).split('.').pop()?.toLowerCase() || '';
  return AUDIO_MIME_BY_EXT[ext] || 'audio/mpeg';
}

export function isAudioMediaItem(item = {}) {
  return Boolean(
    item.mimeType?.startsWith('audio/') ||
    item.mimeType === 'application/ogg' ||
    item.mimeType === 'video/mp4' ||
    item.mimeType === 'video/webm' ||
    isAudioExtension(item.name)
  );
}

function isAudioExtension(name = '') {
  return /\.(mp3|m4a|aac|flac|wav|ogg|opus|mp4|m4v|webm)$/i.test(name);
}

/**
 * Download an audio file as Blob from Google Drive API
 * Endpoint: https://www.googleapis.com/drive/v3/files/{id}?alt=media
 * @param {string} fileId
 * @param {function(number): void} [onProgress]
 * @param {number} [expectedSize]
 * @returns {Promise<{blob: Blob, mimeType: string}>}
 */
export async function downloadDriveAudioFile(fileId, onProgress = null, expectedSize = 0) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const resp = await fetchDriveWithAuth(url, {}, true);

  if (!resp.ok) {
    throw new Error(`Gagal mengunduh audio dari Google Drive (Status: ${resp.status})`);
  }

  const headerLength = Number(resp.headers.get('content-length')) || 0;
  const contentLength = headerLength > 0 ? headerLength : Number(expectedSize || 0);
  const contentType = resp.headers.get('content-type') || 'audio/mpeg';

  if (!resp.body || typeof ReadableStream === 'undefined' || !onProgress) {
    const blob = await resp.blob();
    if (onProgress) onProgress(100);
    return { blob, mimeType: contentType };
  }

  // Trigger initial progress indicator
  onProgress(0);

  // Stream with progress calculation
  const reader = resp.body.getReader();
  let receivedLength = 0;
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    receivedLength += value.length;
    if (contentLength > 0) {
      const percent = Math.min(99, Math.round((receivedLength / contentLength) * 100));
      onProgress(percent);
    } else {
      onProgress(50);
    }
  }

  onProgress(100);

  const blob = new Blob(chunks, { type: contentType });
  return { blob, mimeType: contentType };
}
