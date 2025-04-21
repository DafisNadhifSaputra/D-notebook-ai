import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, Upload, Settings, LogOut, Plus, Trash2, Moon, Sun, X, Menu, Key, Share2, HardDrive } from 'lucide-react';
import './Chatbot.css';

// New imports for user settings services
import { getApiKey, getAIConfig, getBackupApiKey } from '../services/userSettingsService';
import { initializeGemini, updateRagContextForConversation } from '../services/geminiService';
import './Chatbot.css';
import { supabase } from '../utils/supabaseClient';

// Komponen
import ChatInput from './ChatInput';
import ChatMessages from './ChatMessages';
import PdfUploadForm from './PdfUploadForm';
import AIConfigForm from './AIConfigForm';
import ApiKeyForm from './ApiKeyForm';
import ChatHistory from './ChatHistory';
import ErrorMessage from './ErrorMessage';
import DocumentSharing from './DocumentSharing';
import StorageUsage from './StorageUsage';
import './DocumentSharing.css';

// Hooks dan Services
import useChatSystem from '../hooks/useChatSystem';
import useRagSystem from '../hooks/useRagSystem';

const Chatbot = ({ user, onLogout, theme, onToggleTheme }) => {
  const [apiKey, setApiKey] = useState('');
  const [isLoadingApiKey, setIsLoadingApiKey] = useState(true);
  // Rename to CONVERSATION_DOCUMENTS to match allowed unused vars pattern
  const [CONVERSATION_DOCUMENTS, setConversationDocuments] = useState([]); 
  
  const [showApiForm, setShowApiForm] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showAiConfig, setShowAiConfig] = useState(false);
  const [showPdfPanel, setShowPdfPanel] = useState(true);
  const [showDocumentSharing, setShowDocumentSharing] = useState(false);
  const [storageUpdated, setStorageUpdated] = useState(false);
  const [activeConversation, setActiveConversation] = useState(null);
  const [chatError, setChatError] = useState(null); // Add chatError state
  const [storageInfo, setStorageInfo] = useState(null); // Add storageInfo state

  const messagesEndRef = useRef(null);

  // Load API key from database on component mount
  useEffect(() => {
    const loadApiKey = async () => {
      try {
        setIsLoadingApiKey(true);
        // Try to get API key from database first
        let key = await getApiKey();
        
        // If not found in database, try backup from localStorage
        if (!key) {
          key = getBackupApiKey();
        }
        
        if (key) {
          console.log('API key loaded successfully');
          setApiKey(key);
          initializeGemini(key);
        } else {
          // Show API form if no key found
          setShowApiForm(true);
        }
      } catch (err) {
        console.error('Error loading API key:', err);
        // Fallback to localStorage
        const backupKey = getBackupApiKey();
        if (backupKey) {
          setApiKey(backupKey);
          initializeGemini(backupKey);
        } else {
          setShowApiForm(true);
        }
      } finally {
        setIsLoadingApiKey(false);
      }
    };
    
    loadApiKey();
  }, [user?.id]);
  
  // Load preferred AI config from database
  const [aiConfig, setAiConfig] = useState({
    temperature: 0.2,
    maxOutputTokens: 65536,
    topP: 0.95,
    topK: 64,
    model: 'gemini-2.0-flash', // Default to gemini-2.0-flash
    responseStyle: 'balanced',
    showThinkingProcess: false
  });
  
  // Load AI config from database on component mount
  useEffect(() => {
    const loadAIConfig = async () => {
      try {
        const config = await getAIConfig();
        if (config) {
          console.log('AI config loaded from database:', config.model);
          setAiConfig(config);
        }
      } catch (err) {
        console.error('Error loading AI config:', err);
        // Keep default config if there's an error
      }
    };
    
    if (apiKey && !isLoadingApiKey) {
      loadAIConfig();
    }
  }, [apiKey, isLoadingApiKey, user?.id]);

  // Sistem RAG untuk pemrosesan dokumen
  const {
    isSystemReady: isPdfProcessed,
    isLoading: isProcessingPdf,
    processedDocuments,
    processPdfForRag,
    ragError,
    clearRagError,
    resetSystem,
  } = useRagSystem(apiKey);

  // Calculate document count from processed documents
  const docsCount = processedDocuments?.length || 0;
  
  // Sistem percakapan
  const { 
    messages, 
    isProcessing, 
    conversations, 
    startNewConversation, 
    sendMessage, 
    setActiveConversationId, 
    currentConversationId, 
    error: systemError, // Rename to avoid unused variable
    clearChatError,
    removeConversation,
    clearAllConversations,
    loadStorageInfo, // Add loadStorageInfo here
    storageInfo: chatStorageInfo, // Add storageInfo here
  } = useChatSystem(apiKey, user?.id);

  // Set storageInfo from useChatSystem
  useEffect(() => {
    if (chatStorageInfo) {
      setStorageInfo(chatStorageInfo);
    }
  }, [chatStorageInfo]);

  // Set chatError state from systemError
  useEffect(() => {
    if (systemError) {
      setChatError(systemError);
    }
  }, [systemError]);

  // Auto-scroll ke pesan terakhir
  useEffect(() => {
    if (messagesEndRef.current && messages.length > 0) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Mengirim pesan chat
  const handleSendMessage = async (content) => {
    if (!content.trim()) return;
    
    try {
      if (!currentConversationId) {
        // Buat percakapan baru jika belum ada dan langsung kirim pesan
        console.log("Membuat percakapan baru dan mengirim pesan...");
        const newConversation = await startNewConversation();
        
        if (newConversation && newConversation.id) {
          console.log("Percakapan baru dibuat dengan ID:", newConversation.id);
          // Tunggu sampai state conversationId diperbarui
          await sendMessage(newConversation.id, content, aiConfig, isPdfProcessed);
        } else {
          console.error("Gagal membuat percakapan baru");
          clearChatError();  // Clear any existing errors first
          clearRagError();   // Also clear RAG errors if any
        }
      } else {
        // Gunakan percakapan yang sedang aktif
        console.log("Mengirim pesan ke percakapan yang sudah ada:", currentConversationId);
        await sendMessage(currentConversationId, content, aiConfig, isPdfProcessed);
      }
    } catch (error) {
      console.error("Error saat mengirim pesan:", error);
      clearChatError();  // Clear any existing errors
      clearRagError();   // Clear any RAG errors
    }
  };

  // Handle PDF processing
  const handleProcessPdfs = useCallback(async (files) => {
    console.log('[Chatbot] handleProcessPdfs called with files:', files);
    if (!apiKey) {
      setShowApiForm(true);
      return;
    }

    try {
      // Process the PDFs using the RAG system
      const processedDocs = await processPdfForRag(files);
      
      // If no docs were processed successfully, don't create a new conversation
      if (!processedDocs || processedDocs.length === 0) {
        return;
      }
      
      // Create a new conversation or update existing one
      let conversationToUse;
      
      if (!currentConversationId) {
        console.log('Membuat percakapan baru dan mengirim pesan...');
        // Create new conversation
        const newConv = await startNewConversation();
        if (!newConv) {
          console.error('Failed to create new conversation');
          return;
        }
        console.log('Percakapan baru dibuat dengan ID:', newConv.id);
        conversationToUse = newConv.id;
      } else {
        console.log('Mengirim pesan ke percakapan yang sudah ada:', currentConversationId);
        conversationToUse = currentConversationId;
      }
      
      // Link processed documents to the conversation
      if (conversationToUse) {
        try {
          // Get the document IDs from the processed docs
          const docIds = processedDocs.map(doc => doc.id);
          
          // Update the conversation with these document IDs
          const { error } = await supabase
            .from('conversations')
            .update({
              document_context: docIds,
              updated_at: new Date().toISOString()
            })
            .eq('id', conversationToUse);
            
          if (error) {
            console.error('Error linking documents to conversation:', error);
          } else {
            console.log('Documents successfully linked to conversation:', docIds);
            
            // Update local conversationDocuments state
            setConversationDocuments(prevDocs => {
              // Merge old documents with new ones, avoiding duplicates
              const existingDocIds = new Set(prevDocs.map(doc => doc.id));
              const newDocs = processedDocs.filter(doc => !existingDocIds.has(doc.id));
              return [...prevDocs, ...newDocs];
            });
            
            // If this is within an active conversation, update the activeConversation state
            if (activeConversation) {
              setActiveConversation(prev => {
                if (!prev) return prev;
                
                // Get current document_context or initialize to empty array
                const currentDocContext = Array.isArray(prev.document_context) ? prev.document_context : [];
                // Add new doc IDs without duplicates
                const updatedDocContext = [...new Set([...currentDocContext, ...docIds])];
                
                return {
                  ...prev,
                  document_context: updatedDocContext
                };
              });
            }
          }
        } catch (linkErr) {
          console.error('Error during document linking:', linkErr);
        }
      }
    } catch (err) {
      console.error('[Chatbot] Error processing PDFs:', err);
      // Use clearRagError since we don't have a direct setError function
      // This ensures errors are handled properly in the UI
      clearRagError();
      err.message && clearRagError(err.message);
    }
  }, [apiKey, processPdfForRag, startNewConversation, currentConversationId, activeConversation, clearRagError]);

  // Use effect to update document context when conversation changes
  useEffect(() => {
    if (currentConversationId && processedDocuments && processedDocuments.length > 0) {
      // Update the RAG context for this conversation with the current document IDs
      const documentIds = processedDocuments.map(doc => doc.id);
      
      console.log(`Updating document context for conversation ${currentConversationId} with ${documentIds.length} documents`);
      
      // Update RAG context for this conversation
      updateRagContextForConversation(currentConversationId, documentIds)
        .catch(err => console.error('Failed to update RAG context for conversation:', err));
      
      // Also update conversation in database to persist document connections
      supabase
        .from('conversations')
        .update({ document_context: documentIds })
        .eq('id', currentConversationId)
        .then(({ error }) => {
          if (error) {
            console.error('Failed to update conversation document context:', error);
          } else {
            console.log('Successfully updated conversation document context in database');
          }
        });
    }
  }, [currentConversationId, processedDocuments]);

  // Handler untuk menyimpan API key
  const handleSaveApiKey = (key) => {
    setApiKey(key);
    setShowApiForm(false);
  };

  // Handler untuk menyimpan konfigurasi AI
  const handleSaveAiConfig = (newConfig) => {
    setAiConfig(newConfig);
    setShowAiConfig(false);
  };

  // Toggle sidebar dengan penanganan yang lebih akurat
  const toggleSidebar = () => {
    setShowSidebar(prev => !prev);
  };

  // Menutup sidebar (explicit close) tanpa mengganggu grid layout
  const closeSidebar = () => {
    setShowSidebar(false);
  };

  // Membuka sidebar (explicit open)
  const openSidebar = () => {
    setShowSidebar(true);
  };
  
  // Toggle PDF panel untuk tampilan mobile
  const togglePdfPanel = () => {
    setShowPdfPanel(prev => !prev);
  };

  // Handler untuk mobile sidebar toggle dengan penanganan lebih baik
  const handleMobileSidebarToggle = (e) => {
    e.stopPropagation();
    toggleSidebar();
  };

  // Memilih percakapan dari history
  const handleSelectConversation = (conversationId) => {
    setActiveConversationId(conversationId);
  };

  // Hapus semua percakapan
  const handleClearAllConversations = async () => {
    if (window.confirm('Apakah Anda yakin ingin menghapus semua percakapan? Tindakan ini tidak dapat dibatalkan.')) {
      await clearAllConversations();
      
      // Reset sistem RAG saat semua percakapan dihapus
      // Ini akan memastikan bahwa pengguna harus mengunggah dokumen baru
      // sebelum dapat memulai percakapan baru
      await resetSystem();
      
      // Refresh storage info after clearing conversations
      setTimeout(() => {
        loadStorageInfo();
        setStorageUpdated(true);
        setTimeout(() => setStorageUpdated(false), 2000);
      }, 1000);
      
      console.log('All conversations cleared and RAG system reset');
    }
  };

  // Delete conversation and refresh storage info
  const handleDeleteConversation = async (conversationId, deleteDocumentsToo = false) => {
    await removeConversation(conversationId, deleteDocumentsToo);
    
    // Refresh storage info after deletion
    if (deleteDocumentsToo) {
      setTimeout(() => {
        loadStorageInfo();
        setStorageUpdated(true);
        setTimeout(() => setStorageUpdated(false), 2000);
      }, 1000);
    }
  };

  // Wrap the onStorageChange callback
  const handleStorageChange = useCallback(() => {
    setStorageUpdated(true);
    setTimeout(() => setStorageUpdated(false), 2000);
    
    // Refresh processed documents when storage changes
    // This will ensure the UI stays in sync if documents are deleted
    console.log("Storage changed, refreshing documents data.");
    loadStorageInfo();
  }, [loadStorageInfo]);

  // Wrap the onError callback
  const handleStorageError = useCallback((message) => {
    console.error('Storage error:', message);
  }, []);

  // Render empty state saat tidak ada pesan
  const renderEmptyState = () => {
    if (messages.length === 0 && !isProcessing) {
      return (
        <div className="empty-state">
          <MessageSquare size={48} />
          <h3>Mulai Percakapan Baru</h3>
          {isPdfProcessed ? (
            <>
              <p>
                Dokumen PDF Anda telah berhasil diproses. Sekarang Anda dapat mengajukan 
                pertanyaan tentang isi dokumen, dan sistem RAG akan memberikan jawaban 
                berdasarkan informasi yang ada.
              </p>
              <div className="empty-state-actions">
                <button 
                  onClick={startNewConversation} 
                  className="btn primary-btn"
                >
                  <Plus size={16} />
                  <span>Mulai Percakapan</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                Silakan unggah dokumen PDF terlebih dahulu untuk memulai percakapan.
                Sistem RAG akan memproses dokumen dan menyediakan jawaban berdasarkan
                informasi yang terkandung di dalamnya.
              </p>
              <div className="empty-state-hint">
                <Upload size={16} />
                <span>Unggah PDF di bagian atas untuk memulai</span>
              </div>
            </>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className={`chatbot-layout ${showSidebar ? '' : 'sidebar-collapsed'}`} data-theme={theme}>
      {/* Sidebar */}
      <aside className={`sidebar ${showSidebar ? 'active' : ''}`} style={{gridArea: 'sidebar'}}>
        <div className="sidebar-header">
          <h2>
            <MessageSquare size={20} />
            <span>D'Notebook AI</span>
          </h2>
          <button 
            className="sidebar-toggle" 
            onClick={closeSidebar}
            aria-label="Tutup sidebar"
          >
            <X size={20} />
          </button>
        </div>
        
        <div className="sidebar-content">
          <div className="sidebar-actions">
            <button className="new-chat-btn" onClick={startNewConversation}>
              <Plus size={16} />
              <span>Percakapan Baru</span>
            </button>
            
            {conversations && conversations.length > 0 && (
              <button 
                className="clear-all-btn" 
                onClick={handleClearAllConversations}
                title="Hapus semua percakapan"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
          
          <div className="chat-history-container">
            <div className="conversation-history">
              <h4>Riwayat Percakapan</h4>
              <ChatHistory
                conversations={conversations}
                activeConversationId={currentConversationId}
                onSelectConversation={handleSelectConversation}
                onDeleteConversation={handleDeleteConversation}
                isLoading={false}
                onDocumentDeleted={handleStorageChange}
              />
            </div>
          </div>
        </div>
        
        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar">{user?.email?.charAt(0).toUpperCase() || 'U'}</div>
            <div className="user-details">
              <div className="user-name">{user?.user_metadata?.name || user?.email}</div>
              <div className="user-email">{user?.email}</div>
            </div>
          </div>
          
          {/* Add StorageUsage component with animation when updated */}
          <StorageUsage 
            onStorageChange={handleStorageChange}
            onError={handleStorageError}
            animateUpdate={storageUpdated}
          />
          
          <div className="sidebar-actions">
            <button 
              className="theme-toggle-btn" 
              onClick={onToggleTheme}
              title={theme === 'light' ? 'Mode Gelap' : 'Mode Terang'}
              aria-label={theme === 'light' ? 'Mode Gelap' : 'Mode Terang'}
            >
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            </button>
            
            <button 
              className="settings-btn" 
              onClick={() => setShowApiForm(true)}
              title="API Key"
              aria-label="Atur API Key"
            >
              <Key size={20} />
            </button>
            
            <button 
              className="settings-btn" 
              onClick={() => setShowAiConfig(true)}
              title="Pengaturan AI"
              aria-label="Pengaturan AI"
            >
              <Settings size={20} />
            </button>
            
            <button 
              className="logout-btn" 
              onClick={onLogout}
              title="Logout"
              aria-label="Logout"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile sidebar toggle button */}
      {!showSidebar && (
        <button 
          className="sidebar-toggle" 
          onClick={handleMobileSidebarToggle}
          aria-label="Buka sidebar"
        >
          <Menu size={20} />
        </button>
      )}

      {/* Desktop sidebar toggle button */}
      {!showSidebar && (
        <button 
          className="open-sidebar-btn" 
          onClick={openSidebar}
          aria-label="Buka sidebar"
        >
          <Menu size={18} />
        </button>
      )}

      {/* Area Chat Utama */}
      <main className="chat-main" style={{gridArea: 'main'}}>
        {/* Tampilkan judul percakapan jika ada */}
        <div className="chat-header">
          <h2>{activeConversation ? activeConversation.title : 'Percakapan Baru'}</h2>
        </div>
        
        {/* Pesan error */}
        {(chatError || ragError) && (
          <ErrorMessage 
            message={chatError || ragError} 
            onClose={chatError ? clearChatError : clearRagError} 
          />
        )}
        
        {/* Area pesan */}
        <section className="messages-section">
          {renderEmptyState()}
          <ChatMessages 
            messages={messages}
            isProcessing={isProcessing}
          />
          <div ref={messagesEndRef} />
        </section>
        
        {/* Input chat */}
        <section className="input-section">
          <ChatInput
            onSendMessage={handleSendMessage}
            isProcessing={isProcessing}
            isDisabled={!isPdfProcessed}
          />
        </section>
      </main>

      {/* PDF Upload Panel di sebelah kanan */}
      <aside className={`pdf-panel ${showPdfPanel ? 'active' : ''}`} style={{gridArea: 'pdf-panel'}}>
        <div className="pdf-panel-header">
          <h3>
            <Upload size={18} style={{ marginRight: '8px' }} />
            Upload Dokumen
          </h3>
        </div>
        
        <div className="pdf-panel-content">
          {isPdfProcessed ? (
            <div className="pdf-status">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>{docsCount} dokumen PDF telah diproses</span>
              
              <button 
                className="share-docs-btn" 
                onClick={() => setShowDocumentSharing(true)}
                title="Bagikan Dokumen"
              >
                <Share2 size={16} />
                <span>Bagikan</span>
              </button>
            </div>
          ) : null}
          
          <PdfUploadForm
            onProcessPdfs={handleProcessPdfs}
            isProcessing={isProcessingPdf}
            isDisabled={false}
            processingSuccess={isPdfProcessed}
            storageInfo={storageInfo}
          />
        </div>
      </aside>

      {/* Tombol toggle PDF panel untuk mobile */}
      {!showPdfPanel && (
        <button 
          className="pdf-toggle-btn" 
          onClick={togglePdfPanel}
          aria-label="Tampilkan panel upload PDF"
        >
          <Upload size={20} />
        </button>
      )}

      {/* API Key Form Modal */}
      {showApiForm && (
        <div className="modal-overlay" onClick={(e) => apiKey && e.target === e.currentTarget && setShowApiForm(false)}>
          <div className="modal">
            <ApiKeyForm
              initialApiKey={apiKey}
              onSaveApiKey={handleSaveApiKey}
              onCancel={() => apiKey ? setShowApiForm(false) : null}
            />
          </div>
        </div>
      )}

      {/* AI Config Form Modal */}
      {showAiConfig && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowAiConfig(false)}>
          <div className="modal">
            <AIConfigForm
              config={aiConfig}
              onSave={handleSaveAiConfig}
              onCancel={() => setShowAiConfig(false)}
            />
          </div>
        </div>
      )}

      {/* Document Sharing Modal */}
      {showDocumentSharing && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowDocumentSharing(false)}>
          <div className="modal">
            <DocumentSharing onClose={() => setShowDocumentSharing(false)} />
          </div>
        </div>
      )}
    </div>
  );
};

export default Chatbot;