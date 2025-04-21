import React, { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { id } from 'date-fns/locale';
import { FileText, Trash2, X, AlertCircle } from 'lucide-react';
import DocumentContext from './DocumentContext';

/**
 * Komponen untuk menampilkan riwayat percakapan dan memungkinkan pengguna
 * memilih atau menghapus percakapan, serta mengelola dokumen konteksnya.
 * 
 * @param {Array} conversations - Array percakapan dari Supabase
 * @param {string} activeConversationId - ID percakapan yang sedang aktif
 * @param {function} onSelectConversation - Fungsi untuk memilih percakapan
 * @param {function} onDeleteConversation - Fungsi untuk menghapus percakapan
 * @param {boolean} isLoading - Menunjukkan apakah sedang loading
 * @param {function} onDocumentDeleted - Callback setelah dokumen dihapus
 */
const ChatHistory = ({ 
  conversations, 
  activeConversationId, 
  onSelectConversation, 
  onDeleteConversation,
  isLoading,
  onDocumentDeleted
}) => {
  const [showDocumentContext, setShowDocumentContext] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [conversationToDelete, setConversationToDelete] = useState(null);
  const [deleteDocumentsToo, setDeleteDocumentsToo] = useState(false);

  // Format tanggal untuk ditampilkan
  const formatDate = (dateString) => {
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) {
        return 'Invalid date';
      }
      return formatDistanceToNow(date, { addSuffix: true, locale: id });
    } catch (error) {
      console.error('Error formatting date:', error);
      return 'Invalid date';
    }
  };

  // Truncate title jika terlalu panjang
  const truncateTitle = (title, maxLength = 25) => {
    if (!title) return 'Percakapan Baru';
    return title.length > maxLength 
      ? `${title.substring(0, maxLength)}...` 
      : title;
  };

  // Open document context modal
  const openDocumentContext = (conversation, e) => {
    e.stopPropagation();
    setSelectedConversation(conversation);
    setShowDocumentContext(true);
  };

  // Handle document deletion from context
  const handleDocumentDeleted = (docId) => {
    if (onDocumentDeleted) {
      onDocumentDeleted(docId, selectedConversation.id);
    }
  };

  // Open delete confirmation dialog
  const handleDeleteClick = (conversation, e) => {
    e.stopPropagation();
    setConversationToDelete(conversation);
    setDeleteDocumentsToo(false);
    setShowDeleteConfirmation(true);
  };

  // Confirm deletion of conversation
  const confirmDelete = () => {
    if (conversationToDelete) {
      onDeleteConversation(conversationToDelete.id, deleteDocumentsToo);
      setShowDeleteConfirmation(false);
      setConversationToDelete(null);
    }
  };

  // Cek apakah percakapan kosong
  if (!conversations || conversations.length === 0) {
    return (
      <div className="conversation-history">
        <h4>Riwayat Percakapan</h4>
        <p className="text-muted">Belum ada percakapan.</p>
      </div>
    );
  }

  return (
    <div className="conversation-history">
      <h4>Riwayat Percakapan</h4>
      <ul className="conversation-list">
        {isLoading ? (
          <li className="loading">
            <div className="conversation-loading">Memuat...</div>
          </li>
        ) : (
          conversations.map(conv => (
            <li 
              key={conv.id} 
              className={activeConversationId === conv.id ? 'active' : ''}
            >
              <div className="conversation-item">
                <button 
                  className="conversation-select"
                  onClick={() => onSelectConversation(conv.id)}
                >
                  <div className="conversation-title">
                    {truncateTitle(conv.title)}
                  </div>
                  <div className="conversation-date">
                    {formatDate(conv.created_at)}
                  </div>
                  
                  {/* Document indicator */}
                  {conv.documents && conv.documents.length > 0 && (
                    <div className="conversation-docs">
                      <div className="document-badge">
                        <FileText size={8} className="document-badge-icon" />
                        <span>{conv.documents.length}</span>
                      </div>
                      <span 
                        className="conversation-manage"
                        onClick={(e) => openDocumentContext(conv, e)}
                      >
                        Kelola
                      </span>
                    </div>
                  )}
                </button>
                <button 
                  className="conversation-delete" 
                  onClick={(e) => handleDeleteClick(conv, e)}
                  aria-label="Hapus percakapan"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
      
      {/* Document Context Modal */}
      {showDocumentContext && selectedConversation && (
        <div className="modal-overlay" onClick={() => setShowDocumentContext(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <DocumentContext 
              conversationId={selectedConversation.id}
              documents={selectedConversation.documents}
              onClose={() => setShowDocumentContext(false)}
              onDocumentDeleted={handleDocumentDeleted}
            />
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirmation && conversationToDelete && (
        <div className="modal-overlay">
          <div className="delete-confirmation-modal">
            <div className="delete-modal-header">
              <h3>
                <AlertCircle size={20} className="alert-icon" />
                Konfirmasi Penghapusan
              </h3>
              <button 
                className="close-modal-btn" 
                onClick={() => setShowDeleteConfirmation(false)}
                aria-label="Tutup"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="delete-modal-body">
              <p>
                Apakah Anda yakin ingin menghapus percakapan 
                <strong> "{truncateTitle(conversationToDelete.title)}"</strong>?
              </p>
              
              {conversationToDelete.documents && conversationToDelete.documents.length > 0 && (
                <div className="document-delete-option">
                  <label className="checkbox-container">
                    <input
                      type="checkbox"
                      checked={deleteDocumentsToo}
                      onChange={() => setDeleteDocumentsToo(!deleteDocumentsToo)}
                    />
                    <span className="checkbox-label">
                      Hapus juga {conversationToDelete.documents.length} dokumen yang terkait dengan percakapan ini
                    </span>
                  </label>
                  <p className="storage-note">
                    <small>
                      {deleteDocumentsToo ? 
                        "Ini akan menghemat ruang penyimpanan, tetapi dokumen tidak akan tersedia untuk percakapan lain." : 
                        "Dokumen akan tetap tersimpan dan dapat digunakan dalam percakapan lain."
                      }
                    </small>
                  </p>
                </div>
              )}
            </div>
            
            <div className="delete-modal-footer">
              <button 
                className="btn btn-secondary" 
                onClick={() => setShowDeleteConfirmation(false)}
              >
                Batal
              </button>
              <button 
                className="btn btn-danger" 
                onClick={confirmDelete}
              >
                {deleteDocumentsToo ? 'Hapus Percakapan & Dokumen' : 'Hapus Percakapan'}
              </button>
            </div>
          </div>
        </div>
      )}
      
      <style jsx>{`
        .delete-confirmation-modal {
          background-color: var(--bg-primary);
          border-radius: 10px;
          padding: 0;
          width: 90%;
          max-width: 500px;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
          z-index: 1000;
          overflow: hidden;
        }
        
        .delete-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 15px 20px;
          border-bottom: 1px solid var(--border-color);
          background-color: var(--bg-secondary);
        }
        
        .delete-modal-header h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .alert-icon {
          color: var(--danger-color);
        }
        
        .close-modal-btn {
          background: none;
          border: none;
          cursor: pointer;
          padding: 5px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-secondary);
          border-radius: 4px;
        }
        
        .close-modal-btn:hover {
          background-color: var(--hover-bg);
          color: var(--text-primary);
        }
        
        .delete-modal-body {
          padding: 20px;
        }
        
        .document-delete-option {
          margin-top: 15px;
          padding: 12px;
          background-color: var(--bg-secondary);
          border-radius: 8px;
        }
        
        .checkbox-container {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          cursor: pointer;
        }
        
        .checkbox-container input {
          margin-top: 3px;
        }
        
        .checkbox-label {
          font-weight: 500;
        }
        
        .storage-note {
          margin: 8px 0 0 24px;
          color: var(--text-secondary);
        }
        
        .delete-modal-footer {
          padding: 15px 20px;
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          border-top: 1px solid var(--border-color);
          background-color: var(--bg-secondary);
        }
        
        .btn {
          padding: 8px 16px;
          border-radius: 6px;
          border: none;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .btn-secondary {
          background-color: var(--button-secondary-bg);
          color: var(--text-primary);
          border: 1px solid var(--border-color);
        }
        
        .btn-danger {
          background-color: var(--danger-color);
          color: white;
        }
        
        .btn-secondary:hover {
          background-color: var(--button-secondary-hover);
        }
        
        .btn-danger:hover {
          background-color: var(--danger-hover-color);
        }
        
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          backdrop-filter: blur(4px);
        }
        
        .modal-content {
          background-color: var(--bg-primary);
          border-radius: 10px;
          width: 90%;
          max-width: 600px;
          max-height: 80vh;
          overflow: auto;
        }
      `}</style>
    </div>
  );
};

export default ChatHistory;