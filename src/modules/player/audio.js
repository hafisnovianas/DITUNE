/**
 * DITUNE Audio Playback Engine
 * HTML5 Audio controller with IndexedDB stream-to-cache, queue management,
 * shuffle, repeat modes, and Media Session integration.
 */

import { getAudioBlob, saveAudioBlob, getCover, saveCover, saveTrack } from '../storage/db.js';
import { downloadDriveAudioFile } from '../auth/gdrive.js';
import { parseAudioMetadata } from '../parser/metadata.js';
import {
  setupMediaSession,
  updateMediaSessionMetadata,
  updateMediaSessionPositionState,
  updateMediaSessionPlaybackState,
} from './mediaSession.js';

export class AudioEngine {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';

    this.playlist = [];
    this.currentIndex = -1;
    this.currentTrack = null;

    this.isPlaying = false;
    this.isLoading = false;
    this.shuffle = false;
    this.repeatMode = 'off'; // 'off' | 'all' | 'one'
    this.volume = 1.0;

    this.currentBlobUrl = null;
    this.currentCoverUrl = null;
    this.playRequestId = 0;

    // Listeners
    this.listeners = {
      trackChange: [],
      playStateChange: [],
      timeUpdate: [],
      loading: [],
      playlistChange: [],
      error: [],
      modeChange: [],
    };

