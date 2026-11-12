import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  SCOPES,
  DITUNE_FOLDER_NAME,
  hasActiveSession,
  clearSessionToken,
  ensureGisLoaded,
  ensurePickerLoaded,
  initGoogleAuth,
  getAccessToken,
  fetchDriveWithAuth,
  openGooglePicker,
  findDituneFolder,
  findOrCreateDituneFolder,
  listAuthorizedAudioFiles,
  uploadAudioToDrive,
  downloadDriveAudioFile,
  buildUploadDuplicateKey,
  inferAudioMimeType,
  isAudioMediaItem,
} from '../src/modules/auth/gdrive.js';

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

describe('Google Drive (drive.file) Auth & API Helpers', () => {
  let originalLocalStorage;
  let originalSessionStorage;
  let originalFetch;
  let originalXHR;
  let originalWindow;
  let originalDocument;
  let originalClientId;
  let originalApiKey;

  beforeEach(() => {
    originalLocalStorage = globalThis.localStorage;
    originalSessionStorage = globalThis.sessionStorage;
    originalFetch = globalThis.fetch;
    originalXHR = globalThis.XMLHttpRequest;
    originalWindow = globalThis.window;
    originalDocument = globalThis.document;
    originalClientId = process.env.VITE_GOOGLE_CLIENT_ID;
    originalApiKey = process.env.VITE_GOOGLE_API_KEY;

    delete process.env.VITE_GOOGLE_CLIENT_ID;
    delete process.env.VITE_GOOGLE_API_KEY;
    globalThis.localStorage = createMemoryStorage();
    globalThis.sessionStorage = createMemoryStorage();
    clearSessionToken();
  });

  afterEach(() => {
    clearSessionToken();
    globalThis.localStorage = originalLocalStorage;
    globalThis.sessionStorage = originalSessionStorage;
    globalThis.fetch = originalFetch;
    globalThis.XMLHttpRequest = originalXHR;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
    if (originalDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }
    if (originalClientId === undefined) {
      delete process.env.VITE_GOOGLE_CLIENT_ID;
    } else {
      process.env.VITE_GOOGLE_CLIENT_ID = originalClientId;
    }
    if (originalApiKey === undefined) {
      delete process.env.VITE_GOOGLE_API_KEY;
    } else {
      process.env.VITE_GOOGLE_API_KEY = originalApiKey;
    }
  });

  test('SCOPES should enforce non-sensitive drive.file scope', () => {
    assert.equal(SCOPES, 'https://www.googleapis.com/auth/drive.file');
    assert.equal(DITUNE_FOLDER_NAME, 'DITUNE Music');
  });

  test('inferAudioMimeType and isAudioMediaItem should resolve common audio formats', () => {
    assert.equal(inferAudioMimeType('track.mp3', ''), 'audio/mpeg');
    assert.equal(inferAudioMimeType('lossless.flac', 'application/octet-stream'), 'audio/flac');
    assert.equal(inferAudioMimeType('voice.opus', ''), 'audio/opus');
    assert.equal(inferAudioMimeType('song.m4a', 'audio/x-m4a'), 'audio/x-m4a');

    assert.equal(isAudioMediaItem({ name: 'track.mp3', mimeType: '' }), true);
    assert.equal(isAudioMediaItem({ name: 'clip.mp4', mimeType: 'video/mp4' }), true);
    assert.equal(isAudioMediaItem({ name: 'audio-stream', mimeType: 'audio/webm' }), true);
    assert.equal(isAudioMediaItem({ name: 'ogg-stream', mimeType: 'application/ogg' }), true);
    assert.equal(isAudioMediaItem({ name: 'cover.jpg', mimeType: 'image/jpeg' }), false);
    assert.equal(isAudioMediaItem({ name: 'DITUNE Music', mimeType: 'application/vnd.google-apps.folder' }), false);
  });

  test('buildUploadDuplicateKey should normalize filename casing, whitespace, and byte size', () => {
    assert.equal(
      buildUploadDuplicateKey('  My_Song.MP3 ', 1024),
      buildUploadDuplicateKey('my_song.mp3', '1024')
    );
    assert.notEqual(
      buildUploadDuplicateKey('My_Song.mp3', 1024),
      buildUploadDuplicateKey('My_Song.mp3', 2048)
    );
  });

  test('getAccessToken should invalidate legacy token without ditune_oauth_scope key', async () => {
    const futureExpiry = String(Date.now() + 3600 * 1000);
    globalThis.localStorage.setItem('ditune_oauth_token', 'legacy-token-no-scope');
    globalThis.localStorage.setItem('ditune_oauth_expires_at', futureExpiry);

    await assert.rejects(() => getAccessToken(false), /Google Client ID belum dikonfigurasi/);
    assert.equal(globalThis.localStorage.getItem('ditune_oauth_token'), null);
  });

  test('getAccessToken should invalidate legacy token without matching drive.file scope', async () => {
    const futureExpiry = String(Date.now() + 3600 * 1000);
    globalThis.localStorage.setItem('ditune_oauth_token', 'legacy-readonly-token');
    globalThis.localStorage.setItem('ditune_oauth_expires_at', futureExpiry);
    globalThis.localStorage.setItem('ditune_oauth_scope', 'https://www.googleapis.com/auth/drive.readonly');

    await assert.rejects(() => getAccessToken(false), /Google Client ID belum dikonfigurasi/);
    assert.equal(globalThis.localStorage.getItem('ditune_oauth_token'), null);
    assert.equal(globalThis.localStorage.getItem('ditune_oauth_scope'), null);
  });

  test('getAccessToken should restore valid cached token when scope matches drive.file', async () => {
    const futureExpiry = String(Date.now() + 3600 * 1000);
    globalThis.localStorage.setItem('ditune_oauth_token', 'valid-drive-file-token');
    globalThis.localStorage.setItem('ditune_oauth_expires_at', futureExpiry);
    globalThis.localStorage.setItem('ditune_oauth_scope', SCOPES);

    const token = await getAccessToken(false);
    assert.equal(token, 'valid-drive-file-token');
  });

  test('findOrCreateDituneFolder should reuse existing DITUNE Music folder without creating duplicate', async () => {
    globalThis.localStorage.setItem('ditune_oauth_token', 'valid-token');
    globalThis.localStorage.setItem('ditune_oauth_expires_at', String(Date.now() + 3600 * 1000));
    globalThis.localStorage.setItem('ditune_oauth_scope', SCOPES);

    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, method: init?.method || 'GET' });
      return new Response(JSON.stringify({ files: [{ id: 'folder-existing', name: 'DITUNE Music' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const folder = await findOrCreateDituneFolder();
    assert.deepEqual(folder, { id: 'folder-existing', name: 'DITUNE Music' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
  });

  test('findOrCreateDituneFolder should create DITUNE Music folder when none exists', async () => {
    globalThis.localStorage.setItem('ditune_oauth_token', 'valid-token');
    globalThis.localStorage.setItem('ditune_oauth_expires_at', String(Date.now() + 3600 * 1000));
    globalThis.localStorage.setItem('ditune_oauth_scope', SCOPES);

    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, method: init?.method || 'GET', body: init?.body });
      if (!init?.method || init.method === 'GET') {
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'folder-created', name: 'DITUNE Music' }), { status: 200 });
    };

    const folder = await findOrCreateDituneFolder();
    assert.deepEqual(folder, { id: 'folder-created', name: 'DITUNE Music' });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].method, 'POST');
    assert.deepEqual(JSON.parse(calls[1].body), {
      name: 'DITUNE Music',
      mimeType: 'application/vnd.google-apps.folder',
    });
  });

  test('listAuthorizedAudioFiles should paginate and filter non-audio files', async () => {
    globalThis.localStorage.setItem('ditune_oauth_token', 'valid-token');
    globalThis.localStorage.setItem('ditune_oauth_expires_at', String(Date.now() + 3600 * 1000));
    globalThis.localStorage.setItem('ditune_oauth_scope', SCOPES);

    let callIndex = 0;
    globalThis.fetch = async (url) => {
      callIndex++;
      if (callIndex === 1) {
        assert.ok(!url.includes('pageToken='));
        return new Response(
          JSON.stringify({
            nextPageToken: 'page-2',
            files: [
              { id: 'a1', name: 'song1.mp3', mimeType: 'audio/mpeg', size: '1234', parents: ['fld-1'] },
              { id: 'img1', name: 'cover.png', mimeType: 'image/png', size: '500' },
            ],
          }),
          { status: 200 }
        );
      }

      assert.ok(url.includes('pageToken=page-2'));
      return new Response(
        JSON.stringify({
          files: [
            { id: 'a2', name: 'track2.flac', mimeType: 'application/octet-stream', size: '5678', parents: ['fld-2'] },
          ],
        }),
        { status: 200 }
      );
    };

    const files = await listAuthorizedAudioFiles();
    assert.equal(files.length, 2);
    assert.deepEqual(files[0], {
      id: 'a1',
      name: 'song1.mp3',
      mimeType: 'audio/mpeg',
      size: 1234,
      parents: ['fld-1'],
    });
    assert.deepEqual(files[1], {
      id: 'a2',
      name: 'track2.flac',
      mimeType: 'audio/flac',
      size: 5678,
      parents: ['fld-2'],
    });
  });

  test('uploadAudioToDrive should initiate resumable session and PUT binary payload', async () => {
    globalThis.localStorage.setItem('ditune_oauth_token', 'valid-token');
    globalThis.localStorage.setItem('ditune_oauth_expires_at', String(Date.now() + 3600 * 1000));
    globalThis.localStorage.setItem('ditune_oauth_scope', SCOPES);

    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, method: init?.method, headers: init?.headers, body: init?.body });
      if (url.includes('uploadType=resumable')) {
        return new Response(null, {
          status: 200,
          headers: { Location: 'https://upload.example.com/session-123' },
        });
      }
      return new Response(
        JSON.stringify({
          id: 'uploaded-1',
          name: 'demo.flac',
          mimeType: 'audio/flac',
          size: '11',
          parents: ['fld-ditune'],
        }),
        { status: 200 }
      );
    };

    const progressEvents = [];
    const blob = new Blob(['audio-bytes'], { type: '' });
    blob.name = 'demo.flac';

    const uploaded = await uploadAudioToDrive(blob, 'fld-ditune', (pct) => progressEvents.push(pct));

    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].headers['X-Upload-Content-Type'], 'audio/flac');
    assert.deepEqual(JSON.parse(calls[0].body), {
      name: 'demo.flac',
      mimeType: 'audio/flac',
      parents: ['fld-ditune'],
    });
    assert.equal(calls[1].url, 'https://upload.example.com/session-123');
    assert.equal(calls[1].method, 'PUT');
    assert.ok(progressEvents.includes(100));
    assert.deepEqual(uploaded, {
      id: 'uploaded-1',
      name: 'demo.flac',
      mimeType: 'audio/flac',
      size: 11,
      parents: ['fld-ditune'],
    });
  });

  test('findDituneFolder should return null when folder does not exist and avoid creating one', async () => {
    globalThis.localStorage.setItem('ditune_oauth_token', 'valid-token');
    globalThis.localStorage.setItem('ditune_oauth_expires_at', String(Date.now() + 3600 * 1000));
    globalThis.localStorage.setItem('ditune_oauth_scope', SCOPES);

    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return new Response(JSON.stringify({ files: [] }), { status: 200 });
    };

    const folder = await findDituneFolder();
    assert.equal(folder, null);
    assert.equal(callCount, 1);
  });

  test('fetchDriveWithAuth should clear stale token on 401 before attempting refresh', async () => {
    globalThis.localStorage.setItem('ditune_oauth_token', 'revoked-token');
    globalThis.localStorage.setItem('ditune_oauth_expires_at', String(Date.now() + 3600 * 1000));
    globalThis.localStorage.setItem('ditune_oauth_scope', SCOPES);

    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'Invalid Credentials' } }), { status: 401 });

    await assert.rejects(() => findDituneFolder(), /Google Client ID belum dikonfigurasi/);
    assert.equal(globalThis.localStorage.getItem('ditune_oauth_token'), null);
  });

  test('uploadAudioToDrive should reject if Location header or uploaded file ID is missing', async () => {
    globalThis.localStorage.setItem('ditune_oauth_token', 'valid-token');
    globalThis.localStorage.setItem('ditune_oauth_expires_at', String(Date.now() + 3600 * 1000));
    globalThis.localStorage.setItem('ditune_oauth_scope', SCOPES);

    globalThis.fetch = async () => new Response(null, { status: 200 });
    const blob = new Blob(['audio-bytes'], { type: 'audio/mpeg' });
    blob.name = 'missing-location.mp3';

    await assert.rejects(() => uploadAudioToDrive(blob, 'fld-ditune'), /Header Location sesi upload tidak ditemukan/);

    globalThis.fetch = async (url) => {
      if (url.includes('uploadType=resumable')) {
        return new Response(null, {
          status: 200,
          headers: { Location: 'https://upload.example.com/session-bad' },
        });
      }
      return new Response(JSON.stringify({ name: 'no-id.mp3' }), { status: 200 });
    };

    await assert.rejects(() => uploadAudioToDrive(blob, 'fld-ditune'), /tidak mengembalikan ID berkas/);
  });

  test('uploadAudioToDrive should use XMLHttpRequest with progress, error parsing, and network failure handling', async () => {
    globalThis.localStorage.setItem('ditune_oauth_token', 'valid-token');
    globalThis.localStorage.setItem('ditune_oauth_expires_at', String(Date.now() + 3600 * 1000));
    globalThis.localStorage.setItem('ditune_oauth_scope', SCOPES);

    globalThis.fetch = async () =>
      new Response(null, {
        status: 200,
        headers: { Location: 'https://upload.example.com/xhr-session' },
      });

    let xhrBehavior = 'success';
    globalThis.XMLHttpRequest = class MockXHR {
      constructor() {
        this.upload = {};
        this.headers = {};
      }
      open(method, url) {
        this.method = method;
        this.url = url;
      }
      setRequestHeader(k, v) {
        this.headers[k] = v;
      }
      send() {
        if (this.upload.onprogress) {
          this.upload.onprogress({ lengthComputable: true, loaded: 5, total: 10 });
        }
        if (xhrBehavior === 'success') {
          this.status = 200;
          this.responseText = JSON.stringify({ id: 'xhr-file-1', name: 'xhr.mp3', mimeType: 'audio/mpeg', size: '10' });
          this.onload();
        } else if (xhrBehavior === 'http-error') {
          this.status = 403;
          this.responseText = JSON.stringify({ error: { message: 'Storage quota exceeded' } });
          this.onload();
        } else if (xhrBehavior === 'network-error') {
          this.onerror();
        } else if (xhrBehavior === 'abort') {
          this.onabort();
        }
      }
    };

    const blob = new Blob(['0123456789'], { type: 'audio/mpeg' });
    blob.name = 'xhr.mp3';

    const progress = [];
    const uploaded = await uploadAudioToDrive(blob, 'fld-ditune', (pct) => progress.push(pct));
    assert.deepEqual(progress, [0, 50, 100]);
    assert.equal(uploaded.id, 'xhr-file-1');

    xhrBehavior = 'http-error';
    await assert.rejects(() => uploadAudioToDrive(blob, 'fld-ditune'), /Storage quota exceeded/);

    xhrBehavior = 'network-error';
    await assert.rejects(() => uploadAudioToDrive(blob, 'fld-ditune'), /Koneksi terputus/);

    xhrBehavior = 'abort';
    await assert.rejects(() => uploadAudioToDrive(blob, 'fld-ditune'), /dibatalkan/);
  });

  test('hasActiveSession should reflect valid drive.file token vs expired or wrong scope', () => {
    assert.equal(hasActiveSession(), false);

    globalThis.localStorage.setItem('ditune_oauth_token', 'tok-wrong-scope');
    globalThis.localStorage.setItem('ditune_oauth_expires_at', String(Date.now() + 3600 * 1000));
    globalThis.localStorage.setItem('ditune_oauth_scope', 'https://www.googleapis.com/auth/drive.readonly');
    assert.equal(hasActiveSession(), false);

    globalThis.localStorage.setItem('ditune_oauth_token', 'tok-expired');
    globalThis.localStorage.setItem('ditune_oauth_expires_at', String(Date.now() + 10000)); // < 60s buffer
    globalThis.localStorage.setItem('ditune_oauth_scope', SCOPES);
    assert.equal(hasActiveSession(), false);

    globalThis.localStorage.setItem('ditune_oauth_token', 'tok-valid');
    globalThis.localStorage.setItem('ditune_oauth_expires_at', String(Date.now() + 3600 * 1000));
    globalThis.localStorage.setItem('ditune_oauth_scope', SCOPES);
    assert.equal(hasActiveSession(), true);
  });

  test('getAccessToken should validate GIS scope, handle errors, and deduplicate concurrent requests', async () => {
    process.env.VITE_GOOGLE_CLIENT_ID = '123456-test.apps.googleusercontent.com';

    let requestCalls = 0;
    let nextResponseHandler = null;

    globalThis.window = {
      google: {
        accounts: {
          oauth2: {
            initTokenClient(config) {
              const client = {
                callback: config.callback,
                error_callback: config.error_callback,
                requestAccessToken() {
                  requestCalls++;
                  setTimeout(() => nextResponseHandler(client), 5);
                },
              };
              return client;
            },
          },
        },
      },
    };

    // 1. Reject if granted scope omits drive.file
    nextResponseHandler = (client) => {
      client.callback({
        access_token: 'wrong-scope-tok',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/userinfo.email',
      });
    };
    await assert.rejects(() => getAccessToken(true), /Izin Google Drive \(drive\.file\) diperlukan/);
    assert.equal(globalThis.localStorage.getItem('ditune_oauth_token'), null);

    // 2. Reject with mapped popup error messages
    nextResponseHandler = (client) => client.error_callback({ type: 'popup_closed' });
    await assert.rejects(() => getAccessToken(true), /Popup login Google ditutup sebelum selesai/);

    nextResponseHandler = (client) => client.error_callback({ type: 'popup_failed_to_open' });
    await assert.rejects(() => getAccessToken(true), /Popup login Google diblokir oleh browser/);

    nextResponseHandler = (client) => client.callback({ error: 'access_denied', error_description: 'User denied' });
    await assert.rejects(() => getAccessToken(true), /User denied/);

    // 3. Single-flight deduplication across concurrent calls
    requestCalls = 0;
    nextResponseHandler = (client) => {
      client.callback({
        access_token: 'fresh-single-flight-token',
        expires_in: 3600,
        scope: `openid ${SCOPES}`,
      });
    };

    const [t1, t2] = await Promise.all([getAccessToken(true), getAccessToken(true)]);
    assert.equal(t1, 'fresh-single-flight-token');
    assert.equal(t2, 'fresh-single-flight-token');
    assert.equal(requestCalls, 1);
    assert.equal(globalThis.localStorage.getItem('ditune_oauth_scope'), SCOPES);
  });

  test('fetchDriveWithAuth should clear 401 token, refresh via GIS once, and retry request to 200', async () => {
    process.env.VITE_GOOGLE_CLIENT_ID = '123456-test.apps.googleusercontent.com';
    globalThis.localStorage.setItem('ditune_oauth_token', 'stale-token');
    globalThis.localStorage.setItem('ditune_oauth_expires_at', String(Date.now() + 3600 * 1000));
    globalThis.localStorage.setItem('ditune_oauth_scope', SCOPES);

    let oauthPrompts = 0;
    globalThis.window = {
      google: {
        accounts: {
          oauth2: {
            initTokenClient() {
              const client = {
                requestAccessToken() {
                  oauthPrompts++;
                  setTimeout(() => {
                    client.callback({
                      access_token: 'refreshed-token-200',
                      expires_in: 3600,
                      scope: SCOPES,
                    });
                  }, 5);
                },
              };
              return client;
            },
          },
        },
      },
    };

    const seenAuthHeaders = [];
    globalThis.fetch = async (url, init) => {
      seenAuthHeaders.push(init.headers.Authorization);
      if (init.headers.Authorization === 'Bearer stale-token') {
        return new Response(JSON.stringify({ error: { message: 'Invalid Credentials' } }), { status: 401 });
      }
      return new Response(JSON.stringify({ files: [{ id: 'fld-1', name: 'DITUNE Music' }] }), { status: 200 });
    };

    const [r1, r2] = await Promise.all([
      fetchDriveWithAuth('https://www.googleapis.com/drive/v3/files'),
      fetchDriveWithAuth('https://www.googleapis.com/drive/v3/files'),
    ]);

    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(oauthPrompts, 1);
    assert.ok(seenAuthHeaders.includes('Bearer stale-token'));
    assert.ok(seenAuthHeaders.includes('Bearer refreshed-token-200'));
  });

  test('openGooglePicker should support octet-stream, filter picked items, and refresh revoked cached token', async () => {
    await assert.rejects(() => openGooglePicker(), /CONFIG_NEEDED/);

    process.env.VITE_GOOGLE_CLIENT_ID = '998877-app.apps.googleusercontent.com';
    process.env.VITE_GOOGLE_API_KEY = 'fake-api-key';
    globalThis.localStorage.setItem('ditune_oauth_token', 'revoked-cached-token');
    globalThis.localStorage.setItem('ditune_oauth_expires_at', String(Date.now() + 3600 * 1000));
    globalThis.localStorage.setItem('ditune_oauth_scope', SCOPES);

    let capturedMimeTypes = '';
    let capturedOAuthToken = '';
    let capturedAppId = '';
    let pickerActionToEmit = 'picked';

    class MockDocsView {
      setIncludeFolders(v) { this.includeFolders = v; return this; }
      setSelectFolderEnabled(v) { this.selectFolder = v; return this; }
      setMimeTypes(m) { capturedMimeTypes = m; return this; }
      setMode() { return this; }
      setLabel() { return this; }
    }

    class MockPickerBuilder {
      enableFeature(f) { this.feature = f; return this; }
      setAppId(id) { capturedAppId = id; return this; }
      setOAuthToken(tok) { capturedOAuthToken = tok; return this; }
      addView(v) { this.view = v; return this; }
      setDeveloperKey() { return this; }
      setTitle() { return this; }
      setCallback(cb) { this.cb = cb; return this; }
      build() {
        return {
          setVisible: () => {
            if (pickerActionToEmit === 'picked') {
              this.cb({
                action: 'picked',
                docs: [
                  { id: 'doc-1', name: 'lossless.flac', mimeType: 'application/octet-stream', sizeBytes: '2048' },
                  { id: 'doc-2', name: 'readme.pdf', mimeType: 'application/pdf', sizeBytes: '100' },
                ],
              });
            } else {
              this.cb({ action: 'cancel' });
            }
          },
        };
      }
    }

    globalThis.window = {
      google: {
        accounts: {
          oauth2: {
            initTokenClient() {
              const client = {
                requestAccessToken() {
                  client.callback({
                    access_token: 'fresh-picker-token',
                    expires_in: 3600,
                    scope: SCOPES,
                  });
                },
              };
              return client;
            },
          },
        },
        picker: {
          DocsView: MockDocsView,
          DocsViewMode: { LIST: 'list' },
          PickerBuilder: MockPickerBuilder,
          Feature: { MULTISELECT_ENABLED: 'multiselect' },
          Action: { PICKED: 'picked', CANCEL: 'cancel' },
          Response: { DOCUMENTS: 'docs' },
        },
      },
    };

    globalThis.fetch = async (url, init) => {
      if (init.headers.Authorization === 'Bearer revoked-cached-token') {
        return new Response(JSON.stringify({ error: { message: 'Revoked' } }), { status: 401 });
      }
      return new Response(JSON.stringify({ files: [] }), { status: 200 });
    };

    const picked = await openGooglePicker();
    assert.equal(capturedAppId, '998877');
    assert.equal(capturedOAuthToken, 'fresh-picker-token');
    assert.ok(capturedMimeTypes.includes('application/octet-stream'));
    assert.deepEqual(picked, {
      files: [
        { id: 'doc-1', name: 'lossless.flac', mimeType: 'audio/flac', size: 2048 },
      ],
      folder: null,
    });

    pickerActionToEmit = 'cancel';
    const cancelled = await openGooglePicker();
    assert.equal(cancelled, null);
  });

  test('downloadDriveAudioFile should stream progress, fallback cleanly, and handle HTTP errors', async () => {
    process.env.VITE_GOOGLE_CLIENT_ID = '123456-test.apps.googleusercontent.com';
    globalThis.localStorage.setItem('ditune_oauth_token', 'valid-dl-token');
    globalThis.localStorage.setItem('ditune_oauth_expires_at', String(Date.now() + 3600 * 1000));
    globalThis.localStorage.setItem('ditune_oauth_scope', SCOPES);

    // 1. Streaming progress with expectedSize fallback (no content-length header)
    globalThis.fetch = async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3, 4]));
          controller.enqueue(new Uint8Array([5, 6, 7, 8]));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'audio/flac' },
      });
    };

    const progress = [];
    const res = await downloadDriveAudioFile('file-1', (pct) => progress.push(pct), 8);
    assert.equal(res.mimeType, 'audio/flac');
    assert.equal(res.blob.size, 8);
    assert.deepEqual(progress, [0, 50, 99, 100]);

    // 2. HTTP error status
    globalThis.fetch = async () => new Response('Not Found', { status: 404 });
    await assert.rejects(() => downloadDriveAudioFile('missing-id'), /Status: 404/);
  });

  test('ensureGisLoaded, ensurePickerLoaded, and initGoogleAuth should deduplicate script loads and recover after failure', async () => {
    const appendedScripts = [];
    const existingSrcs = new Set();
    let failNextScript = true;

    globalThis.window = {};
    globalThis.document = {
      querySelector: (sel) => {
        const match = sel.match(/script\[src="([^"]+)"\]/);
        return match && existingSrcs.has(match[1]) ? { src: match[1] } : null;
      },
      createElement: () => ({
        src: '',
        async: false,
        defer: false,
        onload: null,
        onerror: null,
        remove() {
          existingSrcs.delete(this.src);
        },
      }),
      head: {
        appendChild(script) {
          appendedScripts.push(script.src);
          setTimeout(() => {
            if (script.src.includes('gsi/client') && failNextScript) {
              failNextScript = false;
              script.onerror();
              return;
            }
            existingSrcs.add(script.src);
            if (script.src.includes('gsi/client')) {
              globalThis.window.google = {
                ...(globalThis.window.google || {}),
                accounts: { oauth2: { initTokenClient: () => ({}) } },
              };
            }
            if (script.src.includes('apis.google.com/js/api.js')) {
              globalThis.window.gapi = {
                load(lib, cb) {
                  assert.equal(lib, 'picker');
                  globalThis.window.google = {
                    ...(globalThis.window.google || {}),
                    picker: { PickerBuilder: class {} },
                  };
                  cb();
                },
              };
            }
            script.onload();
          }, 5);
        },
      },
    };

    // First GIS load fails and cleans up so retry succeeds
    await assert.rejects(() => ensureGisLoaded(), /Gagal memuat script/);
    await Promise.all([ensureGisLoaded(), ensureGisLoaded()]);

    // Concurrent Picker loads deduplicate to 1 script tag
    await Promise.all([ensurePickerLoaded(), ensurePickerLoaded()]);
    await initGoogleAuth();

    assert.equal(appendedScripts.filter((s) => s.includes('gsi/client')).length, 2);
    assert.equal(appendedScripts.filter((s) => s.includes('apis.google.com/js/api.js')).length, 1);
  });

  test('uploadAudioToDrive should retry on 401 during resumable init, and API helpers should surface Drive error messages', async () => {
    process.env.VITE_GOOGLE_CLIENT_ID = '123456-test.apps.googleusercontent.com';
    globalThis.localStorage.setItem('ditune_oauth_token', 'expired-upload-token');
    globalThis.localStorage.setItem('ditune_oauth_expires_at', String(Date.now() + 3600 * 1000));
    globalThis.localStorage.setItem('ditune_oauth_scope', SCOPES);

    globalThis.window = {
      google: {
        accounts: {
          oauth2: {
            initTokenClient() {
              const client = {
                requestAccessToken() {
                  client.callback({ access_token: 'fresh-upload-token', expires_in: 3600, scope: SCOPES });
                },
              };
              return client;
            },
          },
        },
      },
    };

    globalThis.fetch = async (url, init) => {
      if (url.includes('uploadType=resumable')) {
        if (init.headers.Authorization === 'Bearer expired-upload-token') {
          return new Response(JSON.stringify({ error: { message: 'Expired' } }), { status: 401 });
        }
        return new Response(null, { status: 200, headers: { Location: 'https://upload.example.com/retried' } });
      }
      if (url === 'https://upload.example.com/retried') {
        return new Response(JSON.stringify({ id: 'retried-1', name: 'retry.mp3', size: '5' }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { message: 'Drive rate limit' } }), { status: 429 });
    };

    const blob = new Blob(['12345'], { type: 'audio/mpeg' });
    blob.name = 'retry.mp3';
    const uploaded = await uploadAudioToDrive(blob, 'fld-1');
    assert.equal(uploaded.id, 'retried-1');

    await assert.rejects(() => listAuthorizedAudioFiles(), /Drive rate limit/);
    await assert.rejects(() => findOrCreateDituneFolder(), /Drive rate limit/);
  });

  test('openGooglePicker should reject cleanly when Picker emits ERROR action', async () => {
    process.env.VITE_GOOGLE_CLIENT_ID = '998877-app.apps.googleusercontent.com';
    process.env.VITE_GOOGLE_API_KEY = 'fake-api-key';
    globalThis.localStorage.setItem('ditune_oauth_token', 'valid-picker-token');
    globalThis.localStorage.setItem('ditune_oauth_expires_at', String(Date.now() + 3600 * 1000));
    globalThis.localStorage.setItem('ditune_oauth_scope', SCOPES);

    globalThis.fetch = async () => new Response(JSON.stringify({ files: [] }), { status: 200 });
    globalThis.window = {
      google: {
        picker: {
          DocsView: class {
            setIncludeFolders() { return this; }
            setSelectFolderEnabled() { return this; }
            setMimeTypes() { return this; }
            setMode() { return this; }
            setLabel() { return this; }
          },
          DocsViewMode: { LIST: 'list' },
          PickerBuilder: class {
            enableFeature() { return this; }
            setAppId() { return this; }
            setOAuthToken() { return this; }
            addView() { return this; }
            setDeveloperKey() { return this; }
            setTitle() { return this; }
            setCallback(cb) { this.cb = cb; return this; }
            build() { return { setVisible: () => this.cb({ action: 'error' }) }; }
          },
          Feature: { MULTISELECT_ENABLED: 'multiselect' },
          Action: { PICKED: 'picked', CANCEL: 'cancel', ERROR: 'error' },
          Response: { DOCUMENTS: 'docs' },
        },
      },
    };

    await assert.rejects(() => openGooglePicker(), /Google Picker mengalami kesalahan/);
  });
});

