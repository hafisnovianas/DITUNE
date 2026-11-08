/**
 * DITUNE UI Components
 * Renders Spotify-like interface, track lists, album cards, player controls, and modals.
 */

import { formatDuration } from '../parser/metadata.js';

/**
 * Format bytes to human readable format (MB, KB)
 */
export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/**
 * Generate Main App Shell HTML
 */
export function renderAppShell() {
  return `
    <div class="flex flex-col h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100 font-sans select-none">
      
      <!-- Top Workspace (Sidebar + Main Content) -->
      <div class="flex-1 flex min-h-0 overflow-hidden">
        
        <!-- Desktop Sidebar -->
        <aside class="hidden md:flex flex-col w-64 bg-zinc-900/80 backdrop-blur border-r border-zinc-800/80 p-4 gap-4 flex-shrink-0">
          <!-- Logo -->
          <div class="px-2 py-2">
            <h1 class="text-2xl font-black tracking-tight text-white">DITUNE</h1>
            <p class="text-xs text-zinc-400 font-medium mt-0.5">Google Drive Player</p>
          </div>

        <!-- Drive Action Buttons -->
        <div id="sidebar-picker-container" class="pt-2">
          <button id="btn-open-picker" class="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold transition-all shadow-lg shadow-emerald-500/20 active:scale-[0.98]">
            <i data-lucide="folder-plus" class="w-5 h-5"></i>
            <span>Pilih Folder Drive</span>
          </button>
        </div>

        <!-- Navigation Tabs -->
        <nav class="flex flex-col gap-1 mt-4">
          <p class="px-3 text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-1">Perpustakaan</p>
          
          <button data-tab="all" class="nav-tab active flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition text-emerald-400 bg-zinc-800/60">
            <i data-lucide="music" class="w-4 h-4"></i>
            <span>Semua Lagu</span>
          </button>

          <button data-tab="artists" class="nav-tab flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition text-zinc-400 hover:text-white hover:bg-zinc-800/40">
            <i data-lucide="users" class="w-4 h-4"></i>
            <span>Artis</span>
          </button>

          <button data-tab="albums" class="nav-tab flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition text-zinc-400 hover:text-white hover:bg-zinc-800/40">
            <i data-lucide="disc-3" class="w-4 h-4"></i>
            <span>Album</span>
          </button>

          <button data-tab="offline" class="nav-tab flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition text-zinc-400 hover:text-white hover:bg-zinc-800/40">
            <i data-lucide="hard-drive" class="w-4 h-4"></i>
            <span>Tersimpan Offline</span>
            <span id="badge-offline-count" class="ml-auto text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 font-mono">0</span>
          </button>
        </nav>

        <!-- Footer Settings -->
        <button id="btn-open-settings" class="mt-auto flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-semibold text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition">
          <i data-lucide="settings" class="w-4 h-4"></i>
          <span>Pengaturan & Kredensial</span>
        </button>
      </aside>

      <!-- Main Area -->
      <main class="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        
        <!-- Top Navigation Bar -->
        <header class="h-16 border-b border-zinc-800/80 bg-zinc-900/40 backdrop-blur px-4 md:px-6 flex items-center justify-between gap-4 flex-shrink-0">
          
          <!-- Mobile Title / Branding -->
          <div class="flex items-center md:hidden">
            <span class="font-black text-white text-base tracking-tight">DITUNE</span>
          </div>

          <!-- Search Bar -->
          <div class="relative flex-1 max-w-md">
            <i data-lucide="search" class="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400"></i>
            <input 
              id="search-input" 
              type="text" 
              placeholder="Cari judul lagu, artis, atau album..." 
              class="w-full bg-zinc-900 border border-zinc-800 rounded-full pl-10 pr-4 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
            />
            <button id="search-clear" class="hidden absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
              <i data-lucide="x" class="w-4 h-4"></i>
            </button>
          </div>

          <!-- Header Actions -->
          <div class="flex items-center gap-2">
            <!-- Mobile Drive Picker Button -->
            <button id="btn-open-picker-mobile" class="md:hidden flex items-center justify-center p-2 rounded-lg bg-emerald-500 text-zinc-950 font-bold">
              <i data-lucide="folder-plus" class="w-4 h-4"></i>
            </button>

            <!-- Network Status Indicator -->
            <div id="network-badge" class="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <i data-lucide="wifi" class="w-3.5 h-3.5"></i>
              <span class="hidden sm:inline">Online</span>
            </div>

            <!-- Install PWA App Button (Muncul jika browser mendukung instalasi PWA) -->
            <button id="btn-install-pwa" class="hidden items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-semibold transition cursor-pointer" title="Instal DITUNE ke Perangkat">
              <i data-lucide="download" class="w-3.5 h-3.5"></i>
              <span class="hidden sm:inline">Instal App</span>
            </button>

            <!-- Settings Button (Khusus Mobile, di desktop sudah ada di sidebar) -->
            <button id="btn-open-settings-mobile" class="md:hidden p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition" title="Pengaturan & Kredensial">
              <i data-lucide="settings" class="w-4 h-4"></i>
            </button>
          </div>
        </header>

        <!-- Mobile Filter Tabs -->
        <div class="md:hidden flex items-center gap-1 px-4 py-2 bg-zinc-900/60 border-b border-zinc-800/60 overflow-x-auto no-scrollbar">
          <button data-tab="all" class="nav-tab active px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap bg-emerald-500 text-zinc-950">Semua Lagu</button>
          <button data-tab="artists" class="nav-tab px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap bg-zinc-800 text-zinc-300">Artis</button>
          <button data-tab="albums" class="nav-tab px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap bg-zinc-800 text-zinc-300">Album</button>
          <button data-tab="offline" class="nav-tab px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap bg-zinc-800 text-zinc-300">Offline</button>
        </div>

        <!-- Main Content Area (Scrollable) -->
        <div id="content-container" class="flex-1 overflow-y-auto p-4 md:p-6 pb-6">
          <!-- Dynamically rendered track list / album view -->
        </div>
      </main>
    </div>

    <!-- Persistent Bottom Player Bar (In-Flow Flex Row) -->
    <div id="player-bar" class="h-24 bg-zinc-900/95 backdrop-blur-md border-t border-zinc-800 px-4 md:px-6 flex items-center justify-between flex-shrink-0 z-40 transition-all">
      
      <!-- Track Info (Left) -->
      <div class="flex items-center gap-3 w-1/4 min-w-[160px] md:min-w-[240px]">
        <div id="player-cover-container" class="w-14 h-14 rounded-lg bg-zinc-800 border border-zinc-700/60 overflow-hidden flex-shrink-0 flex items-center justify-center text-zinc-600 shadow-md relative">
          <img id="player-cover-img" src="" alt="" class="hidden w-full h-full object-cover" />
          <i id="player-cover-fallback" data-lucide="music" class="w-6 h-6"></i>
        </div>
        <div class="min-w-0">
          <h4 id="player-title" class="text-sm font-semibold text-white truncate hover:underline cursor-pointer">Belum ada lagu</h4>
          <p id="player-artist" class="text-xs text-zinc-400 truncate">Pilih lagu untuk memutar</p>
          <div id="player-status-badge" class="hidden items-center gap-1 text-[10px] text-emerald-400 font-medium mt-0.5">
            <i data-lucide="check-circle-2" class="w-3 h-3"></i>
            <span>Offline Ready</span>
          </div>
        </div>
      </div>

      <!-- Controls & Progress (Center) -->
      <div class="flex flex-col items-center gap-1 flex-1 max-w-xl px-2">
        <!-- Buttons -->
        <div class="flex items-center gap-4">
          <button id="btn-shuffle" class="text-zinc-400 hover:text-white transition p-1.5 rounded-full hover:bg-zinc-800" title="Acak Lagu">
            <i data-lucide="shuffle" class="w-4 h-4"></i>
          </button>
          
          <button id="btn-prev" class="text-zinc-300 hover:text-white transition p-1.5 rounded-full hover:bg-zinc-800" title="Sebelumnya">
            <i data-lucide="skip-back" class="w-5 h-5 fill-current"></i>
          </button>

          <button id="btn-play-pause" class="w-10 h-10 rounded-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 flex items-center justify-center transition shadow-lg shadow-emerald-500/30 active:scale-95" title="Putar/Jeda">
            <i id="icon-play-state" data-lucide="play" class="w-5 h-5 fill-current ml-0.5"></i>
          </button>

          <button id="btn-next" class="text-zinc-300 hover:text-white transition p-1.5 rounded-full hover:bg-zinc-800" title="Berikutnya">
            <i data-lucide="skip-forward" class="w-5 h-5 fill-current"></i>
          </button>

          <button id="btn-repeat" class="text-zinc-400 hover:text-white transition p-1.5 rounded-full hover:bg-zinc-800 relative" title="Ulangi">
            <i id="icon-repeat" data-lucide="repeat" class="w-4 h-4"></i>
            <span id="badge-repeat-one" class="hidden absolute -top-1 -right-1 text-[9px] bg-emerald-500 text-zinc-950 font-bold rounded-full w-3.5 h-3.5 items-center justify-center leading-none">1</span>
          </button>
        </div>

        <!-- Progress Bar & Timers -->
        <div class="w-full flex items-center gap-2">
          <span id="time-current" class="text-[11px] font-mono text-zinc-400 w-9 text-right">0:00</span>
          
          <div id="progress-container" class="relative flex-1 h-3 flex items-center cursor-pointer group">
            <div class="w-full bg-zinc-800 rounded-full h-1 group-hover:h-1.5 transition-all overflow-hidden">
              <div id="progress-bar-fill" class="bg-emerald-500 h-full w-0 rounded-full relative"></div>
            </div>
            <div id="progress-thumb" class="hidden group-hover:block absolute w-3 h-3 bg-white rounded-full shadow-md -translate-x-1/2 pointer-events-none"></div>
          </div>

          <span id="time-total" class="text-[11px] font-mono text-zinc-400 w-9 text-left">0:00</span>
        </div>
      </div>

      <!-- Volume & Quick Cache (Right) -->
      <div class="hidden sm:flex items-center justify-end gap-3 w-1/4">
        <!-- Quick Cache Button -->
        <button id="btn-quick-cache" class="hidden text-zinc-400 hover:text-emerald-400 transition p-2 rounded-lg hover:bg-zinc-800" title="Simpan ke IndexedDB">
          <i id="icon-quick-cache" data-lucide="download" class="w-4 h-4"></i>
        </button>

        <!-- Volume Slider -->
        <div class="flex items-center gap-2">
          <button id="btn-volume-icon" class="text-zinc-400 hover:text-white p-1">
            <i id="icon-volume" data-lucide="volume-2" class="w-4 h-4"></i>
          </button>
          <input 
            id="volume-slider" 
            type="range" 
            min="0" 
            max="1" 
            step="0.01" 
            value="1" 
            class="w-20 md:w-24 h-1 bg-zinc-700 accent-emerald-500 rounded-lg cursor-pointer"
          />
        </div>
      </div>
    </div>
  </div>

    <!-- Settings Modal -->
    <div id="settings-modal" class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm hidden items-center justify-center p-4">
      <div class="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        <!-- Modal Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div class="flex items-center gap-2.5">
            <i data-lucide="settings" class="w-5 h-5 text-emerald-400"></i>
            <h3 class="text-lg font-bold text-white">Pengaturan DITUNE</h3>
          </div>
          <button id="btn-close-settings" class="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800">
            <i data-lucide="x" class="w-5 h-5"></i>
          </button>
        </div>

        <!-- Modal Body (Scrollable) -->
        <div class="p-6 overflow-y-auto space-y-6 text-sm text-zinc-300">
          
          <!-- Connection Status Card -->
          <div class="bg-zinc-950 p-4 rounded-xl border border-zinc-800 space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold text-zinc-400">Integrasi Google Drive</span>
              <div id="status-credential-badge">
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  Terhubung & Aktif
                </span>
              </div>
            </div>

            <!-- Connected Folder Info -->
            <div id="connected-folder-info" class="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800/80 flex items-center justify-between text-xs">
              <div class="flex items-center gap-2 min-w-0 pr-2">
                <i data-lucide="folder" class="w-4 h-4 text-emerald-400 flex-shrink-0"></i>
                <div class="min-w-0">
                  <p class="text-[10px] text-zinc-500 font-medium">Folder Terhubung</p>
                  <p id="connected-folder-name" class="font-semibold text-zinc-200 truncate">Belum ada folder terhubung</p>
                </div>
              </div>
              <span id="connected-folder-badge" class="px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-800 text-zinc-400 flex-shrink-0">
                Tersimpan
              </span>
            </div>

            <p class="text-xs text-zinc-400 leading-relaxed">
              DITUNE terintegrasi resmi dengan Google Identity Services & Google Picker menggunakan scope aman <code class="text-emerald-400 bg-emerald-950/40 px-1 py-0.5 rounded">drive.readonly</code>. Lagu diputar langsung dari folder Google Drive Anda secara privat tanpa perantara.
            </p>
            <div class="pt-1">
              <button id="btn-change-folder" class="w-full py-2.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-semibold transition flex items-center justify-center gap-2">
                <i data-lucide="folder-plus" class="w-4 h-4"></i>
                <span>Ganti Folder Musik Google Drive</span>
              </button>
            </div>
          </div>

          <!-- IndexedDB Cache Maintenance -->
          <div class="space-y-3">
            <label class="font-semibold text-white">Penyimpanan & Cache Musik Offline</label>
            <p class="text-xs text-zinc-400">Semua lagu yang diputar otomatis tersimpan di IndexedDB browser Anda sehingga bisa didengarkan tanpa kuota internet saat offline.</p>

            <div class="grid grid-cols-2 gap-3 bg-zinc-950 p-3.5 rounded-xl border border-zinc-800">
              <div>
                <p class="text-[11px] text-zinc-500 font-medium">Lagu Tersimpan</p>
                <p id="modal-cache-count" class="text-base font-bold text-white font-mono mt-0.5">0 lagu</p>
              </div>
              <div>
                <p class="text-[11px] text-zinc-500 font-medium">Ukuran Memori Cache</p>
                <p id="modal-cache-size" class="text-base font-bold text-emerald-400 font-mono mt-0.5">0 MB</p>
              </div>
            </div>

            <!-- Action Download All -->
            <button id="btn-download-all" class="w-full py-2.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-semibold transition flex items-center justify-center gap-2">
              <i data-lucide="download" class="w-4 h-4"></i>
              <span>Unduh Semua Lagu ke Cache Offline</span>
            </button>

            <div class="flex flex-col sm:flex-row gap-2 pt-1">
              <button id="btn-clear-cache" class="flex-1 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-amber-400 text-xs font-semibold border border-amber-500/30 transition flex items-center justify-center gap-2">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
                <span>Hapus Audio Cache</span>
              </button>

              <button id="btn-reset-library" class="flex-1 py-2.5 rounded-lg bg-red-950/40 hover:bg-red-900/50 text-red-400 text-xs font-semibold border border-red-500/30 transition flex items-center justify-center gap-2">
                <i data-lucide="alert-triangle" class="w-4 h-4"></i>
                <span>Kosongkan Seluruh Library</span>
              </button>
            </div>
          </div>

          <!-- About / App Info -->
          <div class="border-t border-zinc-800/80 pt-4 flex items-center justify-between text-xs text-zinc-500">
            <div class="flex items-center gap-2">
              <i data-lucide="radio" class="w-4 h-4 text-emerald-400"></i>
              <span>DITUNE v1.0.0 • Client-side Music Player</span>
            </div>
            <span>Dijumper Web</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Download / Loading Progress Toast -->
    <div id="toast-container" class="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none"></div>
  `;
}

