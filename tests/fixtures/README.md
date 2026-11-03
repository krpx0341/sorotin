# Fixture QA (tanpa video)

`manifest.json` menyimpan metadata klip uji wajah: nama file, sumber, lisensi, atribusi, sha256, durasi, resolusi, dan ekspektasi deteksi. Video tidak disimpan di repo ini. Simpan file video di luar repo, lalu unduh ulang dari `source_file_url` tiap entri (Wikimedia Commons). Potong dan encode sesuai `source_trim` dan `ffmpeg_command`.

- `closeup_large.mp4` berlisensi CC BY 3.0. Cantumkan teks di field `attribution` saat memakai ulang.
- `center_single.mp4`, `edge_face_right.mp4`, dan `two_people.mp4` domain publik (karya pemerintah AS). Atribusi tetap tercatat di manifest.
- Entri `ours.mp4` tidak ikut karena lisensinya tidak jelas.

Path di manifest relatif. Jangan menulis path absolut mesin lokal.
