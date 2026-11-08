import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { formatDuration, parseAudioMetadata } from '../src/modules/parser/metadata.js';

describe('Metadata Parser & Formatters', () => {
  test('formatDuration should format seconds properly', () => {
    assert.equal(formatDuration(0), '0:00');
    assert.equal(formatDuration(5), '0:05');
    assert.equal(formatDuration(59), '0:59');
    assert.equal(formatDuration(60), '1:00');
    assert.equal(formatDuration(75), '1:15');
    assert.equal(formatDuration(365), '6:05');
    assert.equal(formatDuration(3600), '1:00:00');
    assert.equal(formatDuration(3665), '1:01:05');
    assert.equal(formatDuration(7325), '2:02:05');
    assert.equal(formatDuration(-10), '0:00');
    assert.equal(formatDuration(null), '0:00');
    assert.equal(formatDuration(undefined), '0:00');
    assert.equal(formatDuration(NaN), '0:00');
  });

  test('parseAudioMetadata should fallback gracefully on unformatted or synthetic audio', async () => {
    const dummyWav = new Blob(['RIFFdummyWAVEfmt '], { type: 'audio/wav' });
    const parsed = await parseAudioMetadata(dummyWav, '01 - My Cool Song.wav');

    assert.equal(parsed.title, 'My Cool Song');
    assert.equal(parsed.artist, 'Unknown Artist');
    assert.equal(parsed.album, 'Unknown Album');
    assert.equal(parsed.year, null);
    assert.equal(parsed.coverBlob, null);
  });

  test('parseAudioMetadata should handle completely empty or random blob without crashing', async () => {
    const corruptBlob = new Blob(['random non-audio bytes here'], { type: 'audio/mpeg' });
    const parsed = await parseAudioMetadata(corruptBlob, 'test_corrupt.mp3');

    assert.equal(parsed.title, 'test_corrupt');
    assert.equal(parsed.artist, 'Unknown Artist');
    assert.equal(parsed.album, 'Unknown Album');
  });
});
