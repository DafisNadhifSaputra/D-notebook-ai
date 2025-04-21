import React, { useState, useEffect } from 'react';
import { FileText, X, Trash2, AlertCircle, RefreshCw } from 'lucide-react';

const DocumentContext = ({ 
  documents = [], 
  onRemoveDocument, 
  onRefreshDocuments,
  isLoading = false,
  currentConversationId,
  onError
}) => {
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [documentState, setDocumentState] = useState({
    isLoading: isLoading,
    documents: documents
  });
  
  // Sync with parent component's document state
  useEffect(() => {
    setDocumentState(prev => ({
      ...prev,
      documents: documents,
      isLoading: isLoading
    }));
  }, [documents, isLoading]);
  
  // Effect to fetch documents when conversation changes
  useEffect(() => {
    const fetchConversationDocuments = async () => {
      if (!currentConversationId) return;
      
      try {
        setDocumentState(prev => ({ ...prev, isLoading: true }));
        // This will fetch documents from the database if they're not already loaded
        if (typeof onRefreshDocuments === 'function') {
          await onRefreshDocuments(currentConversationId);
        }
      } catch (error) {
        console.error("Error fetching conversation documents:", error);
        if (onError) onError("Gagal memuat dokumen: " + error.message);
      } finally {
        setDocumentState(prev => ({ ...prev, isLoading: false }));
      }
    };
    
    fetchConversationDocuments();
  }, [currentConversationId, onRefreshDocuments, onError]);
  
  // Format bytes to human-readable size
  const formatBytes = (bytes, decimals = 1) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  // Handle document removal
  const handleRemove = (documentId) => {
    if (confirmDelete === documentId) {
      // Actually remove the document
      onRemoveDocument(documentId);
      setConfirmDelete(null);
    } else {
      // Ask for confirmation
      setConfirmDelete(documentId);
      // Auto-reset confirm state after 3 seconds
      setTimeout(() => setConfirmDelete(null), 3000);
    }
  };

  // Handle refresh documents manually
  const handleRefresh = () => {
    if (typeof onRefreshDocuments === 'function' && currentConversationId) {
      setDocumentState(prev => ({ ...prev, isLoading: true }));
      onRefreshDocuments(currentConversationId)
        .catch(error => {
          console.error("Error refreshing documents:", error);
          if (onError) onError("Gagal merefresh dokumen: " + error.message);
        })
        .finally(() => {
          setDocumentState(prev => ({ ...prev, isLoading: false }));
        });
    }
  };

  if (documentState.isLoading) {
    return (
      <div className="document-context-loading">
        <span>Memuat dokumen...</span>
      </div>
    );
  }

  if (!currentConversationId) {
    return (
      <div className="document-context-empty">
        <AlertCircle size={14} />
        <span>Pilih percakapan terlebih dahulu untuk melihat dokumen yang terkait.</span>
      </div>
    );
  }

  if (documentState.documents.length === 0) {
    return (
      <div className="document-context-empty">
        <FileText size={14} />
        <span>Tidak ada dokumen yang terkait dengan percakapan ini.</span>
        <button 
          onClick={handleRefresh} 
          className="refresh-documents-btn"
          title="Refresh dokumen"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="document-context">
      <div className="document-context-header">
        <h3 className="document-context-title">Dokumen Terkait</h3>
        <button 
          onClick={handleRefresh} 
          className="refresh-documents-btn"
          title="Refresh dokumen"
        >
          <RefreshCw size={14} />
        </button>
      </div>
      <ul className="document-list">
        {documentState.documents.map((doc) => (
          <li key={doc.id} className="document-item">
            <div className="document-info">
              <div className="document-name">
                <FileText size={14} />
                {doc.title || "Dokumen tanpa judul"}
              </div>
              <div className="document-size">
                {formatBytes(doc.file_size)} &bull; {doc.metadata?.pageCount || 1} halaman
              </div>
            </div>
            <button
              className="document-remove-btn"
              onClick={() => handleRemove(doc.id)}
              title={confirmDelete === doc.id ? "Klik untuk konfirmasi" : "Hapus dokumen dari percakapan"}
            >
              {confirmDelete === doc.id ? (
                <Trash2 size={16} className="confirm-delete" />
              ) : (
                <X size={16} />
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default DocumentContext;