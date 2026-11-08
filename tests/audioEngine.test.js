import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

// Polyfill minimal browser environment for Node test runner
before(() => {
  if (typeof globalThis.Audio === 'undefined') {
    globalThis.Audio = class MockAudio {
      constructor() {
        this.src = '';
        this.volume = 1;
        this.currentTime = 0;
        this.duration = 180;
        this._listeners = {};
      }
      addEventListener(evt, fn) {
        if (!this._listeners[evt]) this._listeners[evt] = [];
        this._listeners[evt].push(fn);
      }
      removeEventListener(evt, fn) {
        if (this._listeners[evt]) {
          this._listeners[evt] = this._listeners[evt].filter((f) => f !== fn);
        }
      }
      play() {
        return Promise.resolve();
      }
      pause() {}
    };
  }

  if (typeof globalThis.navigator === 'undefined') {
    globalThis.navigator = {};
  }
  globalThis.navigator.mediaSession = {
    setActionHandler: () => {},
    setPositionState: () => {},
    playbackState: 'none',
    metadata: null,
  };
  globalThis.window = globalThis.window || {};
  globalThis.window.MediaMetadata = class MockMediaMetadata {
    constructor(data) {
      Object.assign(this, data);
    }
  };
  globalThis.URL = globalThis.URL || {};
  if (!globalThis.URL.createObjectURL) {
    globalThis.URL.createObjectURL = () => 'blob:mock-url';
    globalThis.URL.revokeObjectURL = () => {};
  }
  if (typeof globalThis.localStorage === 'undefined') {
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {},
    };
  }
});

import { AudioEngine } from '../src/modules/player/audio.js';
import { saveAudioBlob, saveTrack, getTrack } from '../src/modules/storage/db.js';

