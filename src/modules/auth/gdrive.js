/**
 * DITUNE Google Drive & Google Identity Services (GIS) Module
 * Handles OAuth 2.0 (scope: drive.readonly), Google Picker API, and audio streaming.
 */

const SCOPES = 'https://www.googleapis.com/auth/drive.readonly';
const DISCOVERY_DOCS = ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'];
const SESSION_TOKEN_KEY = 'ditune_oauth_token';
const SESSION_EXPIRES_KEY = 'ditune_oauth_expires_at';

let gisLoaded = false;
let gapiLoaded = false;
let tokenClient = null;
let currentAccessToken = null;
let tokenExpiresAt = 0;

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
  const clientId = (import.meta.env?.VITE_GOOGLE_CLIENT_ID || '').trim();
  const apiKey = (import.meta.env?.VITE_GOOGLE_API_KEY || '').trim();

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
 * Load external script dynamically
 */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = (err) => reject(new Error(`Gagal memuat script: ${src}`));
    document.head.appendChild(script);
  });
}

/**
 * Initialize Google API and GIS libraries
 */
export async function initGoogleAuth() {
  const [gis, gapi] = await Promise.allSettled([
    loadScript('https://accounts.google.com/gsi/client'),
    loadScript('https://apis.google.com/js/api.js'),
  ]);

  if (gis.status === 'fulfilled') gisLoaded = true;
  if (gapi.status === 'fulfilled') gapiLoaded = true;

  if (gapiLoaded && window.gapi) {
    await new Promise((resolve) => window.gapi.load('picker', resolve));
  }
}

/**
 * Clear stored session token
 */
export function clearSessionToken() {
  currentAccessToken = null;
  tokenExpiresAt = 0;
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(SESSION_TOKEN_KEY);
      sessionStorage.removeItem(SESSION_EXPIRES_KEY);
    }
  } catch (e) {
    console.debug('Failed to clear sessionStorage token:', e);
  }
}

/**
 * Get or request a valid access token
 */
