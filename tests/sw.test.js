import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const swSource = fs.readFileSync(path.resolve(__dirname, '../public/sw.js'), 'utf8');

function createSwHarness({ fetchImpl } = {}) {
  const listeners = new Map();
  const cacheStores = new Map();

  const getStore = (name) => {
    if (!cacheStores.has(name)) cacheStores.set(name, new Map());
    return cacheStores.get(name);
  };

  const toKey = (req) => (typeof req === 'string' ? req : req.url);

  const cachesMock = {
    async open(name) {
      const store = getStore(name);
      return {
        async addAll(urls) {
          for (const u of urls) {
            store.set(u, new Response(`cached:${u}`, { status: 200 }));
          }
        },
        async put(req, resp) {
          const url = new URL(toKey(req), 'https://ditune.netlify.app');
          store.set(url.pathname, resp);
        },
      };
    },
    async keys() {
      return Array.from(cacheStores.keys());
    },
    async delete(key) {
      return cacheStores.delete(key);
    },
    async match(req) {
      const url = new URL(toKey(req), 'https://ditune.netlify.app');
      for (const store of cacheStores.values()) {
        if (store.has(url.pathname)) return store.get(url.pathname);
      }
      return undefined;
    },
  };

  const selfMock = {
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
  };

  const context = {
    self: selfMock,
    caches: cachesMock,
    URL,
    Response,
    fetch: fetchImpl || (async () => new Response('network', { status: 200 })),
  };

  vm.runInNewContext(swSource, context);

  return {
    listeners,
    cacheStores,
    cachesMock,
    async install() {
      const promises = [];
      listeners.get('install')({ waitUntil: (p) => promises.push(p) });
      await Promise.all(promises);
    },
    async activate() {
      const promises = [];
      listeners.get('activate')({ waitUntil: (p) => promises.push(p) });
      await Promise.all(promises);
    },
    async dispatchFetch(url, { mode = 'navigate', method = 'GET', accept = 'text/html' } = {}) {
      let respondedPromise = null;
      const event = {
        request: {
          url,
          method,
          mode,
          headers: { get: (k) => (k.toLowerCase() === 'accept' ? accept : null) },
        },
        respondWith(p) {
          respondedPromise = p;
        },
      };
      listeners.get('fetch')(event);
      return {
        intercepted: respondedPromise !== null,
        response: respondedPromise ? await respondedPromise : null,
      };
    },
  };
}

describe('Service Worker (public/sw.js) Cache Isolation', () => {
  test('install should precache /privacy.html and /terms.html in ditune-shell-v6', async () => {
    const sw = createSwHarness();
    await sw.install();

    const shellCache = sw.cacheStores.get('ditune-shell-v6');
    assert.ok(shellCache);
    assert.ok(shellCache.has('/'));
    assert.ok(shellCache.has('/index.html'));
    assert.ok(shellCache.has('/privacy.html'));
    assert.ok(shellCache.has('/terms.html'));
  });

  test('navigating to /privacy.html or /terms.html must not overwrite cached /index.html', async () => {
    const sw = createSwHarness({
      fetchImpl: async (req) => {
        const pathname = new URL(req.url).pathname;
        return new Response(`live:${pathname}`, { status: 200 });
      },
    });
    await sw.install();

    // Seed /index.html with app shell content
    const shellCache = sw.cacheStores.get('ditune-shell-v6');
    shellCache.set('/index.html', new Response('app-shell-index', { status: 200 }));

    // Visit /privacy.html online
    const privacyFetch = await sw.dispatchFetch('https://ditune.netlify.app/privacy.html');
    assert.equal(privacyFetch.intercepted, true);
    assert.equal(await privacyFetch.response.text(), 'live:/privacy.html');

    // Allow microtasks for cache.put inside fetch handler
    await new Promise((r) => setTimeout(r, 10));

    // /index.html must remain untouched!
    assert.equal(await shellCache.get('/index.html').text(), 'app-shell-index');
    assert.equal(await shellCache.get('/privacy.html').text(), 'live:/privacy.html');
  });

  test('offline fallback should serve /privacy.html and /index.html independently', async () => {
    const sw = createSwHarness({
      fetchImpl: async () => Promise.reject(new Error('Offline')),
    });
    await sw.install();

    const offlinePrivacy = await sw.dispatchFetch('https://ditune.netlify.app/privacy.html');
    assert.equal(await offlinePrivacy.response.text(), 'cached:/privacy.html');

    const offlineRoot = await sw.dispatchFetch('https://ditune.netlify.app/');
    assert.equal(await offlineRoot.response.text(), 'cached:/');
  });

  test('Google API and Drive URLs should bypass Service Worker interception', async () => {
    const sw = createSwHarness();
    await sw.install();

    const driveRes = await sw.dispatchFetch('https://www.googleapis.com/drive/v3/files?alt=media', {
      mode: 'cors',
      accept: '*/*',
    });
    assert.equal(driveRes.intercepted, false);

    const gisRes = await sw.dispatchFetch('https://accounts.google.com/gsi/client', {
      mode: 'no-cors',
      accept: '*/*',
    });
    assert.equal(gisRes.intercepted, false);
  });

  test('activate should purge legacy cache versions while retaining ditune-shell-v6', async () => {
    const sw = createSwHarness();
    sw.cacheStores.set('ditune-shell-v5', new Map([['/index.html', new Response('old')]]));
    await sw.install();
    await sw.activate();

    assert.equal(sw.cacheStores.has('ditune-shell-v5'), false);
    assert.equal(sw.cacheStores.has('ditune-shell-v6'), true);
  });

  test('navigating to /terms.html preserves /index.html and query-string routes fallback offline by pathname', async () => {
    const sw = createSwHarness({
      fetchImpl: async (req) => {
        const pathname = new URL(req.url).pathname;
        if (pathname === '/terms.html') {
          return new Response('live:/terms.html', { status: 200 });
        }
        return Promise.reject(new Error('Offline'));
      },
    });
    await sw.install();
    const shellCache = sw.cacheStores.get('ditune-shell-v6');
    shellCache.set('/', new Response('app-shell-root', { status: 200 }));
    shellCache.set('/index.html', new Response('app-shell-index', { status: 200 }));

    const termsRes = await sw.dispatchFetch('https://ditune.netlify.app/terms.html');
    assert.equal(await termsRes.response.text(), 'live:/terms.html');
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(await shellCache.get('/index.html').text(), 'app-shell-index');

    const offlineQueryRoot = await sw.dispatchFetch('https://ditune.netlify.app/?source=pwa');
    assert.equal(await offlineQueryRoot.response.text(), 'app-shell-root');

    const offlineQueryTerms = await sw.dispatchFetch('https://ditune.netlify.app/terms.html?ref=footer');
    assert.equal(await offlineQueryTerms.response.text(), 'live:/terms.html');
  });
});
