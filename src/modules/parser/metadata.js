/**
 * DITUNE Audio Metadata Parser
 * Extracts ID3/Vorbis/MP4 tags and embedded cover art using music-metadata-browser.
 */
import * as mmb from 'music-metadata-browser';

/**
 * Clean filename to generate a readable title
 */
function cleanFileName(filename = '') {
  return filename
    .replace(/\.[a-zA-Z0-9]+$/, '') // remove extension
    .replace(/^\d+[\s.-]+/, '') // remove leading track numbers like "01 - "
    .trim();
}

/**
 * Format seconds to mm:ss
 */
export function formatDuration(seconds) {
  if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
  const totalSecs = Math.floor(seconds);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Parse an audio Blob and extract metadata tags
 * @param {Blob} blob - Audio file blob
 * @param {string} fileName - File name fallback
 * @returns {Promise<{title: string, artist: string, album: string, duration: number, year: number|null, coverBlob: Blob|null}>}
 */
export async function parseAudioMetadata(blob, fileName = 'Unknown Track') {
  const fallbackTitle = cleanFileName(fileName) || 'Unknown Track';

  try {
    const metadata = await mmb.parseBlob(blob, {
      duration: true,
      skipPostHeaders: false,
    });

    const common = metadata.common || {};
    const format = metadata.format || {};

    let coverBlob = null;
    if (common.picture && common.picture.length > 0) {
      const pic = common.picture[0];
      const mime = pic.format || 'image/jpeg';
      coverBlob = new Blob([pic.data], { type: mime });
    }

    return {
      title: common.title?.trim() || fallbackTitle,
      artist: common.artist?.trim() || (common.artists && common.artists[0]?.trim()) || 'Unknown Artist',
      album: common.album?.trim() || 'Unknown Album',
      duration: Math.round(format.duration || 0),
      year: common.year || null,
      trackNo: common.track?.no || null,
      coverBlob,
    };
  } catch (err) {
    console.warn(`[MetadataParser] Failed to parse tags for "${fileName}", falling back:`, err.message);

    // Audio element fallback for duration if possible
    let duration = 0;
    try {
      duration = await getAudioDurationFromBlob(blob);
    } catch (_) {
      // ignore
    }

    return {
      title: fallbackTitle,
      artist: 'Unknown Artist',
      album: 'Unknown Album',
      duration,
      year: null,
      trackNo: null,
      coverBlob: null,
    };
  }
}

/**
 * Fast duration probe using HTML5 Audio element
 */
function getAudioDurationFromBlob(blob) {
  return new Promise((resolve) => {
    const audio = new Audio();
    const url = URL.createObjectURL(blob);
    audio.preload = 'metadata';

    const cleanUp = () => {
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('error', onError);
      URL.revokeObjectURL(url);
    };

    const onLoaded = () => {
      const dur = Math.round(audio.duration || 0);
      cleanUp();
      resolve(dur);
    };

    const onError = () => {
      cleanUp();
      resolve(0);
    };

    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('error', onError);
    audio.src = url;
  });
}
