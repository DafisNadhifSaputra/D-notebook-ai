# RAG System dengan Gemini AI

Aplikasi web menggunakan React dan Vite yang menerapkan sistem RAG (Retrieval Augmented Generation) dengan Gemini AI untuk menjawab pertanyaan berdasarkan dokumen PDF yang diunggah pengguna.

## Fitur

- Terintegrasi dengan Gemini AI untuk pemrosesan bahasa alami
- Memproses hingga 15 file PDF sekaligus
- Mengekstrak teks dari dokumen PDF
- Implementasi sistem RAG (Retrieval Augmented Generation)
- Antarmuka pengguna yang intuitif dan responsif

## Teknologi yang Digunakan

- React.js
- Vite
- @google/generative-ai (Gemini AI)
- LangChain
- PDF.js
- Axios

## Prasyarat

- Node.js (versi 14.0.0 atau lebih tinggi)
- npm (versi 6.0.0 atau lebih tinggi)
- API Key Gemini AI
  
## Instalasi

1. Kloning repositori ini
```bash
git clone https://github.com/username/rag-gemini.git
cd rag-gemini
```

2. Install dependensi
```bash
npm install
```

3. Jalankan aplikasi
```bash
npm run dev
```

4. Buka browser Anda dan akses `http://localhost:5173`

## Cara Penggunaan

1. **Masukkan API Key Gemini AI**
   - Dapatkan API key Anda dari [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Masukkan API key Anda pada form yang tersedia
   - Klik tombol 'Validasi API Key'

2. **Unggah File PDF**
   - Pilih hingga 15 file PDF yang ingin Anda proses
   - Klik tombol 'Proses PDF' untuk mengekstrak dan mengindeks konten

3. **Ajukan Pertanyaan**
   - Setelah dokumen selesai diproses, masukkan pertanyaan Anda
   - Klik tombol 'Kirim Pertanyaan'
   - AI akan merespons berdasarkan informasi dari dokumen yang Anda unggah

4. **Reset Sistem**
   - Klik tombol 'Reset Sistem' untuk mengosongkan data dan memulai ulang

## Konfigurasi Privasi

- Semua pemrosesan dokumen dilakukan secara lokal di browser Anda
- Hanya kueri dan konteks yang dikirim ke API Gemini AI
- API key Anda tidak disimpan secara permanen di aplikasi

## Pembatasan

- Aplikasi ini dibatasi hingga 15 file PDF
- Ukuran file yang sangat besar mungkin memerlukan waktu pemrosesan lebih lama
- Kualitas jawaban bergantung pada kualitas dokumen sumber

## Lisensi

Proyek ini dilisensikan di bawah MIT License - lihat file LICENSE untuk detailnya.
