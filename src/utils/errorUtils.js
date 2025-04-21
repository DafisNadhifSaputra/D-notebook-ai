/**
 * Utility functions for handling various error scenarios
 */

/**
 * Parse PostgreSQL errors and return user-friendly error messages
 * @param {Error} error - The error object
 * @returns {Object} - Object with parsed error info
 */
export const parsePostgresError = (error) => {
  // Default error info
  const errorInfo = {
    message: error.message || 'Terjadi kesalahan pada database',
    type: 'database',
    suggestion: 'Silakan coba lagi atau hubungi administrator',
    isMemoryError: false,
    originalError: error
  };

  // Check for memory errors
  const memoryErrorRegex = /memory required is (\d+) MB, maintenance_work_mem is (\d+) MB/;
  const memoryMatch = error.message?.match(memoryErrorRegex);
  
  if (memoryMatch) {
    const requiredMem = parseInt(memoryMatch[1], 10);
    const allocatedMem = parseInt(memoryMatch[2], 10);
    
    errorInfo.isMemoryError = true;
    errorInfo.type = 'memory_limit';
    errorInfo.requiredMemory = requiredMem;
    errorInfo.allocatedMemory = allocatedMem;
    errorInfo.message = `Operasi database membutuhkan lebih banyak memori (${requiredMem} MB) daripada yang tersedia (${allocatedMem} MB)`;
    errorInfo.suggestion = 'Coba lakukan operasi pada dokumen yang lebih kecil atau kontak administrator untuk menaikkan batas memori database';
  }

  // Check for connection errors
  if (error.message?.includes('connection') || error.code === 'ECONNREFUSED') {
    errorInfo.type = 'connection';
    errorInfo.message = 'Tidak dapat terhubung ke database';
    errorInfo.suggestion = 'Periksa koneksi internet Anda atau coba lagi nanti';
  }

  // Check for permission errors
  if (error.message?.includes('permission denied') || error.code === '42501') {
    errorInfo.type = 'permission';
    errorInfo.message = 'Tidak memiliki izin untuk operasi ini';
    errorInfo.suggestion = 'Pastikan Anda memiliki hak akses yang sesuai';
  }
  
  return errorInfo;
};

/**
 * Handle database errors in consistent way across application
 * @param {Error} error - The error object
 * @returns {string} - User friendly error message
 */
export const handleDatabaseError = (error) => {
  const errorInfo = parsePostgresError(error);
  
  // Log for debugging purposes
  console.error('Database error:', {
    type: errorInfo.type,
    message: errorInfo.message,
    originalError: error
  });
  
  return {
    message: errorInfo.message,
    suggestion: errorInfo.suggestion,
    type: errorInfo.type,
    isMemoryError: errorInfo.isMemoryError
  };
};

/**
 * General error handler for application errors
 * @param {Error|Object|String} error - The error to handle
 * @returns {Object} - Processed error object with type information
 */
export const handleError = (error) => {
  // Log error for debugging
  console.error('Error occurred:', error);
  
  // Handle different error types
  if (error?.code && error.code.startsWith('23')) {
    // Database constraint errors
    return handleDatabaseError(error);
  } else if (error?.code === 'auth/wrong-password' || 
             error?.code === 'auth/user-not-found' || 
             error?.code === 'auth/invalid-credential') {
    // Authentication errors
    return {
      message: 'Email atau password tidak valid',
      type: 'auth',
      suggestion: 'Periksa kembali email dan password Anda'
    };
  } else if (error?.code === 'auth/too-many-requests') {
    return {
      message: 'Terlalu banyak percobaan login yang gagal',
      type: 'rate_limit',
      suggestion: 'Coba lagi nanti atau reset password Anda'
    };
  } else if (error?.code === 'storage/object-not-found' || 
             error?.message?.includes('storage') || 
             error?.message?.includes('not found')) {
    return {
      message: 'File atau dokumen tidak ditemukan',
      type: 'storage',
      suggestion: 'File mungkin telah dihapus atau dipindahkan'
    };
  } else if (error?.message?.includes('network') || 
             error?.message?.includes('koneksi') || 
             error?.message?.toLowerCase().includes('connection')) {
    return {
      message: 'Gangguan koneksi jaringan',
      type: 'network',
      suggestion: 'Periksa koneksi internet Anda dan coba lagi'
    };
  } else if (error instanceof Error) {
    // Standard JavaScript errors
    return {
      message: error.message,
      type: 'application',
      suggestion: 'Coba lakukan operasi kembali atau hubungi administrator'
    };
  }

  // Default case for unknown errors
  const errorMessage = typeof error === 'string' ? error : 'Terjadi kesalahan yang tidak diketahui';
  
  return {
    message: errorMessage,
    type: 'unknown',
    suggestion: 'Coba muat ulang aplikasi atau hubungi administrator'
  };
};

/**
 * Format error message for display
 * @param {Object|String} error - Error object or message
 * @returns {String} - Formatted error message
 */
export const formatErrorMessage = (error) => {
  if (!error) return '';
  
  // If it's a string, return it directly
  if (typeof error === 'string') return error;
  
  // If it's a database error that was processed
  if (error.message && error.suggestion) {
    return `${error.message}. ${error.suggestion}`;
  }
  
  // If it's a standard Error object
  if (error.message) return error.message;
  
  // Fallback
  return 'Terjadi kesalahan. Silakan coba lagi.';
};