import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../utils/supabaseClient';
import { queryWithRAG, getActiveDocumentIds } from '../services/geminiService';
import { 
  deleteConversationAndDocuments,
  removeDocumentFromConversation,
  getStorageUsage
} from '../services/documentService';

const MAX_CONTEXT_MESSAGES = 10; // Batasan untuk konteks chat

// Check if supabase connection is available globally
const checkSupabaseConnection = () => {
  return !!supabase;
};

const useChatSystem = (apiKey, userId) => {
  const [messages, setMessages] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [error, setError] = useState(null);
  const [activeConversation, setActiveConversation] = useState(null);
  const [conversationDocuments, setConversationDocuments] = useState([]);
  // Keep the variable but don't use it
  const [isLoadingDocuments] = useState(false); 
  const [storageInfo, setStorageInfo] = useState(null);
  const storageUpdateTrigger = useRef(0);
  
  // Function to get active document IDs from the conversation documents
  const getActiveRagDocuments = useCallback(() => {
    // First try: Get documents from the current conversation context
    if (conversationDocuments && conversationDocuments.length > 0) {
      return conversationDocuments.map(doc => doc.id);
    }
    
    // Second try: Check if active conversation has document_context
    if (activeConversation && activeConversation.document_context && 
        Array.isArray(activeConversation.document_context) && 
        activeConversation.document_context.length > 0) {
      return activeConversation.document_context;
    }
    
    // Return empty array to ensure proper context isolation
    return [];
  }, [conversationDocuments, activeConversation]);

  /**
   * Load documents for a specific conversation
   * @param {string} conversationId - ID of the conversation to load documents for
   * @returns {Promise<Array>} - Documents associated with the conversation
   */
  const loadConversationDocuments = useCallback(async (conversationId) => {
    if (!conversationId || !checkSupabaseConnection()) return [];
    
    try {
      // First get the conversation to check for document_context
      const { data: conversation, error: convError } = await supabase
        .from('conversations')
        .select('document_context')
        .eq('id', conversationId)
        .single();
        
      if (convError || !conversation) {
        console.error('Error loading conversation documents:', convError);
        return [];
      }
      
      const documentIds = conversation.document_context || [];
      
      if (!documentIds.length) {
        console.log('No documents associated with conversation:', conversationId);
        return [];
      }
      
      console.log(`Found ${documentIds.length} document IDs for conversation ${conversationId}`);
      
      // Now fetch the actual documents
      const { data: documents, error: docsError } = await supabase
        .from('documents')
        .select('*')
        .in('id', documentIds);
        
      if (docsError) {
        console.error('Error loading documents for conversation:', docsError);
        return [];
      }
      
      // Update the state with the loaded documents
      setConversationDocuments(documents || []);
      
      return documents || [];
    } catch (error) {
      console.error('Failed to load conversation documents:', error);
      return [];
    }
  }, [setConversationDocuments]);

  // Load storage usage information
  const loadStorageInfo = useCallback(async () => {
    try {
      const info = await getStorageUsage();
      setStorageInfo(info);
    } catch (err) {
      console.error('Error loading storage info:', err);
    }
  }, []);

  // Load messages for a specific conversation
  const loadConversationMessages = useCallback(async (conversationId) => {
    if (!conversationId) {
      setMessages([]);
      setCurrentConversationId(null);
      setActiveConversation(null);
      setConversationDocuments([]);
      return;
    }
    try {
      setIsProcessing(true);
      setError(null);
      
      // First load the conversation details
      const { data: convData, error: convError } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .single();
        
      if (convError) throw convError;
      
      // Then load the messages
      const { data, error: fetchError } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (fetchError) throw fetchError;
      
      setMessages(data || []);
      setCurrentConversationId(conversationId);
      setActiveConversation(convData);
      
      // Load related documents
      await loadConversationDocuments(conversationId);
    } catch (err) {
      console.error('Error loading messages:', err);
      setError('Gagal memuat pesan percakapan: ' + err.message);
      setMessages([]); // Reset messages on error
      setCurrentConversationId(null);
      setActiveConversation(null);
      setConversationDocuments([]);
    } finally {
      setIsProcessing(false);
    }
  }, [loadConversationDocuments]);

  // Load conversations from Supabase with document context
  const loadConversations = useCallback(async () => {
    if (!userId) {
      console.warn("No userId provided to useChatSystem, can't load conversations");
      return;
    }
    
    try {
      // First, get the conversations without trying to join with documents
      const { data, error: fetchError } = await supabase
        .from('conversations')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;
      
      // Initialize the conversations array with empty document arrays
      const conversationsWithEmptyDocs = data?.map(conversation => ({
        ...conversation,
        documents: [] // Initialize with empty array
      })) || [];
      
      setConversations(conversationsWithEmptyDocs);
      
      // Then, for each conversation that has document_context, fetch those documents separately
      const conversationsWithDocContext = data?.filter(conv => 
        conv.document_context && Array.isArray(conv.document_context) && conv.document_context.length > 0
      ) || [];
      
      if (conversationsWithDocContext.length > 0) {
        // Get all unique document IDs across all conversations
        const allDocumentIds = [...new Set(
          conversationsWithDocContext.flatMap(conv => conv.document_context || [])
        )];
        
        if (allDocumentIds.length > 0) {
          // Fetch all documents in a single query
          const { data: documentsData, error: docsError } = await supabase
            .from('documents')
            .select('*')
            .in('id', allDocumentIds);
            
          if (!docsError && documentsData) {
            // Create a map for quick document lookup
            const documentsById = documentsData.reduce((acc, doc) => {
              acc[doc.id] = doc;
              return acc;
            }, {});
            
            // Update each conversation with its documents
            const updatedConversations = conversationsWithEmptyDocs.map(conv => {
              if (conv.document_context && Array.isArray(conv.document_context) && conv.document_context.length > 0) {
                // Map document IDs to actual document objects
                const documents = conv.document_context
                  .map(docId => documentsById[docId])
                  .filter(doc => doc !== undefined); // Filter out any missing documents
                  
                return { ...conv, documents };
              }
              return conv; // Keep as is if no documents
            });
            
            setConversations(updatedConversations);
          }
        }
      }
    } catch (err) {
      console.error('Error loading conversations:', err);
      setError('Gagal memuat percakapan: ' + err.message);
    }
  }, [userId]);

  // Get context messages for AI (last N messages)
  const getContextMessages = useCallback(() => {
    // Filter only user and assistant messages
    const relevantMessages = messages.filter(m => ['user', 'assistant'].includes(m.role));
    // Take the last MAX_CONTEXT_MESSAGES
    return relevantMessages.slice(-MAX_CONTEXT_MESSAGES);
  }, [messages]);

  // Start a new conversation
  const startNewConversation = useCallback(async () => {
    if (!userId) {
      console.error("No userId provided to useChatSystem, can't create conversation");
      setError('Tidak dapat membuat percakapan: User ID tidak tersedia');
      return null;
    }
    
    try {
      setIsProcessing(true);
      setError(null);
      
      const title = `Percakapan Baru ${new Date().toLocaleString('id-ID')}`;
      
      const { data, error: insertError } = await supabase
        .from('conversations')
        .insert([{ 
          title: title,
          user_id: userId
        }])
        .select()
        .single();

      if (insertError) {
        console.error("Conversation insert error:", insertError);
        throw insertError;
      }

      // Add documents property for consistency in our frontend
      const newConversation = {
        ...data,
        documents: [],
        document_context: [] // Add this for consistency with your app's expectations
      };
      
      console.log("New conversation created:", newConversation);
      
      setConversations(prev => [newConversation, ...prev]);
      setCurrentConversationId(newConversation.id);
      setActiveConversation(newConversation);
      setMessages([]); // Start with empty messages
      setConversationDocuments([]);
      return newConversation;
    } catch (err) {
      console.error('Error starting new conversation:', err);
      setError('Gagal memulai percakapan baru: ' + err.message);
      return null;
    } finally {
      setIsProcessing(false);
    }
  }, [userId]);

  // Send message
  const sendMessage = useCallback(async (conversationId, content, aiConfigOverrides = {}, isSystemReady = false) => {
    if (!content.trim() || !conversationId) {
      setError(!conversationId ? 'Pilih atau mulai percakapan baru terlebih dahulu.' : 'Pesan tidak boleh kosong.');
      return;
    }

    // Check if the API key is available before sending
    if (!apiKey) {
      setError('Gemini API key tidak tersedia. Mohon masukkan API key di pengaturan.');
      return;
    }

    // Get document IDs - multiple ways to ensure we have documents to work with
    let activeDocIds = getActiveRagDocuments();
    
    // If no documents found through the regular channels, try to get them directly from the RAG system
    if ((!activeDocIds || activeDocIds.length === 0) && isSystemReady) {
      try {
        const activeDocsFromService = getActiveDocumentIds();
        console.log('Retrieved document IDs directly from geminiService:', activeDocsFromService);
        activeDocIds = activeDocsFromService;
      } catch (err) {
        console.error('Error getting active document IDs from geminiService:', err);
      }
    }
    
    // Only proceed if either we have documents OR isSystemReady is true
    // This fixes the issue where documents show as processed in UI but aren't actually ready
    if ((!activeDocIds || activeDocIds.length === 0) && !isSystemReady) {
      setError('Anda harus mengunggah dan memproses minimal satu file PDF terlebih dahulu sebelum dapat mengajukan pertanyaan.');
      return;
    }
    
    setIsProcessing(true);
    setError(null);
    
    const userTimestamp = new Date();
    
    // Generate unique local IDs for optimistic UI updates
    const localUserMessageId = `local-user-${Date.now()}`;
    const localAssistantMessageId = `local-assistant-${Date.now()}`;
    
    try {
      // Get context *before* adding the new user message to history sent to AI
      const contextMessages = getContextMessages();

      // Add user message and typing indicator to UI immediately (optimistic update)
      setMessages(prevMessages => [
        ...prevMessages,
        {
          id: localUserMessageId,
          role: 'user',
          content,
          timestamp: userTimestamp
        },
        {
          id: localAssistantMessageId,
          conversation_id: conversationId,
          role: 'assistant', 
          content: '...',
          isTypingIndicator: true,
          timestamp: new Date(),
          user_id: userId
        }
      ]);

      // Detect if this is likely a mathematical query
      const isMathQuery = /persamaan|rumus|formula|equation|differential|gelombang|wave|eigen|laplace|laplacian|turunan|derivative|integral|poisson/i.test(content);
      
      // Enhance AI config for mathematical queries
      if (isMathQuery) {
        console.log('Mathematical query detected, adjusting AI parameters...');
        // Ensure we use settings that work well for mathematical content
        aiConfigOverrides = {
          ...aiConfigOverrides,
          temperature: Math.min(aiConfigOverrides.temperature || 0.2, 0.15), // Lower temperature
          showThinkingProcess: aiConfigOverrides.showThinkingProcess !== false, // Enable thinking process
          responseStyle: 'comprehensive' // Use detailed responses
        };
      }

      try {
        // Process with Gemini
        const response = await queryWithRAG(
          content,
          apiKey,
          aiConfigOverrides,
          contextMessages // Pass the conversation history
        );

        const assistantTimestamp = new Date();
        const assistantMessageContent = response?.text || "Maaf, saya tidak bisa memproses permintaan Anda saat ini.";
        
        // Replace typing indicator with real response by updating messages state
        setMessages(prevMessages => 
          prevMessages.map(msg => 
            msg.id === localAssistantMessageId 
              ? {
                  ...msg, 
                  content: assistantMessageContent,
                  isTypingIndicator: false,
                  timestamp: assistantTimestamp
                } 
              : msg
          )
        );

        // --- Save Messages to Supabase ---
        const messagesToSave = [
          {
            conversation_id: conversationId,
            user_id: userId,
            role: 'user',
            content: content,
            created_at: userTimestamp.toISOString()
          },
          {
            conversation_id: conversationId,
            user_id: userId,
            role: 'assistant',
            content: assistantMessageContent,
            created_at: assistantTimestamp.toISOString()
          }
        ];

        // Add thinking process message if available
        let thinkingProcessToSave = null;
        if (response?.thinkingProcess) {
          thinkingProcessToSave = {
            conversation_id: conversationId,
            user_id: userId,
            role: 'thinking',
            content: response.thinkingProcess,
            metadata: { relatedMessageId: null }, // Placeholder, will be updated
            created_at: new Date().toISOString()
          };
          messagesToSave.push(thinkingProcessToSave);
        }

        const { data: savedMessagesData, error: insertError } = await supabase
          .from('messages')
          .insert(messagesToSave)
          .select(); // Select the inserted rows

        if (insertError) {
          console.error('Error saving messages to Supabase:', insertError);
          setError('Gagal menyimpan pesan ke database.');
          // Rollback optimistic updates if save fails
          setMessages(prevMessages => prevMessages.filter(m =>
            m.id !== localUserMessageId && m.id !== localAssistantMessageId
          ));
        } else {
          // --- Update Local State with DB IDs (Optional but recommended) ---
          const savedUserMsg = savedMessagesData?.find(m => m.role === 'user' && m.content === content);
          const savedAssistantMsg = savedMessagesData?.find(m => m.role === 'assistant');
          const savedThinkingMsg = savedMessagesData?.find(m => m.role === 'thinking');

          setMessages(prevMessages => prevMessages.map(msg => {
            if (msg.id === localUserMessageId && savedUserMsg) {
              return { ...msg, id: savedUserMsg.id, timestamp: new Date(savedUserMsg.created_at) };
            }
            if (msg.id === localAssistantMessageId && savedAssistantMsg) {
              // If there's a thinking process, link it here
              const updatedMetadata = savedThinkingMsg
                ? { ...msg.metadata, thinkingProcessId: savedThinkingMsg.id }
                : msg.metadata;
              return { ...msg, id: savedAssistantMsg.id, timestamp: new Date(savedAssistantMsg.created_at), metadata: updatedMetadata };
            }
            return msg;
          }));

          // Add thinking message to local state *after* saving and getting IDs
          if (savedThinkingMsg && savedAssistantMsg) {
            // Update the thinking message's metadata with the actual assistant message ID
            await supabase
              .from('messages')
              .update({ metadata: { relatedMessageId: savedAssistantMsg.id } })
              .eq('id', savedThinkingMsg.id);

            // Add the thinking message to local state
            const thinkingMessageForState = {
                ...savedThinkingMsg,
                timestamp: new Date(savedThinkingMsg.created_at),
                metadata: { relatedMessageId: savedAssistantMsg.id }
            };
            // Insert thinking message right after its related assistant message
            setMessages(prev => {
                const assistantIndex = prev.findIndex(m => m.id === savedAssistantMsg.id);
                if (assistantIndex !== -1) {
                    const newMessages = [...prev];
                    newMessages.splice(assistantIndex + 1, 0, thinkingMessageForState);
                    return newMessages;
                } else {
                    return [...prev, thinkingMessageForState];
                }
            });
          }
        }
      } catch (queryError) {
        console.error('Error in queryWithRAG:', queryError);
        
        // Handle specific RAG system errors more gracefully
        if (queryError.message?.includes('Tidak ada dokumen yang diproses')) {
          setError('Dokumen belum berhasil diproses. Silakan coba unggah dokumen lagi atau periksa jika format dokumen didukung.');
        } else {
          setError('Gagal mendapatkan jawaban: ' + (queryError.message || 'Unknown error'));
        }
        
        // Remove typing indicator but keep user message
        setMessages(prevMessages => prevMessages.filter(m => m.id !== localAssistantMessageId));
        
        // Save just the user message to database
        try {
          await supabase.from('messages').insert([{
            conversation_id: conversationId,
            user_id: userId,
            role: 'user',
            content: content,
            created_at: userTimestamp.toISOString()
          }]);
        } catch (saveErr) {
          console.error('Error saving user message:', saveErr);
        }
      }
    } catch (err) {
      console.error('Error sending message:', err);
      setError('Gagal mengirim pesan: ' + (err.message || 'Unknown error'));
      // Rollback optimistic user message if AI call fails
      setMessages(prevMessages => prevMessages.filter(m => 
        m.id !== localUserMessageId && m.id !== localAssistantMessageId
      ));
    } finally {
      setIsProcessing(false);
    }
  }, [apiKey, userId, getContextMessages, getActiveRagDocuments]);

  // Delete conversation and optionally its documents
  const deleteConversation = useCallback(async (conversationId, deleteDocumentsToo = false) => {
    if (!conversationId) return;
    
    // Confirmation dialog
    if (!window.confirm(deleteDocumentsToo 
      ? "Apakah Anda yakin ingin menghapus percakapan ini dan semua dokumen yang digunakan di dalamnya? Tindakan ini tidak dapat dibatalkan."
      : "Apakah Anda yakin ingin menghapus percakapan ini? Tindakan ini tidak dapat dibatalkan."
    )) {
      return;
    }

    try {
      setIsProcessing(true);
      setError(null);
      
      // Use the enhanced document service that properly cleans up storage
      const result = await deleteConversationAndDocuments(conversationId, deleteDocumentsToo);
      
      if (!result.success) {
        throw new Error("Gagal menghapus percakapan");
      }
      
      // If documents were deleted, update the UI with storage freed info
      if (deleteDocumentsToo && result.deletedDocs > 0) {
        const freedMB = (result.freedBytes / (1024 * 1024)).toFixed(2);
        alert(`${result.deletedDocs} dokumen dihapus, membebaskan ${freedMB} MB penyimpanan.`);
        
        // Trigger storage info refresh
        storageUpdateTrigger.current += 1;
        loadStorageInfo();
      }

      // Update local state
      setConversations(prev => prev.filter(conv => conv.id !== conversationId));
      
      // If the deleted conversation was the active one, reset active state
      if (currentConversationId === conversationId) {
        setCurrentConversationId(null);
        setActiveConversation(null);
        setMessages([]);
        setConversationDocuments([]);
      }
      
      // Refresh the conversations list to get updated document counts
      loadConversations();
      
    } catch (err) {
      console.error('Error deleting conversation:', err);
      setError('Gagal menghapus percakapan: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  }, [currentConversationId, loadConversations, loadStorageInfo]);
  
  // Delete a document from a conversation
  const deleteDocumentFromConversation = useCallback(async (documentId, conversationId = currentConversationId) => {
    if (!documentId || !conversationId) return;
    
    try {
      setIsProcessing(true);
      setError(null);
      
      // Remove document from conversation
      await removeDocumentFromConversation(conversationId, documentId);
      
      // Update local state
      setConversationDocuments(prev => prev.filter(doc => doc.id !== documentId));
      
      // If this is active conversation, update its documents array too
      if (conversationId === currentConversationId) {
        setActiveConversation(prev => {
          if (!prev) return prev;
          
          return {
            ...prev,
            document_context: Array.isArray(prev.document_context) 
              ? prev.document_context.filter(id => id !== documentId)
              : []
          };
        });
      }
      
      // Update the conversations list to reflect document changes
      setConversations(prev => prev.map(conv => {
        if (conv.id === conversationId) {
          return {
            ...conv,
            documents: Array.isArray(conv.documents) 
              ? conv.documents.filter(doc => doc.id !== documentId)
              : []
          };
        }
        return conv;
      }));
      
      // Trigger storage update - this document might be deleted if not used elsewhere
      storageUpdateTrigger.current += 1;
      loadStorageInfo();
      
    } catch (err) {
      console.error('Error removing document from conversation:', err);
      setError('Gagal menghapus dokumen dari percakapan: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  }, [currentConversationId, loadStorageInfo]);

  // Clear all conversations
  const clearAllConversations = useCallback(async () => {
    if (!userId) return;
    
    // Ask if user wants to delete associated documents too
    const deleteDocumentsToo = window.confirm(
      "Apakah Anda ingin menghapus semua dokumen yang terkait dengan percakapan ini juga? " +
      "Ini akan membebaskan penyimpanan Anda. Pilih 'OK' untuk menghapus dokumen, 'Cancel' untuk membiarkan dokumen tetap tersimpan."
    );
    
    // Final confirmation
    if (!window.confirm(
      deleteDocumentsToo 
        ? "PERHATIAN: Semua percakapan dan dokumen akan dihapus. Tindakan ini tidak dapat dibatalkan. Lanjutkan?"
        : "PERHATIAN: Semua percakapan akan dihapus. Dokumen akan tetap tersimpan. Lanjutkan?"
    )) {
      return;
    }
    
    try {
      setIsProcessing(true);
      setError(null);
      
      // Get all conversation IDs
      const { data: convData } = await supabase
        .from('conversations')
        .select('id')
        .eq('user_id', userId);
        
      if (!convData || convData.length === 0) {
        // No conversations to delete
        setConversations([]);
        setCurrentConversationId(null);
        setActiveConversation(null);
        setMessages([]);
        setConversationDocuments([]);
        return;
      }
      
      // Delete each conversation and its documents if requested
      let totalDeletedDocs = 0;
      let totalFreedBytes = 0;
      
      for (const conv of convData) {
        try {
          const result = await deleteConversationAndDocuments(conv.id, deleteDocumentsToo);
          if (result.success) {
            totalDeletedDocs += result.deletedDocs;
            totalFreedBytes += result.freedBytes;
          }
        } catch (err) {
          console.warn(`Failed to delete conversation ${conv.id}:`, err);
          // Continue with other conversations
        }
      }
      
      // Reset local state
      setConversations([]);
      setCurrentConversationId(null);
      setMessages([]);
      setActiveConversation(null);
      setConversationDocuments([]);
      
      // Show summary if documents were deleted
      if (deleteDocumentsToo && totalDeletedDocs > 0) {
        const freedMB = (totalFreedBytes / (1024 * 1024)).toFixed(2);
        alert(`${totalDeletedDocs} dokumen dihapus, membebaskan ${freedMB} MB penyimpanan.`);
        
        // Trigger storage update
        storageUpdateTrigger.current += 1;
        loadStorageInfo();
      }
      
    } catch (err) {
      console.error('Error clearing all conversations:', err);
      setError('Gagal menghapus semua percakapan: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  }, [userId, loadStorageInfo]);

  // Initial load of conversations and storage info
  useEffect(() => {
    if (userId) {
      loadConversations();
      loadStorageInfo();
    }
  }, [userId, loadConversations, loadStorageInfo]);

  // Refresh storage info when trigger changes
  useEffect(() => {
    loadStorageInfo();
  }, [storageUpdateTrigger, loadStorageInfo]);

  // When conversation ID changes, load messages
  useEffect(() => {
    if (currentConversationId) {
      loadConversationMessages(currentConversationId);
    } else {
      // Clear messages if no conversation is selected
      setMessages([]);
      setActiveConversation(null);
      setConversationDocuments([]);
    }
  }, [currentConversationId, loadConversationMessages]);

  // Clear error message
  const clearChatError = useCallback(() => {
    setError(null);
  }, []);

  return {
    messages,
    isProcessing,
    currentConversationId,
    activeConversation,
    conversations,
    conversationDocuments,
    isLoadingDocuments,
    error,
    storageInfo,
    defaultAIConfig: {
      temperature: 0.2,
      maxOutputTokens: 65536,
      topP: 0.95,
      topK: 64,
      model: 'gemini-2.5-flash',
      responseStyle: 'balanced',
      showThinkingProcess: false,
    },
    loadConversations,
    loadConversationMessages,
    loadConversationDocuments,
    loadStorageInfo,
    startNewConversation,
    sendMessage,
    removeConversation: deleteConversation,
    clearChatError,
    clearAllConversations,
    setActiveConversationId: setCurrentConversationId,
    deleteDocumentFromConversation
  };
};

export default useChatSystem;