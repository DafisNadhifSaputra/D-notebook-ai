import React, { useState, useEffect } from 'react';
import { AlertTriangle, X, Database, HardDrive } from 'lucide-react';
import './ErrorMessage.css';
import { formatErrorMessage } from '../utils/errorUtils';

/**
 * Komponen untuk menampilkan pesan error dengan animasi dan auto-dismiss
 * 
 * @param {string|object} error - Pesan error atau objek error yang akan ditampilkan
 * @param {function} onClose - Callback untuk menutup pesan error
 * @param {number} autoHideMs - Waktu dalam milidetik untuk otomatis menyembunyikan pesan (0 untuk tidak auto-hide)
 */
const ErrorMessage = ({ error, onClose, autoHideMs = 5000 }) => {
  const [isVisible, setIsVisible] = useState(true);
  const [progress, setProgress] = useState(100);
  
  // Parse error object
  const errorObj = typeof error === 'string' ? { message: error } : error || {};
  const message = formatErrorMessage(error);
  
  // Set up auto-hide timer if autoHideMs > 0
  useEffect(() => {
    let progressInterval;
    let hideTimeout;
    
    if (autoHideMs > 0) {
      const startTime = Date.now();
      const updateInterval = 16; // ~60fps
      
      progressInterval = setInterval(() => {
        const elapsedTime = Date.now() - startTime;
        const remainingPercent = Math.max(0, 100 - (elapsedTime / autoHideMs * 100));
        setProgress(remainingPercent);
      }, updateInterval);
      
      hideTimeout = setTimeout(() => {
        setIsVisible(false);
        setTimeout(() => {
          if (onClose) onClose();
        }, 300); // Animation time
      }, autoHideMs);
    }
    
    return () => {
      clearInterval(progressInterval);
      clearTimeout(hideTimeout);
    };
  }, [autoHideMs, onClose]);
  
  // Handle manual close
  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => {
      if (onClose) onClose();
    }, 300); // Animation time
  };
  
  if (!error) return null;
  
  const getErrorIcon = () => {
    if (errorObj.type === 'memory_limit') return <HardDrive size={20} />; // Changed Memory to HardDrive
    if (errorObj.type === 'database') return <Database size={20} />;
    return <AlertTriangle size={20} />;
  };
  
  return (
    <div className={`error-message-container ${isVisible ? 'visible' : 'hiding'}`}>
      <div className={`error-message ${errorObj.type ? `error-type-${errorObj.type}` : ''}`}>
        <div className="error-icon">
          {getErrorIcon()}
        </div>
        <div className="error-content">
          <p>{message}</p>
          {errorObj.suggestion && <p className="error-suggestion">{errorObj.suggestion}</p>}
          {errorObj.isMemoryError && (
            <div className="memory-error-details">
              <div className="memory-bar">
                <div 
                  className="memory-available" 
                  style={{ width: `${(errorObj.allocatedMemory / errorObj.requiredMemory) * 100}%` }}
                >
                  {errorObj.allocatedMemory} MB
                </div>
                <div className="memory-required">{errorObj.requiredMemory} MB</div>
              </div>
            </div>
          )}
        </div>
        <button className="error-close" onClick={handleClose}>
          <X size={18} />
        </button>
      </div>
      {autoHideMs > 0 && (
        <div className="error-progress-bar">
          <div className="error-progress" style={{ width: `${progress}%` }}></div>
        </div>
      )}
    </div>
  );
};

export default ErrorMessage;