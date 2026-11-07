import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateSyntheticAudioBlob,
  generateCoverBlob,
  createDemoTracks,
} from '../src/modules/player/demoTracks.js';

describe('Demo Tracks & Synthesizer Engine', () => {
  test('generateSyntheticAudioBlob should create valid WAV binary with RIFF header', async () => {
    const blob = generateSyntheticAudioBlob(1, [440]);
    assert.ok(blob);
    assert.equal(blob.type, 'audio/wav');
    assert.ok(blob.size > 44);

    const arrayBuffer = await blob.arrayBuffer();
    const view = new DataView(arrayBuffer);

    // Check 'RIFF'
    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    assert.equal(riff, 'RIFF');

    // Check 'WAVE'
    const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
    assert.equal(wave, 'WAVE');

    // Check 'fmt '
    const fmt = String.fromCharCode(view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15));
    assert.equal(fmt, 'fmt ');

    // Check PCM format = 1
    assert.equal(view.getUint16(20, true), 1);
  });

  test('generateCoverBlob should generate SVG blob with text and gradient', async () => {
    const cover = generateCoverBlob('Test Title', '#10b981', '#064e3b');
    assert.ok(cover);
    assert.equal(cover.type, 'image/svg+xml');

    const text = await cover.text();
    assert.ok(text.includes('Test Title'));
    assert.ok(text.includes('#10b981'));
  });

  test('createDemoTracks should produce 3 complete tracks with audio and cover blobs', async () => {
    const tracks = await createDemoTracks();
    assert.equal(tracks.length, 3);

    for (const track of tracks) {
      assert.ok(track.id);
      assert.ok(track.title);
      assert.ok(track.artist);
      assert.ok(track.album);
      assert.ok(track.duration > 0);
      assert.ok(track.audioBlob);
      assert.ok(track.coverBlob);
      assert.equal(track.isCached, true);
    }
  });
});
