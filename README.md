# Rimba Malam

Prototype game social-deduction horor folklor Indonesia, dibuat dengan HTML, CSS, Canvas, dan JavaScript tanpa build step.

## Fitur
- Mode bermain solo dengan 5 bot AI.
- Room online peer-to-peer untuk maksimal 3 pemain manusia; slot lain diisi AI sampai total 6 karakter.
- Satu pemain manusia menjadi Kuntilanak saat ada 2–3 pemain manusia. Dalam mode solo, peran pemain dan bot diacak.
- Penyintas memiliki 3 tugas acak per ronde dengan tiga tipe puzzle: urutan rune, pasang simbol, dan kode hitung.
- Hantu menyamar sebagai penyintas, bisa menghantui pemain dekat, dan sesaat terlihat saat menyerang.
- Lapor mayat, rapat darurat dekat api unggun, voting, timer, kondisi menang/kalah.
- Kontrol mobile berupa joystick + tombol aksi; desktop mendukung WASD/arrow, E (aksi), Q (hantui), R (lapor).
- Visual hutan malam dibuat dengan Canvas, tanpa file gambar terpisah. Efek suara dibuat secara procedural menggunakan Web Audio.

## Deploy ke GitHub Pages
1. Buat repository baru di GitHub.
2. Upload `index.html`, `style.css`, `game.js`, dan `README.md` ke root repository.
3. Buka **Settings → Pages**.
4. Pada **Build and deployment**, pilih **Deploy from a branch**, branch `main`, folder `/ (root)`, lalu Save.
5. Buka URL GitHub Pages yang muncul. Pastikan halaman dibuka lewat HTTPS.

## Cara mabar
1. Satu pemain tekan **Buat room mabar**.
2. Bagikan kode room 5 karakter ke maksimal 2 teman.
3. Teman memasukkan kode itu di menu utama dan menekan **Gabung**.
4. Host menekan **Mulai malam**. Slot kosong diisi bot.

### Catatan multiplayer
GitHub Pages hanya meng-host file statis. Multiplayer di prototipe ini memakai PeerJS dan layanan signaling publik default PeerJS; semua pemain harus online, host harus tetap membuka halaman, dan layanan publik dapat mengalami batasan atau gangguan. Untuk rilis publik dengan kestabilan lebih tinggi, gunakan PeerServer sendiri atau backend game yang dikelola.

## Catatan prototipe
Ini fondasi game yang bisa dimainkan, bukan server kompetitif/anti-cheat. Posisi dan aksi multiplayer masih mengandalkan host peer sebagai otoritas. Puzzle dan voting sebaiknya diuji bersama teman pada browser/perangkat yang akan dipakai.
