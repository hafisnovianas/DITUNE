/**
 * DITUNE UI Controller & Event Handlers
 * Glues AudioEngine, IndexedDB storage, Google Drive Picker, and the UI together.
 */

import {
  createIcons,
  Disc,
  FolderPlus,
  Folder,
  Music,
  Users,
  Disc3,
  HardDrive,
  Database,
  Download,
  Settings,
  Search,
  X,
  Wifi,
  WifiOff,
  Shuffle,
  SkipBack,
  SkipForward,
  Play,
  Pause,
  Repeat,
  Volume2,
  VolumeX,
  CheckCircle2,
  ExternalLink,
  Trash2,
  AlertTriangle,
  Info,
  AlertCircle,
  User,
  Radio,
  Loader,
  RefreshCw,
} from 'lucide';

import {
  getAllTracks,
  saveTracks,
  saveAudioBlob,
  getAudioBlob,
  getAllAudioBlobIds,
  saveCover,
  getStorageStats,
  clearAllCache,
  clearAllData,
  saveTrack,
  getSetting,
  setSetting,
} from '../storage/db.js';
import {
  hasCredentials,
  openGooglePicker,
  listAudioFilesFromFolder,
  getAccessToken,
  initGoogleAuth,
  downloadDriveAudioFile,
  clearSessionToken,
} from '../auth/gdrive.js';
import { formatDuration, parseAudioMetadata } from '../parser/metadata.js';
import {
  renderTrackList,
  renderArtistsView,
  renderAlbumsView,
  showToast,
  showProgressToast,
  removeProgressToast,
  formatBytes,
} from './components.js';

export function refreshLucideIcons() {
  createIcons({
    icons: {
      Disc,
      FolderPlus,
      Folder,
      Music,
      Users,
      Disc3,
      HardDrive,
      Database,
      Download,
      Settings,
      Search,
      X,
      Wifi,
      WifiOff,
      Shuffle,
      SkipBack,
      SkipForward,
      Play,
      Pause,
      Repeat,
      Volume2,
      VolumeX,
      CheckCircle2,
      ExternalLink,
      Trash2,
      AlertTriangle,
      Info,
      AlertCircle,
      User,
      Radio,
      Loader,
      RefreshCw,
    },
  });
}

export class UIController {
  constructor(audioEngine) {
    this.engine = audioEngine;
    this.allTracks = [];
    this.activeTab = 'all'; // 'all' | 'artists' | 'albums' | 'offline'
    this.searchQuery = '';
    this.filterArtist = null;
    this.filterAlbum = null;
    this.isDraggingProgress = false;
    this.previousVolume = 1.0;
    this.isBatchDownloading = false;
    this.downloadingTrackIds = new Set();
    this.deferredInstallPrompt = null;

    this.bindEngineEvents();
    this.bindDOMEvents();
    this.bindNetworkEvents();
    this.bindPWAEvents();
  }

  async init() {
    await this.reloadTracks();
    await this.updateStorageInfo();

    // Check online status
    this.updateNetworkStatus(navigator.onLine);

    // Initial render
    this.renderMainContent();
    refreshLucideIcons();
  }

  async reloadTracks() {
    this.allTracks = await getAllTracks();
    try {
      const blobIds = await getAllAudioBlobIds();
      const tracksToHeal = [];

      for (const track of this.allTracks) {
        const hasBlob = blobIds.has(track.id);
        let needSave = false;

        if (hasBlob && !track.isCached) {
          track.isCached = true;
          if (!track.cachedAt) track.cachedAt = Date.now();
          needSave = true;
        } else if (!hasBlob && track.isCached) {
          track.isCached = false;
          track.cachedAt = null;
          needSave = true;
        }

        // Heal legacy hardcoded album name
        if (track.album === 'Google Drive') {
          track.album = 'Unknown Album';
          needSave = true;
        }

        // Heal titles with underscores into clean titles with spaces
        if (track.title && track.title.includes('_')) {
          track.title = track.title.replace(/_/g, ' ').trim();
          needSave = true;
        }

        if (needSave) {
          tracksToHeal.push(track);
        }
      }

      if (tracksToHeal.length > 0) {
        await saveTracks(tracksToHeal);
      }
    } catch (e) {
      console.warn('Failed to reconcile tracks with audio_blobs:', e);
    }

    this.updateOfflineBadge();
  }

  updateOfflineBadge() {
    const offlineCount = this.allTracks.filter((t) => t.isCached).length;
    const badge = document.getElementById('badge-offline-count');
    if (badge) {
      badge.textContent = offlineCount;
    }
  }

