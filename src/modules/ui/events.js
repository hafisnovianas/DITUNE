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
  MoreVertical,
  RotateCcw,
  EyeOff,
  Upload,
  Plus,
  ListMusic,
  ArrowLeft,
  Pencil,
  ChevronRight,
  ListX,
} from 'lucide';

import {
  getAllTracks,
  saveTracks,
  saveAudioBlob,
  removeAudioBlob,
  getAudioBlob,
  getAllAudioBlobIds,
  saveCover,
  getStorageStats,
  clearAllCache,
  clearAllData,
  saveTrack,
  getSetting,
  setSetting,
  getIgnoredTracks,
  ignoreTrack,
  unignoreTrack,
  clearIgnoredTracks,
  getAllPlaylists,
  getPlaylist,
  savePlaylist,
  deletePlaylist,
} from '../storage/db.js';
import {
  DITUNE_FOLDER_NAME,
  hasCredentials,
  hasActiveSession,
  openGooglePicker,
  findDituneFolder,
  findOrCreateDituneFolder,
  listAuthorizedAudioFiles,
  uploadAudioToDrive,
  buildUploadDuplicateKey,
  isAudioMediaItem,
  inferAudioMimeType,
  getAccessToken,
  downloadDriveAudioFile,
} from '../auth/gdrive.js';
import { formatDuration, parseAudioMetadata } from '../parser/metadata.js';
import {
  renderTrackList,
  renderArtistsView,
  renderAlbumsView,
  renderSidebarPlaylists,
  renderPlaylistView,
  showToast,
  showProgressToast,
  removeProgressToast,
  formatBytes,
  escapeHtml,
} from './components.js';

