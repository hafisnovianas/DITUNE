import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import {
  openDB,
  saveTrack,
  saveTracks,
  getAllTracks,
  getTrack,
  deleteTrack,
  saveAudioBlob,
  getAudioBlob,
  getAllAudioBlobs,
  getAllAudioBlobIds,
  removeAudioBlob,
  saveCover,
  getCover,
  getSetting,
  setSetting,
  getStorageStats,
  clearAllCache,
  clearAllData,
  getIgnoredTracks,
  ignoreTrack,
  unignoreTrack,
  clearIgnoredTracks,
  getAllPlaylists,
  getPlaylist,
  savePlaylist,
  deletePlaylist,
} from '../src/modules/storage/db.js';

describe('IndexedDB Storage Engine', () => {
  beforeEach(async () => {
    await clearAllData();
  });

  test('should open database and have all required object stores', async () => {
    const db = await openDB();
    assert.ok(db.objectStoreNames.contains('tracks'));
    assert.ok(db.objectStoreNames.contains('audio_blobs'));
    assert.ok(db.objectStoreNames.contains('covers'));
    assert.ok(db.objectStoreNames.contains('settings'));
    assert.ok(db.objectStoreNames.contains('playlists'));
  });

  test('should save and retrieve tracks', async () => {
    const track = {
      id: 'track-1',
      name: 'Song A.mp3',
      title: 'Song A',
      artist: 'Artist One',
      album: 'Album One',
      duration: 180,
      size: 5000000,
      mimeType: 'audio/mpeg',
      isCached: false,
    };

    await saveTrack(track);
    const retrieved = await getTrack('track-1');
    assert.deepEqual(retrieved, track);

    const all = await getAllTracks();
    assert.equal(all.length, 1);
    assert.equal(all[0].title, 'Song A');
  });

  test('should batch save tracks', async () => {
    const tracks = [
      { id: 't1', title: 'T1', name: 't1.mp3', artist: 'A', album: 'Alb', duration: 100 },
      { id: 't2', title: 'T2', name: 't2.mp3', artist: 'B', album: 'Alb', duration: 200 },
    ];
    await saveTracks(tracks);

    const all = await getAllTracks();
    assert.equal(all.length, 2);
  });

  test('should save and retrieve audio blobs and update track cached status', async () => {
    const track = {
      id: 't-blob',
      name: 't.mp3',
      title: 'T',
      artist: 'A',
      album: 'Alb',
      duration: 120,
      isCached: false,
    };
    await saveTrack(track);

    const blob = new Blob(['dummy audio content'], { type: 'audio/mpeg' });
    await saveAudioBlob('t-blob', blob, 'audio/mpeg');

    const retrievedBlob = await getAudioBlob('t-blob');
    assert.ok(retrievedBlob);
    assert.equal(retrievedBlob.size, blob.size);

    const updatedTrack = await getTrack('t-blob');
    assert.equal(updatedTrack.isCached, true);
    assert.ok(updatedTrack.cachedAt > 0);

    // Remove blob
    await removeAudioBlob('t-blob');
    const blobAfter = await getAudioBlob('t-blob');
    assert.equal(blobAfter, null);

    const trackAfterRemove = await getTrack('t-blob');
    assert.equal(trackAfterRemove.isCached, false);
  });

  test('should save and retrieve album cover blobs', async () => {
    const coverBlob = new Blob(['<svg></svg>'], { type: 'image/svg+xml' });
    await saveCover('cover-1', coverBlob, 'image/svg+xml');

    const retrieved = await getCover('cover-1');
    assert.ok(retrieved);
    assert.equal(retrieved.size, coverBlob.size);
  });

  test('should get and set settings', async () => {
    const defaultVal = await getSetting('customKey', 'fallback');
    assert.equal(defaultVal, 'fallback');

    await setSetting('customKey', 'my-custom-value');
    const savedVal = await getSetting('customKey');
    assert.equal(savedVal, 'my-custom-value');
  });

  test('should calculate accurate storage stats', async () => {
    const track = { id: 's1', title: 'S1', isCached: false };
    await saveTrack(track);

    const blob = new Blob(['1234567890'], { type: 'audio/mpeg' }); // 10 bytes
    await saveAudioBlob('s1', blob, 'audio/mpeg');

    const stats = await getStorageStats();
    assert.equal(stats.totalTracks, 1);
    assert.equal(stats.cachedCount, 1);
    assert.equal(stats.totalBytes, 10);
  });

  test('clearAllCache should purge blobs but retain track metadata and reset flags', async () => {
    const track = { id: 'c1', title: 'C1', isCached: false, hasCover: true };
    await saveTrack(track);

    const blob = new Blob(['music data'], { type: 'audio/mpeg' });
    await saveAudioBlob('c1', blob, 'audio/mpeg');
    await saveCover('c1', new Blob(['cover art']), 'image/jpeg');

    await clearAllCache();

    const blobAfter = await getAudioBlob('c1');
    assert.equal(blobAfter, null);

    const coverAfter = await getCover('c1');
    assert.equal(coverAfter, null);

    const trackAfter = await getTrack('c1');
    assert.ok(trackAfter);
    assert.equal(trackAfter.isCached, false);
    assert.equal(trackAfter.hasCover, false);
  });

  test('deleteTrack should delete track, audio blob and cover', async () => {
    await saveTrack({ id: 'del-1', title: 'Del' });
    await saveAudioBlob('del-1', new Blob(['a']), 'audio/mpeg');
    await saveCover('del-1', new Blob(['b']), 'image/jpeg');

    await deleteTrack('del-1');

    assert.equal(await getTrack('del-1'), null);
    assert.equal(await getAudioBlob('del-1'), null);
    assert.equal(await getCover('del-1'), null);
  });

  test('getAllAudioBlobIds should return a set of all saved blob IDs', async () => {
    await saveAudioBlob('blob-1', new Blob(['abc']), 'audio/mpeg');
    await saveAudioBlob('blob-2', new Blob(['def']), 'audio/mpeg');

    const ids = await getAllAudioBlobIds();
    assert.ok(ids instanceof Set);
    assert.equal(ids.size, 2);
    assert.ok(ids.has('blob-1'));
    assert.ok(ids.has('blob-2'));
    assert.ok(!ids.has('blob-3'));
  });

  test('getStorageStats should reconcile against audio_blobs SSOT even if track isCached is false', async () => {
    // Simulate desynchronized state: track says isCached: false, but blob exists
    await saveAudioBlob('desync-1', new Blob(['1234567890']), 'audio/mpeg');
    // Save track with isCached explicitly false (bypass auto-heal to simulate stale DB record)
    const db = await openDB();
    const tx = db.transaction('tracks', 'readwrite');
    tx.objectStore('tracks').put({ id: 'desync-1', title: 'Desync Track', isCached: false, size: 0 });
    await new Promise((resolve) => { tx.oncomplete = resolve; });

    const stats = await getStorageStats();
    assert.equal(stats.totalTracks, 1);
    assert.equal(stats.cachedCount, 1, 'Should count track as cached because blob exists in audio_blobs');
    assert.equal(stats.totalBytes, 10, 'Should measure bytes from audio_blobs');

    // Self-healing check: database record must be healed
    const healed = await getTrack('desync-1');
    assert.equal(healed.isCached, true, 'Stored track should be healed to isCached = true');
    assert.equal(healed.size, 10, 'Stored track size should be healed from blob');
  });

  test('getStorageStats should reconcile tracks when track claims isCached but blob is missing', async () => {
    const db = await openDB();
    const tx = db.transaction('tracks', 'readwrite');
    tx.objectStore('tracks').put({ id: 'ghost-1', title: 'Ghost Track', isCached: true, size: 1000 });
    await new Promise((resolve) => { tx.oncomplete = resolve; });

    const stats = await getStorageStats();
    assert.equal(stats.totalTracks, 1);
    assert.equal(stats.cachedCount, 0, 'Ghost track without blob should not be counted as cached');
    assert.equal(stats.totalBytes, 0);

    const healed = await getTrack('ghost-1');
    assert.equal(healed.isCached, false, 'Ghost track in store should be healed to isCached = false');
  });

  test('saveTrack and saveTracks should preserve isCached if audio blob exists and enforce false if missing', async () => {
    await saveAudioBlob('heal-1', new Blob(['content123']), 'audio/mpeg');

    // Trying to save track with isCached: false when blob exists
    const inMemTrack = { id: 'heal-1', title: 'Heal 1', isCached: false };
    await saveTrack(inMemTrack);
    assert.equal(inMemTrack.isCached, true, 'in-memory reference must be updated to isCached = true');
    const track = await getTrack('heal-1');
    assert.equal(track.isCached, true, 'saveTrack must preserve isCached = true when blob exists');

    // Batch saving with isCached: false when blob exists
    const batchList = [{ id: 'heal-1', title: 'Heal Batch', isCached: false }];
    await saveTracks(batchList);
    assert.equal(batchList[0].isCached, true, 'in-memory batch reference must be updated to isCached = true');
    const trackAfterBatch = await getTrack('heal-1');
    assert.equal(trackAfterBatch.isCached, true, 'saveTracks must preserve isCached = true when blob exists');

    // Saving track claiming isCached: true when blob does NOT exist
    const ghostTrack = { id: 'no-blob', title: 'No Blob Track', isCached: true };
    await saveTrack(ghostTrack);
    assert.equal(ghostTrack.isCached, false, 'saveTrack must enforce isCached = false when blob is missing');
    const savedGhost = await getTrack('no-blob');
    assert.equal(savedGhost.isCached, false, 'Stored track must have isCached = false when blob is missing');
  });

  test('ignored tracks management should add, remove, and purge ignored tracks while deleting stored track data', async () => {
    // 1. Initial state must be empty array
    const initialList = await getIgnoredTracks();
    assert.deepEqual(initialList, []);

    // 2. Save a track with audio blob and cover
    const sampleTrack = { id: 'track-to-ignore', title: 'Lagu Rahasia', artist: 'Artis Misteri', album: 'Album X' };
    await saveTrack(sampleTrack);
    await saveAudioBlob('track-to-ignore', new Blob(['test-audio']), 'audio/mpeg');
    await saveCover('track-to-ignore', new Blob(['test-cover']), 'image/jpeg');

    // Verify it exists in stores
    assert.ok(await getTrack('track-to-ignore'));
    assert.ok(await getAudioBlob('track-to-ignore'));
    assert.ok(await getCover('track-to-ignore'));

    // 3. Ignore track
    await ignoreTrack(sampleTrack);

    // 4. Track should be recorded in ignored_tracks
    const ignoredList = await getIgnoredTracks();
    assert.equal(ignoredList.length, 1);
    assert.equal(ignoredList[0].id, 'track-to-ignore');
    assert.equal(ignoredList[0].title, 'Lagu Rahasia');
    assert.ok(ignoredList[0].ignoredAt > 0);

    // 5. Track data must be purged from tracks, audio_blobs, and covers
    assert.equal(await getTrack('track-to-ignore'), null);
    assert.equal(await getAudioBlob('track-to-ignore'), null);
    assert.equal(await getCover('track-to-ignore'), null);

    // 6. Unignore track
    await unignoreTrack('track-to-ignore');
    const afterUnignore = await getIgnoredTracks();
    assert.deepEqual(afterUnignore, []);

    // 7. Clear all ignored tracks
    await ignoreTrack({ id: 'dummy-1', title: 'Dummy 1' });
    await ignoreTrack({ id: 'dummy-2', title: 'Dummy 2' });
    assert.equal((await getIgnoredTracks()).length, 2);
    await clearIgnoredTracks();
    assert.deepEqual(await getIgnoredTracks(), []);
  });

  test('should automatically reopen DB when connection is closed or deleted via versionchange', async () => {
    const db1 = await openDB();
    db1.close();

    // Subsequent transaction after manual close must transparently recover without InvalidStateError
    await setSetting('recovered_after_close', { ok: true });
    assert.deepEqual(await getSetting('recovered_after_close'), { ok: true });

    // Simulate DevTools "Clear site data" / external deleteDatabase triggering onversionchange
    await new Promise((resolve, reject) => {
      const delReq = indexedDB.deleteDatabase('ditune_db');
      delReq.onsuccess = () => resolve();
      delReq.onerror = (e) => reject(e.target.error);
    });

    await setSetting('recovered_after_delete', 'yes');
    assert.equal(await getSetting('recovered_after_delete'), 'yes');

    // Simulate synchronous InvalidStateError ("connection is closing") before onclose event fires
    const db2 = await openDB();
    db2.transaction = () => {
      const err = new Error('The database connection is closing.');
      err.name = 'InvalidStateError';
      throw err;
    };
    await setSetting('recovered_after_invalid_state', 42);
    assert.equal(await getSetting('recovered_after_invalid_state'), 42);
  });

  test('should save, retrieve, and delete playlists', async () => {
    const pl = {
      id: 'pl-1',
      name: 'Road Trip',
      trackIds: ['t-a', 't-b'],
      createdAt: 1000,
      updatedAt: 1000,
    };

    await savePlaylist(pl);
    const fetched = await getPlaylist('pl-1');
    assert.equal(fetched.name, 'Road Trip');
    assert.deepStrictEqual(fetched.trackIds, ['t-a', 't-b']);

    const all = await getAllPlaylists();
    assert.equal(all.length, 1);

    await deletePlaylist('pl-1');
    const afterDelete = await getAllPlaylists();
    assert.equal(afterDelete.length, 0);
    assert.equal(await getPlaylist('pl-1'), null);
  });

  test('should persist playlist trackIds order and update via savePlaylist', async () => {
    const pl = {
      id: 'pl-order',
      name: 'Ordered',
      trackIds: ['z', 'a', 'm', 'b'],
      createdAt: 2000,
      updatedAt: 2000,
    };
    await savePlaylist(pl);

    const fetched = await getPlaylist('pl-order');
    assert.deepStrictEqual(fetched.trackIds, ['z', 'a', 'm', 'b']);

    // Update: add a track and change name
    fetched.trackIds.push('c');
    fetched.name = 'Reordered';
    fetched.updatedAt = 3000;
    await savePlaylist(fetched);

    const updated = await getPlaylist('pl-order');
    assert.equal(updated.name, 'Reordered');
    assert.deepStrictEqual(updated.trackIds, ['z', 'a', 'm', 'b', 'c']);
    assert.equal(updated.updatedAt, 3000);
  });

  test('clearAllData should also clear playlists', async () => {
    await savePlaylist({ id: 'pl-x', name: 'X', trackIds: [], createdAt: 1, updatedAt: 1 });
    await savePlaylist({ id: 'pl-y', name: 'Y', trackIds: ['t1'], createdAt: 2, updatedAt: 2 });
    assert.equal((await getAllPlaylists()).length, 2);

    await clearAllData();
    assert.equal((await getAllPlaylists()).length, 0);
  });
});
