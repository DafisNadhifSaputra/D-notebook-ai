import React, { useState, useEffect } from 'react';
import { Share2, Globe, Users, Lock, Check } from 'lucide-react';
import { shareDocument, setDocumentPublic, getUserDocuments } from '../services/documentService';

/**
 * Component for sharing documents with other users
 */
const DocumentSharing = ({ onClose }) => {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [shareEmails, setShareEmails] = useState('');
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [shareSuccess, setShareSuccess] = useState(false);

  // Load user's documents on mount
  useEffect(() => {
    const fetchDocuments = async () => {
      try {
        setLoading(true);
        const userDocs = await getUserDocuments();
        setDocuments(userDocs);
      } catch (err) {
        console.error('Error fetching documents:', err);
        setError('Gagal memuat dokumen: ' + err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchDocuments();
  }, []);

  // Handle document selection
  const handleSelectDocument = (docId) => {
    setSelectedDocId(docId);
    setShareSuccess(false); // Reset success state
  };

  // Handle document sharing
  const handleShareDocument = async () => {
    if (!selectedDocId) {
      setError('Pilih dokumen terlebih dahulu');
      return;
    }

    if (!shareEmails.trim()) {
      setError('Masukkan minimal satu email');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Split emails by comma, semicolon, or newline and trim whitespace
      const emails = shareEmails
        .split(/[,;\n]/)
        .map(email => email.trim())
        .filter(email => email.length > 0);

      // Basic email validation
      const invalidEmails = emails.filter(email => !validateEmail(email));
      if (invalidEmails.length > 0) {
        setError(`Email tidak valid: ${invalidEmails.join(', ')}`);
        setLoading(false);
        return;
      }

      // Share document with emails
      await shareDocument(selectedDocId, emails);
      setShareSuccess(true);
      
      // Update documents list to reflect sharing status
      const updatedDocs = await getUserDocuments();
      setDocuments(updatedDocs);
    } catch (err) {
      console.error('Error sharing document:', err);
      setError('Gagal membagikan dokumen: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Handle making document public/private
  const handleTogglePublic = async (docId, makePublic) => {
    try {
      setLoading(true);
      setError(null);

      await setDocumentPublic(docId, makePublic);
      
      // Update documents list to reflect public status
      const updatedDocs = await getUserDocuments();
      setDocuments(updatedDocs);
      
      setShareSuccess(true);
      setTimeout(() => setShareSuccess(false), 3000);
    } catch (err) {
      console.error('Error setting document public status:', err);
      setError('Gagal mengubah status dokumen: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Basic email validation
  const validateEmail = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  return (
    <div className="document-sharing-dialog">
      <div className="document-sharing-header">
        <h2>
          <Share2 size={18} />
          <span>Bagikan Dokumen</span>
        </h2>
        <button className="close-button" onClick={onClose}>×</button>
      </div>

      <div className="document-sharing-content">
        {error && (
          <div className="error-message">
            {error}
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}

        {shareSuccess && (
          <div className="success-message">
            <Check size={16} />
            <span>Dokumen berhasil dibagikan!</span>
          </div>
        )}

        <div className="document-list">
          <h3>Pilih Dokumen</h3>
          {loading && <div className="loading-indicator">Memuat dokumen...</div>}
          
          {!loading && documents.length === 0 && (
            <div className="no-documents">
              Tidak ada dokumen yang tersedia untuk dibagikan.
            </div>
          )}

          <ul>
            {documents.map(doc => (
              <li 
                key={doc.id} 
                className={selectedDocId === doc.id ? 'selected' : ''}
                onClick={() => handleSelectDocument(doc.id)}
              >
                <div className="document-info">
                  <div className="document-title">{doc.title}</div>
                  <div className="document-date">{new Date(doc.created_at).toLocaleDateString()}</div>
                </div>
                
                <div className="document-status">
                  {doc.is_public ? (
                    <Globe size={16} className="public-icon" title="Publik" />
                  ) : doc.is_shared ? (
                    <Users size={16} className="shared-icon" title="Dibagikan" />
                  ) : (
                    <Lock size={16} className="private-icon" title="Pribadi" />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {selectedDocId && (
          <div className="sharing-options">
            <div className="toggle-public">
              <h3>Status Akses</h3>
              <div className="toggle-buttons">
                <button 
                  className="public-button"
                  onClick={() => handleTogglePublic(selectedDocId, true)}
                  disabled={loading || documents.find(d => d.id === selectedDocId)?.is_public}
                >
                  <Globe size={16} />
                  <span>Publik</span>
                </button>
                <button 
                  className="private-button"
                  onClick={() => handleTogglePublic(selectedDocId, false)}
                  disabled={loading || !documents.find(d => d.id === selectedDocId)?.is_public}
                >
                  <Lock size={16} />
                  <span>Pribadi</span>
                </button>
              </div>
              <p className="help-text">
                Dokumen publik dapat dilihat oleh semua pengguna D'Notebook AI.
              </p>
            </div>

            <div className="share-with-users">
              <h3>Bagikan Dengan Pengguna</h3>
              <textarea
                placeholder="Masukkan email penerima (pisahkan dengan koma atau baris baru)"
                value={shareEmails}
                onChange={e => setShareEmails(e.target.value)}
                disabled={loading}
              />
              <button 
                className="share-button"
                onClick={handleShareDocument}
                disabled={loading || !shareEmails.trim()}
              >
                <Share2 size={16} />
                <span>Bagikan</span>
              </button>
              <p className="help-text">
                Dokumen akan dibagikan hanya dengan pengguna yang Anda tentukan.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DocumentSharing;