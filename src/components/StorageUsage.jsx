import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Database, AlertCircle } from 'lucide-react';
import { getStorageUsage } from '../services/documentService';
import './StorageUsage.css';

const StorageUsage = ({ onStorageChange, onError, animateUpdate = false }) => {
  const [storageData, setStorageData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [error, setError] = useState(null);
  const [animateChange, setAnimateChange] = useState(false);
  const previousStorage = useRef(0);

  // Format byte size to human-readable format
  const formatSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Calculate percentage usage
  const calculatePercentage = (used, total) => {
    if (!total) return 0;
    return Math.min(Math.round((used / total) * 100), 100);
  };

  // Get progress bar color based on percentage
  const getProgressColor = (percentage) => {
    if (percentage < 70) return '';
    if (percentage < 90) return 'warning';
    return 'danger';
  };

  // Fetch storage data
  const fetchStorageUsage = useCallback(async () => {
    if (isInitialLoad) {
      setIsLoading(true);
    }
    setError(null);
    
    try {
      const data = await getStorageUsage();
      
      // Check if storage has changed to trigger animation
      if (previousStorage.current !== 0 && previousStorage.current !== data.usedStorage) {
        setAnimateChange(true);
        setTimeout(() => setAnimateChange(false), 2000); // Reset animation after 2 seconds
      }
      
      previousStorage.current = data.usedStorage;
      setStorageData(data);
      setIsInitialLoad(false);
      onStorageChange?.();
    } catch (err) {
      console.error('Failed to fetch storage usage:', err);
      setError('Gagal mengambil data penggunaan penyimpanan');
      onError?.('Gagal mengambil data penggunaan penyimpanan');
    } finally {
      setIsLoading(false);
    }
  }, [onStorageChange, onError, isInitialLoad]);

  // Load storage data on component mount
  useEffect(() => {
    fetchStorageUsage();
    
    // Create a refresh interval (every 30 seconds)
    const intervalId = setInterval(fetchStorageUsage, 30000);
    
    // Cleanup on unmount
    return () => clearInterval(intervalId);
  }, [fetchStorageUsage]);

  // Handle external animation triggers from props
  useEffect(() => {
    if (animateUpdate) {
      setAnimateChange(true);
      setTimeout(() => setAnimateChange(false), 2000);
    }
  }, [animateUpdate]);

  // Calculate storage percentage
  const percentage = storageData 
    ? calculatePercentage(storageData.usedStorage, storageData.totalStorage) 
    : 0;

  return (
    <div className={`minimal-storage-usage ${animateChange ? 'storage-updated' : ''}`}>
      <div className="storage-info">
        <div className="storage-title">
          <Database size={14} />
          <span>Penyimpanan</span>
          
          {/* Add refresh button */}
          <button 
            className="storage-refresh-btn" 
            onClick={fetchStorageUsage} 
            disabled={isLoading}
            title="Refresh penyimpanan"
          >
            <RefreshCw size={12} className={isLoading ? 'rotating' : ''} />
          </button>
        </div>
        <div className="storage-percent">{percentage}%</div>
      </div>
      <div className="storage-progress-container">
        <div 
          className={`storage-progress ${getProgressColor(percentage)}`} 
          style={{ width: `${percentage}%` }}
        ></div>
      </div>
      {error ? (
        <div className="storage-error-text">
          <AlertCircle size={12} />
          <span>{error}</span>
        </div>
      ) : (
        <div className="storage-details">
          {isLoading && isInitialLoad ? (
            <span>Memuat data...</span>
          ) : (
            <span>{formatSize(storageData?.usedStorage || 0)} dari {formatSize(storageData?.totalStorage || 0)}</span>
          )}
        </div>
      )}
    </div>
  );
};

export default StorageUsage;