describe('AudioEngine Unit Tests', () => {
  test('should initialize with default states', () => {
    const engine = new AudioEngine();
    assert.equal(engine.currentIndex, -1);
    assert.equal(engine.currentTrack, null);
    assert.equal(engine.isPlaying, false);
    assert.equal(engine.shuffle, false);
    assert.equal(engine.repeatMode, 'off');
    assert.equal(engine.volume, 1.0);
    assert.equal(engine.playlist.length, 0);
  });

  test('setPlaylist should update playlist and trigger event', () => {
    const engine = new AudioEngine();
    let emitted = false;
    engine.on('playlistChange', (list) => {
      emitted = true;
      assert.equal(list.length, 2);
    });

    const mockTracks = [
      { id: '1', title: 'Song 1', duration: 120 },
      { id: '2', title: 'Song 2', duration: 200 },
    ];
    engine.setPlaylist(mockTracks, -1);

    assert.equal(emitted, true);
    assert.equal(engine.playlist.length, 2);
  });

  test('cycleRepeat should cycle off -> all -> one -> off', () => {
    const engine = new AudioEngine();
    assert.equal(engine.repeatMode, 'off');

    assert.equal(engine.cycleRepeat(), 'all');
    assert.equal(engine.repeatMode, 'all');

    assert.equal(engine.cycleRepeat(), 'one');
    assert.equal(engine.repeatMode, 'one');

    assert.equal(engine.cycleRepeat(), 'off');
    assert.equal(engine.repeatMode, 'off');
  });

  test('toggleShuffle should toggle shuffle boolean and emit modeChange', () => {
    const engine = new AudioEngine();
    let lastEmittedShuffle = null;
    engine.on('modeChange', ({ shuffle }) => {
      lastEmittedShuffle = shuffle;
    });

    assert.equal(engine.toggleShuffle(), true);
    assert.equal(engine.shuffle, true);
    assert.equal(lastEmittedShuffle, true);

    assert.equal(engine.toggleShuffle(), false);
    assert.equal(engine.shuffle, false);
    assert.equal(lastEmittedShuffle, false);
  });

  test('setVolume should clamp between 0.0 and 1.0', () => {
    const engine = new AudioEngine();
    engine.setVolume(0.5);
    assert.equal(engine.volume, 0.5);

    engine.setVolume(1.8);
    assert.equal(engine.volume, 1.0);

    engine.setVolume(-0.4);
    assert.equal(engine.volume, 0.0);
  });

  test('queue navigation should respect bounds and repeat modes', () => {
    const engine = new AudioEngine();
    engine.loadAndPlay = () => Promise.resolve(); // Mock loading for queue state testing

    const tracks = [
      { id: 'ae-nav-1', title: 'T1', duration: 100 },
      { id: 'ae-nav-2', title: 'T2', duration: 150 },
    ];
    engine.setPlaylist(tracks, -1);
    engine.currentIndex = 0;

    // playNext from index 0 -> index 1
    engine.playNext();
    assert.equal(engine.currentIndex, 1);

    // playNext from last track with repeat 'off'
    engine.repeatMode = 'off';
    engine.playNext();
    assert.equal(engine.currentIndex, 1); // stays at last, paused

    // playNext with repeat 'all' wraps around
    engine.repeatMode = 'all';
    engine.playNext();
    assert.equal(engine.currentIndex, 0);

    // playPrevious from index 0 with repeat 'all' wraps to last
    engine.audio.currentTime = 0;
    engine.playPrevious();
    assert.equal(engine.currentIndex, 1);
  });

  test('playRequestId increments and guards against async race condition', () => {
    const engine = new AudioEngine();
    assert.equal(engine.playRequestId, 0);

    const track1 = { id: 'track-1', title: 'Track 1', name: 'track1.wav' };
    const track2 = { id: 'track-2', title: 'Track 2', name: 'track2.wav' };

    engine.loadAndPlay(track1);
    const req1 = engine.playRequestId;
    assert.equal(req1, 1);

    engine.loadAndPlay(track2);
    const req2 = engine.playRequestId;
    assert.equal(req2, 2);
    assert.notEqual(req1, req2);
  });

  test('loadAndPlay should self-heal isCached, size, and persist to IndexedDB when blob exists', async () => {
    const engine = new AudioEngine();
    const track = {
      id: 'self-heal-audio',
      title: 'Heal Song',
      name: 'healsong.mp3',
      artist: 'Heal Artist',
      duration: 120,
      isCached: false,
    };

    const mockBlob = new Blob(['mock audio stream content'], { type: 'audio/mpeg' });
    await saveAudioBlob('self-heal-audio', mockBlob, 'audio/mpeg');

    // Track was in un-cached state in memory
    assert.equal(track.isCached, false);

    await engine.loadAndPlay(track);

    assert.equal(track.isCached, true, 'track.isCached should be healed to true');
    assert.equal(track.size, mockBlob.size, 'track.size should match blob.size');
    assert.ok(track.cachedAt > 0, 'track.cachedAt should be set');

    const persisted = await getTrack('self-heal-audio');
    assert.ok(persisted);
    assert.equal(persisted.isCached, true, 'persisted track should be isCached = true');
  });

  test('loadedmetadata should heal missing duration and emit trackChange', async () => {
    const engine = new AudioEngine();
    const track = {
      id: 'duration-heal-track',
      title: 'Zero Duration Song',
      name: 'song.mp3',
      artist: 'Artist',
      duration: 0,
      isCached: true,
    };

    const mockBlob = new Blob(['mock audio'], { type: 'audio/mpeg' });
    await saveAudioBlob('duration-heal-track', mockBlob, 'audio/mpeg');
    await saveTrack(track);

    let emittedTrack = null;
    engine.on('trackChange', ({ track: t }) => {
      emittedTrack = t;
    });

    await engine.loadAndPlay(track);

    // MockAudio has duration = 180 by default. Trigger loadedmetadata event
    const listeners = engine.audio._listeners['loadedmetadata'] || [];
    for (const fn of listeners) {
      fn();
    }

    assert.equal(engine.currentTrack.duration, 180, 'engine.currentTrack.duration should be healed to 180');
    assert.ok(emittedTrack);
    assert.equal(emittedTrack.duration, 180, 'trackChange should be emitted with healed duration');

    const persisted = await getTrack('duration-heal-track');
    assert.ok(persisted);
    assert.equal(persisted.duration, 180, 'Persisted track duration in IndexedDB should be 180');
  });
});
