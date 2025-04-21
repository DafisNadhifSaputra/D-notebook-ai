import React, { useState } from 'react';
import { Eye, EyeOff, Key, ExternalLink, X, AlertCircle } from 'lucide-react';
import { validateGeminiApiKey } from '../services/geminiService';
import { saveApiKey } from '../services/userSettingsService';
import './ApiKeyForm.css';

/**
 * Komponen Form API Key untuk Gemini AI
 * 
 * @param {string} initialApiKey - API Key yang sudah tersimpan (jika ada)
 * @param {function} onSaveApiKey - Callback saat API key disimpan
 * @param {function} onCancel - Callback saat form dibatalkan
 */
const ApiKeyForm = ({ initialApiKey = '', onSaveApiKey, onCancel }) => {
  const [apiKey, setApiKey] = useState(initialApiKey || '');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!apiKey.trim()) {
      setError('API Key tidak boleh kosong');
      return;
    }

    setIsValidating(true);
    setError('');

    try {
      // Validate API key
      await validateGeminiApiKey(apiKey);
      
      // Save API key to the database
      await saveApiKey(apiKey);
      
      // If successful, call callback
      if (onSaveApiKey) onSaveApiKey(apiKey);
    } catch (err) {
      console.error('Error validating/saving API key:', err);
      setError(err.message || 'API Key tidak valid');
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div className="api-key-form-card">
      <div className="form-header">
        <h2>
          <Key size={24} className="icon" />
          <span>Gemini API Key</span>
        </h2>
        <button 
          onClick={onCancel} 
          className="close-btn"
          aria-label="Tutup form"
        >
          <X size={20} />
        </button>
      </div>
      
      <div className="form-content">
        <p className="form-description">
          Untuk menggunakan aplikasi ini, Anda memerlukan Gemini API Key dari Google AI Studio.
          API Key Anda akan disimpan secara aman dan terenkripsi di database.
        </p>
        
        <a 
          href="https://ai.google.dev/tutorials/setup" 
          target="_blank" 
          rel="noopener noreferrer"
          className="api-key-link"
        >
          <ExternalLink size={14} />
          <span>Mendapatkan Gemini API Key</span>
        </a>

        {error && (
          <div className="api-key-error">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="apiKey" className="form-label">API Key</label>
            <div className="api-key-input-wrapper">
              <input
                type={showApiKey ? 'text' : 'password'}
                id="apiKey"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Masukkan Gemini API Key Anda"
                className="form-control"
                disabled={isValidating}
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="toggle-visibility-btn"
                aria-label={showApiKey ? 'Sembunyikan API key' : 'Tampilkan API key'}
              >
                {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div className="form-actions">
            <button
              type="button"
              onClick={onCancel}
              className="btn btn-secondary"
              disabled={isValidating || !initialApiKey}
            >
              {initialApiKey ? 'Batal' : 'Gunakan Nanti'}
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isValidating || !apiKey.trim()}
            >
              {isValidating ? (
                <>
                  <span className="loading-spinner"></span>
                  <span>Memvalidasi...</span>
                </>
              ) : (
                <span>Simpan API Key</span>
              )}
            </button>
          </div>
        </form>
        
        <div className="api-key-info">
          <p>
            <strong>Catatan:</strong> API Key Anda akan disimpan secara aman di database dan hanya digunakan untuk
            berkomunikasi dengan Gemini AI. Anda dapat mengubah API Key kapan saja melalui menu pengaturan.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ApiKeyForm;