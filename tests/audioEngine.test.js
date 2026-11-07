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

    const track1 = { id: 'demo-track-1', title: 'Demo 1', name: 'demo1.wav' };
    const track2 = { id: 'demo-track-2', title: 'Demo 2', name: 'demo2.wav' };

    engine.loadAndPlay(track1);
    const req1 = engine.playRequestId;
    assert.equal(req1, 1);

    engine.loadAndPlay(track2);
    const req2 = engine.playRequestId;
    assert.equal(req2, 2);
    assert.notEqual(req1, req2);
  });
});
