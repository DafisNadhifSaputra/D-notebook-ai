<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

# Instruksi untuk GitHub Copilot

Ini adalah proyek aplikasi React yang menggunakan Vite, yang mengimplementasikan sistem RAG (Retrieval Augmented Generation) dengan Gemini AI untuk menjawab pertanyaan berdasarkan dokumen PDF yang diunggah pengguna.

## Teknologi yang Digunakan

- React.js dengan hooks
- Vite sebagai build tool
- @google/generative-ai untuk integrasi dengan Gemini AI
- LangChain untuk implementasi RAG
- PDF.js untuk pemrosesan file PDF
- Axios untuk HTTP requests

## Struktur Proyek

- `/src/components`: Komponen-komponen React
- `/src/services`: Layanan untuk pemrosesan PDF dan integrasi Gemini AI
- `/src/hooks`: Custom hooks React
- `/src/utils`: Fungsi-fungsi utilitas

## Pedoman Pengembangan

- Gunakan React hooks untuk pengelolaan state
- Gunakan pendekatan fungsional dalam komponen React
- Pastikan kode memiliki error handling yang tepat
- Batasi jumlah file PDF yang diproses hingga 15 file
- Pastikan sistem RAG berfungsi dengan baik untuk mengambil konteks dari dokumen
- Prioritaskan keamanan API key dengan tidak menyimpannya secara permanen