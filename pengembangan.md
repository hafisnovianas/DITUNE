# Rencana Pengembangan DITUNE

## Fitur Baru

### 1. Playlist Kustom
Pembuatan, pengelolaan, dan pemutaran playlist kustom buatan pengguna.

**Model data** — Object store baru `playlists` di IndexedDB (versi DB naik):
```
{ id, name, trackIds: [file.id, ...], createdAt, updatedAt }
```
`trackIds` merujuk ke `file.id` yang sudah ada di object store `tracks` (tanpa duplikasi data lagu).

**Perubahan per komponen:**
- `db.js`: Tambah object store `playlists` + fungsi CRUD (`savePlaylist`, `getAllPlaylists`, `deletePlaylist`, `addTrackToPlaylist`, `removeTrackFromPlaylist`, `reorderPlaylistTracks`).
- `components.js`: Daftar playlist di sidebar (di bawah "Tersimpan Offline"). Modal buat/rename playlist. Tombol/menu "Tambah ke Playlist" di setiap baris lagu.
- `events.js`: View playlist (daftar lagu terfilter sesuai `trackIds`). Klik play pada playlist memanggil `audioEngine.setPlaylist()`.
- `AudioEngine`: Tidak perlu berubah — `setPlaylist()` dan shuffle/repeat sudah bekerja dengan array track apa pun.

**Pertimbangan:**
- Lagu dihapus dari pustaka → filter `trackIds` yang tidak ditemukan saat menampilkan playlist (*graceful skip*).
- Sinkronisasi antar-perangkat → tahap awal cukup IndexedDB lokal; nanti bisa ikut disinkronkan via `appDataFolder` (lihat poin 2).
- Tahap awal cukup CRUD dasar + play, tanpa drag-and-drop reorder atau cover playlist kustom.

### 2. Sinkronisasi Pengaturan via Google Drive `appDataFolder`
Menyimpan file pengaturan (misal `ditune-settings.json`) di folder tersembunyi Google Drive (`appDataFolder`) agar preferensi pengguna tersinkronkan antar-perangkat tanpa mencemari folder musik.

- **Scope tambahan**: `drive.appdata` (perlu ditambahkan ke OAuth consent screen).
- **Data kandidat**: `ignored_tracks`, playlist kustom, equalizer preset.
- **Data yang TIDAK perlu disinkronkan** (wajar per-perangkat): volume, repeat/shuffle mode.
- **Pertimbangan**: Konflik jika buka di 2 browser bersamaan (strategi *last-write-wins* atau *merge*), migrasi versi schema.
