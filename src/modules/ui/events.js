/**
 * DITUNE UI Controller & Event Handlers
 * Glues AudioEngine, IndexedDB storage, Google Drive Picker, and the UI together.
 */

import {
  createIcons,
  Disc,
  FolderPlus,
  Sparkles,
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
} from 'lucide';

import {
  getAllTracks,
  saveTracks,
  saveAudioBlob,
  saveCover,
  getStorageStats,
  clearAllCache,
  clearAllData,
  saveTrack,
} from '../storage/db.js';
import {
  hasCredentials,
  openGooglePicker,
  downloadDriveAudioFile,
} from '../auth/gdrive.js';
import { createDemoTracks } from '../player/demoTracks.js';
import { formatDuration, parseAudioMetadata } from '../parser/metadata.js';
import {
  renderTrackList,
  renderArtistsView,
  renderAlbumsView,
  showToast,
  formatBytes,
} from './components.js';

export function refreshLucideIcons() {
  createIcons({
    icons: {
      Disc,
      FolderPlus,
      Sparkles,
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

    this.bindEngineEvents();
    this.bindDOMEvents();
    this.bindNetworkEvents();
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
    const prevScrollTop = container.scrollTop;

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
        backBtn.className = 'mb-4 flex items-center gap-2';
        backBtn.innerHTML = `
          <button id="btn-clear-filter" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-300 hover:text-white transition">
            <i data-lucide="x" class="w-3.5 h-3.5"></i>
            <span>Kembali ke semua ${this.filterArtist ? 'Artis' : 'Album'}</span>
          </button>
          <span class="text-xs text-zinc-500">•</span>
          <span class="text-xs text-emerald-400 font-semibold">${filterTitle}</span>
        `;
        container.prepend(backBtn);
      }
    }

    container.scrollTop = prevScrollTop;
    refreshLucideIcons();
  }

  bindEngineEvents() {
    this.engine.on('trackChange', ({ track, coverUrl }) => {
      // Update player bar info
      const titleEl = document.getElementById('player-title');
      const artistEl = document.getElementById('player-artist');
      const coverImg = document.getElementById('player-cover-img');
      const coverFallback = document.getElementById('player-cover-fallback');
      const badgeStatus = document.getElementById('player-status-badge');
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

      if (badgeStatus) {
        if (track.isCached) {
          badgeStatus.classList.remove('hidden');
          badgeStatus.classList.add('flex');
        } else {
          badgeStatus.classList.add('hidden');
          badgeStatus.classList.remove('flex');
        }
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

    this.engine.on('loading', ({ isLoading, percent }) => {
      if (isLoading && percent > 0 && percent < 100) {
        const timeCurEl = document.getElementById('time-current');
        if (timeCurEl) timeCurEl.textContent = `${percent}%`;
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

        // Empty picker button
        if (e.target.closest('#btn-empty-picker')) {
          this.triggerDrivePicker();
          return;
        }

        // Empty demo button
        if (e.target.closest('#btn-empty-demo')) {
          this.loadDemoTracks();
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

    // Drive Picker Buttons
    const openPickerHandler = () => this.triggerDrivePicker();
    document.getElementById('btn-open-picker')?.addEventListener('click', openPickerHandler);
    document.getElementById('btn-open-picker-mobile')?.addEventListener('click', openPickerHandler);

    // Demo Tracks Button
    document.getElementById('btn-load-demo')?.addEventListener('click', () => {
      this.loadDemoTracks();
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
        await clearAllData();
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

  openSettingsModal() {
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

  async triggerDrivePicker() {
    if (!hasCredentials()) {
      showToast('Kredensial Google belum terkonfigurasi pada sistem aplikasi.', 'warning');
      this.openSettingsModal();
      return;
    }

    try {
      showToast('Membuka Google Picker...', 'info');
      const pickedFiles = await openGooglePicker();

      if (!pickedFiles || pickedFiles.length === 0) {
        showToast('Tidak ada file audio yang dipilih.', 'info');
        return;
      }

      showToast(`Menambahkan ${pickedFiles.length} file ke library DITUNE...`, 'success');

      // Create initial track records
      const newTracks = pickedFiles.map((file) => ({
        id: file.id,
        name: file.name,
        title: file.name.replace(/\.[a-zA-Z0-9]+$/, '').trim(),
        artist: 'Unknown Artist',
        album: 'Google Drive',
        duration: 0,
        size: file.size || 0,
        mimeType: file.mimeType || 'audio/mpeg',
        isCached: false,
        cachedAt: null,
        hasCover: false,
      }));

      await saveTracks(newTracks);
      await this.reloadTracks();
      this.renderMainContent();
      showToast(`${pickedFiles.length} lagu berhasil dimasukkan ke library!`, 'success');
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

  async loadDemoTracks() {
    try {
      showToast('Membuat lagu demo berformat WAV dengan synthesizer audio...', 'info');
      const demoTracks = await createDemoTracks();

      for (const track of demoTracks) {
        // Save audio blob and cover blob directly into IndexedDB
        await saveAudioBlob(track.id, track.audioBlob, track.mimeType);
        await saveCover(track.id, track.coverBlob, 'image/svg+xml');

        const trackRecord = {
          id: track.id,
          name: track.name,
          title: track.title,
          artist: track.artist,
          album: track.album,
          duration: track.duration,
          size: track.size,
          mimeType: track.mimeType,
          isCached: true,
          cachedAt: Date.now(),
          hasCover: true,
        };
        await saveTrack(trackRecord);
      }

      await this.reloadTracks();
      await this.updateStorageInfo();
      this.renderMainContent();
      showToast('3 Lagu Demo berhasil dimuat dan disimpan di IndexedDB!', 'success');

      // Auto play first demo track
      if (this.allTracks.length > 0) {
        this.engine.playTrack(this.allTracks[0], this.allTracks);
      }
    } catch (err) {
      console.error('Demo load error:', err);
      showToast(`Gagal memuat demo: ${err.message}`, 'error');
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

    try {
      showToast(`Mengunduh "${track.title}" ke cache IndexedDB...`, 'info');

      let blob = null;
      let mimeType = track.mimeType || 'audio/mpeg';

      if (track.id.startsWith('demo-track-')) {
        const demoTracks = await createDemoTracks();
        const match = demoTracks.find((d) => d.id === track.id);
        if (match) {
          blob = match.audioBlob;
          mimeType = match.mimeType;
          if (match.coverBlob) {
            await saveCover(track.id, match.coverBlob, 'image/svg+xml');
            track.hasCover = true;
          }
        }
      } else {
        const result = await downloadDriveAudioFile(track.id);
        blob = result.blob;
        mimeType = result.mimeType;

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
            <i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i>
            <span>Mengunduh (${completed + 1}/${uncached.length})...</span>
          `;
        }

        try {
          let blob = null;
          let mimeType = track.mimeType || 'audio/mpeg';

          if (track.id.startsWith('demo-track-')) {
            const demoTracks = await createDemoTracks();
            const match = demoTracks.find((d) => d.id === track.id);
            if (match) {
              blob = match.audioBlob;
              mimeType = match.mimeType;
              if (match.coverBlob) {
                await saveCover(track.id, match.coverBlob, 'image/svg+xml');
                track.hasCover = true;
              }
            }
          } else {
            if (!navigator.onLine) {
              showToast('Koneksi internet terputus saat mengunduh.', 'warning');
              break;
            }
            const result = await downloadDriveAudioFile(track.id);
            blob = result.blob;
            mimeType = result.mimeType;

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
          }

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
      showToast(`Selesai! ${completed} dari ${uncached.length} lagu berhasil disimpan offline.`, 'success');
    } finally {
      this.isBatchDownloading = false;
      if (btnDownloadAll) {
        btnDownloadAll.disabled = false;
        btnDownloadAll.classList.remove('opacity-70', 'cursor-not-allowed');
        btnDownloadAll.innerHTML = originalBtnHtml;
        refreshLucideIcons();
      }
    }
  }
}
