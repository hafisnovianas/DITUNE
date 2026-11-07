# Changelog

Semua perubahan penting pada proyek **DITUNE** akan didokumentasikan di berkas ini.

Format penulisan mengacu pada [Keep a Changelog](https://keepachangelog.com/id/1.0.0/),
dan proyek ini mematuhi prinsip [Semantic Versioning](https://semver.org/lang/id/).

## [Unreleased]

### Removed
- Menghapus seluruh form input kredensial kustom (Client ID & API Key) dari modal Pengaturan untuk menyederhanakan pengalaman pengguna murni ke fungsi pemutar musik (*consumer-focused*).
- Menghapus dependensi dan logika pembacaan/penyimpanan kredensial di `localStorage`.

### Changed
- Mengubah OAuth scope dari `drive.file` menjadi `drive.readonly` agar fitur pemilihan 1 folder musik dapat memindai dan memuat semua file audio di dalamnya secara otomatis.
- Menyederhanakan modal Pengaturan agar murni menampilkan status koneksi Google Drive, manajemen memori cache musik offline, dan informasi aplikasi.
- Memperbarui tag meta PWA `mobile-web-app-capable` pada `index.html` dan menambahkan impor ikon `Radio` pada modul UI.

### Added
- Inisialisasi awal proyek pemutar musik DITUNE berbasis web (*client-side*) menggunakan Vite, Vanilla JS, Tailwind CSS, dan Lucide Icons.
- Integrasi Google Identity Services (GIS) dan Google Picker API dengan *scope* minimal `drive.file` untuk memilih folder musik dari Google Drive pengguna secara aman dan menjaga privasi.
- Penyimpanan lokal IndexedDB (`tracks`, `audio_blobs`, `covers`, `settings`) dengan fitur *stream-to-cache* otomatis saat lagu diputar dan tombol unduh batch untuk pemutaran *offline* tanpa kuota internet berulang.
- Audio playback engine dengan dukungan antrean (*queue*), *shuffle*, *repeat*, serta penanganan *race condition* (`playRequestId`) saat pergantian lagu cepat.
- Parser metadata audio ID3 di sisi browser untuk mengekstrak judul, artis, album, dan cover art biner.
- Generator audio sintetis bawaan untuk demonstrasi lagu tanpa memerlukan kredensial Google Cloud.
- Integrasi Media Session API untuk kontrol audio di *lockscreen* dan panel notifikasi sistem operasi (Android, Windows, macOS, iOS).
- Dukungan Progressive Web App (PWA) lengkap dengan Service Worker untuk *caching app shell* secara *offline*.
- Antarmuka pengguna Spotify-like responsif (desktop & mobile) dengan filter tab (*Semua Lagu*, *Artis*, *Album*, *Offline*), *search bar*, *touch scrubbing* pada slider progres musik, dan modal pengaturan kredensial Google API.
- Rangkaian pengujian unit otomatis (22 tes) mencakup modul storage, audio engine, parser metadata, dan demo synthesizer.