    this.initAudioListeners();
    setupMediaSession(this);
  }

  initAudioListeners() {
    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      this.emit('playStateChange', true);
      updateMediaSessionPlaybackState('playing');
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      this.emit('playStateChange', false);
      updateMediaSessionPlaybackState('paused');
    });

    this.audio.addEventListener('timeupdate', () => {
      const currentTime = this.audio.currentTime || 0;
      const duration = this.audio.duration || (this.currentTrack?.duration || 0);
      this.emit('timeUpdate', { currentTime, duration });
      updateMediaSessionPositionState(currentTime, duration);
    });

    this.audio.addEventListener('loadedmetadata', () => {
      if (this.currentTrack && (!this.currentTrack.duration || this.currentTrack.duration === 0)) {
        if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
          const dur = Math.round(this.audio.duration);
          this.currentTrack.duration = dur;
          saveTrack(this.currentTrack).catch((err) => {
            console.warn('[AudioEngine] Failed to save healed duration:', err);
          });
          this.emit('trackChange', { track: this.currentTrack, coverUrl: this.currentCoverUrl });
        }
      }
    });

    this.audio.addEventListener('ended', () => {
      this.handleTrackEnded();
    });

    this.audio.addEventListener('error', (e) => {
      console.error('[AudioEngine] Playback error:', e);
      this.isLoading = false;
      this.emit('loading', { isLoading: false, percent: 0 });
      this.emit('error', 'Gagal memutar audio. Format tidak didukung atau file tidak dapat diakses.');
    });
  }

  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((cb) => {
        try {
          cb(data);
        } catch (err) {
          console.error(`Error in listener for ${event}:`, err);
        }
      });
    }
  }

  setPlaylist(tracks, startIndex = 0) {
    this.playlist = [...tracks];
    this.emit('playlistChange', this.playlist);
    if (startIndex >= 0 && startIndex < this.playlist.length) {
      this.playTrackAtIndex(startIndex);
    }
  }

  async playTrack(track, newPlaylist = null) {
    if (newPlaylist) {
      this.playlist = [...newPlaylist];
      this.emit('playlistChange', this.playlist);
    }

    const index = this.playlist.findIndex((t) => t.id === track.id);
    if (index !== -1) {
      this.currentIndex = index;
    } else {
      this.playlist.unshift(track);
      this.currentIndex = 0;
      this.emit('playlistChange', this.playlist);
    }

    await this.loadAndPlay(track);
  }

  async playTrackAtIndex(index) {
    if (index < 0 || index >= this.playlist.length) return;
    this.currentIndex = index;
    const track = this.playlist[index];
    await this.loadAndPlay(track);
  }

  async loadAndPlay(track) {
    const requestId = ++this.playRequestId;
    this.currentTrack = track;
    this.isLoading = true;
    this.emit('loading', { isLoading: true, percent: 0 });

    // Clean up previous URLs
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl);
      this.currentBlobUrl = null;
    }
    if (this.currentCoverUrl) {
      URL.revokeObjectURL(this.currentCoverUrl);
      this.currentCoverUrl = null;
    }

    // Fast parallel check of cover art and cached audio blob from IndexedDB
    let audioBlob = null;
    try {
      const [coverBlob, cachedBlob] = await Promise.all([
        getCover(track.id).catch(() => null),
        getAudioBlob(track.id).catch(() => null),
      ]);
      if (requestId !== this.playRequestId) return;

      if (coverBlob) {
        this.currentCoverUrl = URL.createObjectURL(coverBlob);
      }

      if (cachedBlob) {
        audioBlob = cachedBlob;
        track.isCached = true;
        if (!track.size || track.size !== cachedBlob.size) {
          track.size = cachedBlob.size;
        }
        if (!track.cachedAt) {
          track.cachedAt = Date.now();
        }
      }
    } catch (_) {
      // ignore read error
    }

    if (requestId !== this.playRequestId) return;

    this.emit('trackChange', { track: this.currentTrack, coverUrl: this.currentCoverUrl });
    updateMediaSessionMetadata(this.currentTrack, this.currentCoverUrl);

    try {
      if (audioBlob) {
        let shouldSave = true;

        // Heal duration and metadata if missing (0:00 or default values)
        if (!track.duration || track.duration === 0 || track.title === track.name || track.artist === 'Unknown Artist') {
          try {
            const meta = await parseAudioMetadata(audioBlob, track.name);
            if (track.title === track.name && meta.title) {
              track.title = meta.title;
              shouldSave = true;
            }
            if (track.artist === 'Unknown Artist' && meta.artist) {
              track.artist = meta.artist;
              shouldSave = true;
            }
            if ((track.album === 'Unknown Album' || track.album === 'Google Drive') && meta.album) {
              track.album = meta.album;
              shouldSave = true;
            }
            if ((!track.duration || track.duration === 0) && meta.duration > 0) {
              track.duration = meta.duration;
              shouldSave = true;
            }
            if (meta.coverBlob && !this.currentCoverUrl) {
              await saveCover(track.id, meta.coverBlob, meta.coverBlob.type);
              if (requestId !== this.playRequestId) return;
              this.currentCoverUrl = URL.createObjectURL(meta.coverBlob);
              track.hasCover = true;
              shouldSave = true;
            }
          } catch (metaErr) {
            console.warn('[AudioEngine] Metadata heal error:', metaErr);
          }
        }

        if (shouldSave) {
          await saveTrack(track);
        }
      } else {
        if (track.url) {
          // Direct URL (e.g. static link)
          const resp = await fetch(track.url);
          audioBlob = await resp.blob();
        } else {
          // Google Drive download
          this.emit('loading', { isLoading: true, percent: 0, track: this.currentTrack });
          const { blob, mimeType } = await downloadDriveAudioFile(
            track.id,
            (percent) => {
              if (requestId === this.playRequestId) {
                this.emit('loading', { isLoading: true, percent, track: this.currentTrack });
              }
            },
            track.size
          );

          if (requestId !== this.playRequestId) return;
          audioBlob = blob;

          // Parse metadata if track has default values
          if (track.title === track.name || track.artist === 'Unknown Artist') {
            try {
              const meta = await parseAudioMetadata(audioBlob, track.name);
              track.title = meta.title;
              track.artist = meta.artist;
              track.album = meta.album;
              if (meta.duration > 0) track.duration = meta.duration;

              if (meta.coverBlob) {
                await saveCover(track.id, meta.coverBlob, meta.coverBlob.type);
                if (this.currentCoverUrl) URL.revokeObjectURL(this.currentCoverUrl);
                this.currentCoverUrl = URL.createObjectURL(meta.coverBlob);
                track.hasCover = true;
              }
            } catch (metaErr) {
              console.warn('Metadata parsing during stream-to-cache failed:', metaErr);
            }
          }

          // Cache blob into IndexedDB
          await saveAudioBlob(track.id, audioBlob, mimeType);
          track.isCached = true;
          await saveTrack(track);
        }
      }

      if (requestId !== this.playRequestId) return;

      // 3. Play audio blob via Object URL
      this.currentBlobUrl = URL.createObjectURL(audioBlob);
      this.audio.src = this.currentBlobUrl;
      this.audio.volume = this.volume;

      this.isLoading = false;
      this.emit('loading', { isLoading: false, percent: 100, track: this.currentTrack });

      // Update UI with any enriched metadata & cover
      this.emit('trackChange', { track: this.currentTrack, coverUrl: this.currentCoverUrl });
      updateMediaSessionMetadata(this.currentTrack, this.currentCoverUrl);

      await this.audio.play();
    } catch (err) {
      if (requestId !== this.playRequestId) return;
      console.error('[AudioEngine] loadAndPlay error:', err);
      this.isLoading = false;
      this.emit('loading', { isLoading: false, percent: 0, track: this.currentTrack });
      this.emit('error', err.message || 'Gagal memuat lagu.');
    }
  }

  resume() {
    if (this.audio.src && this.currentTrack) {
      this.audio.play().catch((e) => console.warn('Play interrupted:', e));
    } else if (this.currentTrack) {
      this.loadAndPlay(this.currentTrack);
    }
  }

  pause() {
    this.audio.pause();
  }

  stop() {
    this.playRequestId++;
    this.pause();
    this.isLoading = false;
    this.playlist = [];
    this.currentIndex = -1;
    this.currentTrack = null;
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl);
      this.currentBlobUrl = null;
    }
    if (this.currentCoverUrl) {
      URL.revokeObjectURL(this.currentCoverUrl);
      this.currentCoverUrl = null;
    }
    if (typeof this.audio.removeAttribute === 'function') {
      this.audio.removeAttribute('src');
    } else {
      this.audio.src = '';
    }
    if (typeof this.audio.load === 'function') {
      this.audio.load();
    }
  }

  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.resume();
    }
  }

  seek(seconds) {
    if (this.audio.duration && !isNaN(this.audio.duration)) {
      this.audio.currentTime = Math.max(0, Math.min(seconds, this.audio.duration));
    }
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    this.audio.volume = this.volume;
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    this.emit('modeChange', { shuffle: this.shuffle, repeatMode: this.repeatMode });
    return this.shuffle;
  }

  cycleRepeat() {
    const modes = ['off', 'all', 'one'];
    const nextIdx = (modes.indexOf(this.repeatMode) + 1) % modes.length;
    this.repeatMode = modes[nextIdx];
    this.emit('modeChange', { shuffle: this.shuffle, repeatMode: this.repeatMode });
    return this.repeatMode;
  }

  handleTrackEnded() {
    if (this.repeatMode === 'one') {
      this.audio.currentTime = 0;
      this.audio.play();
      return;
    }
    this.playNext();
  }

  playNext() {
    if (this.playlist.length === 0) return;

    if (this.shuffle) {
      const nextIdx = Math.floor(Math.random() * this.playlist.length);
      this.playTrackAtIndex(nextIdx);
      return;
    }

    if (this.currentIndex + 1 < this.playlist.length) {
      this.playTrackAtIndex(this.currentIndex + 1);
    } else if (this.repeatMode === 'all') {
      this.playTrackAtIndex(0);
    } else {
      this.pause();
      this.seek(0);
    }
  }

  playPrevious() {
    if (this.playlist.length === 0) return;

    // If more than 3 seconds in, restart track
    if (this.audio.currentTime > 3) {
      this.seek(0);
      return;
    }

    if (this.currentIndex > 0) {
      this.playTrackAtIndex(this.currentIndex - 1);
    } else if (this.repeatMode === 'all') {
      this.playTrackAtIndex(this.playlist.length - 1);
    } else {
      this.seek(0);
    }
  }

  getCurrentTime() {
    return this.audio.currentTime || 0;
  }

  getDuration() {
    return this.audio.duration || (this.currentTrack?.duration || 0);
  }
}