/**
 * Render Track List
 */
export function renderTrackList(tracks = [], currentTrackId = null, isPlaying = false) {
  if (tracks.length === 0) {
    return `
      <div class="flex flex-col items-center justify-center py-20 text-center text-zinc-400">
        <div class="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4 text-zinc-600">
          <i data-lucide="music" class="w-8 h-8"></i>
        </div>
        <h3 class="text-lg font-bold text-zinc-200">Belum ada lagu di library</h3>
        <p class="text-sm max-w-md text-zinc-400 mt-1">
          Hubungkan folder musik dari Google Drive Anda untuk mulai mendengarkan.
        </p>
        <div class="flex items-center gap-3 mt-6">
          <button id="btn-empty-picker" class="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-sm transition">
            <i data-lucide="folder-plus" class="w-4 h-4"></i>
            <span>Pilih Folder Drive</span>
          </button>
        </div>
      </div>
    `;
  }

  const rows = tracks.map((track, idx) => {
    const isActive = track.id === currentTrackId;
    const activeClass = isActive ? 'bg-zinc-800/80 text-emerald-400' : 'hover:bg-zinc-900/60 text-zinc-300';
    const activeText = isActive ? 'text-emerald-400' : 'text-white';

    const cacheIcon = track.isCached
      ? `<span class="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20" title="Tersimpan di IndexedDB">
           <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i>
           <span class="hidden sm:inline">Offline</span>
         </span>`
      : `<button class="btn-cache-track text-zinc-400 hover:text-emerald-400 p-1.5 rounded-lg hover:bg-zinc-800 transition" data-id="${track.id}" title="Unduh ke Cache Offline">
           <i data-lucide="download" class="w-4 h-4"></i>
         </button>`;

    return `
      <div 
        class="track-row group flex items-center gap-3 px-3 py-2.5 rounded-xl transition cursor-pointer ${activeClass}" 
        data-id="${track.id}"
      >
        <!-- Index / Play indicator -->
        <div class="w-8 text-center flex-shrink-0">
          ${
            isActive && isPlaying
              ? `<div class="flex items-end justify-center gap-0.5 h-4">
                   <span class="w-1 bg-emerald-400 animate-pulse h-full"></span>
                   <span class="w-1 bg-emerald-400 animate-pulse h-2"></span>
                   <span class="w-1 bg-emerald-400 animate-pulse h-3"></span>
                 </div>`
              : `<span class="text-xs text-zinc-400 group-hover:hidden font-mono">${idx + 1}</span>
                 <i data-lucide="play" class="w-4 h-4 text-white hidden group-hover:inline-block ml-auto mr-auto fill-current"></i>`
          }
        </div>

        <!-- Title & Artist -->
        <div class="flex-1 min-w-0 pr-2">
          <p class="text-sm font-semibold truncate ${activeText}">${escapeHtml(track.title || track.name)}</p>
          <p class="text-xs text-zinc-400 truncate">${escapeHtml(track.artist || 'Unknown Artist')}</p>
        </div>

        <!-- Album -->
        <div class="hidden md:block w-1/4 min-w-0 pr-2">
          <p class="text-xs text-zinc-400 truncate">${escapeHtml(track.album || 'Unknown Album')}</p>
        </div>

        <!-- Cache Status & Duration -->
        <div class="track-cache-status flex items-center gap-3 flex-shrink-0">
          ${cacheIcon}
          <span class="text-xs text-zinc-400 font-mono w-10 text-right">${formatDuration(track.duration)}</span>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-2xl font-black text-white">Daftar Lagu</h2>
          <p class="text-xs text-zinc-400 mt-0.5">${tracks.length} lagu tersedia</p>
        </div>
        <div class="flex items-center gap-2">
          <button id="btn-sync-folder" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-300 hover:text-white transition cursor-pointer" title="Periksa dan sinkronkan lagu baru dari Google Drive">
            <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
            <span>Sinkronkan Lagu</span>
          </button>
        </div>
      </div>

      <!-- Table Header -->
      <div class="flex items-center gap-3 px-3 py-2 text-xs font-bold text-zinc-500 uppercase tracking-wider border-b border-zinc-800/80">
        <span class="w-8 text-center">#</span>
        <span class="flex-1">Judul</span>
        <span class="hidden md:block w-1/4">Album</span>
        <span class="w-24 text-right">Durasi</span>
      </div>

      <!-- Track Items -->
      <div class="space-y-1">
        ${rows}
      </div>
    </div>
  `;
}

/**
 * Render Artists Grouped View
 */
export function renderArtistsView(tracks = [], onArtistSelect = null) {
  const map = new Map();
  tracks.forEach((t) => {
    const artist = t.artist || 'Unknown Artist';
    if (!map.has(artist)) map.set(artist, []);
    map.get(artist).push(t);
  });

  const sortedArtists = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  if (sortedArtists.length === 0) {
    return `<div class="text-center py-20 text-zinc-400">Tidak ada artis ditemukan.</div>`;
  }

  const cards = sortedArtists.map(([artist, artistTracks]) => `
    <div class="artist-card bg-zinc-900/60 hover:bg-zinc-800/80 border border-zinc-800/80 rounded-2xl p-4 transition cursor-pointer group" data-artist="${escapeHtml(artist)}">
      <div class="w-full aspect-square rounded-full bg-zinc-800 border border-zinc-700/60 mb-3 flex items-center justify-center text-zinc-500 group-hover:scale-105 transition-all shadow-md">
        <i data-lucide="user" class="w-12 h-12 text-emerald-400/80"></i>
      </div>
      <h4 class="text-sm font-bold text-white truncate">${escapeHtml(artist)}</h4>
      <p class="text-xs text-zinc-400 mt-0.5">${artistTracks.length} lagu</p>
    </div>
  `).join('');

  return `
    <div class="space-y-4">
      <h2 class="text-2xl font-black text-white">Artis</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        ${cards}
      </div>
    </div>
  `;
}

/**
 * Render Albums Grouped View
 */
export function renderAlbumsView(tracks = []) {
  const map = new Map();
  tracks.forEach((t) => {
    const album = t.album || 'Unknown Album';
    if (!map.has(album)) map.set(album, []);
    map.get(album).push(t);
  });

  const sortedAlbums = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  if (sortedAlbums.length === 0) {
    return `<div class="text-center py-20 text-zinc-400">Tidak ada album ditemukan.</div>`;
  }

  const cards = sortedAlbums.map(([album, albumTracks]) => {
    const firstTrack = albumTracks[0];
    const artist = firstTrack?.artist || 'Various Artists';

    return `
      <div class="album-card bg-zinc-900/60 hover:bg-zinc-800/80 border border-zinc-800/80 rounded-2xl p-4 transition cursor-pointer group" data-album="${escapeHtml(album)}">
        <div class="w-full aspect-square rounded-xl bg-zinc-800 border border-zinc-700/60 mb-3 flex items-center justify-center text-zinc-500 group-hover:scale-105 transition-all shadow-md relative overflow-hidden">
          <i data-lucide="disc" class="w-12 h-12 text-emerald-400/80"></i>
        </div>
        <h4 class="text-sm font-bold text-white truncate">${escapeHtml(album)}</h4>
        <p class="text-xs text-zinc-400 mt-0.5 truncate">${escapeHtml(artist)} • ${albumTracks.length} lagu</p>
      </div>
    `;
  }).join('');

  return `
    <div class="space-y-4">
      <h2 class="text-2xl font-black text-white">Album</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        ${cards}
      </div>
    </div>
  `;
}

/**
 * Toast Notification Helper
 */
export function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const bgColors = {
    info: 'bg-zinc-900 border-zinc-700 text-zinc-200',
    success: 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200',
    warning: 'bg-amber-950/90 border-amber-500/50 text-amber-200',
    error: 'bg-red-950/90 border-red-500/50 text-red-200',
  };

  const icons = {
    info: 'info',
    success: 'check-circle-2',
    warning: 'alert-triangle',
    error: 'alert-circle',
  };

  toast.className = `flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-md shadow-xl text-xs font-medium transition-all duration-300 translate-y-2 opacity-0 pointer-events-auto ${bgColors[type] || bgColors.info}`;
  toast.innerHTML = `
    <i data-lucide="${icons[type] || 'info'}" class="w-4 h-4 flex-shrink-0"></i>
    <span class="flex-1">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-x-4');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/**
 * Real-time Progress Toast (for active audio download)
 */
export function showProgressToast(id, message, percent = 0) {
  const container = document.getElementById('toast-container');
  if (!container) return null;

  let toast = document.getElementById(`toast-${id}`);
  if (!toast) {
    toast = document.createElement('div');
    toast.id = `toast-${id}`;
    toast.className = 'flex flex-col gap-2 px-4 py-3 rounded-xl border backdrop-blur-md shadow-xl text-xs font-medium transition-all duration-300 bg-zinc-900 border-emerald-500/40 text-zinc-200 pointer-events-auto min-w-[280px]';
    container.appendChild(toast);
  }

  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));

  toast.innerHTML = `
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-2 truncate">
        <svg class="w-3.5 h-3.5 animate-spin text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
        </svg>
        <span class="truncate font-semibold text-zinc-100">${escapeHtml(message)}</span>
      </div>
      <span class="font-mono text-emerald-400 font-bold flex-shrink-0">${safePercent}%</span>
    </div>
    <div class="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
      <div class="bg-emerald-500 h-full rounded-full transition-all duration-150" style="width: ${safePercent}%"></div>
    </div>
  `;

  if (safePercent >= 100) {
    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-x-4');
      setTimeout(() => toast.remove(), 300);
    }, 1200);
  }

  return toast;
}

export function removeProgressToast(id) {
  const toast = document.getElementById(`toast-${id}`);
  if (toast) {
    toast.classList.add('opacity-0', 'translate-x-4');
    setTimeout(() => toast.remove(), 300);
  }
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