  async updateStorageInfo() {
    try {
      const stats = await getStorageStats();
      const usageText = document.getElementById('storage-usage-text');
      const progressBar = document.getElementById('storage-progress-bar');
      const modalCount = document.getElementById('modal-cache-count');
      const modalSize = document.getElementById('modal-cache-size');

      const sizeStr = formatBytes(stats.totalBytes);

      if (usageText) usageText.textContent = `${stats.cachedCount} lagu • ${sizeStr}`;
      if (modalCount) modalCount.textContent = `${stats.cachedCount} lagu`;
      if (modalSize) modalSize.textContent = sizeStr;

      if (progressBar) {
        const pct = stats.totalTracks > 0 ? (stats.cachedCount / stats.totalTracks) * 100 : 0;
        progressBar.style.width = `${pct}%`;
      }
    } catch (e) {
      console.warn('Failed to update storage stats:', e);
    }
  }

  getFilteredTracks() {
    let list = [...this.allTracks];

    if (this.activeTab === 'offline') {
      list = list.filter((t) => t.isCached);
    }

    if (this.filterArtist) {
      list = list.filter((t) => (t.artist || 'Unknown Artist') === this.filterArtist);
    }

    if (this.filterAlbum) {
      list = list.filter((t) => (t.album || 'Unknown Album') === this.filterAlbum);
    }

    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      list = list.filter(
        (t) =>
          (t.title || t.name || '').toLowerCase().includes(q) ||
          (t.artist || '').toLowerCase().includes(q) ||
          (t.album || '').toLowerCase().includes(q)
      );
    }

