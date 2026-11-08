# Changelog

Semua perubahan penting pada proyek **DITUNE** akan didokumentasikan di berkas ini.

Format penulisan mengacu pada [Keep a Changelog](https://keepachangelog.com/id/1.0.0/),
dan proyek ini mematuhi prinsip [Semantic Versioning](https://semver.org/lang/id/).

## [Unreleased]

### Added
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
- Menghilangkan tombol Pengaturan redundan pada bilah navigasi desktop (hanya dipertahankan pada navigasi mobile).
- Menghapus seluruh fitur modul generator audio contoh (`demoTracks.js`), tombol "Muat Lagu Contoh" pada sidebar dan library kosong, serta pengujian terkait.
- Menghapus seluruh form input kredensial kustom (Client ID & API Key) dari modal Pengaturan untuk menyederhanakan pengalaman pengguna murni ke fungsi pemutar musik (*consumer-focused*).
- Menghapus dependensi dan logika pembacaan/penyimpanan kredensial di `localStorage`.
