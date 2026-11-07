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
  removeAudioBlob,
  saveCover,
  getCover,
  getSetting,
  setSetting,
  getStorageStats,
  clearAllCache,
  clearAllData,
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
});
