# Changelog

Semua perubahan penting pada proyek **DITUNE** akan didokumentasikan di berkas ini.

Format penulisan mengacu pada [Keep a Changelog](https://keepachangelog.com/id/1.0.0/),
dan proyek ini mematuhi prinsip [Semantic Versioning](https://semver.org/lang/id/).

## [Unreleased]

### Added
- Fitur **Playlist Kustom** berbasis IndexedDB lokal: membuat playlist baru lewat input *inline* di sidebar (`+`), menampilkan daftar playlist di sidebar desktop (`renderSidebarPlaylists`), serta halaman detail playlist (`renderPlaylistView`) dengan tombol **Putar Semua** yang mengganti antrean aktif (`engine.setPlaylist`) sehingga *shuffle* dan *repeat* berjalan dalam lingkup playlist.
- Dukungan pengelolaan playlist lengkap pada kontroler UI: sub-dropdown *Tambah ke Playlist* di menu `⋮` baris lagu (dengan pencegahan duplikat), aksi *Hapus dari Playlist*, serta menu opsi playlist untuk mengubah nama (*Ubah Nama*) dan menghapus playlist (*Hapus Playlist*).
- Fungsi CRUD playlist di `src/modules/storage/db.js` (`getAllPlaylists`, `getPlaylist`, `savePlaylist`, `deletePlaylist`) beserta 9 unit test baru di `tests/storage.test.js` (3 tes) dan `tests/uiController.test.js` (6 tes), sehingga total pengujian menjadi 80 tes di 6 suite.
- Fitur *batch upload* lagu langsung dari perangkat ke folder otomatis `DITUNE Music` di Google Drive melalui *Resumable Upload* (`uploadAudioToDrive`) dengan antrean paralel (maksimal 2 file serentak), indikator progress real-time, deteksi duplikat otomatis (`buildUploadDuplicateKey`), dan cache offline instan per lagu selesai (`persistTrackBlobWithMetadata`).
- Dukungan *drag-and-drop* berkas audio ke area kerja utama (`#main-workspace` & `#upload-drop-overlay`) beserta pencegahan navigasi browser saat berkas dijatuhkan di luar area utama.
- Halaman statis **Kebijakan Privasi** (`public/privacy.html`) dan **Ketentuan Layanan** (`public/terms.html`) untuk kelengkapan *Go Publish* Google OAuth, lengkap dengan tautannya di footer modal Pengaturan.
- Metode `AudioEngine.stop()` untuk menghentikan pemutaran, membatalkan request tertunda, mengosongkan antrean, me-revoke object URL, dan membersihkan `audio.src`.
- Rangkaian pengujian unit baru di `tests/gdrive.test.js` (22 tes), `tests/sw.test.js` (6 tes), `tests/uiController.test.js` (15 tes), serta tambahan kasus uji di `tests/audioEngine.test.js` (total 70 tes di 6 suite).
- Fitur penghapusan lagu dari library dan daftar abaikan (*Ignored Tracks*) berbasis IndexedDB lokal tanpa mengubah file fisik di Google Drive (menggunakan scope `drive.readonly`).
- Tombol menu aksi titik tiga (`•••`) pada setiap baris lagu dengan dropdown: *Hapus Audio dari Cache Offline*, *Hapus dari Library*, dan tautan *Buka di Google Drive*.
- Dialog modal konfirmasi ringkas sebelum menghapus lagu dari library.
- Transisi pemutaran otomatis (`engine.playNext()`) ke trek berikutnya jika lagu yang sedang diputar dihapus oleh pengguna.
- Pusat pengelolaan *Lagu yang Disembunyikan* di modal Pengaturan untuk melihat dan memulihkan lagu secara individu atau sekaligus (*Pulihkan Semua*).
- Otomatis melewati (*skip*) file yang tercatat di daftar abaikan saat proses pemindaian dan sinkronisasi Google Drive (`↻ Sinkronkan Lagu`).
- Animasi batang equalizer audio dinamis (GPU-composited via CSS `transform: scaleY`) pada baris lagu yang sedang aktif diputar, lengkap dengan transisi ikon pause saat di-hover.
- Dukungan pemindaian dan pemutaran trek audio dari file media berformat `.mp4`, `.m4v`, dan `.webm` dari Google Drive.
- Dukungan tombol instalasi aplikasi Progressive Web App (PWA) di bilah navigasi header saat aplikasi belum terpasang.
- Fitur sinkronisasi folder 1-klik (`↻ Sinkronkan Lagu`) di header daftar lagu untuk memindai lagu baru di Google Drive tanpa memunculkan dialog Picker.
- Kartu informasi status dan nama folder terhubung di dalam modal Pengaturan.
- Penyimpanan persisten metadata folder aktif (`connected_folder`) di IndexedDB.
- Indikator progress bar dan persentase unduhan real-time pada baris daftar lagu, floating toast, tombol unduh batch, dan player bar saat proses pemuatan audio Google Drive.
- Menyimpan token akses Google OAuth sementara di `sessionStorage` (masa berlaku 1 jam) agar sesi login tidak ter-reset saat pengguna me-reload halaman browser.
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

### Changed
- Menaikkan versi skema IndexedDB (`DB_VERSION`) dari `1` ke `2` untuk menambahkan object store `playlists` secara aman saat migrasi serta mengosongkannya saat `clearAllData()` dan `handleResetLibrary()` dijalankan.
- Mengekstrak helper internal `buildTrackRow()` di `src/modules/ui/components.js` agar tampilan daftar lagu utama dan detail playlist berbagi struktur baris yang konsisten.
- Mengubah OAuth scope dari `drive.readonly` menjadi scope non-sensitif `https://www.googleapis.com/auth/drive.file` untuk kesiapan *Go Publish*, disertai penyimpanan `ditune_oauth_scope` guna menginvalidasi otomatis token sesi lama.
- Memperbarui Google Picker (`openGooglePicker`) menjadi mode impor berkas audio multi-select dengan penelusuran folder (`setIncludeFolders(true)`, `setSelectFolderEnabled(false)`), perluasan filter MIME audio, verifikasi sesi awal, serta penanganan aksi error Picker.
- Memisahkan `ensureGisLoaded()` dan `ensurePickerLoaded()` (dengan timeout 15 detik pada pemuatan Picker) agar jalur upload dan sinkronisasi tidak menunggu library Picker sebelum memicu popup OAuth.
- Memperbarui tombol aksi pada *empty state*, header daftar lagu, dan modal Pengaturan (**Upload Lagu**, **Impor Drive**, **Sinkronkan**), serta memperbarui `syncConnectedFolder()` untuk menyinkronkan seluruh file audio berizin `drive.file` (`listAuthorizedAudioFiles`) dan menautkan folder `DITUNE Music` (`findDituneFolder`).
- Memperbarui tampilan status koneksi di modal Pengaturan untuk membedakan status kredensial/sesi OAuth (`Kredensial Belum Siap`, `Sesi Google Aktif`, `Siap Login`) dan label versi `DITUNE v1.3.0 • Dijumper Web`.
- Memperbarui tombol "Kosongkan Perpustakaan" agar mempertahankan tautan folder Google Drive (`connected_folder`) dan sesi login, sehingga pengguna dapat langsung menarik kembali lagu-lagu segar via tombol "Sinkronkan Lagu" tanpa harus memilih ulang folder dari awal.
- Menyesuaikan tampilan antarmuka saat library kosong untuk menampilkan status folder terhubung beserta tombol aksi cepat "Sinkronkan Lagu" dan tombol sekunder "Ganti Folder".
- Menyempurnakan antarmuka modal *Lagu yang Disembunyikan* dengan menghapus tombol silang `✕` agar murni berstatus panel aksi langsung (*Immediate Management Panel*), serta menjalankan sinkronisasi folder Google Drive otomatis di latar belakang saat tombol **"Selesai"** diklik jika terdapat lagu yang dipulihkan.
- Memperlebar kolom ke-4 pada tabel daftar lagu menjadi `9.5rem` (`grid-cols-[2rem_1fr_9.5rem]` / `md:grid-cols-[2rem_1fr_26%_9.5rem]`) agar memuat badge offline, durasi, dan tombol menu lagu dengan rapi dan presisi.
- Merombak antarmuka modal Pengaturan dari gaya kartu bertumpuk menjadi tata letak baris bersih (*native row-based preferences*) untuk menghilangkan redundansi visual dan meningkatkan keterbacaan.
- Mengalihkan penyimpanan token akses Google OAuth dari `sessionStorage` ke `localStorage` (dengan batas masa berlaku 1 jam) agar pengguna tidak perlu login ulang setiap kali menutup dan membuka kembali browser atau aplikasi PWA.
- Menjadikan header kolom tabel daftar lagu sticky (menempel di atas dengan efek blur) saat daftar lagu di-scroll ke bawah.
- Membersihkan otomatis karakter pemisah garis bawah (_) pada judul lagu mentah menjadi spasi yang rapi.
- Mempercantik kotak thumbnail cover art di player bar dengan latar belakang gradien modern dan aksen emerald.
- Penyatuan logika smart merge pustaka Google Drive ke fungsi tunggal SSOT `mergeAndSaveDriveFiles`.
- Menyembunyikan tombol "Pilih Folder Drive" dari sidebar dan mobile header saat library sudah terisi lagu untuk mencegah persepsi multi-folder, serta menyediakan tombol "Ganti Folder Musik Google Drive" di dalam modal Pengaturan.
- Mengubah OAuth scope dari `drive.file` menjadi `drive.readonly` agar fitur pemilihan 1 folder musik dapat memindai dan memuat semua file audio di dalamnya secara otomatis.
- Menyederhanakan modal Pengaturan agar murni menampilkan status koneksi Google Drive, manajemen memori cache musik offline, dan informasi aplikasi.
- Memperbarui tag meta PWA `mobile-web-app-capable` pada `index.html` dan menambahkan impor ikon `Radio` pada modul UI.

### Fixed
- Menangani penutupan atau penghapusan koneksi IndexedDB (`onversionchange`, `onclose`, serta retry otomatis saat `InvalidStateError` via `createTransaction`) di `src/modules/storage/db.js` agar tidak gagal setelah *Clear site data* atau saat browser menutup koneksi idle.
- Menambahkan *single-flight lock* (`pendingTokenPromise`), `error_callback` GIS, validasi token/scope callback, dan guard `currentAccessToken === token` pada `fetchDriveWithAuth()` untuk mencegah tabrakan callback OAuth paralel maupun Promise menggantung saat popup ditutup/diblokir.
- Menambahkan guard status sibuk lintas operasi (`hasActiveTransferOrSync`, `isPicking`, `isSyncing`, `isBatchUploading`, `isBatchDownloading`, `downloadingTrackIds`) serta guard koneksi `navigator.onLine` pada alur upload, impor Picker, sinkronisasi, unduhan offline, cache, dan reset library.
- Memserialisasikan pembaruan IndexedDB/UI pasca-upload via `refreshChain`, memperbarui status unduhan batch secara inkremental per lagu, dan melacak timer auto-close (`_fadeTimer`, `_removeTimer`) pada `showProgressToast()` / `removeProgressToast()`.
- Memperbaiki *Service Worker* (`public/sw.js`, `ditune-shell-v6`) agar caching navigasi HTML hanya menimpa `/index.html` pada rute `/` atau `/index.html`, menambahkan halaman legal ke `STATIC_ASSETS`, dan memperbaiki chaining fallback offline.
- Menambahkan sanitasi `escapeHtml()`, `encodeURIComponent()`, dan `CSS.escape()` pada judul filter Artis/Album serta atribut/URL ID lagu, serta membersihkan metadata `connected_folder` lama tanpa `scope: 'drive.file'`.
- Memperbaiki ketidakkonsistenan posisi kolom Album dan merapikan kolom Durasi agar tidak mepet dengan scrollbar menggunakan struktur CSS Grid 4-kolom yang presisi (`grid-cols-[2rem_1fr_26%_7.5rem]`).
- Memperbaiki alur otentikasi Google Drive saat memutar atau mengunduh lagu pada sesi baru dengan langsung memicu popup interaktif resmi, mencegah penutupan modal mendadak akibat *silent auth*, serta memulihkan tampilan antarmuka baris lagu agar tidak tertahan di status loading 0% saat unduhan batal atau gagal.
- Memperbaiki penanganan kloning Response body pada Service Worker PWA (`sw.js`) untuk mencegah error `Response body is already used` saat caching navigasi HTML dan menaikkan versi cache menjadi `ditune-shell-v3`.
- Memperbaiki tata letak area konten utama dengan memisahkan header halaman dan kolom tabel menjadi elemen tetap (*non-scrollable fixed header*), sehingga judul tidak tergulung keluar layar dan baris-baris lagu bergulir secara independen di bawahnya.
- Menambahkan kursor `pointer` global untuk seluruh tombol interaktif pada aplikasi guna menyempurnakan ergonomi antarmuka.
- Memperbaiki indikator unduhan yang berlebihan: menghilangkan toast mengambang saat memutar lagu biasa dan mengembalikan kemurnian slider/timer player bar khusus untuk posisi pemutaran audio.
- Menyeragamkan nama album bawaan menjadi `Unknown Album` serta merekonsiliasi otomatis lagu yang sebelumnya terdata sebagai `Google Drive`.
- Memperbaiki tata letak shell aplikasi menjadi Flex Column semantik sehingga Player Bar tidak lagi menimpa tombol Pengaturan dan status penyimpanan di sidebar.
- Menambahkan rekonsiliasi mandiri (Self-Healing SSOT) antara tabel audio_blobs dan metadata tracks agar status Offline dan durasi lagu tetap sinkron secara otomatis.
- Mengubah strategi Service Worker PWA untuk navigasi HTML menjadi Network-First (cache ditune-shell-v2) agar pembaruan rilis web langsung aktif tanpa tertahan cache lama.
- Mencegah reset status cache dan penghapusan metadata lagu lama saat memilih folder Google Drive berulang melalui mekanisme Smart Merge berbasis ID file.
- Memperbaiki parsing metadata ID3 di browser dengan menginisialisasi polyfill `Buffer` global untuk pustaka `music-metadata-browser`.
- Memperbaiki pendaftaran ikon `Radio` pada objek pembuat ikon Lucide untuk menghilangkan peringatan konsol.

### Removed
- Menghapus fungsi `listAudioFilesFromFolder`, `folderView` pada Google Picker, konstanta `DISCOVERY_DOCS`, dan elemen `#connected-folder-badge` yang tidak lagi digunakan di bawah scope `drive.file`.
- Menghilangkan tombol Pengaturan redundan pada bilah navigasi desktop (hanya dipertahankan pada navigasi mobile).
- Menghapus seluruh fitur modul generator audio contoh (`demoTracks.js`), tombol "Muat Lagu Contoh" pada sidebar dan library kosong, serta pengujian terkait.
- Menghapus seluruh form input kredensial kustom (Client ID & API Key) dari modal Pengaturan untuk menyederhanakan pengalaman pengguna murni ke fungsi pemutar musik (*consumer-focused*).
- Menghapus dependensi dan logika pembacaan/penyimpanan kredensial di `localStorage`.