    return list;
  }

  renderMainContent() {
    const container = document.getElementById('content-container');
    if (!container) return;
    const activeScrollEl = container.querySelector('.overflow-y-auto') || container;
    const prevScrollTop = activeScrollEl.scrollTop;

    if (this.activeTab === 'artists' && !this.filterArtist) {
      container.innerHTML = renderArtistsView(this.allTracks);
    } else if (this.activeTab === 'albums' && !this.filterAlbum) {
      container.innerHTML = renderAlbumsView(this.allTracks);
    } else {
      const filtered = this.getFilteredTracks();
      const currentId = this.engine.currentTrack?.id;
      container.innerHTML = renderTrackList(filtered, currentId, this.engine.isPlaying);

      // Breadcrumb header if filtered by artist or album
      if (this.filterArtist || this.filterAlbum) {
        const filterTitle = this.filterArtist ? `Artis: ${this.filterArtist}` : `Album: ${this.filterAlbum}`;
        const backBtn = document.createElement('div');
        backBtn.className = 'mb-3 flex-shrink-0 flex items-center gap-2';
        backBtn.innerHTML = `
          <button id="btn-clear-filter" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-300 hover:text-white transition cursor-pointer">
            <i data-lucide="x" class="w-3.5 h-3.5"></i>
            <span>Kembali ke semua ${this.filterArtist ? 'Artis' : 'Album'}</span>
          </button>
          <span class="text-xs text-zinc-500">•</span>
          <span class="text-xs text-emerald-400 font-semibold">${filterTitle}</span>
        `;
        container.prepend(backBtn);
      }
    }

    const newScrollEl = container.querySelector('.overflow-y-auto') || container;
    newScrollEl.scrollTop = prevScrollTop;
    refreshLucideIcons();
  }

  bindEngineEvents() {
    this.engine.on('trackChange', ({ track, coverUrl }) => {
      const match = this.allTracks.find((t) => t.id === track.id);
      if (match) {
        Object.assign(match, track);
      }

      // Update player bar info
      const titleEl = document.getElementById('player-title');
      const artistEl = document.getElementById('player-artist');
      const coverImg = document.getElementById('player-cover-img');
      const coverFallback = document.getElementById('player-cover-fallback');
      const btnQuickCache = document.getElementById('btn-quick-cache');
      const iconQuickCache = document.getElementById('icon-quick-cache');

      if (titleEl) titleEl.textContent = track.title || track.name || 'Unknown Track';
      if (artistEl) artistEl.textContent = track.artist || 'Unknown Artist';

      if (coverUrl && coverImg) {
        coverImg.src = coverUrl;
        coverImg.classList.remove('hidden');
        if (coverFallback) coverFallback.classList.add('hidden');
      } else if (coverImg) {
        coverImg.src = '';
        coverImg.classList.add('hidden');
        if (coverFallback) coverFallback.classList.remove('hidden');
      }

      if (btnQuickCache) {
        btnQuickCache.classList.remove('hidden');
        if (track.isCached) {
          btnQuickCache.title = 'Tersimpan di IndexedDB';
          btnQuickCache.classList.add('text-emerald-400');
          if (iconQuickCache) iconQuickCache.setAttribute('data-lucide', 'check-circle-2');
        } else {
          btnQuickCache.title = 'Simpan lagu ke IndexedDB';
          btnQuickCache.classList.remove('text-emerald-400');
          if (iconQuickCache) iconQuickCache.setAttribute('data-lucide', 'download');
        }
      }

      this.updateOfflineBadge();
      this.updateStorageInfo();
      this.renderMainContent();
    });

    this.engine.on('playStateChange', (isPlaying) => {
      const btnPlayPause = document.getElementById('btn-play-pause');
      if (btnPlayPause) {
        btnPlayPause.innerHTML = isPlaying
          ? '<i id="icon-play-state" data-lucide="pause" class="w-5 h-5 fill-current"></i>'
          : '<i id="icon-play-state" data-lucide="play" class="w-5 h-5 fill-current ml-0.5"></i>';
      }
      this.renderMainContent();
    });

    this.engine.on('timeUpdate', ({ currentTime, duration }) => {
      if (!this.isDraggingProgress) {
        const timeCurEl = document.getElementById('time-current');
        const timeTotEl = document.getElementById('time-total');
        const barFill = document.getElementById('progress-bar-fill');
        const thumb = document.getElementById('progress-thumb');

        if (timeCurEl) timeCurEl.textContent = formatDuration(currentTime);
        if (timeTotEl) timeTotEl.textContent = formatDuration(duration);

        if (barFill && duration > 0) {
          const pct = (currentTime / duration) * 100;
          barFill.style.width = `${pct}%`;
          if (thumb) thumb.style.left = `${pct}%`;
        }
      }
    });

    this.engine.on('loading', ({ isLoading, percent, track }) => {
      const btnPlayPause = document.getElementById('btn-play-pause');

      if (isLoading) {
        if (btnPlayPause) {
          btnPlayPause.innerHTML = `
            <svg class="w-5 h-5 animate-spin text-zinc-950" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
            </svg>
          `;
        }
        if (track) {
          this.updateTrackDownloadUI(track.id, percent);
        }
      } else {
        if (btnPlayPause) {
          btnPlayPause.innerHTML = this.engine.isPlaying
            ? '<i id="icon-play-state" data-lucide="pause" class="w-5 h-5 fill-current"></i>'
            : '<i id="icon-play-state" data-lucide="play" class="w-5 h-5 fill-current ml-0.5"></i>';
          refreshLucideIcons();
        }
        if (track && !track.isCached) {
          this.renderMainContent();
        }
      }
    });

    this.engine.on('modeChange', ({ shuffle, repeatMode }) => {
      const btnShuffle = document.getElementById('btn-shuffle');
      const btnRepeat = document.getElementById('btn-repeat');
      const badgeRepeatOne = document.getElementById('badge-repeat-one');

      if (btnShuffle) {
        btnShuffle.className = shuffle
          ? 'text-emerald-400 p-1.5 rounded-full hover:bg-zinc-800 transition'
          : 'text-zinc-400 hover:text-white transition p-1.5 rounded-full hover:bg-zinc-800';
      }

      if (btnRepeat) {
        btnRepeat.className = repeatMode !== 'off'
          ? 'text-emerald-400 p-1.5 rounded-full hover:bg-zinc-800 transition relative'
          : 'text-zinc-400 hover:text-white transition p-1.5 rounded-full hover:bg-zinc-800 relative';
      }

      if (badgeRepeatOne) {
        if (repeatMode === 'one') {
          badgeRepeatOne.classList.remove('hidden');
          badgeRepeatOne.classList.add('flex');
        } else {
          badgeRepeatOne.classList.add('hidden');
          badgeRepeatOne.classList.remove('flex');
        }
      }
    });

    this.engine.on('error', (msg) => {
      this.renderMainContent();
      showToast(msg, 'error');
    });
  }

  bindDOMEvents() {
    // Top Tabs & Sidebar Tabs
    document.querySelectorAll('.nav-tab').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.getAttribute('data-tab');
        this.setActiveTab(tab);
      });
    });

    // Content container delegated clicks
    const container = document.getElementById('content-container');
    if (container) {
      container.addEventListener('click', async (e) => {
        // Track Row Click (Play track)
        const trackRow = e.target.closest('.track-row');
        const cacheBtn = e.target.closest('.btn-cache-track');

        if (cacheBtn) {
          e.stopPropagation();
          const trackId = cacheBtn.getAttribute('data-id');
          await this.downloadSingleTrack(trackId);
          return;
        }

        if (trackRow) {
          const trackId = trackRow.getAttribute('data-id');
          const track = this.allTracks.find((t) => t.id === trackId);
          if (track) {
            const currentFiltered = this.getFilteredTracks();
            this.engine.playTrack(track, currentFiltered);
          }
          return;
        }

        // Artist Card Click
        const artistCard = e.target.closest('.artist-card');
        if (artistCard) {
          const artist = artistCard.getAttribute('data-artist');
          this.filterArtist = artist;
          this.filterAlbum = null;
          this.renderMainContent();
          return;
        }

        // Album Card Click
        const albumCard = e.target.closest('.album-card');
        if (albumCard) {
          const album = albumCard.getAttribute('data-album');
          this.filterAlbum = album;
          this.filterArtist = null;
          this.renderMainContent();
          return;
        }

        // Clear filter button
        const clearFilterBtn = e.target.closest('#btn-clear-filter');
        if (clearFilterBtn) {
          this.filterArtist = null;
          this.filterAlbum = null;
          this.renderMainContent();
          return;
        }

        // Sync connected folder button
        if (e.target.closest('#btn-sync-folder')) {
          this.syncConnectedFolder();
          return;
        }

        // Empty picker button
        if (e.target.closest('#btn-empty-picker')) {
          this.triggerDrivePicker();
          return;
        }
      });
    }

    // Search bar
    const searchInput = document.getElementById('search-input');
    const searchClear = document.getElementById('search-clear');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value;
        if (searchClear) {
          searchClear.classList.toggle('hidden', !this.searchQuery);
        }
        this.renderMainContent();
      });
    }

    if (searchClear) {
      searchClear.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        this.searchQuery = '';
        searchClear.classList.add('hidden');
        this.renderMainContent();
      });
    }

    // Player Bar Controls
    document.getElementById('btn-play-pause')?.addEventListener('click', () => {
      this.engine.togglePlay();
    });

    document.getElementById('btn-prev')?.addEventListener('click', () => {
      this.engine.playPrevious();
    });

    document.getElementById('btn-next')?.addEventListener('click', () => {
      this.engine.playNext();
    });

    document.getElementById('btn-shuffle')?.addEventListener('click', () => {
      this.engine.toggleShuffle();
    });

    document.getElementById('btn-repeat')?.addEventListener('click', () => {
      this.engine.cycleRepeat();
    });

    // Seek / Progress Scrubbing
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
      const handleSeek = (e) => {
        const rect = progressContainer.getBoundingClientRect();
        const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const duration = this.engine.getDuration();
        if (duration > 0) {
          this.engine.seek(pos * duration);
        }
      };

      progressContainer.addEventListener('click', handleSeek);

      progressContainer.addEventListener('mousedown', (e) => {
        this.isDraggingProgress = true;
        handleSeek(e);

        const onMouseMove = (moveEvt) => {
          if (this.isDraggingProgress) {
            const rect = progressContainer.getBoundingClientRect();
            const pos = Math.max(0, Math.min(1, (moveEvt.clientX - rect.left) / rect.width));
            const barFill = document.getElementById('progress-bar-fill');
            const thumb = document.getElementById('progress-thumb');
            const timeCurEl = document.getElementById('time-current');
            const duration = this.engine.getDuration();
            if (barFill) barFill.style.width = `${pos * 100}%`;
            if (thumb) thumb.style.left = `${pos * 100}%`;
            if (timeCurEl && duration > 0) timeCurEl.textContent = formatDuration(pos * duration);
          }
        };

        const onMouseUp = (upEvt) => {
          if (this.isDraggingProgress) {
            this.isDraggingProgress = false;
            handleSeek(upEvt);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
          }
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      });

      // Mobile Touch Scrubbing
      const getTouchPos = (touchEvt) => {
        if (!touchEvt.touches || touchEvt.touches.length === 0) return 0;
        const touch = touchEvt.touches[0];
        const rect = progressContainer.getBoundingClientRect();
        return Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
      };

      progressContainer.addEventListener('touchstart', (e) => {
        this.isDraggingProgress = true;
        const pos = getTouchPos(e);
        const duration = this.engine.getDuration();
        if (duration > 0) {
          const barFill = document.getElementById('progress-bar-fill');
          const thumb = document.getElementById('progress-thumb');
          const timeCurEl = document.getElementById('time-current');
          if (barFill) barFill.style.width = `${pos * 100}%`;
          if (thumb) thumb.style.left = `${pos * 100}%`;
          if (timeCurEl) timeCurEl.textContent = formatDuration(pos * duration);
        }
      }, { passive: true });

      progressContainer.addEventListener('touchmove', (e) => {
        if (this.isDraggingProgress) {
          const pos = getTouchPos(e);
          const duration = this.engine.getDuration();
          if (duration > 0) {
            const barFill = document.getElementById('progress-bar-fill');
            const thumb = document.getElementById('progress-thumb');
            const timeCurEl = document.getElementById('time-current');
            if (barFill) barFill.style.width = `${pos * 100}%`;
            if (thumb) thumb.style.left = `${pos * 100}%`;
            if (timeCurEl) timeCurEl.textContent = formatDuration(pos * duration);
          }
        }
      }, { passive: true });

      progressContainer.addEventListener('touchend', (e) => {
        if (this.isDraggingProgress) {
          this.isDraggingProgress = false;
          if (e.changedTouches && e.changedTouches.length > 0) {
            const touch = e.changedTouches[0];
            const rect = progressContainer.getBoundingClientRect();
            const pos = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
            const duration = this.engine.getDuration();
            if (duration > 0) {
              this.engine.seek(pos * duration);
            }
          }
        }
      });
    }

    // Volume Slider & Mute
    const volSlider = document.getElementById('volume-slider');
    const volIcon = document.getElementById('btn-volume-icon');

    if (volSlider) {
      volSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.engine.setVolume(val);
        this.updateVolumeIcon(val);
      });
    }

    if (volIcon) {
      volIcon.addEventListener('click', () => {
        if (this.engine.volume > 0) {
          this.previousVolume = this.engine.volume;
          this.engine.setVolume(0);
          if (volSlider) volSlider.value = '0';
          this.updateVolumeIcon(0);
        } else {
          const restore = this.previousVolume || 1;
          this.engine.setVolume(restore);
          if (volSlider) volSlider.value = String(restore);
          this.updateVolumeIcon(restore);
        }
      });
    }

    // Quick Cache button on player bar
    document.getElementById('btn-quick-cache')?.addEventListener('click', async () => {
      if (this.engine.currentTrack) {
        await this.downloadSingleTrack(this.engine.currentTrack.id);
      }
    });

    // Drive Picker Button in Settings
    document.getElementById('btn-change-folder')?.addEventListener('click', () => {
      this.closeSettingsModal();
      this.triggerDrivePicker();
    });

    // Download All Button
    document.getElementById('btn-download-all')?.addEventListener('click', () => {
      this.downloadAllTracks();
    });

    // Settings Modal Open/Close
    const openSettings = () => this.openSettingsModal();
    document.getElementById('btn-open-settings')?.addEventListener('click', openSettings);
    document.getElementById('btn-open-settings-mobile')?.addEventListener('click', openSettings);
    document.getElementById('btn-close-settings')?.addEventListener('click', () => this.closeSettingsModal());

    // Clear Audio Cache Button
    document.getElementById('btn-clear-cache')?.addEventListener('click', async () => {
      if (confirm('Yakin ingin menghapus seluruh audio yang tersimpan di IndexedDB? (Metadata daftar lagu tetap disimpan)')) {
        await clearAllCache();
        await this.reloadTracks();
        await this.updateStorageInfo();
        this.renderMainContent();
        showToast('Seluruh audio cache telah dibersihkan.', 'info');
      }
    });

    // Reset All Library Button
    document.getElementById('btn-reset-library')?.addEventListener('click', async () => {
      if (confirm('PERINGATAN: Semua lagu dan cache di DITUNE akan dihapus total. Lanjutkan?')) {
        clearSessionToken();
        await clearAllData();
        await setSetting('connected_folder', null);
        this.engine.pause();
        this.engine.playlist = [];
        this.engine.currentTrack = null;
        await this.reloadTracks();
        await this.updateStorageInfo();
        this.renderMainContent();
        showToast('Library telah di-reset sepenuhnya.', 'warning');
      }
    });
  }

  setActiveTab(tab) {
    this.activeTab = tab;
    this.filterArtist = null;
    this.filterAlbum = null;

    document.querySelectorAll('.nav-tab').forEach((el) => {
      const t = el.getAttribute('data-tab');
      const isDesktop = Boolean(el.closest('aside'));
      const isActive = t === tab;

      if (isDesktop) {
        if (isActive) {
          el.className = 'nav-tab active flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition text-emerald-400 bg-zinc-800/60';
        } else {
          el.className = 'nav-tab flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition text-zinc-400 hover:text-white hover:bg-zinc-800/40';
        }
      } else {
        if (isActive) {
          el.className = 'nav-tab active px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap bg-emerald-500 text-zinc-950';
        } else {
          el.className = 'nav-tab px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap bg-zinc-800 text-zinc-300';
        }
      }
    });

    this.renderMainContent();
  }

  updateVolumeIcon(vol) {
    const icon = document.getElementById('icon-volume');
    if (!icon) return;
    if (vol === 0) {
      icon.setAttribute('data-lucide', 'volume-x');
    } else {
      icon.setAttribute('data-lucide', 'volume-2');
    }
    refreshLucideIcons();
  }

  bindNetworkEvents() {
    window.addEventListener('online', () => {
      this.updateNetworkStatus(true);
      showToast('Koneksi internet pulih. Online.', 'success');
    });

    window.addEventListener('offline', () => {
      this.updateNetworkStatus(false);
      showToast('Mode offline aktif. Anda dapat memutar lagu yang telah di-cache.', 'warning');
    });
  }

  bindPWAEvents() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredInstallPrompt = e;
      const installBtn = document.getElementById('btn-install-pwa');
      if (installBtn) {
        installBtn.classList.remove('hidden');
        installBtn.classList.add('flex');
        refreshLucideIcons();
      }
    });

    document.getElementById('btn-install-pwa')?.addEventListener('click', async () => {
      if (!this.deferredInstallPrompt) return;
      this.deferredInstallPrompt.prompt();
      const choice = await this.deferredInstallPrompt.userChoice;
      if (choice?.outcome === 'accepted') {
        showToast('Memasang DITUNE ke perangkat Anda...', 'success');
      }
      this.deferredInstallPrompt = null;
      const installBtn = document.getElementById('btn-install-pwa');
      if (installBtn) {
        installBtn.classList.add('hidden');
        installBtn.classList.remove('flex');
      }
    });

    window.addEventListener('appinstalled', () => {
      this.deferredInstallPrompt = null;
      const installBtn = document.getElementById('btn-install-pwa');
      if (installBtn) {
        installBtn.classList.add('hidden');
        installBtn.classList.remove('flex');
      }
      showToast('DITUNE berhasil terinstal di perangkat Anda!', 'success');
    });
  }

  updateNetworkStatus(isOnline) {
    const badge = document.getElementById('network-badge');
    if (!badge) return;

    if (isOnline) {
      badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
      badge.innerHTML = `<i data-lucide="wifi" class="w-3.5 h-3.5"></i><span class="hidden sm:inline">Online</span>`;
    } else {
      badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20';
      badge.innerHTML = `<i data-lucide="wifi-off" class="w-3.5 h-3.5"></i><span class="hidden sm:inline">Offline</span>`;
    }
    refreshLucideIcons();
  }

  async openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;

    const badgeStatus = document.getElementById('status-credential-badge');
    if (badgeStatus) {
      if (hasCredentials()) {
        badgeStatus.innerHTML = `
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            Terhubung & Aktif
          </span>`;
      } else {
        badgeStatus.innerHTML = `
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
            Kredensial Belum Dikonfigurasi
          </span>`;
      }
    }

    // Update Connected Folder status in modal
    try {
      const folder = await getSetting('connected_folder');
      const folderNameEl = document.getElementById('connected-folder-name');
      const folderBadgeEl = document.getElementById('connected-folder-badge');
      if (folderNameEl) {
        folderNameEl.textContent = folder?.name || 'Belum ada folder terhubung';
      }
      if (folderBadgeEl) {
        folderBadgeEl.textContent = folder?.name ? 'Tersimpan' : 'Kosong';
      }
    } catch (e) {
      console.warn('Gagal membaca info connected_folder:', e);
    }

    this.updateStorageInfo();

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    refreshLucideIcons();
  }

  closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
  }

  /**
   * Helper SSOT: Merge remote audio files with local IndexedDB records
   * Preserves cached blobs, durations, ID3 metadata, and cover art.
   */
  async mergeAndSaveDriveFiles(remoteFiles, folderInfo = null) {
    if (folderInfo && folderInfo.id) {
      await setSetting('connected_folder', {
        id: folderInfo.id,
        name: folderInfo.name || 'Folder Musik',
        connectedAt: Date.now(),
      });
    }

    const existingTracks = await getAllTracks();
    const existingMap = new Map(existingTracks.map((t) => [t.id, t]));
    const blobIds = await getAllAudioBlobIds();

    let existingCount = 0;
    let newCount = 0;
    const tracksToSave = [];

    for (const file of remoteFiles) {
      const existing = existingMap.get(file.id);

      if (existing) {
        // Track already exists: preserve parsed ID3 metadata, cover, and cache status
        const isCached = existing.isCached || blobIds.has(file.id);

        tracksToSave.push({
          ...existing,
          name: file.name,
          size: file.size || existing.size,
          mimeType: file.mimeType || existing.mimeType,
          isCached,
          cachedAt: isCached ? (existing.cachedAt || Date.now()) : null,
        });
        existingCount++;
      } else {
        // New track from Google Drive
        const isCached = blobIds.has(file.id);
        tracksToSave.push({
          id: file.id,
          name: file.name,
          title: file.name.replace(/\.[a-zA-Z0-9]+$/, '').replace(/_/g, ' ').trim(),
          artist: 'Unknown Artist',
          album: 'Unknown Album',
          duration: 0,
          size: file.size || 0,
          mimeType: file.mimeType || 'audio/mpeg',
          isCached,
          cachedAt: isCached ? Date.now() : null,
          hasCover: false,
        });
        newCount++;
      }
    }

    await saveTracks(tracksToSave);
    await this.reloadTracks();
    this.renderMainContent();
    await this.updateStorageInfo();

    return { newCount, existingCount };
  }

  async triggerDrivePicker() {
    if (!hasCredentials()) {
      showToast('Kredensial Google belum terkonfigurasi pada sistem aplikasi.', 'warning');
      this.openSettingsModal();
      return;
    }

    try {
      showToast('Membuka Google Picker...', 'info');
      const pickerResult = await openGooglePicker();

      if (!pickerResult) {
        return;
      }

      // Handle both { files, folder } and direct array (fallback safety)
      const pickedFiles = Array.isArray(pickerResult) ? pickerResult : (pickerResult.files || []);
      const pickedFolder = pickerResult.folder || null;

      if (pickedFiles.length === 0) {
        showToast('Tidak ada file audio yang dipilih.', 'info');
        return;
      }

      showToast(`Menyinkronkan ${pickedFiles.length} file dengan library DITUNE...`, 'info');
      const { newCount, existingCount } = await this.mergeAndSaveDriveFiles(pickedFiles, pickedFolder);

      if (existingCount > 0 && newCount > 0) {
        showToast(`${newCount} lagu baru ditambahkan, ${existingCount} lagu diperbarui & cache offline tetap utuh!`, 'success');
      } else if (existingCount > 0) {
        showToast(`${existingCount} lagu diverifikasi, seluruh cache & metadata offline tetap utuh!`, 'success');
      } else {
        showToast(`${newCount} lagu berhasil dimasukkan ke library!`, 'success');
      }
    } catch (err) {
      console.error('Picker error:', err);
      if (err.message === 'CONFIG_NEEDED') {
        showToast('Kredensial Google belum lengkap. Silakan atur di Pengaturan.', 'warning');
        this.openSettingsModal();
      } else {
        showToast(`Gagal memilih file: ${err.message}`, 'error');
      }
    }
  }

  async syncConnectedFolder() {
    if (!hasCredentials()) {
      showToast('Kredensial Google belum terkonfigurasi pada sistem aplikasi.', 'warning');
      this.openSettingsModal();
      return;
    }

    const folder = await getSetting('connected_folder');
    if (!folder || !folder.id) {
      showToast('Belum ada folder yang terhubung. Silakan pilih folder musik terlebih dahulu.', 'warning');
      this.triggerDrivePicker();
      return;
    }

    const syncBtn = document.getElementById('btn-sync-folder');
    const syncIcon = syncBtn?.querySelector('[data-lucide="refresh-cw"]');

    try {
      if (syncIcon) syncIcon.classList.add('animate-spin');
      if (syncBtn) syncBtn.disabled = true;

      showToast(`Memeriksa lagu baru di folder "${folder.name}"...`, 'info');

      await initGoogleAuth();
      const token = await getAccessToken(true);

      const remoteFiles = await listAudioFilesFromFolder(folder.id, token);

      if (!remoteFiles || remoteFiles.length === 0) {
        showToast(`Tidak ditemukan file audio di folder "${folder.name}".`, 'info');
        return;
      }

      const { newCount, existingCount } = await this.mergeAndSaveDriveFiles(remoteFiles, folder);

      if (newCount > 0) {
        showToast(`Sinkronisasi selesai! ${newCount} lagu baru ditambahkan (${existingCount} lagu sinkron).`, 'success');
      } else {
        showToast(`Pustaka musik sudah mutakhir (${existingCount} lagu di "${folder.name}").`, 'info');
      }
    } catch (err) {
      console.error('Sync folder error:', err);
      showToast(`Gagal menyinkronkan folder: ${err.message}`, 'error');
    } finally {
      if (syncIcon) syncIcon.classList.remove('animate-spin');
      if (syncBtn) syncBtn.disabled = false;
    }
  }

  updateTrackDownloadUI(trackId, percent) {
    const row = document.querySelector(`.track-row[data-id="${trackId}"]`);
    if (!row) return;

    const cacheStatus = row.querySelector('.track-cache-status');
    if (cacheStatus) {
      const durationSpan = cacheStatus.querySelector('span.font-mono.w-10');
      const durationText = durationSpan ? durationSpan.textContent : '';
      cacheStatus.innerHTML = `
        <span class="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-mono font-medium px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30">
          <svg class="w-3.5 h-3.5 animate-spin text-emerald-400" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
          </svg>
          <span>${percent}%</span>
        </span>
        <span class="text-xs text-zinc-400 font-mono w-10 text-right">${durationText}</span>
      `;
    }
  }

  async downloadSingleTrack(trackId) {
    const track = this.allTracks.find((t) => t.id === trackId);
    if (!track) return;

    if (track.isCached) {
      showToast(`"${track.title}" sudah tersimpan di cache offline.`, 'info');
      return;
    }

    if (this.downloadingTrackIds.has(trackId)) {
      showToast(`"${track.title}" sedang diunduh...`, 'info');
      return;
    }

    this.downloadingTrackIds.add(trackId);
    this.updateTrackDownloadUI(trackId, 0);

    try {
      const result = await downloadDriveAudioFile(
        track.id,
        (percent) => {
          this.updateTrackDownloadUI(trackId, percent);
        },
        track.size
      );

      const blob = result.blob;
      const mimeType = result.mimeType;

      // Parse metadata & cover if available
      try {
        const meta = await parseAudioMetadata(blob, track.name);
        track.title = meta.title;
        track.artist = meta.artist;
        track.album = meta.album;
        if (meta.duration > 0) track.duration = meta.duration;

        if (meta.coverBlob) {
          await saveCover(track.id, meta.coverBlob, meta.coverBlob.type);
          track.hasCover = true;
        }
      } catch (metaErr) {
        console.warn('Metadata parsing failed:', metaErr);
      }

      if (blob) {
        await saveAudioBlob(track.id, blob, mimeType);
        track.isCached = true;
        track.cachedAt = Date.now();
        await saveTrack(track);

        await this.reloadTracks();
        await this.updateStorageInfo();
        this.renderMainContent();

        showToast(`"${track.title}" berhasil di-cache untuk offline!`, 'success');
      }
    } catch (err) {
      console.error('Download single track error:', err);
      this.renderMainContent();
      showToast(`Gagal mengunduh: ${err.message}`, 'error');
    } finally {
      this.downloadingTrackIds.delete(trackId);
    }
  }

  async downloadAllTracks() {
    if (this.isBatchDownloading) {
      showToast('Proses unduh sedang berlangsung...', 'info');
      return;
    }

    const uncached = this.allTracks.filter((t) => !t.isCached);
    if (uncached.length === 0) {
      showToast('Semua lagu dalam library sudah di-cache offline!', 'info');
      return;
    }

    const btnDownloadAll = document.getElementById('btn-download-all');
    const originalBtnHtml = btnDownloadAll ? btnDownloadAll.innerHTML : '';

    this.isBatchDownloading = true;
    if (btnDownloadAll) {
      btnDownloadAll.disabled = true;
      btnDownloadAll.classList.add('opacity-70', 'cursor-not-allowed');
    }

    try {
      showToast(`Memulai unduhan ${uncached.length} lagu ke IndexedDB...`, 'info');

      let completed = 0;
      for (const track of uncached) {
        if (btnDownloadAll) {
          btnDownloadAll.innerHTML = `
            <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
            </svg>
            <span>(${completed + 1}/${uncached.length}) 0%</span>
          `;
        }

        this.updateTrackDownloadUI(track.id, 0);
        showProgressToast('batch-download', `(${completed + 1}/${uncached.length}) ${track.title}`, 0);

        try {
          if (!navigator.onLine) {
            showToast('Koneksi internet terputus saat mengunduh.', 'warning');
            break;
          }
          const result = await downloadDriveAudioFile(
            track.id,
            (percent) => {
              if (btnDownloadAll) {
                btnDownloadAll.innerHTML = `
                  <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                  </svg>
                  <span>(${completed + 1}/${uncached.length}) ${percent}%</span>
                `;
              }
              this.updateTrackDownloadUI(track.id, percent);
              showProgressToast('batch-download', `(${completed + 1}/${uncached.length}) ${track.title}`, percent);
            },
            track.size
          );
          const blob = result.blob;
          const mimeType = result.mimeType;

          try {
            const meta = await parseAudioMetadata(blob, track.name);
            track.title = meta.title;
            track.artist = meta.artist;
            track.album = meta.album;
            if (meta.duration > 0) track.duration = meta.duration;

            if (meta.coverBlob) {
              await saveCover(track.id, meta.coverBlob, meta.coverBlob.type);
              track.hasCover = true;
            }
          } catch (_) {}

          if (blob) {
            await saveAudioBlob(track.id, blob, mimeType);
            track.isCached = true;
            track.cachedAt = Date.now();
            await saveTrack(track);

            completed++;
            await this.updateStorageInfo();
          }
        } catch (err) {
          console.warn(`Gagal mengunduh track ${track.name}:`, err);
        }
      }

      await this.reloadTracks();
      this.renderMainContent();
      await this.updateStorageInfo();
      showToast(`Selesai! ${completed} dari ${uncached.length} lagu berhasil disimpan offline.`, 'success');
    } finally {
      this.isBatchDownloading = false;
      removeProgressToast('batch-download');
      if (btnDownloadAll) {
        btnDownloadAll.disabled = false;
        btnDownloadAll.classList.remove('opacity-70', 'cursor-not-allowed');
        btnDownloadAll.innerHTML = originalBtnHtml;
        refreshLucideIcons();
      }
    }
  }
}
