import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import {
  clearAllData,
  getAllTracks,
  saveTrack,
  saveAudioBlob,
  getAudioBlob,
  getSetting,
  setSetting,
  ignoreTrack,
  getIgnoredTracks,
} from '../src/modules/storage/db.js';
import { SCOPES, clearSessionToken } from '../src/modules/auth/gdrive.js';
import { showProgressToast, removeProgressToast } from '../src/modules/ui/components.js';

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

function createMockAudioEngine() {
  return {
    currentTrack: null,
    isPlaying: false,
    playlist: [],
    currentIndex: -1,
    volume: 1.0,
    on() {},
    pause() { this.isPlaying = false; },
    playNext() {},
    getDuration() { return 0; },
    setVolume(v) { this.volume = v; },
  };
}

function createMockElement(id = '', onRemove = null) {
  const listeners = new Map();
  const classes = new Set();
  const el = {
    id,
    className: '',
    disabled: false,
    value: '',
    files: null,
    _html: '',
    textContent: '',
    style: {},
    children: [],
    classList: {
      add(...names) { names.forEach((n) => classes.add(n)); },
      remove(...names) { names.forEach((n) => classes.delete(n)); },
      toggle(name, force) {
        if (force === undefined) {
          if (classes.has(name)) classes.delete(name);
          else classes.add(name);
          return classes.has(name);
        }
        if (force) classes.add(name);
        else classes.delete(name);
        return Boolean(force);
      },
      contains(name) { return classes.has(name); },
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    async dispatchEvent(evt) {
      const list = listeners.get(evt.type) || [];
      for (const fn of list) {
        await fn(evt);
      }
    },
    querySelector() { return null; },
    closest(selector) {
      if (selector === `#${el.id}`) return el;
      return null;
    },
    click() {
      this._clicked = (this._clicked || 0) + 1;
    },
    remove() {
      if (onRemove) onRemove(el);
    },
  };
  return el;
}

function installMinimalBrowserMocks(capturedToasts = [], capturedToastMeta = []) {
  const mockElements = new Map();
  const docListeners = new Map();

  const toastContainer = {
    children: [],
    appendChild(el) {
      this.children.push(el);
      if (el.id) mockElements.set(el.id, el);
      if (el._html) {
        capturedToasts.push(el._html);
        capturedToastMeta.push({ className: el.className, html: el._html });
      }
    },
  };

  globalThis.document = {
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: (type, fn) => {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    getElementById: (id) => {
      if (id === 'toast-container') return toastContainer;
      return mockElements.get(id) || null;
    },
    createElement: () => {
      const el = createMockElement('', (removed) => {
        toastContainer.children = toastContainer.children.filter((c) => c !== removed);
        if (removed.id && mockElements.get(removed.id) === removed) {
          mockElements.delete(removed.id);
        }
      });
      Object.defineProperty(el, 'innerHTML', {
        set(val) {
          el._html = val;
          if (el.id === 'toast-batch-upload') {
            capturedToasts.push(val);
          }
        },
        get() {
          return el._html;
        },
      });
      return el;
    },
  };

  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  globalThis.requestAnimationFrame = () => {};
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true },
    configurable: true,
  });

  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...args) => {
    const timer = realSetTimeout(fn, ms, ...args);
    if (timer && typeof timer.unref === 'function') timer.unref();
    return timer;
  };

  return {
    mockElements,
    toastContainer,
    restoreTimeout: () => {
      globalThis.setTimeout = realSetTimeout;
    },
  };
}

const { UIController } = await import('../src/modules/ui/events.js');

