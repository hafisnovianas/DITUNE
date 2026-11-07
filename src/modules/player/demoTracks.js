/**
 * DITUNE Demo Track Generator
 * Generates lightweight synthetic audio WAV tracks client-side so users can test
 * audio playback, ID3 tags, and offline caching immediately with zero external credentials.
 */

/**
 * Generate a PCM WAV Blob with pleasant musical chords/notes
 * @param {number} durationSec
 * @param {number[]} frequencies
 * @returns {Blob}
 */
export function generateSyntheticAudioBlob(durationSec = 20, frequencies = [261.63, 329.63, 392.0, 523.25]) {
  const sampleRate = 22050;
  const numChannels = 2;
  const bitsPerSample = 16;
  const numSamples = Math.floor(sampleRate * durationSec);
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // Write WAV Header
  function writeString(offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Synthesize pleasant ambient chord arpeggios
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const noteIdx = Math.floor(t * 2) % frequencies.length;
    const freq = frequencies[noteIdx];

    // Smooth envelope with subtle vibrato
    const env = Math.min(1, Math.sin((Math.PI * (t % 0.5)) / 0.5));
    const sample = Math.sin(2 * Math.PI * freq * t) * 0.4 * env;
    const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));

    view.setInt16(offset, intSample, true); // Left
    view.setInt16(offset + 2, intSample, true); // Right
    offset += 4;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Generate a colorful SVG album cover as Blob
 */
export function generateCoverBlob(text = 'DITUNE', color1 = '#10b981', color2 = '#064e3b') {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${color1}"/>
          <stop offset="100%" stop-color="${color2}"/>
        </linearGradient>
      </defs>
      <rect width="400" height="400" fill="url(#grad)" rx="24"/>
      <circle cx="200" cy="200" r="110" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="8"/>
      <circle cx="200" cy="200" r="50" fill="rgba(255,255,255,0.2)"/>
      <text x="200" y="210" font-family="system-ui, sans-serif" font-size="28" font-weight="bold" fill="#ffffff" text-anchor="middle">${text}</text>
    </svg>
  `;
  return new Blob([svg], { type: 'image/svg+xml' });
}

/**
 * Pre-packaged demo tracks
 */
export async function createDemoTracks() {
  const track1Blob = generateSyntheticAudioBlob(18, [261.63, 329.63, 392.0, 523.25]); // C Major
  const track2Blob = generateSyntheticAudioBlob(22, [220.0, 261.63, 329.63, 440.0]); // A Minor
  const track3Blob = generateSyntheticAudioBlob(20, [349.23, 440.0, 523.25, 698.46]); // F Major

  const cover1 = generateCoverBlob('Emerald Beat', '#10b981', '#064e3b');
  const cover2 = generateCoverBlob('Midnight Dream', '#6366f1', '#1e1b4b');
  const cover3 = generateCoverBlob('Sunset Groove', '#f59e0b', '#78350f');

  return [
    {
      id: 'demo-track-1',
      name: 'Emerald Melody (Demo).wav',
      title: 'Emerald Melody',
      artist: 'DITUNE Synthesizer',
      album: 'Lofi Chords Vol. 1',
      duration: 18,
      size: track1Blob.size,
      mimeType: 'audio/wav',
      isCached: true,
      hasCover: true,
      audioBlob: track1Blob,
      coverBlob: cover1,
    },
    {
      id: 'demo-track-2',
      name: 'Midnight Echoes (Demo).wav',
      title: 'Midnight Echoes',
      artist: 'Lunar Studio',
      album: 'Chill Ambient Waves',
      duration: 22,
      size: track2Blob.size,
      mimeType: 'audio/wav',
      isCached: true,
      hasCover: true,
      audioBlob: track2Blob,
      coverBlob: cover2,
    },
    {
      id: 'demo-track-3',
      name: 'Sunset Horizon (Demo).wav',
      title: 'Sunset Horizon',
      artist: 'Solaris Beats',
      album: 'Chill Ambient Waves',
      duration: 20,
      size: track3Blob.size,
      mimeType: 'audio/wav',
      isCached: true,
      hasCover: true,
      audioBlob: track3Blob,
      coverBlob: cover3,
    },
  ];
}
