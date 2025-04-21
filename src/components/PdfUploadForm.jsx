import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import './PdfUploadForm.css';
import { FileText, X, Upload, AlertCircle, Check, Loader, AlertTriangle, HardDrive } from 'lucide-react';
import { hasEnoughStorage } from '../services/documentService';

const PdfUploadForm = ({ onProcessPdfs, isProcessing, isDisabled, processingSuccess = false, maxFiles = 15 }) => {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [error, setError] = useState('');
  const [fileStatus, setFileStatus] = useState({});
  const [hasAutoProcessed, setHasAutoProcessed] = useState(false);
  const [isCheckingStorage, setIsCheckingStorage] = useState(false);
  
  // Handle process button click - wrapped with useCallback
  const handleProcessClick = useCallback(async () => {
    console.log("[PdfUploadForm] handleProcessClick called with files:", selectedFiles.length);
    if (selectedFiles.length === 0) {
      setError('Pilih setidaknya satu file PDF untuk diproses.');
      return;
    }
    
    // Check if user has enough storage space
    try {
      setIsCheckingStorage(true);
      
      // Calculate total size of selected files
      const totalSize = selectedFiles.reduce((acc, file) => acc + file.size, 0);
      
      // Check if user has enough storage
      const hasStorage = await hasEnoughStorage(totalSize);
      
      if (!hasStorage) {
        setError('Penyimpanan tidak cukup. Batas penyimpanan 100MB. Hapus beberapa dokumen lama terlebih dahulu.');
        setIsCheckingStorage(false);
        return;
      }
      
      setIsCheckingStorage(false);
      
      // Tandai semua file sebagai 'processing'
      const newStatus = {};
      selectedFiles.forEach(file => {
        newStatus[file.name] = 'processing';
      });
      setFileStatus(newStatus);
      console.log("[PdfUploadForm] Setting file status to processing:", newStatus);
      
      // Panggil fungsi pemrosesan dari parent component
      onProcessPdfs(selectedFiles);
    } catch (err) {
      console.error("[PdfUploadForm] Error checking storage:", err);
      setError('Gagal memeriksa penyimpanan: ' + err.message);
      setIsCheckingStorage(false);
    }
  }, [selectedFiles, onProcessPdfs]);

  // Auto proses setelah file ditambahkan - dinonaktifkan untuk mencegah reset berulang
  useEffect(() => {
    console.log("[PdfUploadForm] Auto-process useEffect triggered. Auto-processing disabled to prevent frequent resets.");
    
    // Commented out auto-processing functionality to prevent RAG system reset loop
    /*
    // Hanya lakukan auto-processing jika ada file dan belum pernah diproses
    if (selectedFiles.length > 0 && !isProcessing && !isDisabled && !hasAutoProcessed) {
      console.log("[PdfUploadForm] Conditions met for auto-processing. Setting timer...");
      // Tandai bahwa kita akan melakukan auto-processing
      setHasAutoProcessed(true);
      
      try {
        // Mulai proses dengan sedikit delay untuk UX yang lebih baik
        const timer = setTimeout(() => {
          console.log("[PdfUploadForm] Timer finished, calling handleProcessClick.");
          handleProcessClick();
        }, 500);
        
        return () => clearTimeout(timer);
      } catch (err) {
        console.error("[PdfUploadForm] Error in auto-processing:", err);
        setError('Gagal memproses otomatis: ' + err.message);
      }
    }
    */
  }, [selectedFiles, isProcessing, isDisabled, handleProcessClick, hasAutoProcessed]);

  // Effect untuk memperbarui status berdasarkan hasil pemrosesan
  useEffect(() => {
    // Hanya jalankan ketika isProcessing berubah dari true ke false
    const wasProcessing = Object.values(fileStatus).some(status => status === 'processing');
    
    if (wasProcessing && !isProcessing) {
      console.log(`Processing finished. Success status: ${processingSuccess}`);
      const newStatus = {};
      Object.keys(fileStatus).forEach(fileName => {
        // Perbarui status hanya untuk file yang sebelumnya 'processing'
        if (fileStatus[fileName] === 'processing') {
          newStatus[fileName] = processingSuccess ? 'processed' : 'failed';
        } else {
          // Pertahankan status file lain (misalnya jika ada yang sudah 'processed' sebelumnya)
          newStatus[fileName] = fileStatus[fileName];
        }
      });
      setFileStatus(newStatus);
      
      // Tampilkan error jika pemrosesan gagal secara keseluruhan
      if (!processingSuccess) {
        setError('Gagal memproses dokumen. Silakan periksa konsol untuk detail atau coba lagi.');
      }
    }
  }, [isProcessing, processingSuccess, fileStatus]);

  // Check file size before accepting
  const checkTotalFilesSize = async (files) => {
    const totalSize = files.reduce((total, file) => total + file.size, 0);
    
    // Hard limit on individual file size - 20MB per file
    const largeFiles = files.filter(file => file.size > 20_971_520); // 20MB in bytes
    
    if (largeFiles.length > 0) {
      return {
        valid: false,
        error: `File terlalu besar: ${largeFiles.map(f => f.name).join(', ')}. Maksimal 20MB per file.`
      };
    }
    
    // Check if adding these files would exceed storage limit
    try {
      const hasStorage = await hasEnoughStorage(totalSize);
      if (!hasStorage) {
        return {
          valid: false,
          error: 'Penyimpanan tidak cukup. Batas penyimpanan 100MB. Hapus beberapa dokumen lama terlebih dahulu.'
        };
      }
      
      return { valid: true, error: null };
    } catch (err) {
      console.error("[PdfUploadForm] Error checking storage for new files:", err);
      return {
        valid: false,
        error: 'Gagal memeriksa penyimpanan: ' + err.message
      };
    }
  };

  const onDrop = useCallback(async (acceptedFiles, rejectedFiles) => {
    setError(''); // Clear previous errors
    
    // Jangan terima file baru jika masih dalam proses
    if (isProcessing || isCheckingStorage) {
      setError(isProcessing ? 'Sedang memproses file. Tunggu hingga selesai sebelum mengunggah file baru.' :
                            'Sedang memeriksa penyimpanan. Harap tunggu sebentar.');
      return;
    }

    console.log("[PdfUploadForm] Files dropped:", acceptedFiles.length);

    // Reset auto-process state untuk set file baru
    setHasAutoProcessed(false);
    
    // Handle rejected files (e.g., wrong type)
    if (rejectedFiles && rejectedFiles.length > 0) {
      setError(`File tidak valid: ${rejectedFiles.map(f => f.file.name).join(', ')}. Hanya file PDF yang diterima.`);
    }

    // Filter only PDF files from accepted files
    const pdfFiles = acceptedFiles.filter(file => file.type === 'application/pdf');

    if (pdfFiles.length !== acceptedFiles.length) {
      setError('Beberapa file non-PDF diabaikan.');
    }

    if (pdfFiles.length === 0) return;

    // Check storage before accepting files
    const sizeCheck = await checkTotalFilesSize(pdfFiles);
    
    if (!sizeCheck.valid) {
      setError(sizeCheck.error);
      return;
    }

    // Combine with existing files, prevent duplicates, and enforce maxFiles limit
    setSelectedFiles(prevFiles => {
      const existingFileNames = new Set(prevFiles.map(f => f.name));
      const newUniqueFiles = pdfFiles.filter(file => !existingFileNames.has(file.name));
      
      if (newUniqueFiles.length < pdfFiles.length) {
        setError(prevError => prevError ? prevError + ' File duplikat diabaikan.' : 'File duplikat diabaikan.');
      }

      const combined = [...prevFiles, ...newUniqueFiles];
      
      if (combined.length > maxFiles) {
        setError(`Anda hanya dapat mengunggah maksimal ${maxFiles} file. Kelebihan file diabaikan.`);
        return combined.slice(0, maxFiles); // Keep only up to maxFiles
      }
      return combined;
    });
  }, [maxFiles, isProcessing, isCheckingStorage]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
    },
    disabled: isDisabled || isProcessing || isCheckingStorage,
    multiple: true,
  });

  // Format file size untuk tampilan
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleRemoveFile = (fileName) => {
    // Jangan izinkan menghapus file saat sedang diproses
    if (isProcessing || isCheckingStorage) return;
    
    setSelectedFiles(prevFiles => prevFiles.filter(file => file.name !== fileName));
    setFileStatus(prevStatus => {
      const newStatus = {...prevStatus};
      delete newStatus[fileName];
      return newStatus;
    });
    
    if (error && error.includes(fileName)) {
      setError('');
    }
  };

  // Render status icon untuk setiap file
  const renderFileStatusIcon = (fileName) => {
    const status = fileStatus[fileName];
    
    if (status === 'processing') {
      return <Loader size={18} className="file-processing-indicator" />;
    } else if (status === 'processed') {
      return <Check size={18} className="file-processed-indicator" />;
    } else if (status === 'failed') {
      return <AlertTriangle size={18} className="file-failed-indicator" />;
    }
    
    return null;
  };

  return (
    <div className="pdf-form">
      {/* Dropzone area with modern styling */}
      <div
        {...getRootProps()}
        className={`pdf-dropzone ${isDragActive ? 'active' : ''} ${isDisabled || isProcessing || isCheckingStorage ? 'disabled' : ''}`}
      >
        <input {...getInputProps()} />
        <div className="dropzone-content">
          <div className="dropzone-icon">
            {isDragActive ? (
              <Upload size={36} strokeWidth={1.5} />
            ) : (
              <FileText size={36} strokeWidth={1.5} />
            )}
          </div>
          {isDragActive ? (
            <p className="dropzone-text">Lepaskan file PDF di sini...</p>
          ) : (
            <p className="dropzone-text">
              <span className="dropzone-primary">Jatuhkan file PDF di sini</span>
              <span className="dropzone-secondary">atau klik untuk memilih (maks {maxFiles})</span>
            </p>
          )}
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="pdf-error">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Selected files list with improved UI */}
      {selectedFiles && selectedFiles.length > 0 && (
        <div className="pdf-files">
          <div className="pdf-files-header">
            <h4>File Terpilih ({selectedFiles.length})</h4>
            
            {/* Tombol proses manual (untuk berjaga-jaga jika auto-process tidak berfungsi) */}
            <button 
              onClick={handleProcessClick}
              disabled={isProcessing || isCheckingStorage || selectedFiles.length === 0}
              className="pdf-process-btn"
              title="Proses file PDF"
            >
              {isProcessing ? (
                <Loader size={16} className="pdf-process-spinner" />
              ) : isCheckingStorage ? (
                <HardDrive size={16} className="pdf-process-spinner" />
              ) : (
                <span>Proses File</span>
              )}
            </button>
          </div>
          <div className="pdf-files-list">
            {selectedFiles.map((file, index) => (
              <div 
                key={`${file.name}-${index}`} 
                className={`pdf-file-item ${fileStatus[file.name] || ''}`}
              >
                <div className="pdf-file-icon">
                  <FileText size={20} strokeWidth={1.5} />
                </div>
                <div className="pdf-file-info">
                  <div className="pdf-file-name" title={file.name}>
                    {file.name}
                  </div>
                  <div className="pdf-file-size">{formatFileSize(file.size)}</div>
                </div>
                <div className="pdf-file-status">
                  {renderFileStatusIcon(file.name)}
                </div>
                <button
                  onClick={() => handleRemoveFile(file.name)}
                  disabled={isProcessing || isCheckingStorage}
                  className="pdf-file-remove"
                  aria-label={`Hapus ${file.name}`}
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PdfUploadForm;