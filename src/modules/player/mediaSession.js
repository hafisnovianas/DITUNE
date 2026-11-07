/**
 * DITUNE Media Session API Integration
 * Connects lockscreen, notification controls, and physical media keys on Mobile/Desktop OS.
 */

export function setupMediaSession(audioEngine) {
  if (!('mediaSession' in navigator)) {
    return;
  }

  // Register action handlers
  const actionHandlers = [
    ['play', () => audioEngine.resume()],
    ['pause', () => audioEngine.pause()],
    ['previoustrack', () => audioEngine.playPrevious()],
    ['nexttrack', () => audioEngine.playNext()],
    ['seekto', (details) => {
      if (details.seekTime !== undefined) {
        audioEngine.seek(details.seekTime);
      }
    }],
    ['seekbackward', (details) => {
      const skipTime = details.seekOffset || 10;
      audioEngine.seek(Math.max(0, audioEngine.getCurrentTime() - skipTime));
    }],
    ['seekforward', (details) => {
      const skipTime = details.seekOffset || 10;
      audioEngine.seek(Math.min(audioEngine.getDuration(), audioEngine.getCurrentTime() + skipTime));
    }],
    ['stop', () => audioEngine.pause()],
  ];

  for (const [action, handler] of actionHandlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch (err) {
      console.warn(`MediaSession action "${action}" not supported:`, err.message);
    }
  }
}

/**
 * Update media metadata on lockscreen / OS player
 */
export function updateMediaSessionMetadata(track, coverUrl = null) {
  if (!('mediaSession' in navigator)) return;

  const artwork = [];
  if (coverUrl) {
    artwork.push(
      { src: coverUrl, sizes: '96x96', type: 'image/jpeg' },
      { src: coverUrl, sizes: '192x192', type: 'image/jpeg' },
      { src: coverUrl, sizes: '512x512', type: 'image/jpeg' }
    );
  } else {
    // Default fallback icon
    artwork.push(
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
    );
  }

  navigator.mediaSession.metadata = new window.MediaMetadata({
    title: track.title || track.name || 'DITUNE Player',
    artist: track.artist || 'DITUNE',
    album: track.album || 'Google Drive Music',
    artwork,
  });
}

/**
 * Update playback position state for lockscreen seek bar
 */
export function updateMediaSessionPositionState(position, duration, playbackRate = 1) {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;

  try {
    if (duration > 0 && position >= 0 && position <= duration) {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate,
        position,
      });
    }
  } catch (err) {
    // Some browsers reject tiny desync
  }
}

/**
 * Update playback state ('playing' | 'paused' | 'none')
 */
export function updateMediaSessionPlaybackState(state) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.playbackState = state;
}