export async function getAccessToken(interactive = true) {
  // If token is still valid in memory (with 60s buffer)
  if (currentAccessToken && Date.now() < tokenExpiresAt - 60000) {
    return currentAccessToken;
  }

  // Restore from sessionStorage if still valid
  try {
    if (typeof sessionStorage !== 'undefined') {
      const savedToken = sessionStorage.getItem(SESSION_TOKEN_KEY);
      const savedExpires = Number(sessionStorage.getItem(SESSION_EXPIRES_KEY)) || 0;
      if (savedToken && Date.now() < savedExpires - 60000) {
        currentAccessToken = savedToken;
        tokenExpiresAt = savedExpires;
        return currentAccessToken;
      }
    }
  } catch (e) {
    console.debug('Failed to read sessionStorage token:', e);
  }

  const { clientId } = getCredentials();
  if (!clientId) {
    throw new Error('Google Client ID belum dikonfigurasi. Silakan buka Pengaturan.');
  }

  if (!gisLoaded || !window.google?.accounts?.oauth2) {
    await initGoogleAuth();
  }

  return new Promise((resolve, reject) => {
    try {
      if (!tokenClient) {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPES,
          callback: '', // handled dynamically below
        });
      }

      tokenClient.callback = (resp) => {
        if (resp.error) {
          console.error('[GIS] OAuth error:', resp);
          reject(new Error(resp.error_description || resp.error || 'Autentikasi Google gagal.'));
          return;
        }
        currentAccessToken = resp.access_token;
        const expiresInSec = Number(resp.expires_in) || 3600;
        tokenExpiresAt = Date.now() + expiresInSec * 1000;

        try {
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem(SESSION_TOKEN_KEY, currentAccessToken);
            sessionStorage.setItem(SESSION_EXPIRES_KEY, String(tokenExpiresAt));
          }
        } catch (e) {
          console.debug('Failed to save sessionStorage token:', e);
        }

        resolve(currentAccessToken);
      };

      tokenClient.requestAccessToken({
        prompt: interactive ? '' : 'none',
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Open Google Picker to select audio files or a music folder
 */
export async function openGooglePicker() {
  const { clientId, apiKey } = getCredentials();
  if (!clientId || !apiKey) {
    throw new Error('CONFIG_NEEDED');
  }

  await initGoogleAuth();
  const token = await getAccessToken(true);

  if (!window.google?.picker) {
    throw new Error('Google Picker API belum siap. Mohon periksa koneksi internet.');
  }

  return new Promise((resolve, reject) => {
    try {
      // Audio files view
      const audioView = new window.google.picker.DocsView()
        .setMimeTypes('audio/mpeg,audio/mp3,audio/flac,audio/x-m4a,audio/m4a,audio/wav,audio/ogg,audio/aac')
        .setMode(window.google.picker.DocsViewMode.LIST)
        .setLabel('File Musik');

      // Folder view
      const folderView = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
        .setMimeTypes('application/vnd.google-apps.folder')
        .setSelectFolderEnabled(true)
        .setLabel('Pilih Folder');

      const appId = clientId.split('-')[0] || '';

      const picker = new window.google.picker.PickerBuilder()
        .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
        .setAppId(appId)
        .setOAuthToken(token)
        .addView(folderView)
        .addView(audioView)
        .setDeveloperKey(apiKey)
        .setTitle('DITUNE - Pilih Folder Musik atau File Audio')
        .setCallback(async (data) => {
          if (data.action === window.google.picker.Action.PICKED) {
            const docs = data[window.google.picker.Response.DOCUMENTS] || [];
            try {
              const tracks = await processPickedDocuments(docs, token);
              resolve(tracks);
            } catch (err) {
              reject(err);
            }
          } else if (data.action === window.google.picker.Action.CANCEL) {
            resolve(null);
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
 * Process picked documents from Google Picker
 * If a folder is picked, queries files inside the folder recursively.
 * If audio files are picked, maps them directly.
 */
async function processPickedDocuments(docs, token) {
  const resultFiles = [];

  for (const doc of docs) {
    const isFolder =
      doc.mimeType === 'application/vnd.google-apps.folder' ||
      doc.type === 'folder' ||
      doc[window.google?.picker?.Document?.MIME_TYPE] === 'application/vnd.google-apps.folder';

    if (isFolder) {
      // Query files inside this folder recursively
      const folderId = doc.id;
      const folderFiles = await listAudioFilesFromFolder(folderId, token);
      resultFiles.push(...folderFiles);
    } else if (doc.mimeType?.startsWith('audio/') || isAudioExtension(doc.name)) {
      resultFiles.push({
        id: doc.id,
        name: doc.name,
        mimeType: doc.mimeType || 'audio/mpeg',
        size: Number(doc.sizeBytes || doc.size || 0),
      });
    }
  }

  return resultFiles;
}

/**
 * Query audio files inside a Google Drive folder recursively with pagination
 * @param {string} folderId
 * @param {string} token
 * @param {number} [maxDepth=4]
 * @param {number} [currentDepth=0]
 */
export async function listAudioFilesFromFolder(folderId, token, maxDepth = 4, currentDepth = 0) {
  if (currentDepth > maxDepth) return [];

  const audioFiles = [];
  const subfolderIds = [];
  let pageToken = '';

  do {
    const query = `'${folderId}' in parents and trashed = false`;
    let url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=nextPageToken,files(id,name,mimeType,size)&pageSize=500`;
    if (pageToken) {
      url += `&pageToken=${encodeURIComponent(pageToken)}`;
    }

    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!resp.ok) {
      const errorBody = await resp.json().catch(() => ({}));
      throw new Error(errorBody.error?.message || `Gagal mengambil daftar file folder (${resp.status})`);
    }

    const data = await resp.json();
    const files = data.files || [];

    for (const file of files) {
      if (file.mimeType === 'application/vnd.google-apps.folder') {
        subfolderIds.push(file.id);
      } else if (file.mimeType?.startsWith('audio/') || isAudioExtension(file.name)) {
        audioFiles.push({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType || 'audio/mpeg',
          size: Number(file.size || 0),
          folderId,
        });
      }
    }

    pageToken = data.nextPageToken || '';
  } while (pageToken);

  // Recurse into subfolders
  for (const subId of subfolderIds) {
    try {
      const subFiles = await listAudioFilesFromFolder(subId, token, maxDepth, currentDepth + 1);
      audioFiles.push(...subFiles);
    } catch (err) {
      console.warn(`[GDrive] Subfolder listing failed (${subId}):`, err.message);
    }
  }

  return audioFiles;
}

function isAudioExtension(name = '') {
  return /\.(mp3|m4a|aac|flac|wav|ogg|opus)$/i.test(name);
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
  let token = await getAccessToken(false).catch(() => getAccessToken(true));
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

  let resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  // If unauthorized, retry once with refreshed interactive token
  if (resp.status === 401) {
    clearSessionToken();
    token = await getAccessToken(true);
    resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  if (!resp.ok) {
    throw new Error(`Gagal mengunduh audio dari Google Drive (Status: ${resp.status})`);
  }

  const headerLength = Number(resp.headers.get('content-length')) || 0;
  const contentLength = headerLength > 0 ? headerLength : Number(expectedSize || 0);
  const contentType = resp.headers.get('content-type') || 'audio/mpeg';

  if (!resp.body || !window.ReadableStream || !onProgress) {
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