describe('UIController (drive.file batch upload, sync & concurrency guards)', () => {
  let originalLocalStorage;
  let originalSessionStorage;
  let originalFetch;
  let originalXHR;
  let originalDocument;
  let originalWindow;
  let originalNavigatorDescriptor;
  let originalRAF;
  let originalClientId;
  let originalApiKey;
  let restoreTimeout;
  let capturedToasts;
  let capturedToastMeta;
  let mockElements;

  beforeEach(async () => {
    originalLocalStorage = globalThis.localStorage;
    originalSessionStorage = globalThis.sessionStorage;
    originalFetch = globalThis.fetch;
    originalXHR = globalThis.XMLHttpRequest;
    originalDocument = globalThis.document;
    originalWindow = globalThis.window;
    originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    originalRAF = globalThis.requestAnimationFrame;
    originalClientId = process.env.VITE_GOOGLE_CLIENT_ID;
    originalApiKey = process.env.VITE_GOOGLE_API_KEY;

    globalThis.localStorage = createMemoryStorage();
    globalThis.sessionStorage = createMemoryStorage();
    clearSessionToken();

    process.env.VITE_GOOGLE_CLIENT_ID = '123456-test.apps.googleusercontent.com';
    process.env.VITE_GOOGLE_API_KEY = 'test-api-key';
    globalThis.localStorage.setItem('ditune_oauth_token', 'valid-ui-token');
    globalThis.localStorage.setItem('ditune_oauth_expires_at', String(Date.now() + 3600 * 1000));
    globalThis.localStorage.setItem('ditune_oauth_scope', SCOPES);

    capturedToasts = [];
    capturedToastMeta = [];
    ({ restoreTimeout, mockElements } = installMinimalBrowserMocks(capturedToasts, capturedToastMeta));

    await clearAllData();
    await setSetting('connected_folder', null);
    await setSetting('ignored_tracks', []);
  });

  afterEach(async () => {
    restoreTimeout();
    clearSessionToken();
    await clearAllData();

    globalThis.localStorage = originalLocalStorage;
    globalThis.sessionStorage = originalSessionStorage;
    globalThis.fetch = originalFetch;
    globalThis.XMLHttpRequest = originalXHR;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.requestAnimationFrame = originalRAF;

    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
    }
    if (originalClientId === undefined) delete process.env.VITE_GOOGLE_CLIENT_ID;
    else process.env.VITE_GOOGLE_CLIENT_ID = originalClientId;
    if (originalApiKey === undefined) delete process.env.VITE_GOOGLE_API_KEY;
    else process.env.VITE_GOOGLE_API_KEY = originalApiKey;
  });

  test('reloadTracks should clear legacy connected_folder without drive.file scope and serialize concurrent calls', async () => {
    const controller = new UIController(createMockAudioEngine());

    await setSetting('connected_folder', { id: 'old-fld', name: 'Old Music' });
    await controller.reloadTracks();
    assert.equal(controller.connectedFolder, null);
    assert.equal(await getSetting('connected_folder'), null);

    await setSetting('connected_folder', { id: 'new-fld', name: 'DITUNE Music', scope: 'drive.file' });
    await saveTrack({ id: 't-1', name: 'song_one.mp3', title: 'song_one', isCached: false });

    const p1 = controller.reloadTracks();
    await saveTrack({ id: 't-2', name: 'song two.mp3', title: 'song two', isCached: false });
    const p2 = controller.reloadTracks();
    await Promise.all([p1, p2]);

    assert.equal(controller.connectedFolder.id, 'new-fld');
    assert.equal(controller.allTracks.length, 2);
    assert.equal(controller.allTracks.find((t) => t.id === 't-1').title, 'song one');
  });

  test('handleFilesUpload should not treat Picker file with empty parents as in DITUNE Music, and should skip & cache local library duplicates', async () => {
    const controller = new UIController(createMockAudioEngine());

    // Pre-existing Picker-imported track in local library (uncached) from another folder
    await saveTrack({
      id: 'picker-track-1',
      name: 'already-imported.mp3',
      title: 'Already Imported',
      artist: 'Picker Artist',
      album: 'Picker Album',
      size: 10,
      mimeType: 'audio/mpeg',
      isCached: false,
    });
    await controller.reloadTracks();

    const uploadedNames = [];
    delete globalThis.XMLHttpRequest;

    globalThis.fetch = async (url, init) => {
      const decodedUrl = decodeURIComponent(url);
      if (decodedUrl.includes("mimeType = 'application/vnd.google-apps.folder'")) {
        return new Response(JSON.stringify({ files: [{ id: 'ditune-fld-1', name: 'DITUNE Music' }] }), { status: 200 });
      }
      if (url.includes('files?q=') && !url.includes('uploadType=resumable')) {
        return new Response(
          JSON.stringify({
            files: [
              // Picker file whose parent folder is inaccessible -> parents: []
              { id: 'picker-orphan-remote', name: 'needs-upload.mp3', mimeType: 'audio/mpeg', size: '12', parents: [] },
              // Picker-imported file in local library with other parent
              { id: 'picker-track-1', name: 'already-imported.mp3', mimeType: 'audio/mpeg', size: '10', parents: ['other-fld'] },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('uploadType=resumable')) {
        const meta = JSON.parse(init.body);
        uploadedNames.push(meta.name);
        return new Response(null, {
          status: 200,
          headers: { Location: `https://upload.example.com/${meta.name}` },
        });
      }
      if (url.startsWith('https://upload.example.com/')) {
        const name = url.split('/').pop();
        return new Response(
          JSON.stringify({
            id: `uploaded-${name}`,
            name,
            mimeType: 'audio/mpeg',
            size: '12',
            parents: ['ditune-fld-1'],
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };

    const fileNeedsUpload = new Blob(['123456789012'], { type: 'audio/mpeg' });
    fileNeedsUpload.name = 'needs-upload.mp3';

    const fileAlreadyImported = new Blob(['1234567890'], { type: 'audio/mpeg' });
    fileAlreadyImported.name = 'already-imported.mp3';

    await controller.handleFilesUpload([fileNeedsUpload, fileAlreadyImported]);

    // 1. File with empty parents NOT in local library MUST be uploaded (regression test for !rf.parents?.length bug)
    assert.deepEqual(uploadedNames, ['needs-upload.mp3']);

    // 2. Local library Picker track MUST be skipped from upload and cached directly into IndexedDB
    const cachedPickerBlob = await getAudioBlob('picker-track-1');
    assert.ok(cachedPickerBlob);
    assert.equal(cachedPickerBlob.size, 10);

    // 3. New uploaded track must be saved & cached
    const tracks = await getAllTracks();
    assert.equal(tracks.length, 2);
    assert.ok(tracks.every((t) => t.isCached === true));
  });

  test('handleFilesUpload should skip files in DITUNE Music, unignore if ignored, and report accurate message when all skipped', async () => {
    const controller = new UIController(createMockAudioEngine());
    await ignoreTrack({ id: 'remote-in-folder-1', name: 'existing_song.mp3', title: 'existing_song' });

    let uploadCalled = false;
    globalThis.fetch = async (url) => {
      const decodedUrl = decodeURIComponent(url);
      if (decodedUrl.includes("mimeType = 'application/vnd.google-apps.folder'")) {
        return new Response(JSON.stringify({ files: [{ id: 'ditune-fld-1', name: 'DITUNE Music' }] }), { status: 200 });
      }
      if (url.includes('files?q=')) {
        return new Response(
          JSON.stringify({
            files: [
              { id: 'remote-in-folder-1', name: 'existing_song.mp3', mimeType: 'audio/mpeg', size: '9', parents: ['ditune-fld-1'] },
            ],
          }),
          { status: 200 }
        );
      }
      uploadCalled = true;
      return new Response(null, { status: 500 });
    };

    const dupFile = new Blob(['123456789'], { type: 'audio/mpeg' });
    dupFile.name = 'existing_song.mp3';

    await controller.handleFilesUpload([dupFile]);

    assert.equal(uploadCalled, false);
    assert.equal((await getIgnoredTracks()).length, 0);
    const tracks = await getAllTracks();
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].title, 'existing song');
    assert.equal(tracks[0].isCached, true);
    assert.ok(capturedToasts.some((msg) => msg.includes('sudah ada di &quot;DITUNE Music&quot;')));
  });

  test('handleFilesUpload should handle parallel batch uploads cleanly without overwriting allTracks', async () => {
    const controller = new UIController(createMockAudioEngine());
    delete globalThis.XMLHttpRequest;

    let uploadCounter = 0;
    globalThis.fetch = async (url, init) => {
      const decodedUrl = decodeURIComponent(url);
      if (decodedUrl.includes("mimeType = 'application/vnd.google-apps.folder'")) {
        return new Response(JSON.stringify({ files: [{ id: 'ditune-fld-1', name: 'DITUNE Music' }] }), { status: 200 });
      }
      if (url.includes('files?q=') && !url.includes('uploadType=resumable')) {
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }
      if (url.includes('uploadType=resumable')) {
        const meta = JSON.parse(init.body);
        return new Response(null, {
          status: 200,
          headers: { Location: `https://upload.example.com/${encodeURIComponent(meta.name)}` },
        });
      }
      if (url.startsWith('https://upload.example.com/')) {
        const name = decodeURIComponent(url.split('/').pop());
        uploadCounter++;
        // Stagger completion times to exercise parallel workers finishing out-of-order
        await new Promise((r) => setTimeout(r, name === 'track-1.mp3' ? 25 : 5));
        return new Response(
          JSON.stringify({
            id: `id-${name}`,
            name,
            mimeType: 'audio/mpeg',
            size: '5',
            parents: ['ditune-fld-1'],
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const files = ['track-1.mp3', 'track-2.mp3', 'track-3.mp3'].map((name) => {
      const b = new Blob(['audio'], { type: 'audio/mpeg' });
      b.name = name;
      return b;
    });

    await controller.handleFilesUpload(files);

    assert.equal(uploadCounter, 3);
    assert.equal(controller.isBatchUploading, false);
    assert.equal(controller.allTracks.length, 3);
    assert.equal((await getAllTracks()).length, 3);
  });

  test('syncConnectedFolder should persist connected_folder even when DITUNE Music exists with 0 audio files', async () => {
    const controller = new UIController(createMockAudioEngine());

    globalThis.fetch = async (url) => {
      const decodedUrl = decodeURIComponent(url);
      if (decodedUrl.includes("mimeType = 'application/vnd.google-apps.folder'")) {
        return new Response(JSON.stringify({ files: [{ id: 'empty-ditune-fld', name: 'DITUNE Music' }] }), { status: 200 });
      }
      if (url.includes('files?q=')) {
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    await controller.syncConnectedFolder();

    assert.equal(controller.connectedFolder?.id, 'empty-ditune-fld');
    assert.equal(controller.connectedFolder?.scope, 'drive.file');
    const saved = await getSetting('connected_folder');
    assert.equal(saved?.id, 'empty-ditune-fld');
    assert.equal(saved?.scope, 'drive.file');
    assert.ok(capturedToasts.some((msg) => msg.includes('terhubung, belum ada lagu di dalamnya')));
  });

  test('busy-state guards should prevent sync, clearCache, resetLibrary, and picker during active batch upload', async () => {
    const controller = new UIController(createMockAudioEngine());
    await saveTrack({ id: 'keep-1', name: 'keep.mp3', title: 'Keep', isCached: true });
    await saveAudioBlob('keep-1', new Blob(['keep']), 'audio/mpeg');
    await controller.reloadTracks();

    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response(JSON.stringify({ files: [] }), { status: 200 });
    };

    controller.isBatchUploading = true;

    await controller.syncConnectedFolder();
    await controller.triggerDrivePicker();
    const cleared = await controller.handleClearCache(() => true);
    const reset = await controller.handleResetLibrary(() => true);

    assert.equal(fetchCalled, false);
    assert.equal(cleared, false);
    assert.equal(reset, false);
    assert.equal((await getAllTracks()).length, 1);
    assert.ok(await getAudioBlob('keep-1'));

    // When idle and confirmed, handleClearCache and handleResetLibrary work normally
    controller.isBatchUploading = false;
    assert.equal(await controller.handleClearCache(() => true), true);
    assert.equal(await getAudioBlob('keep-1'), null);
    assert.equal((await getAllTracks()).length, 1);

    assert.equal(await controller.handleResetLibrary(() => true), true);
    assert.equal((await getAllTracks()).length, 0);
  });

  test('handleFilesUpload should handle partial batch failure and library-only duplicate toast accurately', async () => {
    const controller = new UIController(createMockAudioEngine());
    delete globalThis.XMLHttpRequest;

    await saveTrack({
      id: 'lib-only-1',
      name: 'already-in-lib.mp3',
      title: 'Already In Lib',
      size: 7,
      mimeType: 'audio/mpeg',
      isCached: true,
    });
    await saveAudioBlob('lib-only-1', new Blob(['1234567'], { type: 'audio/mpeg' }), 'audio/mpeg');
    await controller.reloadTracks();

    // Case 1: Only library duplicate dropped -> toast should mention library, not falsely say DITUNE Music only
    globalThis.fetch = async (url) => {
      const decodedUrl = decodeURIComponent(url);
      if (decodedUrl.includes("mimeType = 'application/vnd.google-apps.folder'")) {
        return new Response(JSON.stringify({ files: [{ id: 'ditune-fld-1', name: 'DITUNE Music' }] }), { status: 200 });
      }
      if (url.includes('files?q=')) {
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const dupLibFile = new Blob(['1234567'], { type: 'audio/mpeg' });
    dupLibFile.name = 'already-in-lib.mp3';
    await controller.handleFilesUpload([dupLibFile]);
    assert.ok(capturedToasts.some((msg) => msg.includes('sudah ada di pustaka atau &quot;DITUNE Music&quot;')));

    // Case 2: Partial failure in batch (1 succeeds, 1 fails)
    capturedToasts.length = 0;
    globalThis.fetch = async (url, init) => {
      const decodedUrl = decodeURIComponent(url);
      if (decodedUrl.includes("mimeType = 'application/vnd.google-apps.folder'")) {
        return new Response(JSON.stringify({ files: [{ id: 'ditune-fld-1', name: 'DITUNE Music' }] }), { status: 200 });
      }
      if (url.includes('files?q=') && !url.includes('uploadType=resumable')) {
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }
      if (url.includes('uploadType=resumable')) {
        const meta = JSON.parse(init.body);
        if (meta.name === 'fail.mp3') {
          return new Response(JSON.stringify({ error: { message: 'Quota exceeded' } }), { status: 403 });
        }
        return new Response(null, {
          status: 200,
          headers: { Location: `https://upload.example.com/${encodeURIComponent(meta.name)}` },
        });
      }
      if (url.startsWith('https://upload.example.com/')) {
        return new Response(
          JSON.stringify({ id: 'ok-1', name: 'ok.mp3', mimeType: 'audio/mpeg', size: '4', parents: ['ditune-fld-1'] }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const okFile = new Blob(['good'], { type: 'audio/mpeg' });
    okFile.name = 'ok.mp3';
    const failFile = new Blob(['bad'], { type: 'audio/mpeg' });
    failFile.name = 'fail.mp3';

    await controller.handleFilesUpload([okFile, failFile]);
    assert.equal(controller.isBatchUploading, false);
    assert.ok(controller.allTracks.some((t) => t.id === 'ok-1'));
    assert.ok(capturedToasts.some((msg) => msg.includes('1 lagu diunggah') && msg.includes('1 gagal (Quota exceeded)')));
  });

  test('syncConnectedFolder should clear connected_folder when DITUNE Music is absent while still syncing Picker files and respecting ignored tracks', async () => {
    const controller = new UIController(createMockAudioEngine());
    await setSetting('connected_folder', { id: 'stale-fld', name: 'DITUNE Music', scope: 'drive.file' });
    await ignoreTrack({ id: 'ignored-picker-1', name: 'hidden.mp3', title: 'Hidden' });

    globalThis.fetch = async (url) => {
      const decodedUrl = decodeURIComponent(url);
      if (decodedUrl.includes("mimeType = 'application/vnd.google-apps.folder'")) {
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }
      if (url.includes('files?q=')) {
        return new Response(
          JSON.stringify({
            files: [
              { id: 'picker-sync-1', name: 'picked_song.mp3', mimeType: 'audio/mpeg', size: '100', parents: ['other-fld'] },
              { id: 'ignored-picker-1', name: 'hidden.mp3', mimeType: 'audio/mpeg', size: '100', parents: [] },
            ],
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    await controller.syncConnectedFolder();

    assert.equal(controller.connectedFolder, null);
    assert.equal(await getSetting('connected_folder'), null);
    assert.equal(controller.allTracks.length, 1);
    assert.equal(controller.allTracks[0].id, 'picker-sync-1');
    assert.equal(controller.allTracks[0].title, 'picked song');
  });

  test('openSettingsModal should render honest OAuth session status and consistent folder fallback text', async () => {
    const controller = new UIController(createMockAudioEngine());
    const makeEl = () => ({
      innerHTML: '',
      textContent: '',
      classList: { add() {}, remove() {} },
    });

    const modalEl = makeEl();
    const badgeEl = makeEl();
    const folderEl = makeEl();
    const ignoredEl = makeEl();
    mockElements.set('settings-modal', modalEl);
    mockElements.set('status-credential-badge', badgeEl);
    mockElements.set('connected-folder-name', folderEl);
    mockElements.set('modal-ignored-count', ignoredEl);

    // 1. Active session present
    await controller.openSettingsModal();
    assert.ok(badgeEl.innerHTML.includes('Sesi Google Aktif'));
    assert.equal(folderEl.textContent, 'DITUNE Music (Otomatis)');

    // 2. Credentials configured, but NO active OAuth session yet
    clearSessionToken();
    await controller.openSettingsModal();
    assert.ok(badgeEl.innerHTML.includes('Siap Login'));
    assert.equal(badgeEl.innerHTML.includes('Terhubung'), false);

    // 3. Credentials missing
    delete process.env.VITE_GOOGLE_CLIENT_ID;
    await controller.openSettingsModal();
    assert.ok(badgeEl.innerHTML.includes('Kredensial Belum Siap'));
  });

  test('persistTrackBlobWithMetadata should safely handle null blob and normalize underscore titles', async () => {
    const controller = new UIController(createMockAudioEngine());

    const noBlobTrack = await controller.persistTrackBlobWithMetadata(
      { id: 'nob-1', name: 'raw_track_name.mp3' },
      null,
      'audio/mpeg'
    );
    assert.equal(noBlobTrack.title, 'raw track name');

    const blob = new Blob(['not-id3-audio'], { type: 'audio/mpeg' });
    const withBlobTrack = await controller.persistTrackBlobWithMetadata(
      { id: 'withb-1', name: 'my_custom_song.mp3' },
      blob,
      'audio/mpeg'
    );
    assert.equal(withBlobTrack.title, 'my custom song');
    assert.equal(withBlobTrack.isCached, true);
  });

  test('triggerDrivePicker should import multi-selected tracks, preserve cached ID3 metadata, skip ignored, handle cancel, and prevent double open', async () => {
    const controller = new UIController(createMockAudioEngine());

    // Pre-existing cached track with rich ID3 metadata that must be preserved on re-pick
    await saveTrack({
      id: 'picked-existing',
      name: 'old_name.mp3',
      title: 'Rich ID3 Title',
      artist: 'Rich Artist',
      album: 'Rich Album',
      duration: 215,
      size: 1000,
      isCached: true,
    });
    await saveAudioBlob('picked-existing', new Blob(['cached-bytes']), 'audio/mpeg');
    await ignoreTrack({ id: 'picked-ignored', name: 'secret.mp3', title: 'Secret' });
    await controller.reloadTracks();

    let pickerMode = 'picked';
    let releasePicker = null;
    let pickerBuilds = 0;

    globalThis.fetch = async () => new Response(JSON.stringify({ files: [] }), { status: 200 });
    globalThis.window.google = {
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
          build() {
            pickerBuilds++;
            return {
              setVisible: () => {
                if (pickerMode === 'hold') {
                  releasePicker = () => this.cb({ action: 'cancel' });
                  return;
                }
                if (pickerMode === 'cancel') {
                  this.cb({ action: 'cancel' });
                  return;
                }
                this.cb({
                  action: 'picked',
                  docs: [
                    { id: 'picked-existing', name: 'old_name.mp3', mimeType: 'audio/mpeg', sizeBytes: '12' },
                    { id: 'picked-new', name: 'fresh_drop.flac', mimeType: 'application/octet-stream', sizeBytes: '4096' },
                    { id: 'picked-ignored', name: 'secret.mp3', mimeType: 'audio/mpeg', sizeBytes: '900' },
                  ],
                });
              },
            };
          }
        },
        Feature: { MULTISELECT_ENABLED: 'multiselect' },
        Action: { PICKED: 'picked', CANCEL: 'cancel' },
        Response: { DOCUMENTS: 'docs' },
      },
    };

    await controller.triggerDrivePicker();
    assert.equal(controller.allTracks.length, 2);
    const existing = controller.allTracks.find((t) => t.id === 'picked-existing');
    const added = controller.allTracks.find((t) => t.id === 'picked-new');
    assert.equal(existing.title, 'Rich ID3 Title');
    assert.equal(existing.artist, 'Rich Artist');
    assert.equal(existing.isCached, true);
    assert.equal(added.title, 'fresh drop');
    assert.equal(added.mimeType, 'audio/flac');

    // Concurrent second triggerDrivePicker call while Picker is open must be blocked
    pickerMode = 'hold';
    pickerBuilds = 0;
    const firstPick = controller.triggerDrivePicker();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(controller.isPicking, true);
    await controller.triggerDrivePicker();
    assert.equal(pickerBuilds, 1);
    releasePicker();
    await firstPick;
    assert.equal(controller.isPicking, false);

    // Offline guard
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
    pickerBuilds = 0;
    await controller.triggerDrivePicker();
    assert.equal(pickerBuilds, 0);
  });

  test('downloadSingleTrack and downloadAllTracks should handle progress, incremental updates, offline guards, and honest failure toasts', async () => {
    const controller = new UIController(createMockAudioEngine());
    await saveTrack({ id: 'dl-1', name: 'track_one.mp3', title: 'track one', isCached: false, size: 6 });
    await saveTrack({ id: 'dl-2', name: 'track_two.mp3', title: 'track two', isCached: false, size: 6 });
    await controller.reloadTracks();

    const rowCacheStatus = {
      innerHTML: '',
      querySelector: () => ({ textContent: '3:00' }),
    };
    globalThis.document.querySelector = (sel) => {
      if (sel.includes('dl-1')) {
        return { querySelector: () => rowCacheStatus };
      }
      return null;
    };

    let failSecond = false;
    globalThis.fetch = async (url) => {
      if (url.includes('/files/dl-2') && failSecond) {
        return new Response('Missing', { status: 404 });
      }
      return new Response(new Uint8Array([1, 2, 3, 4, 5, 6]), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg', 'content-length': '6' },
      });
    };

    // Single track download + DOM progress check
    await controller.downloadSingleTrack('dl-1');
    assert.equal(controller.downloadingTrackIds.size, 0);
    assert.ok(rowCacheStatus.innerHTML.includes('100%'));
    assert.equal(controller.allTracks.find((t) => t.id === 'dl-1').isCached, true);

    // Error during downloadSingleTrack cleans up downloadingTrackIds
    failSecond = true;
    await controller.downloadSingleTrack('dl-2');
    assert.equal(controller.downloadingTrackIds.size, 0);
    assert.equal(controller.allTracks.find((t) => t.id === 'dl-2').isCached, false);

    // downloadAllTracks with 0 successes emits error summary, not success
    capturedToasts.length = 0;
    capturedToastMeta.length = 0;
    await controller.downloadAllTracks();
    assert.equal(controller.isBatchDownloading, false);
    assert.ok(
      capturedToastMeta.some((t) => t.html.includes('0 dari 1 lagu berhasil') && t.className.includes('bg-red-950'))
    );

    // downloadAllTracks blocks when single track download is active
    controller.downloadingTrackIds.add('dl-2');
    failSecond = false;
    await controller.downloadAllTracks();
    assert.equal(controller.allTracks.find((t) => t.id === 'dl-2').isCached, false);
    controller.downloadingTrackIds.clear();

    // downloadAllTracks succeeds on remaining uncached track
    capturedToasts.length = 0;
    capturedToastMeta.length = 0;
    await controller.downloadAllTracks();
    assert.equal(controller.allTracks.find((t) => t.id === 'dl-2').isCached, true);
    assert.ok(
      capturedToastMeta.some((t) => t.html.includes('1 dari 1 lagu berhasil') && t.className.includes('bg-emerald-950'))
    );
  });

  test('executeDeleteTrack and handleRemoveTrackCache should stop active engine safely and honor busy guards', async () => {
    let stopCalls = 0;
    const engine = {
      ...createMockAudioEngine(),
      stop() {
        stopCalls++;
        this.playlist = [];
        this.currentIndex = -1;
        this.currentTrack = null;
      },
    };
    const controller = new UIController(engine);

    await saveTrack({ id: 'act-1', name: 'active.mp3', title: 'Active', isCached: true });
    await saveAudioBlob('act-1', new Blob(['active-audio']), 'audio/mpeg');
    await controller.reloadTracks();

    engine.playlist = [...controller.allTracks];
    engine.currentIndex = 0;
    engine.currentTrack = controller.allTracks[0];

    // Busy guard blocks cache removal and track deletion
    controller.isPicking = true;
    await controller.handleRemoveTrackCache('act-1');
    await controller.executeDeleteTrack(controller.allTracks[0]);
    assert.equal(controller.allTracks.length, 1);
    assert.ok(await getAudioBlob('act-1'));
    controller.isPicking = false;

    // Idle: remove cache then delete active track
    await controller.handleRemoveTrackCache('act-1');
    assert.equal(await getAudioBlob('act-1'), null);
    assert.equal(controller.allTracks[0].isCached, false);

    await controller.executeDeleteTrack(controller.allTracks[0]);
    assert.equal(stopCalls, 1);
    assert.equal(engine.currentTrack, null);
    assert.equal(controller.allTracks.length, 0);
    assert.equal((await getIgnoredTracks()).length, 1);
  });

  test('bindDOMEvents should wire upload button, file input reset, drag-and-drop overlay, and action buttons', async () => {
    const contentContainer = createMockElement('content-container');
    const mainWorkspace = createMockElement('main-workspace');
    const dropOverlay = createMockElement('upload-drop-overlay');
    dropOverlay.classList.add('hidden');
    const uploadInput = createMockElement('upload-audio-input');
    const uploadBtn = createMockElement('btn-upload-tracks');
    const importBtn = createMockElement('btn-import-drive');
    const syncBtn = createMockElement('btn-sync-folder');

    mockElements.set('content-container', contentContainer);
    mockElements.set('main-workspace', mainWorkspace);
    mockElements.set('upload-drop-overlay', dropOverlay);
    mockElements.set('upload-audio-input', uploadInput);
    mockElements.set('btn-upload-tracks', uploadBtn);
    mockElements.set('btn-import-drive', importBtn);
    mockElements.set('btn-sync-folder', syncBtn);

    const controller = new UIController(createMockAudioEngine());
    const calls = [];
    let inputValDuringUpload = 'unset';
    controller.handleFilesUpload = async (files) => {
      inputValDuringUpload = uploadInput.value;
      calls.push({ type: 'upload', count: files.length });
    };
    controller.triggerDrivePicker = async () => calls.push({ type: 'picker' });
    controller.syncConnectedFolder = async () => calls.push({ type: 'sync' });

    // Click delegation on contentContainer
    await contentContainer.dispatchEvent({
      type: 'click',
      target: { closest: (sel) => (sel === '#btn-upload-tracks' ? uploadBtn : null) },
    });
    assert.equal(uploadInput._clicked, 1);

    await contentContainer.dispatchEvent({
      type: 'click',
      target: { closest: (sel) => (sel === '#btn-import-drive' ? importBtn : null) },
    });
    await contentContainer.dispatchEvent({
      type: 'click',
      target: { closest: (sel) => (sel === '#btn-sync-folder' ? syncBtn : null) },
    });

    // File input change snapshots files and clears value immediately BEFORE awaiting handleFilesUpload
    const f1 = new Blob(['abc'], { type: 'audio/mpeg' });
    f1.name = 'chosen.mp3';
    uploadInput.value = 'C:\\fakepath\\chosen.mp3';
    uploadInput.files = [f1];
    await uploadInput.dispatchEvent({ type: 'change', target: uploadInput });
    assert.equal(inputValDuringUpload, '');

    // Drag-and-drop overlay visibility & drop upload
    await mainWorkspace.dispatchEvent({
      type: 'dragenter',
      dataTransfer: { types: ['Files'] },
      preventDefault() {},
    });
    assert.equal(dropOverlay.classList.contains('hidden'), false);
    assert.equal(dropOverlay.classList.contains('flex'), true);

    await mainWorkspace.dispatchEvent({
      type: 'dragleave',
      dataTransfer: { types: ['Files'] },
    });
    assert.equal(dropOverlay.classList.contains('hidden'), true);

    await mainWorkspace.dispatchEvent({
      type: 'drop',
      dataTransfer: { types: ['Files'], files: [f1] },
      preventDefault() {},
    });

    assert.deepEqual(calls, [
      { type: 'picker' },
      { type: 'sync' },
      { type: 'upload', count: 1 },
      { type: 'upload', count: 1 },
    ]);
  });

  test('showProgressToast should cancel pending removeProgressToast timer on consecutive batch reuse', async () => {
    const first = showProgressToast('batch-upload', 'Batch 1', 50, false);
    assert.ok(globalThis.document.getElementById('toast-batch-upload'));

    removeProgressToast('batch-upload');
    assert.equal(first.classList.contains('opacity-0'), true);

    // Re-trigger within 300ms fade window
    const second = showProgressToast('batch-upload', 'Batch 2', 10, false);
    assert.equal(second, first);
    assert.equal(second.classList.contains('opacity-0'), false);

    await new Promise((r) => setTimeout(r, 340));
    assert.ok(globalThis.document.getElementById('toast-batch-upload'));
  });
});