export function refreshLucideIcons() {
  if (typeof document === 'undefined') return;
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
      MoreVertical,
      RotateCcw,
      EyeOff,
      Upload,
      Plus,
      ListMusic,
      ArrowLeft,
      Pencil,
      ChevronRight,
      ListX,
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
    this.isBatchUploading = false;
    this.isSyncing = false;
    this.isPicking = false;
    this.dragDepth = 0;
    this.downloadingTrackIds = new Set();
    this.deferredInstallPrompt = null;
    this.activeMenuTrackId = null;
    this.confirmActionCallback = null;
    this.hasRestoredIgnoredTracks = false;
    this.connectedFolder = null;
    this.playlists = [];
    this.activePlaylistId = null;
    this.isCreatingPlaylist = false;
    this._reloadPromise = Promise.resolve();

    this.bindEngineEvents();
    this.bindDOMEvents();
    this.bindNetworkEvents();
    this.bindPWAEvents();
  }

  async init() {
    await this.reloadTracks();
    await this.updateStorageInfo();
    await this.loadPlaylists();

    // Check online status
    this.updateNetworkStatus(navigator.onLine);

    // Initial render
    this.renderMainContent();
    refreshLucideIcons();
  }

  reloadTracks() {
    const runReload = async () => {
      this.allTracks = await getAllTracks();
      try {
        const savedFolder = await getSetting('connected_folder');
        // Clear stale drive.readonly folder metadata from pre-drive.file releases
        if (savedFolder && savedFolder.scope !== 'drive.file') {
          await setSetting('connected_folder', null);
          this.connectedFolder = null;
        } else {
          this.connectedFolder = savedFolder;
        }
      } catch (e) {
        console.warn('Gagal membaca connected_folder saat reload:', e);
      }
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
    };

    const next = this._reloadPromise.then(runReload, runReload);
    this._reloadPromise = next;
    return next;
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

    if (this.activeTab === 'playlist' && this.activePlaylistId) {
      const pl = this.playlists.find((p) => p.id === this.activePlaylistId);
      if (pl) {
        list = pl.trackIds.map((id) => list.find((t) => t.id === id)).filter(Boolean);
        if (this.searchQuery.trim()) {
          const q = this.searchQuery.toLowerCase();
          list = list.filter((t) =>
            (t.title || t.name || '').toLowerCase().includes(q) ||
            (t.artist || '').toLowerCase().includes(q) ||
            (t.album || '').toLowerCase().includes(q)
          );
        }
        return list;
      }
    }

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

    if (this.activeTab === 'playlist' && this.activePlaylistId) {
      const pl = this.playlists.find((p) => p.id === this.activePlaylistId);
      if (pl) {
        const plTracks = pl.trackIds
          .map((id) => this.allTracks.find((t) => t.id === id))
          .filter(Boolean);
        const currentId = this.engine.currentTrack?.id;
        container.innerHTML = renderPlaylistView(pl, plTracks, currentId, this.engine.isPlaying);
      }
    } else if (this.activeTab === 'artists' && !this.filterArtist) {
      container.innerHTML = renderArtistsView(this.allTracks);
    } else if (this.activeTab === 'albums' && !this.filterAlbum) {
      container.innerHTML = renderAlbumsView(this.allTracks);
    } else {
      const filtered = this.getFilteredTracks();
      const currentId = this.engine.currentTrack?.id;
      container.innerHTML = renderTrackList(filtered, currentId, this.engine.isPlaying, this.connectedFolder);

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
          <span class="text-xs text-emerald-400 font-semibold">${escapeHtml(filterTitle)}</span>
        `;
        container.prepend(backBtn);
      }
    }

    const uploadBtn = document.getElementById('btn-upload-tracks');
    if (uploadBtn && this.isBatchUploading) {
      uploadBtn.disabled = true;
    }

    const importBtn = document.getElementById('btn-import-drive') || document.getElementById('btn-empty-picker');
    if (importBtn && this.isPicking) {
      importBtn.disabled = true;
    }

    const syncBtn = document.getElementById('btn-sync-folder');
    if (syncBtn && this.isSyncing) {
      syncBtn.disabled = true;
      const syncIcon = syncBtn.querySelector('[data-lucide="refresh-cw"]');
      if (syncIcon) syncIcon.classList.add('animate-spin');
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
        // Track Menu Button Click
        const menuBtn = e.target.closest('.btn-track-menu');
        if (menuBtn) {
          e.stopPropagation();
          const trackId = menuBtn.getAttribute('data-id');
          this.openTrackActionMenu(trackId, menuBtn);
          return;
        }

        // Track Play/Pause Indicator Button (Column #)
        const playBtn = e.target.closest('.track-play-btn');
        if (playBtn) {
          e.stopPropagation();
          const trackId = playBtn.getAttribute('data-id');
          if (this.engine.currentTrack?.id === trackId) {
            this.engine.togglePlay();
          } else {
            const track = this.allTracks.find((t) => t.id === trackId);
            if (track) {
              const currentFiltered = this.getFilteredTracks();
              this.engine.playTrack(track, currentFiltered);
            }
          }
          return;
        }

        // Track Row Click (Play or restart track)
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
          if (this.engine.currentTrack?.id === trackId) {
            // Putar ulang dari awal jika mengeklik baris lagu yang sedang aktif
            this.engine.seek(0);
            if (!this.engine.isPlaying) {
              this.engine.resume();
            }
            return;
          }

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

        // Play All Playlist
        const playAllBtn = e.target.closest('#btn-play-all-playlist');
        if (playAllBtn) {
          const plId = playAllBtn.getAttribute('data-playlist-id');
          const pl = this.playlists.find((p) => p.id === plId);
          if (pl) {
            const plTracks = pl.trackIds
              .map((id) => this.allTracks.find((t) => t.id === id))
              .filter(Boolean);
            if (plTracks.length > 0) {
              this.engine.setPlaylist(plTracks, 0);
            }
          }
          return;
        }

        // Back from playlist view
        const backBtn = e.target.closest('#btn-back-playlists');
        if (backBtn) {
          this.activePlaylistId = null;
          this.setActiveTab('all');
          return;
        }

        // Playlist action menu (rename, delete)
        const plActionsBtn = e.target.closest('#btn-playlist-actions');
        if (plActionsBtn) {
          e.stopPropagation();
          const plId = plActionsBtn.getAttribute('data-playlist-id');
          this.openPlaylistActionMenu(plId, plActionsBtn);
          return;
        }

        // Upload audio files button
        if (e.target.closest('#btn-upload-tracks')) {
          if (this.isBatchUploading) {
            showToast('Proses upload batch sedang berlangsung. Mohon tunggu hingga selesai.', 'info');
            return;
          }
          if (this.isSyncing || this.isBatchDownloading || this.isPicking || this.downloadingTrackIds.size > 0) {
            showToast('Mohon tunggu hingga proses saat ini selesai sebelum mengunggah lagu.', 'warning');
            return;
          }
          document.getElementById('upload-audio-input')?.click();
          return;
        }

        // Sync connected library button
        if (e.target.closest('#btn-sync-folder')) {
          this.syncConnectedFolder();
          return;
        }

        // Import from Drive Picker buttons (empty state & track list header)
        if (e.target.closest('#btn-empty-picker') || e.target.closest('#btn-import-drive')) {
          this.triggerDrivePicker();
          return;
        }
      });
    }

    // --- Playlist sidebar events ---
    document.getElementById('btn-create-playlist')?.addEventListener('click', () => {
      this.startInlinePlaylistCreate();
    });

    document.getElementById('sidebar-playlists')?.addEventListener('click', (e) => {
      const item = e.target.closest('.playlist-item');
      if (item) {
        const plId = item.getAttribute('data-playlist-id');
        this.activePlaylistId = plId;
        this.setActiveTab('playlist');
      }
    });

    // Batch Upload Input & Drag-and-Drop on Main Workspace
    const uploadInput = document.getElementById('upload-audio-input');
    if (uploadInput) {
      uploadInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        if (files.length > 0) {
          await this.handleFilesUpload(files);
        }
      });
    }

    const mainWorkspace = document.getElementById('main-workspace');
    const dropOverlay = document.getElementById('upload-drop-overlay');
    const hasDraggedFiles = (evt) => Array.from(evt.dataTransfer?.types || []).includes('Files');

    // Prevent browser from opening dropped files if dropped outside main workspace (e.g. sidebar/player bar)
    document.addEventListener('dragover', (e) => {
      if (hasDraggedFiles(e)) {
        e.preventDefault();
      }
    });
    document.addEventListener('drop', (e) => {
      if (hasDraggedFiles(e) && !e.target.closest('#main-workspace')) {
        e.preventDefault();
        this.dragDepth = 0;
        if (dropOverlay) {
          dropOverlay.classList.add('hidden');
          dropOverlay.classList.remove('flex');
        }
      }
    });

    if (mainWorkspace && dropOverlay) {
      const setOverlayVisible = (visible) => {
        dropOverlay.classList.toggle('hidden', !visible);
        dropOverlay.classList.toggle('flex', visible);
      };

      mainWorkspace.addEventListener('dragenter', (e) => {
        if (!hasDraggedFiles(e)) return;
        e.preventDefault();
        if (this.hasActiveTransferOrSync()) return;
        this.dragDepth++;
        setOverlayVisible(true);
      });

      mainWorkspace.addEventListener('dragover', (e) => {
        if (!hasDraggedFiles(e)) return;
        e.preventDefault();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = this.hasActiveTransferOrSync() ? 'none' : 'copy';
        }
      });

      mainWorkspace.addEventListener('dragleave', (e) => {
        if (!hasDraggedFiles(e)) return;
        this.dragDepth = Math.max(0, this.dragDepth - 1);
        if (this.dragDepth === 0) {
          setOverlayVisible(false);
        }
      });

      mainWorkspace.addEventListener('drop', async (e) => {
        if (!hasDraggedFiles(e)) return;
        e.preventDefault();
        this.dragDepth = 0;
        setOverlayVisible(false);
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
          await this.handleFilesUpload(files);
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
    document.getElementById('btn-settings-import-drive')?.addEventListener('click', () => {
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
    document.getElementById('btn-clear-cache')?.addEventListener('click', () => {
      this.handleClearCache();
    });

    // Reset All Library Button
    document.getElementById('btn-reset-library')?.addEventListener('click', () => {
      this.handleResetLibrary();
    });

    // Floating Track Action Menu Click Handling
    const actionMenu = document.getElementById('track-action-menu');
    if (actionMenu) {
      actionMenu.addEventListener('click', async (e) => {
        const item = e.target.closest('.menu-action-item');
        if (!item) return;

        const action = item.getAttribute('data-action');
        const trackId = item.getAttribute('data-id') || this.activeMenuTrackId;
        this.closeTrackActionMenu();

        if (action === 'remove-cache') {
          await this.handleRemoveTrackCache(trackId);
        } else if (action === 'delete-track') {
          this.promptDeleteTrack(trackId);
        } else if (action === 'rename-playlist') {
          this.promptRenamePlaylist(item.getAttribute('data-id'));
        } else if (action === 'delete-playlist') {
          this.promptDeletePlaylist(item.getAttribute('data-id'));
        } else if (action === 'remove-from-playlist') {
          const plId = item.getAttribute('data-playlist-id');
          await this.removeTrackFromPlaylist(plId, trackId);
        }
      });
    }

    // Add to playlist from track action menu
    document.addEventListener('click', async (e) => {
      const addBtn = e.target.closest('.menu-add-to-playlist');
      if (addBtn) {
        const plId = addBtn.getAttribute('data-playlist-id');
        const trackId = addBtn.getAttribute('data-track-id');
        await this.addTrackToPlaylist(plId, trackId);
        this.closeTrackActionMenu();
      }
    });

    // Close floating action menu on outside clicks and scroll
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#track-action-menu') && !e.target.closest('.btn-track-menu') && !e.target.closest('#btn-playlist-actions')) {
        this.closeTrackActionMenu();
      }
    });
    window.addEventListener('scroll', () => this.closeTrackActionMenu(), true);

    // Confirmation Modal Actions
    document.getElementById('btn-confirm-cancel')?.addEventListener('click', () => {
      this.closeConfirmModal();
    });

    document.getElementById('btn-confirm-action')?.addEventListener('click', async () => {
      const cb = this.confirmActionCallback;
      this.closeConfirmModal();
      if (typeof cb === 'function') {
        await cb();
      }
    });

    // Ignored Tracks Modal Actions
    document.getElementById('btn-manage-ignored')?.addEventListener('click', () => {
      this.openIgnoredTracksModal();
    });

    document.getElementById('btn-done-ignored-modal')?.addEventListener('click', () => {
      this.closeIgnoredTracksModal();
    });

    document.getElementById('btn-restore-all-ignored')?.addEventListener('click', async () => {
      const ignored = await getIgnoredTracks();
      if (ignored.length === 0) {
        showToast('Tidak ada lagu di daftar abaikan.', 'info');
        return;
      }
      await clearIgnoredTracks();
      this.hasRestoredIgnoredTracks = true;
      await this.renderIgnoredTracksModalList();
      const countEl = document.getElementById('modal-ignored-count');
      if (countEl) countEl.textContent = '0 lagu';
      showToast('Semua lagu telah dipulihkan dari daftar abaikan.', 'success');
    });

    const ignoredListEl = document.getElementById('ignored-tracks-list');
    if (ignoredListEl) {
      ignoredListEl.addEventListener('click', async (e) => {
        const unignoreBtn = e.target.closest('.btn-unignore-track');
        if (unignoreBtn) {
          const trackId = unignoreBtn.getAttribute('data-id');
          await unignoreTrack(trackId);
          this.hasRestoredIgnoredTracks = true;
          await this.renderIgnoredTracksModalList();
          const remaining = await getIgnoredTracks();
          const countEl = document.getElementById('modal-ignored-count');
          if (countEl) countEl.textContent = `${remaining.length} lagu`;
          showToast('Lagu dipulihkan dari daftar abaikan.', 'info');
        }
      });
    }
  }

  setActiveTab(tab) {
    if (tab !== 'playlist') {
      this.activePlaylistId = null;
    }
    this.activeTab = tab;
    this.filterArtist = null;
    this.filterAlbum = null;

    document.querySelectorAll('.nav-tab').forEach((el) => {
      const t = el.getAttribute('data-tab');
      const isDesktop = Boolean(el.closest('aside'));
      const isPlaylistItem = el.classList.contains('playlist-item');
      const isActive = isPlaylistItem
        ? (tab === 'playlist' && el.getAttribute('data-playlist-id') === this.activePlaylistId)
        : (t === tab);

      if (isPlaylistItem) {
        // Playlist items are re-rendered by renderSidebarPlaylists below
        return;
      }

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

    this.updateSidebarPlaylists();
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
      if (!hasCredentials()) {
        badgeStatus.innerHTML = `<span class="text-xs text-amber-400 font-medium">Kredensial Belum Siap</span>`;
      } else if (hasActiveSession()) {
        badgeStatus.innerHTML = `<span class="text-xs text-emerald-400 font-medium">Sesi Google Aktif</span>`;
      } else {
        badgeStatus.innerHTML = `<span class="text-xs text-zinc-400 font-medium">Siap Login</span>`;
      }
    }

    // Update Connected Folder status in modal
    try {
      const folder = await getSetting('connected_folder');
      const folderNameEl = document.getElementById('connected-folder-name');
      if (folderNameEl) {
        folderNameEl.textContent = folder?.name || 'DITUNE Music (Otomatis)';
      }
    } catch (e) {
      console.warn('Gagal membaca info connected_folder:', e);
    }

    // Update Ignored Tracks count in modal
    try {
      const ignored = await getIgnoredTracks();
      const countEl = document.getElementById('modal-ignored-count');
      if (countEl) {
        countEl.textContent = `${ignored.length} lagu`;
      }
    } catch (e) {
      console.warn('Gagal membaca info ignored_tracks:', e);
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

  openTrackActionMenu(trackId, triggerBtn) {
    const menu = document.getElementById('track-action-menu');
    if (!menu) return;

    const track = this.allTracks.find((t) => t.id === trackId);
    if (!track) return;

    this.activeMenuTrackId = trackId;

    const safeTrackId = escapeHtml(track.id);
    menu.innerHTML = `
      ${this.activeTab === 'playlist' && this.activePlaylistId ? `
        <button class="menu-action-item flex items-center gap-2.5 w-full px-3 py-2 text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition cursor-pointer" data-action="remove-from-playlist" data-id="${safeTrackId}" data-playlist-id="${escapeHtml(this.activePlaylistId)}">
          <i data-lucide="list-x" class="w-3.5 h-3.5 text-zinc-400"></i>
          <span>Hapus dari Playlist</span>
        </button>` : ''}
      ${this.playlists.length > 0 ? `
        <div class="relative group/pl">
          <button class="menu-action-item flex items-center justify-between w-full px-3 py-2 text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition cursor-pointer">
            <span class="flex items-center gap-2.5">
              <i data-lucide="list-music" class="w-3.5 h-3.5 text-zinc-400"></i>
              <span>Tambah ke Playlist</span>
            </span>
            <i data-lucide="chevron-right" class="w-3 h-3 text-zinc-500"></i>
          </button>
          <div class="hidden group-hover/pl:block absolute left-full top-0 ml-1 w-44 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl py-1.5 z-50">
            ${this.playlists.map((pl) => `
              <button class="menu-add-to-playlist flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-zinc-800 text-zinc-300 hover:text-white text-xs transition cursor-pointer" data-playlist-id="${escapeHtml(pl.id)}" data-track-id="${safeTrackId}">
                ${escapeHtml(pl.name)}
              </button>
            `).join('')}
          </div>
        </div>
      ` : ''}
      ${
        track.isCached
          ? `<button class="menu-action-item flex items-center gap-2.5 w-full px-3 py-2 text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition cursor-pointer" data-action="remove-cache" data-id="${safeTrackId}">
               <i data-lucide="trash-2" class="w-3.5 h-3.5 text-zinc-400"></i>
               <span>Hapus dari Cache Offline</span>
             </button>`
          : ''
      }
      <button class="menu-action-item flex items-center gap-2.5 w-full px-3 py-2 text-left hover:bg-rose-500/10 text-rose-400 hover:text-rose-300 transition cursor-pointer" data-action="delete-track" data-id="${safeTrackId}">
        <i data-lucide="eye-off" class="w-3.5 h-3.5 text-rose-400"></i>
        <span>Hapus dari Library</span>
      </button>
      <a href="https://drive.google.com/file/d/${encodeURIComponent(track.id)}/view" target="_blank" rel="noopener noreferrer" class="menu-action-item flex items-center gap-2.5 w-full px-3 py-2 text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition cursor-pointer">
        <i data-lucide="external-link" class="w-3.5 h-3.5 text-zinc-400"></i>
        <span>Buka di Google Drive</span>
      </a>
    `;

    refreshLucideIcons();

    // Position menu relative to button
    const rect = triggerBtn.getBoundingClientRect();
    const menuWidth = 208; // w-52
    let left = rect.right - menuWidth;
    if (left < 10) left = 10;
    if (left + menuWidth > window.innerWidth - 10) left = window.innerWidth - menuWidth - 10;

    let top = rect.bottom + 4;
    const estimatedHeight = (track.isCached ? 115 : 80) + (this.playlists.length > 0 ? 36 : 0) + (this.activeTab === 'playlist' && this.activePlaylistId ? 36 : 0);
    if (top + estimatedHeight > window.innerHeight - 10) {
      top = rect.top - estimatedHeight - 4;
    }

    menu.style.top = `${Math.max(10, top)}px`;
    menu.style.left = `${left}px`;
    menu.classList.remove('hidden');
  }

  closeTrackActionMenu() {
    const menu = document.getElementById('track-action-menu');
    if (menu) {
      menu.classList.add('hidden');
    }
    this.activeMenuTrackId = null;
  }

  // ================= PLAYLIST METHODS =================

  async loadPlaylists() {
    this.playlists = await getAllPlaylists();
    this.updateSidebarPlaylists();
  }

  updateSidebarPlaylists() {
    const container = document.getElementById('playlist-list-container');
    if (!container) return;
    container.innerHTML = renderSidebarPlaylists(this.playlists, this.activePlaylistId);
    refreshLucideIcons();
  }

  startInlinePlaylistCreate() {
    if (this.isCreatingPlaylist) return;
    this.isCreatingPlaylist = true;

    const container = document.getElementById('playlist-list-container');
    if (!container) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Nama playlist...';
    input.className = 'w-full px-3 py-2 rounded-lg bg-zinc-800 border border-emerald-500/40 text-sm text-white placeholder-zinc-500 outline-none focus:border-emerald-500';
    input.maxLength = 100;

    container.prepend(input);
    input.focus();

    const cleanup = () => {
      this.isCreatingPlaylist = false;
      input.remove();
    };

    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const name = input.value.trim();
        if (!name) { cleanup(); return; }
        const pl = {
          id: crypto.randomUUID(),
          name,
          trackIds: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await savePlaylist(pl);
        cleanup();
        await this.loadPlaylists();
        showToast(`Playlist "${name}" dibuat.`, 'success');
      } else if (e.key === 'Escape') {
        cleanup();
      }
    });

    input.addEventListener('blur', () => {
      setTimeout(() => { if (this.isCreatingPlaylist) cleanup(); }, 150);
    });
  }

  openPlaylistActionMenu(playlistId, triggerBtn) {
    const menu = document.getElementById('track-action-menu');
    if (!menu) return;
    const pl = this.playlists.find((p) => p.id === playlistId);
    if (!pl) return;

    menu.innerHTML = `
      <button class="menu-action-item flex items-center gap-2.5 w-full px-3 py-2 text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition cursor-pointer" data-action="rename-playlist" data-id="${escapeHtml(playlistId)}">
        <i data-lucide="pencil" class="w-3.5 h-3.5 text-zinc-400"></i>
        <span>Ubah Nama</span>
      </button>
      <button class="menu-action-item flex items-center gap-2.5 w-full px-3 py-2 text-left hover:bg-rose-500/10 text-rose-400 hover:text-rose-300 transition cursor-pointer" data-action="delete-playlist" data-id="${escapeHtml(playlistId)}">
        <i data-lucide="trash-2" class="w-3.5 h-3.5 text-rose-400"></i>
        <span>Hapus Playlist</span>
      </button>
    `;

    const rect = triggerBtn.getBoundingClientRect();
    const menuWidth = 208;
    let left = rect.right - menuWidth;
    if (left < 10) left = 10;
    if (left + menuWidth > window.innerWidth - 10) left = window.innerWidth - menuWidth - 10;
    let top = rect.bottom + 4;
    if (top + 80 > window.innerHeight - 10) top = rect.top - 80 - 4;
    menu.style.top = `${Math.max(10, top)}px`;
    menu.style.left = `${left}px`;
    menu.classList.remove('hidden');
    refreshLucideIcons();
  }

  async addTrackToPlaylist(playlistId, trackId) {
    const pl = this.playlists.find((p) => p.id === playlistId);
    if (!pl) return;
    if (pl.trackIds.includes(trackId)) {
      showToast('Lagu sudah ada di playlist ini.', 'info');
      return;
    }
    pl.trackIds.push(trackId);
    pl.updatedAt = Date.now();
    await savePlaylist(pl);
    await this.loadPlaylists();
    const track = this.allTracks.find((t) => t.id === trackId);
    showToast(`"${track?.title || track?.name || 'Lagu'}" ditambahkan ke "${pl.name}".`, 'success');
    if (this.activePlaylistId === playlistId) {
      this.renderMainContent();
    }
  }

  async removeTrackFromPlaylist(playlistId, trackId) {
    const pl = this.playlists.find((p) => p.id === playlistId);
    if (!pl) return;
    pl.trackIds = pl.trackIds.filter((id) => id !== trackId);
    pl.updatedAt = Date.now();
    await savePlaylist(pl);
    await this.loadPlaylists();
    showToast('Lagu dihapus dari playlist.', 'info');
    if (this.activePlaylistId === playlistId) {
      this.renderMainContent();
    }
  }

  promptRenamePlaylist(playlistId) {
    const pl = this.playlists.find((p) => p.id === playlistId);
    if (!pl) return;

    const modal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-modal-title');
    const descEl = document.getElementById('confirm-modal-desc');
    const btnAction = document.getElementById('btn-confirm-action');
    if (!modal) return;

    if (titleEl) titleEl.textContent = 'Ubah Nama Playlist';
    if (descEl) {
      descEl.innerHTML = `<input id="rename-playlist-input" type="text" value="${escapeHtml(pl.name)}" maxlength="100" class="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-white outline-none focus:border-emerald-500 mt-1">`;
    }
    if (btnAction) {
      btnAction.textContent = 'Simpan';
      btnAction.className = 'px-3.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-semibold border border-emerald-500/30 transition cursor-pointer';
    }

    this.confirmActionCallback = async () => {
      const input = document.getElementById('rename-playlist-input');
      const newName = input?.value?.trim();
      if (!newName) return;
      pl.name = newName;
      pl.updatedAt = Date.now();
      await savePlaylist(pl);
      await this.loadPlaylists();
      this.renderMainContent();
      showToast(`Playlist diubah menjadi "${newName}".`, 'success');
    };

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => document.getElementById('rename-playlist-input')?.focus(), 100);
  }

  promptDeletePlaylist(playlistId) {
    const pl = this.playlists.find((p) => p.id === playlistId);
    if (!pl) return;

    const modal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-modal-title');
    const descEl = document.getElementById('confirm-modal-desc');
    const btnAction = document.getElementById('btn-confirm-action');
    if (!modal) return;

    if (titleEl) titleEl.textContent = 'Hapus Playlist';
    if (descEl) {
      descEl.textContent = `Apakah Anda yakin ingin menghapus playlist "${pl.name}"? Lagu-lagu di dalamnya tetap ada di pustaka.`;
    }
    if (btnAction) {
      btnAction.textContent = 'Hapus';
      btnAction.className = 'px-3.5 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-semibold border border-rose-500/30 transition cursor-pointer';
    }

    this.confirmActionCallback = async () => {
      await deletePlaylist(playlistId);
      if (this.activePlaylistId === playlistId) {
        this.activePlaylistId = null;
        this.setActiveTab('all');
      }
      await this.loadPlaylists();
      showToast(`Playlist "${pl.name}" dihapus.`, 'info');
    };

    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  hasActiveTransferOrSync() {
    return (
      this.isBatchUploading ||
      this.isBatchDownloading ||
      this.isSyncing ||
      this.isPicking ||
      this.downloadingTrackIds.size > 0
    );
  }

  async handleClearCache(confirmFn = (msg) => (typeof confirm === 'function' ? confirm(msg) : false)) {
    if (this.hasActiveTransferOrSync()) {
      showToast('Mohon tunggu hingga proses upload, unduhan, atau sinkronisasi selesai.', 'warning');
      return false;
    }

    if (!confirmFn('Yakin ingin menghapus seluruh audio yang tersimpan di IndexedDB? (Metadata daftar lagu tetap disimpan)')) {
      return false;
    }

    if (this.hasActiveTransferOrSync()) {
      showToast('Mohon tunggu hingga proses upload, unduhan, atau sinkronisasi selesai.', 'warning');
      return false;
    }

    await clearAllCache();
    await this.reloadTracks();
    await this.updateStorageInfo();
    this.renderMainContent();
    showToast('Seluruh audio cache telah dibersihkan.', 'info');
    return true;
  }

  async handleResetLibrary(confirmFn = (msg) => (typeof confirm === 'function' ? confirm(msg) : false)) {
    if (this.hasActiveTransferOrSync()) {
      showToast('Mohon tunggu hingga proses upload, unduhan, atau sinkronisasi selesai.', 'warning');
      return false;
    }

    if (!confirmFn('Yakin ingin mengosongkan seluruh lagu dan audio cache di DITUNE? (Folder terhubung tetap disimpan)')) {
      return false;
    }

    if (this.hasActiveTransferOrSync()) {
      showToast('Mohon tunggu hingga proses upload, unduhan, atau sinkronisasi selesai.', 'warning');
      return false;
    }

    await clearAllData();
    if (typeof this.engine.stop === 'function') {
      this.engine.stop();
    } else {
      this.engine.pause();
      this.engine.playlist = [];
      this.engine.currentTrack = null;
      this.engine.currentIndex = -1;
    }
    this.resetPlayerBar();
    if (this.activeTab === 'playlist') {
      this.activePlaylistId = null;
      this.setActiveTab('all');
    }
    await this.reloadTracks();
    await this.loadPlaylists();
    await this.updateStorageInfo();
    this.updateOfflineBadge();
    this.renderMainContent();
    showToast('Perpustakaan lagu telah dikosongkan. Folder tetap terhubung.', 'info');
    return true;
  }

  async handleRemoveTrackCache(trackId) {
    if (this.hasActiveTransferOrSync()) {
      showToast('Mohon tunggu hingga proses upload, unduhan, atau sinkronisasi selesai.', 'warning');
      return;
    }
    const track = this.allTracks.find((t) => t.id === trackId);
    if (!track) return;

    try {
      await removeAudioBlob(trackId);
      track.isCached = false;
      track.cachedAt = null;
      await saveTrack(track);

      await this.reloadTracks();
      await this.updateStorageInfo();
      this.updateOfflineBadge();
      this.renderMainContent();
      showToast(`Audio "${track.title || track.name}" dihapus dari cache offline.`, 'info');
    } catch (err) {
      console.error('Remove audio cache error:', err);
      showToast(`Gagal menghapus cache audio: ${err.message}`, 'error');
    }
  }

  promptDeleteTrack(trackId) {
    const track = this.allTracks.find((t) => t.id === trackId);
    if (!track) return;

    const modal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-modal-title');
    const descEl = document.getElementById('confirm-modal-desc');
    const btnAction = document.getElementById('btn-confirm-action');

    if (!modal) return;

    if (titleEl) titleEl.textContent = 'Hapus Lagu dari Library';
    if (descEl) {
      descEl.textContent = `Apakah Anda yakin ingin menghapus "${track.title || track.name}" dari library DITUNE? Lagu tidak akan dihapus dari Google Drive Anda, namun akan disembunyikan dari sinkronisasi.`;
    }
    if (btnAction) {
      btnAction.textContent = 'Hapus';
      btnAction.className = 'px-3.5 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-semibold border border-rose-500/30 transition cursor-pointer';
    }

    this.confirmActionCallback = async () => {
      await this.executeDeleteTrack(track);
    };

    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  closeConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
    this.confirmActionCallback = null;
  }

  async executeDeleteTrack(track) {
    if (this.hasActiveTransferOrSync()) {
      showToast('Mohon tunggu hingga proses upload, unduhan, atau sinkronisasi selesai.', 'warning');
      return;
    }

    try {
      const isCurrent = this.engine.currentTrack?.id === track.id;

      if (isCurrent) {
        if (this.engine.playlist.length > 1) {
          this.engine.playNext();
        } else {
          if (typeof this.engine.stop === 'function') {
            this.engine.stop();
          } else {
            this.engine.pause();
            this.engine.playlist = [];
            this.engine.currentTrack = null;
            this.engine.currentIndex = -1;
          }
          this.resetPlayerBar();
        }
      }

      this.engine.playlist = this.engine.playlist.filter((t) => t.id !== track.id);
      if (this.engine.currentTrack) {
        this.engine.currentIndex = this.engine.playlist.findIndex((t) => t.id === this.engine.currentTrack.id);
      }

      await ignoreTrack(track);
      await this.reloadTracks();
      await this.updateStorageInfo();
      this.updateOfflineBadge();
      this.renderMainContent();

      showToast(`"${track.title || track.name}" telah dihapus dari library.`, 'info');
    } catch (err) {
      console.error('Delete track error:', err);
      showToast(`Gagal menghapus lagu: ${err.message}`, 'error');
    }
  }

  resetPlayerBar() {
    const titleEl = document.getElementById('player-title');
    const artistEl = document.getElementById('player-artist');
    const coverImg = document.getElementById('player-cover-img');
    const coverFallback = document.getElementById('player-cover-fallback');
    const btnQuickCache = document.getElementById('btn-quick-cache');
    const timeCurEl = document.getElementById('time-current');
    const timeTotEl = document.getElementById('time-total');
    const barFill = document.getElementById('progress-bar-fill');
    const thumb = document.getElementById('progress-thumb');

    if (titleEl) titleEl.textContent = 'Belum ada lagu';
    if (artistEl) artistEl.textContent = 'Pilih lagu untuk memutar';
    if (coverImg) {
      coverImg.src = '';
      coverImg.classList.add('hidden');
    }
    if (coverFallback) coverFallback.classList.remove('hidden');
    if (btnQuickCache) btnQuickCache.classList.add('hidden');
    if (timeCurEl) timeCurEl.textContent = '0:00';
    if (timeTotEl) timeTotEl.textContent = '0:00';
    if (barFill) barFill.style.width = '0%';
    if (thumb) thumb.style.left = '0%';
  }

  async openIgnoredTracksModal() {
    this.hasRestoredIgnoredTracks = false;
    const modal = document.getElementById('ignored-tracks-modal');
    if (!modal) return;
    await this.renderIgnoredTracksModalList();
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    refreshLucideIcons();
  }

  async closeIgnoredTracksModal() {
    const modal = document.getElementById('ignored-tracks-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
    const ignored = await getIgnoredTracks();
    const countEl = document.getElementById('modal-ignored-count');
    if (countEl) countEl.textContent = `${ignored.length} lagu`;

    if (this.hasRestoredIgnoredTracks) {
      this.hasRestoredIgnoredTracks = false;
      if (navigator.onLine) {
        await this.syncConnectedFolder();
      } else {
        showToast('Lagu telah dipulihkan. Hubungkan ke internet untuk menyinkronkan kembali.', 'info');
      }
    }
  }

  async renderIgnoredTracksModalList() {
    const listEl = document.getElementById('ignored-tracks-list');
    if (!listEl) return;

    const ignoredList = await getIgnoredTracks();
    if (ignoredList.length === 0) {
      listEl.innerHTML = `
        <div class="flex flex-col items-center justify-center py-12 text-center text-zinc-500">
          <i data-lucide="eye-off" class="w-8 h-8 mb-2 opacity-40"></i>
          <p class="text-xs">Belum ada lagu yang disembunyikan.</p>
        </div>
      `;
      refreshLucideIcons();
      return;
    }

    listEl.innerHTML = ignoredList
      .map(
        (t) => `
      <div class="flex items-center justify-between gap-3 py-2.5 px-2 hover:bg-zinc-800/40 rounded-lg transition">
        <div class="min-w-0 flex-1">
          <p class="text-xs font-semibold text-white truncate">${escapeHtml(t.title || t.name)}</p>
          <p class="text-[11px] text-zinc-400 truncate">${escapeHtml(t.artist || 'Unknown Artist')}</p>
        </div>
        <button class="btn-unignore-track flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700/60 text-xs font-medium transition cursor-pointer" data-id="${escapeHtml(t.id)}" title="Pulihkan lagu ke sinkronisasi">
          <i data-lucide="rotate-ccw" class="w-3 h-3"></i>
          <span>Pulihkan</span>
        </button>
      </div>
    `
      )
      .join('');

    refreshLucideIcons();
  }

  /**
   * Helper SSOT: Merge remote audio files with local IndexedDB records
   * Preserves cached blobs, durations, ID3 metadata, and cover art.
   */
  async mergeAndSaveDriveFiles(remoteFiles, folderInfo = null) {
    if (folderInfo && folderInfo.id) {
      await setSetting('connected_folder', {
        id: folderInfo.id,
        name: folderInfo.name || DITUNE_FOLDER_NAME,
        scope: 'drive.file',
        connectedAt: Date.now(),
      });
    }

    // Filter out files in ignored_tracks
    const ignoredList = await getIgnoredTracks();
    const ignoredSet = new Set(ignoredList.map((t) => t.id));
    const validRemoteFiles = remoteFiles.filter((file) => !ignoredSet.has(file.id));

    const existingTracks = await getAllTracks();
    const existingMap = new Map(existingTracks.map((t) => [t.id, t]));
    const blobIds = await getAllAudioBlobIds();

    let existingCount = 0;
    let newCount = 0;
    const tracksToSave = [];

    for (const file of validRemoteFiles) {
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

  /**
   * Shared SSOT helper: Parse ID3 metadata & cover, then persist audio Blob and track record to IndexedDB
   */
  async persistTrackBlobWithMetadata(trackBase, blob, mimeType) {
    const fallbackTitle = (trackBase.name || 'Unknown Track')
      .replace(/\.[a-zA-Z0-9]+$/, '')
      .replace(/_/g, ' ')
      .trim();

    const track = {
      id: trackBase.id,
      name: trackBase.name,
      title: (trackBase.title || fallbackTitle).replace(/_/g, ' ').trim(),
      artist: trackBase.artist || 'Unknown Artist',
      album: trackBase.album || 'Unknown Album',
      duration: trackBase.duration || 0,
      size: blob?.size || trackBase.size || 0,
      mimeType: mimeType || trackBase.mimeType || inferAudioMimeType(trackBase.name),
      hasCover: Boolean(trackBase.hasCover),
    };

    if (blob) {
      try {
        const meta = await parseAudioMetadata(blob, track.name);
        track.title = (meta.title || fallbackTitle).replace(/_/g, ' ').trim();
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

      await saveAudioBlob(track.id, blob, track.mimeType);
      track.isCached = true;
      track.cachedAt = Date.now();
      await saveTrack(track);
    }

    return track;
  }

  async handleFilesUpload(fileList) {
    if (!hasCredentials()) {
      showToast('Kredensial Google belum terkonfigurasi pada sistem aplikasi.', 'warning');
      this.openSettingsModal();
      return;
    }

    if (!navigator.onLine) {
      showToast('Koneksi internet dibutuhkan untuk mengunggah lagu ke Google Drive.', 'warning');
      return;
    }

    if (this.isBatchUploading) {
      showToast('Proses upload batch sedang berlangsung. Mohon tunggu hingga selesai.', 'info');
      return;
    }

    if (this.isSyncing || this.isBatchDownloading || this.isPicking || this.downloadingTrackIds.size > 0) {
      showToast('Mohon tunggu hingga proses saat ini selesai sebelum mengunggah lagu.', 'warning');
      return;
    }

    const audioFiles = Array.from(fileList || []).filter((file) =>
      isAudioMediaItem({ name: file.name, mimeType: file.type })
    );

    if (audioFiles.length === 0) {
      showToast('Tidak ada file audio yang didukung (.mp3, .m4a, .flac, .wav, .ogg, .opus, .aac, .mp4, .webm).', 'warning');
      return;
    }

    this.isBatchUploading = true;
    const uploadBtn = document.getElementById('btn-upload-tracks');
    if (uploadBtn) uploadBtn.disabled = true;

    try {
      showToast(`Menyiapkan upload ${audioFiles.length} lagu ke Google Drive...`, 'info');
      const folder = await findOrCreateDituneFolder();

      await setSetting('connected_folder', {
        id: folder.id,
        name: folder.name,
        scope: 'drive.file',
        connectedAt: Date.now(),
      });
      this.connectedFolder = folder;

      const [remoteFiles, localTracks] = await Promise.all([
        listAuthorizedAudioFiles(),
        getAllTracks(),
      ]);

      const existingFolderFiles = new Map();
      const remoteById = new Map();
      for (const rf of remoteFiles) {
        remoteById.set(rf.id, rf);
        if (Array.isArray(rf.parents) && rf.parents.includes(folder.id)) {
          existingFolderFiles.set(buildUploadDuplicateKey(rf.name, rf.size), rf);
        }
      }

      const localLibraryByKey = new Map();
      const existingTrackById = new Map();
      for (const lt of localTracks) {
        existingTrackById.set(lt.id, lt);
        const remoteMatch = remoteById.get(lt.id);
        const effectiveName = lt.name || remoteMatch?.name || lt.title;
        const effectiveSize = lt.size || remoteMatch?.size || 0;
        if (effectiveName) {
          localLibraryByKey.set(buildUploadDuplicateKey(effectiveName, effectiveSize), lt);
        }
      }

      const seenInBatch = new Set();
      const toUpload = [];
      const duplicates = [];

      for (const file of audioFiles) {
        const key = buildUploadDuplicateKey(file.name, file.size);
        const existingInFolder = existingFolderFiles.get(key);
        const existingInLibrary = !existingInFolder ? localLibraryByKey.get(key) : null;
        const existingMatch = existingInFolder || existingInLibrary || null;

        if (existingMatch || seenInBatch.has(key)) {
          duplicates.push({
            file,
            existingMatch,
            source: existingInFolder ? 'folder' : (existingInLibrary ? 'library' : 'batch'),
          });
        } else {
          seenInBatch.add(key);
          toUpload.push(file);
        }
      }

      // Ensure skipped duplicates are un-ignored (if needed) and cached locally once per ID
      let cachedDuplicateCount = 0;
      if (duplicates.length > 0) {
        const blobIds = await getAllAudioBlobIds();
        const ignoredSet = new Set((await getIgnoredTracks()).map((t) => t.id));
        const processedDuplicateIds = new Set();

        for (const { file, existingMatch } of duplicates) {
          if (!existingMatch || processedDuplicateIds.has(existingMatch.id)) continue;
          processedDuplicateIds.add(existingMatch.id);

          if (ignoredSet.has(existingMatch.id)) {
            await unignoreTrack(existingMatch.id);
          }

          const hasLocalTrack = existingTrackById.has(existingMatch.id);
          const hasLocalBlob = blobIds.has(existingMatch.id);
          if (!hasLocalTrack || !hasLocalBlob) {
            await this.persistTrackBlobWithMetadata(existingMatch, file, inferAudioMimeType(file.name, file.type));
            blobIds.add(existingMatch.id);
            existingTrackById.set(existingMatch.id, existingMatch);
            cachedDuplicateCount++;
          }
        }

        await this.reloadTracks();
        this.renderMainContent();
        await this.updateStorageInfo();
      }

      if (toUpload.length === 0) {
        const suffix = cachedDuplicateCount > 0 ? ` (${cachedDuplicateCount} disimpan ke cache lokal)` : '';
        const allFromFolder = duplicates.every((d) => d.source === 'folder');
        const locationLabel = allFromFolder
          ? `"${folder.name}"`
          : `pustaka atau "${folder.name}"`;
        showToast(`Semua ${duplicates.length} lagu sudah ada di ${locationLabel} sehingga dilewati.${suffix}`, 'info');
        return;
      }

      const fileProgress = new Array(toUpload.length).fill(0);
      const activeFiles = new Map();
      let nextIndex = 0;
      let uploadedCount = 0;
      let failedCount = 0;
      let lastErrorMsg = '';
      let refreshChain = Promise.resolve();

      const enqueuePostUploadRefresh = () => {
        refreshChain = refreshChain
          .then(async () => {
            await this.reloadTracks();
            this.renderMainContent();
          })
          .catch((err) => {
            console.warn('Post-upload UI refresh error:', err);
          });
        return refreshChain;
      };

      const updateBatchProgress = () => {
        const doneCount = uploadedCount + failedCount;
        const activeEntries = Array.from(activeFiles.entries()).sort((a, b) => a[0] - b[0]);

        let displayIndex = Math.min(toUpload.length, doneCount + 1);
        let label = 'Menyimpan ke library...';
        let percent = 0;

        if (activeEntries.length > 0) {
          const [activeIdx, activeName] = activeEntries[0];
          displayIndex = activeIdx + 1;
          label = activeName;
          percent = fileProgress[activeIdx] || 0;
        } else if (doneCount === toUpload.length) {
          displayIndex = toUpload.length;
          label = 'Menyelesaikan upload...';
          percent = 100;
        }

        showProgressToast('batch-upload', `(${displayIndex}/${toUpload.length}) ${label}`, percent, false);
      };

      updateBatchProgress();

      const workerCount = 1;
      const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < toUpload.length) {
          const currentIndex = nextIndex++;
          const file = toUpload[currentIndex];
          activeFiles.set(currentIndex, file.name);
          updateBatchProgress();

          try {
            const driveFile = await uploadAudioToDrive(file, folder.id, (pct) => {
              fileProgress[currentIndex] = pct;
              updateBatchProgress();
            });

            await this.persistTrackBlobWithMetadata(driveFile, file, driveFile.mimeType);
            uploadedCount++;
            fileProgress[currentIndex] = 100;
            activeFiles.delete(currentIndex);
            updateBatchProgress();

            enqueuePostUploadRefresh();
          } catch (err) {
            failedCount++;
            lastErrorMsg = err.message;
            fileProgress[currentIndex] = 100;
            activeFiles.delete(currentIndex);
            updateBatchProgress();
            console.warn(`Gagal mengunggah "${file.name}":`, err);
          }
        }
      });

      await Promise.all(workers);
      await refreshChain;
      if (uploadedCount > 0) {
        await this.updateStorageInfo();
      }

      const summaryParts = [`${uploadedCount} lagu diunggah ke "${folder.name}"`];
      if (duplicates.length > 0) summaryParts.push(`${duplicates.length} duplikat dilewati`);
      if (failedCount > 0) {
        summaryParts.push(lastErrorMsg ? `${failedCount} gagal (${lastErrorMsg})` : `${failedCount} gagal`);
      }
      showToast(`Selesai! ${summaryParts.join(', ')}.`, failedCount > 0 && uploadedCount === 0 ? 'error' : 'success');
    } catch (err) {
      console.error('Batch upload error:', err);
      showToast(`Gagal mengunggah lagu: ${err.message}`, 'error');
    } finally {
      this.isBatchUploading = false;
      removeProgressToast('batch-upload');
      const currentUploadBtn = document.getElementById('btn-upload-tracks');
      if (currentUploadBtn) currentUploadBtn.disabled = false;
    }
  }

  async triggerDrivePicker() {
    if (!hasCredentials()) {
      showToast('Kredensial Google belum terkonfigurasi pada sistem aplikasi.', 'warning');
      this.openSettingsModal();
      return;
    }

    if (!navigator.onLine) {
      showToast('Koneksi internet dibutuhkan untuk mengimpor lagu dari Google Drive.', 'warning');
      return;
    }

    if (this.isPicking) {
      showToast('Google Picker sedang dibuka...', 'info');
      return;
    }

    if (this.isBatchUploading || this.isSyncing || this.isBatchDownloading || this.downloadingTrackIds.size > 0) {
      showToast('Mohon tunggu hingga proses upload, unduhan, atau sinkronisasi selesai.', 'warning');
      return;
    }

    this.isPicking = true;
    const importBtn = document.getElementById('btn-import-drive') || document.getElementById('btn-empty-picker');
    if (importBtn) importBtn.disabled = true;

    try {
      showToast('Membuka Google Picker...', 'info');
      const pickerResult = await openGooglePicker();

      if (!pickerResult) {
        return;
      }

      const pickedFiles = Array.isArray(pickerResult) ? pickerResult : (pickerResult.files || []);
      const pickedFolder = pickerResult.folder || null;

      if (pickedFiles.length === 0) {
        showToast('Tidak ada file audio yang dipilih.', 'info');
        return;
      }

      showToast(`Mengimpor ${pickedFiles.length} file ke library DITUNE...`, 'info');
      const { newCount, existingCount } = await this.mergeAndSaveDriveFiles(pickedFiles, pickedFolder);

      if (newCount === 0 && existingCount === 0) {
        showToast('File yang dipilih berada di Daftar Abaikan. Pulihkan melalui Pengaturan jika ingin menampilkannya.', 'info');
      } else if (existingCount > 0 && newCount > 0) {
        showToast(`${newCount} lagu baru diimpor, ${existingCount} lagu diperbarui & cache offline tetap utuh!`, 'success');
      } else if (existingCount > 0) {
        showToast(`${existingCount} lagu diverifikasi, seluruh cache & metadata offline tetap utuh!`, 'success');
      } else {
        showToast(`${newCount} lagu berhasil diimpor dari Google Drive!`, 'success');
      }
    } catch (err) {
      console.error('Picker error:', err);
      if (err.message === 'CONFIG_NEEDED') {
        showToast('Kredensial Google belum lengkap. Silakan atur di Pengaturan.', 'warning');
        this.openSettingsModal();
      } else {
        showToast(`Gagal mengimpor file: ${err.message}`, 'error');
      }
    } finally {
      this.isPicking = false;
      const currentImportBtn = document.getElementById('btn-import-drive') || document.getElementById('btn-empty-picker');
      if (currentImportBtn) currentImportBtn.disabled = false;
    }
  }

  async syncConnectedFolder() {
    if (!hasCredentials()) {
      showToast('Kredensial Google belum terkonfigurasi pada sistem aplikasi.', 'warning');
      this.openSettingsModal();
      return;
    }

    if (!navigator.onLine) {
      showToast('Koneksi internet dibutuhkan untuk menyinkronkan lagu dari Google Drive.', 'warning');
      return;
    }

    if (this.isBatchUploading) {
      showToast('Proses upload batch sedang berlangsung. Mohon tunggu hingga selesai.', 'info');
      return;
    }

    if (this.isBatchDownloading || this.downloadingTrackIds.size > 0) {
      showToast('Proses unduhan offline sedang berlangsung. Mohon tunggu hingga selesai.', 'info');
      return;
    }

    if (this.isPicking) {
      showToast('Google Picker sedang dibuka. Mohon selesaikan impor terlebih dahulu.', 'warning');
      return;
    }

    if (this.isSyncing) {
      showToast('Sinkronisasi sedang berlangsung...', 'info');
      return;
    }

    this.isSyncing = true;
    const syncBtn = document.getElementById('btn-sync-folder');
    const syncIcon = syncBtn?.querySelector('[data-lucide="refresh-cw"]');

    try {
      if (syncIcon) syncIcon.classList.add('animate-spin');
      if (syncBtn) syncBtn.disabled = true;

      showToast('Menyinkronkan lagu dari Google Drive...', 'info');

      await getAccessToken(true);

      const [remoteFiles, dituneFolder] = await Promise.all([
        listAuthorizedAudioFiles(),
        findDituneFolder(),
      ]);

      const targetFolder = dituneFolder && dituneFolder.id
        ? {
            id: dituneFolder.id,
            name: dituneFolder.name || DITUNE_FOLDER_NAME,
            scope: 'drive.file',
            connectedAt: Date.now(),
          }
        : null;

      await setSetting('connected_folder', targetFolder);
      this.connectedFolder = targetFolder;

      if (!remoteFiles || remoteFiles.length === 0) {
        this.renderMainContent();
        showToast(
          targetFolder
            ? `Folder "${targetFolder.name}" terhubung, belum ada lagu di dalamnya.`
            : 'Belum ada lagu yang diunggah atau diimpor di Google Drive.',
          'info'
        );
        return;
      }

      const { newCount, existingCount } = await this.mergeAndSaveDriveFiles(remoteFiles, targetFolder);

      if (newCount > 0) {
        showToast(`Sinkronisasi selesai! ${newCount} lagu baru ditambahkan (${existingCount} lagu sinkron).`, 'success');
      } else {
        showToast(`Pustaka musik sudah mutakhir (${existingCount} lagu sinkron).`, 'info');
      }
    } catch (err) {
      console.error('Sync library error:', err);
      showToast(`Gagal menyinkronkan lagu: ${err.message}`, 'error');
    } finally {
      this.isSyncing = false;
      const currentSyncBtn = document.getElementById('btn-sync-folder');
      const currentSyncIcon = currentSyncBtn?.querySelector('[data-lucide="refresh-cw"]');
      if (currentSyncIcon) currentSyncIcon.classList.remove('animate-spin');
      if (currentSyncBtn) currentSyncBtn.disabled = false;
    }
  }

  updateTrackDownloadUI(trackId, percent) {
    const escapedId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(trackId) : trackId;
    const row = document.querySelector(`.track-row[data-id="${escapedId}"]`);
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
        <span class="text-xs text-zinc-400 font-mono w-10 text-right flex-shrink-0">${durationText}</span>
        <button class="btn-track-menu p-1 text-zinc-500 hover:text-white rounded-md hover:bg-zinc-800 transition opacity-80 sm:opacity-0 group-hover:opacity-100 cursor-pointer flex-shrink-0" data-id="${escapeHtml(trackId)}" title="Opsi Lagu">
          <i data-lucide="more-vertical" class="w-4 h-4 pointer-events-none"></i>
        </button>
      `;
      refreshLucideIcons();
    }
  }

  async downloadSingleTrack(trackId) {
    const track = this.allTracks.find((t) => t.id === trackId);
    if (!track) return;

    if (track.isCached) {
      showToast(`"${track.title}" sudah tersimpan di cache offline.`, 'info');
      return;
    }

    if (!navigator.onLine) {
      showToast('Koneksi internet dibutuhkan untuk mengunduh lagu.', 'warning');
      return;
    }

    if (this.isBatchDownloading || this.isBatchUploading || this.isSyncing || this.isPicking) {
      showToast('Mohon tunggu hingga proses saat ini selesai sebelum mengunduh lagu.', 'warning');
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

      if (result.blob) {
        const saved = await this.persistTrackBlobWithMetadata(track, result.blob, result.mimeType);
        await this.reloadTracks();
        await this.updateStorageInfo();
        this.renderMainContent();
        showToast(`"${saved.title}" berhasil di-cache untuk offline!`, 'success');
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

    if (this.isBatchUploading || this.isSyncing || this.isPicking || this.downloadingTrackIds.size > 0) {
      showToast('Mohon tunggu hingga proses saat ini selesai.', 'warning');
      return;
    }

    const uncached = this.allTracks.filter((t) => !t.isCached);
    if (uncached.length === 0) {
      showToast('Semua lagu dalam library sudah di-cache offline!', 'info');
      return;
    }

    if (!navigator.onLine) {
      showToast('Koneksi internet dibutuhkan untuk mengunduh lagu.', 'warning');
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
        showProgressToast('batch-download', `(${completed + 1}/${uncached.length}) ${track.title}`, 0, false);

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
              showProgressToast('batch-download', `(${completed + 1}/${uncached.length}) ${track.title}`, percent, false);
            },
            track.size
          );

          if (result.blob) {
            await this.persistTrackBlobWithMetadata(track, result.blob, result.mimeType);
            completed++;
            await this.reloadTracks();
            this.renderMainContent();
            await this.updateStorageInfo();
          }
        } catch (err) {
          console.warn(`Gagal mengunduh track ${track.name}:`, err);
        }
      }

      await this.reloadTracks();
      this.renderMainContent();
      await this.updateStorageInfo();
      const summaryType = completed === 0 ? 'error' : (completed < uncached.length ? 'warning' : 'success');
      showToast(`Selesai! ${completed} dari ${uncached.length} lagu berhasil disimpan offline.`, summaryType);
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
