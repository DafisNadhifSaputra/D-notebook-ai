import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { HelpCircle, X, Settings } from 'lucide-react';
import { saveAIConfig } from '../services/userSettingsService';

/**
 * Komponen untuk mengonfigurasi model Gemini AI
 * 
 * @param {Object} config - Konfigurasi awal
 * @param {Function} onSave - Callback saat konfigurasi disimpan
 * @param {Function} onCancel - Callback saat konfigurasi dibatalkan
 */
const AIConfigForm = ({ config = {}, onSave, onCancel }) => {
  const {
    temperature = 0.2,
    maxOutputTokens = 65536,
    topP = 0.95,
    topK = 64,
    model = 'gemini-2.0-flash', // Default now is gemini-2.0-flash
    responseStyle = 'balanced',
    showThinkingProcess = false
  } = config;

  const [localConfig, setLocalConfig] = useState({
    temperature,
    maxOutputTokens,
    topP,
    topK,
    model,
    responseStyle,
    showThinkingProcess
  });
  
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [activeTooltip, setActiveTooltip] = useState(null);

  // Model configurations with predefined settings - wrapped in useMemo
  const modelConfigs = useMemo(() => ({
    'gemini-1.5-flash': { 
      maxOutputTokens: 8192, 
      canShowThinking: false, 
      description: 'Model yang cepat dengan pemahaman yang baik - Gemini 1.5 Flash' 
    },
    'gemini-1.5-pro': { 
      maxOutputTokens: 8192, 
      canShowThinking: false, 
      description: 'Model dengan kemampuan penalaran lebih baik - Gemini 1.5 Pro' 
    },
    'gemini-2.0-flash': { 
      maxOutputTokens: 8192, 
      canShowThinking: false, 
      description: 'Model generasi 2.0 dengan kecepatan tinggi - Gemini 2.0 Flash' 
    },
    'gemini-2.5-flash-preview-04-17': { 
      maxOutputTokens: 65536, 
      canShowThinking: true, 
      description: 'Model terbaru dengan kecepatan tinggi dan jendela konteks besar - Gemini 2.5 Flash' 
    },
    'gemini-2.5-pro-preview-03-25': { 
      maxOutputTokens: 65536, 
      canShowThinking: true, 
      description: 'Model terbaru dengan kemampuan penalaran terbaik - Gemini 2.5 Pro' 
    }
  }), []);

  // Stable reference to the getModelConfig function
  const getModelConfig = useCallback((modelKey) => {
    return modelConfigs[modelKey];
  }, [modelConfigs]);

  // Update configs when model changes
  useEffect(() => {
    if (localConfig.model) {
      const modelConfig = getModelConfig(localConfig.model);
      
      if (modelConfig) {
        setLocalConfig(prev => {
          // Jika model tidak mendukung thinking process, matikan fitur tersebut
          const updatedThinkingProcess = modelConfig.canShowThinking ? prev.showThinkingProcess : false;
          
          return {
            ...prev,
            maxOutputTokens: modelConfig.maxOutputTokens,
            showThinkingProcess: updatedThinkingProcess
          };
        });
      }
    }
  }, [localConfig.model, getModelConfig]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    
    // Handle different input types
    const newValue = type === 'checkbox' ? checked : 
                     type === 'number' ? parseFloat(value) : 
                     value;
                     
    setLocalConfig(prev => ({
      ...prev,
      [name]: newValue
    }));
  };

  // Cek apakah model saat ini mendukung thinking process
  const canShowThinking = modelConfigs[localConfig.model]?.canShowThinking || false;

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setSaveError('');
      
      // Save configuration to database
      await saveAIConfig(localConfig);
      
      // Call the callback provided by parent component
      if (onSave) onSave(localConfig);
    } catch (err) {
      console.error('Error saving AI config:', err);
      setSaveError(err.message || 'Gagal menyimpan konfigurasi');
    } finally {
      setIsSaving(false);
    }
  };

  // Helper untuk menampilkan tooltip
  const Tooltip = ({ id, children }) => (
    <div className="tooltip">
      <HelpCircle 
        size={16} 
        onMouseEnter={() => setActiveTooltip(id)}
        onMouseLeave={() => setActiveTooltip(null)}
      />
      <div className={`tooltip-text ${activeTooltip === id ? 'visible' : ''}`}>
        {children}
      </div>
    </div>
  );

  // Format max tokens untuk tampilan
  const formatMaxTokens = (tokens) => {
    return tokens >= 10000 ? `${(tokens / 1000).toFixed(0)}K` : tokens.toLocaleString();
  };

  return (
    <div className="ai-config-panel">
      <div className="config-panel-header">
        <div className="config-panel-title">
          <Settings size={18} />
          <h3>Pengaturan AI</h3>
        </div>
        <button className="config-close-btn" onClick={onCancel} aria-label="Tutup">
          <X size={18} />
        </button>
      </div>

      <div className="config-panel-content">
        {/* Model selection */}
        <div className="config-group model-selection">
          <div className="config-label">
            <label htmlFor="model">Model AI</label>
            <Tooltip id="model">
              Pilih model AI yang akan digunakan. Setiap model memiliki karakteristik, kemampuan, dan batas token yang berbeda.
            </Tooltip>
          </div>
          <div className="model-options">
            {Object.keys(modelConfigs).map((modelKey) => (
              <div 
                key={modelKey}
                className={`model-option ${localConfig.model === modelKey ? 'selected' : ''}`}
                onClick={() => setLocalConfig(prev => ({ ...prev, model: modelKey }))}
              >
                <div className="model-option-inner">
                  <div className="model-radio">
                    <input 
                      type="radio" 
                      name="model" 
                      value={modelKey}
                      checked={localConfig.model === modelKey}
                      onChange={handleChange}
                      id={`model-${modelKey}`}
                    />
                    <span className="model-checkmark"></span>
                  </div>
                  <label htmlFor={`model-${modelKey}`}>
                    <span className="model-name">{modelKey.replace('gemini-', '').replace('-preview-04-17', '').replace('-preview-03-25', '')}</span>
                    <span className="model-description">{modelConfigs[modelKey].description}</span>
                    <div className="model-tags">
                      <span className="model-tag">Max tokens: {formatMaxTokens(modelConfigs[modelKey].maxOutputTokens)}</span>
                      {modelKey.includes('2.5') && <span className="model-tag highlight">Latest</span>}
                      {modelConfigs[modelKey].canShowThinking && 
                        <span className="model-tag feature">Thinking Process</span>
                      }
                    </div>
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="config-divider"></div>

        {/* Max output tokens */}
        <div className="config-group">
          <div className="config-label">
            <label htmlFor="maxOutputTokens">Token Maksimum: {localConfig.maxOutputTokens.toLocaleString()}</label>
            <Tooltip id="maxOutputTokens">
              Jumlah maksimum token (kata dan karakter) yang dapat dihasilkan dalam satu respons.
              Model Gemini 2.5 mendukung hingga 65K, sementara model lain terbatas pada 8K.
            </Tooltip>
          </div>
          <input 
            type="range" 
            id="maxOutputTokens" 
            name="maxOutputTokens" 
            min="1000" 
            max={modelConfigs[localConfig.model]?.maxOutputTokens || 8192} 
            step="1000" 
            value={localConfig.maxOutputTokens} 
            onChange={handleChange}
            className="range-slider"
          />
          <div className="range-labels">
            <span>1K</span>
            <span>{formatMaxTokens(modelConfigs[localConfig.model]?.maxOutputTokens || 8192)}</span>
          </div>
        </div>

        {/* Show thinking process - hanya ditampilkan jika model mendukung */}
        {canShowThinking && (
          <div className="config-group switch-group">
            <div className="config-label">
              <label htmlFor="showThinkingProcess">Tampilkan Proses Berpikir AI</label>
              <Tooltip id="showThinkingProcess">
                Jika diaktifkan, AI akan menunjukkan proses berpikir tahap demi tahap sebelum memberikan jawaban akhir.
                Fitur ini hanya tersedia pada model Gemini 2.5.
              </Tooltip>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                id="showThinkingProcess"
                name="showThinkingProcess"
                checked={localConfig.showThinkingProcess}
                onChange={handleChange}
                disabled={!canShowThinking}
              />
              <span className="slider round"></span>
              <span className="switch-label">{localConfig.showThinkingProcess ? 'Aktif' : 'Nonaktif'}</span>
            </label>
          </div>
        )}

        {/* Temperature slider - simplified */}
        <div className="config-group">
          <div className="config-label">
            <label htmlFor="temperature">Kreativitas: {localConfig.temperature === 0 ? 'Sangat Presisi' : localConfig.temperature < 0.3 ? 'Presisi' : localConfig.temperature < 0.7 ? 'Seimbang' : 'Kreatif'}</label>
            <Tooltip id="temperature">
              Mengontrol kreativitas dan variasi respons. Nilai rendah untuk jawaban yang lebih konsisten, nilai tinggi untuk jawaban yang lebih kreatif.
            </Tooltip>
          </div>
          <input 
            type="range" 
            id="temperature" 
            name="temperature" 
            min="0" 
            max="1" 
            step="0.1" 
            value={localConfig.temperature} 
            onChange={handleChange}
            className="range-slider"
          />
          <div className="range-labels">
            <span>Presisi</span>
            <span>Kreativitas</span>
          </div>
        </div>
      </div>

      <div className="config-panel-footer">
        <button className="btn btn-secondary" onClick={onCancel}>Batal</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>
          {isSaving ? 'Menyimpan...' : 'Simpan Pengaturan'}
        </button>
        {saveError && <div className="save-error">{saveError}</div>}
      </div>

      <style jsx>{`
        .ai-config-panel {
          display: flex;
          flex-direction: column;
          background: var(--bg-primary);
          border-radius: 12px;
          overflow: hidden;
          width: 100%;
          max-width: 550px;
          max-height: 90vh; /* Increased from 70vh to 90vh */
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
          color: var(--text-primary);
        }

        [data-theme="dark"] .ai-config-panel {
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
        }

        .config-panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-color);
          background-color: var(--bg-secondary);
          flex-shrink: 0; /* Prevent header from shrinking */
        }

        .config-panel-title {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
        }

        .config-close-btn {
          background: transparent;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .config-close-btn:hover {
          background-color: var(--bg-hover);
          color: var(--text-primary);
        }

        .config-panel-content {
          flex: 1;
          padding: 20px;
          overflow-y: auto; /* Enable scrolling */
          overflow-x: hidden;
          display: flex;
          flex-direction: column;
          gap: 24px;
          -webkit-overflow-scrolling: touch; /* Better scrolling on iOS */
        }

        .config-group {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .config-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-weight: 500;
          font-size: 15px;
        }

        .tooltip {
          position: relative;
          display: flex;
          color: var(--text-light);
        }

        .tooltip-text {
          visibility: hidden;
          position: absolute;
          top: calc(100% + 5px);
          left: 50%;
          transform: translateX(-50%);
          background-color: var(--bg-secondary);
          color: var(--text-primary);
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 12px;
          width: 240px;
          z-index: 100;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
          opacity: 0;
          transition: opacity 0.2s, visibility 0.2s;
          text-align: center;
          pointer-events: none;
          border: 1px solid var(--border-color);
        }

        .tooltip-text.visible {
          visibility: visible;
          opacity: 1;
        }

        .range-slider {
          -webkit-appearance: none;
          width: 100%;
          height: 6px;
          border-radius: 3px;
          background: linear-gradient(to right, #3b82f6 0%, #8b5cf6 100%);
          outline: none;
          transition: all 0.2s;
        }

        .range-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #6366f1;
          box-shadow: 0 2px 4px rgba(99, 102, 241, 0.3);
          cursor: pointer;
          transition: all 0.2s;
        }

        .range-slider::-webkit-slider-thumb:hover {
          transform: scale(1.1);
        }

        .range-labels {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          color: var(--text-light);
          margin-top: 4px;
        }

        .config-panel-footer {
          padding: 16px 20px;
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          border-top: 1px solid var(--border-color);
          background-color: var(--bg-secondary);
          flex-shrink: 0; /* Prevent footer from shrinking */
          position: sticky;
          bottom: 0;
          width: 100%;
          z-index: 10;
        }

        .save-error {
          color: var(--error-color);
          font-size: 14px;
          margin-right: auto;
        }

        .btn {
          padding: 8px 16px;
          border-radius: 6px;
          font-weight: 500;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid transparent;
        }

        .btn-primary {
          background-color: var(--primary-color);
          color: white;
        }

        .btn-primary:hover {
          background-color: var(--primary-hover);
          transform: translateY(-1px);
        }

        .btn-primary:disabled {
          opacity: 0.7;
          cursor: not-allowed;
          transform: none;
        }

        .btn-secondary {
          background-color: transparent;
          border-color: var(--border-color);
          color: var(--text-primary);
        }

        .btn-secondary:hover {
          background-color: var(--bg-secondary);
        }

        .switch-group {
          display: flex;
          flex-direction: row;
          justify-content: space-between;
          align-items: center;
        }

        .switch {
          position: relative;
          display: inline-block;
          width: 50px;
          height: 24px;
          margin-left: auto;
        }

        .switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }

        .slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: #ccc;
          transition: .3s;
          border-radius: 24px;
        }

        .slider:before {
          position: absolute;
          content: "";
          height: 18px;
          width: 18px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: .3s;
          border-radius: 50%;
        }

        input:checked + .slider {
          background-color: var(--primary-color);
        }

        input:disabled + .slider {
          background-color: #ccc;
          opacity: 0.5;
          cursor: not-allowed;
        }

        input:checked + .slider:before {
          transform: translateX(26px);
        }

        .switch-label {
          margin-left: 60px;
          font-size: 13px;
          color: var(--text-light);
        }

        /* Model selection styling */
        .model-selection {
          margin-bottom: 10px;
        }

        .model-options {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 12px;
        }

        .model-option {
          border: 1px solid var(--border-color);
          border-radius: 10px;
          padding: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
          position: relative;
        }

        .model-option:hover {
          border-color: var(--primary-color);
          background-color: rgba(var(--primary-color-rgb), 0.05);
        }

        .model-option.selected {
          border-color: var(--primary-color);
          background-color: rgba(var(--primary-color-rgb), 0.08);
        }

        .model-option-inner {
          display: flex;
          gap: 10px;
          align-items: flex-start;
        }

        .model-radio {
          margin-top: 2px;
        }

        .model-radio input[type="radio"] {
          position: absolute;
          opacity: 0;
          cursor: pointer;
        }

        .model-checkmark {
          height: 20px;
          width: 20px;
          background-color: #eee;
          border-radius: 50%;
          display: block;
          position: relative;
          border: 1px solid var(--border-color);
        }

        input[type="radio"]:checked ~ .model-checkmark {
          background-color: var(--primary-color);
          border-color: var(--primary-color);
        }

        .model-checkmark:after {
          content: "";
          position: absolute;
          display: none;
          top: 6px;
          left: 6px;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: white;
        }

        input[type="radio"]:checked ~ .model-checkmark:after {
          display: block;
        }

        .model-option label {
          display: flex;
          flex-direction: column;
          gap: 4px;
          cursor: pointer;
          flex: 1;
          padding-top: 2px;
        }

        .model-name {
          font-weight: 600;
          font-size: 15px;
          color: var(--text-primary);
        }

        .model-description {
          font-size: 13px;
          color: var(--text-secondary);
          line-height: 1.4;
        }

        .model-tags {
          display: flex;
          gap: 8px;
          margin-top: 6px;
          flex-wrap: wrap;
        }

        .model-tag {
          padding: 4px 8px;
          background-color: rgba(var(--primary-color-rgb), 0.1);
          color: var(--primary-color);
          border-radius: 12px;
          font-size: 11px;
          font-weight: 500;
        }

        .model-tag.highlight {
          background-color: var(--primary-color);
          color: white;
        }
        
        .model-tag.feature {
          background-color: #10b981;
          color: white;
        }

        .config-divider {
          height: 1px;
          background-color: var(--border-color);
          margin: 8px 0;
          opacity: 0.6;
        }

        @media (max-width: 576px) {
          .ai-config-panel {
            width: 95%;
            max-height: 85vh; /* Slightly smaller on mobile */
            margin: 0 auto;
          }
          
          .config-panel-content {
            padding: 16px;
            max-height: none; /* Remove fixed height on mobile */
          }
          
          .model-option {
            padding: 10px;
          }
          
          .model-name {
            font-size: 14px;
          }
          
          .model-description {
            font-size: 12px;
          }

          /* Make sure footer is always visible */
          .config-panel-footer {
            position: sticky;
            bottom: 0;
            box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.1);
          }
        }
      `}</style>
    </div>
  );
};

export default AIConfigForm;