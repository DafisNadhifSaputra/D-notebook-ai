import { useState, useEffect, useCallback } from 'react';
import { 
  initializeGemini, 
  isGeminiInitialized, 
  processDocumentForRag, 
  executeRagQuery,
  clearRAGSystem,
  reloadRAGContext,
  getActiveDocumentIds,
  isDocumentInRagSystem,
  cleanRAGSystem
} from '../services/geminiService';
import { getPdfText } from '../services/pdfService';
import { 
  saveDocument, 
  getDocuments, 
  deleteDocument, 
  getDocumentContent,
  updateDocumentUsage
} from '../services/documentService';
import { handleError } from '../utils/errorUtils';
import { useSupabaseContext } from '../utils/supabaseClient';
import { v4 as uuidv4 } from 'uuid';

/**
 * Custom hook for managing the RAG (Retrieval Augmented Generation) system
 * @param {string} apiKey - API key for Gemini AI
 */
export const useRagSystem = (apiKey) => {
  const [isLoading, setIsLoading] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [error, setError] = useState(null);
  const [initialized, setInitialized] = useState(false);
  const [processedDocuments, setProcessedDocuments] = useState([]);
  const [isRagReady, setIsRagReady] = useState(false);
  const [isSystemReady, setIsSystemReady] = useState(false);
  const [ragMetrics, setRagMetrics] = useState({
    documentsProcessed: 0,
    totalTokensUsed: 0,
    averageResponseTime: 0,
    lastResponseTime: null,
  });
  
  const { session, supabase } = useSupabaseContext();
  const userId = session?.user?.id;
  
  // Load documents from storage
  const loadDocuments = useCallback(async () => {
    setIsLoading(true);
    try {
      const docs = await getDocuments(userId);
      setDocuments(docs);
      setProcessedDocuments(docs);
      
      // Check if documents need to be reloaded into RAG system
      if (isGeminiInitialized()) {
        const activeDocIds = new Set(getActiveDocumentIds());
        const docsToLoad = docs.filter(doc => !activeDocIds.has(doc.id));
        
        if (docsToLoad.length > 0) {
          // For each document, we need to get its content if not already loaded
          const docsWithContent = await Promise.all(docsToLoad.map(async (doc) => {
            if (!doc.text) {
              const content = await getDocumentContent(doc.id);
              return { ...doc, text: content };
            }
            return doc;
          }));
          
          // Reload documents into RAG system
          await reloadRAGContext(docsWithContent);
        }
        
        setIsRagReady(true);
        setIsSystemReady(true);
      }
    } catch (err) {
      console.error('Error loading documents:', err);
      setError('Failed to load documents');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);
  
  // Initialize the system with API key
  const initializeSystem = useCallback(async (key) => {
    setIsLoading(true);
    setError(null);
    try {
      const success = initializeGemini(key);
      if (success) {
        setInitialized(true);
        setIsSystemReady(true);
        // Store API key in sessionStorage (not localStorage for security)
        sessionStorage.setItem('gemini_api_key', key);
        
        // Load existing documents if available
        await loadDocuments();
      } else {
        setError('Failed to initialize Gemini API. Please check your API key.');
      }
    } catch (err) {
      setError(err.message || 'Failed to initialize Gemini API');
      handleError(err);
    } finally {
      setIsLoading(false);
    }
  }, [loadDocuments]);
  
  // Process a PDF file for RAG
  const processPdfForRag = useCallback(async (files) => {
    setIsLoading(true);
    setError(null);
    
    if (!Array.isArray(files)) {
      files = [files];
    }
    
    if (documents.length + files.length > 15) {
      setError('Maximum number of documents (15) reached. Please delete some documents first.');
      setIsLoading(false);
      return null;
    }
    
    try {
      // Auto-initialize with apiKey if not already initialized
      if (!isGeminiInitialized() && apiKey) {
        console.log('Auto-initializing Gemini with provided API key');
        const success = initializeGemini(apiKey);
        if (!success) {
          throw new Error('Failed to initialize Gemini API with the provided key.');
        }
        setInitialized(true);
        setIsSystemReady(true);
      } else if (!isGeminiInitialized()) {
        throw new Error('Gemini API not initialized. Please enter API key first.');
      }
      
      const processedDocs = [];
      const failedFiles = [];
      
      // Process each file
      for (const file of files) {
        console.log(`Processing PDF file: ${file.name}`);
        
        try {
          // Extract text from PDF
          const { text, pageCount } = await getPdfText(file);
          
          if (!text || text.trim() === '') {
            console.warn(`Failed to extract text from PDF: ${file.name}. The file may be corrupted or password protected.`);
            failedFiles.push({ name: file.name, reason: 'Failed to extract text' });
            continue;
          }
          
          // Create document object
          const documentId = uuidv4();
          const document = {
            id: documentId,
            filename: file.name,
            title: file.name.replace('.pdf', ''),
            sizeBytes: file.size,
            pageCount,
            text,
            createdAt: new Date().toISOString(),
            userId: userId || null
          };
          
          // Save document to storage first to ensure it exists
          await saveDocument(document);
          
          console.log(`Document saved to storage: ${documentId}`);
          
          // Process document for RAG - this will throw an error if it fails
          await processDocumentForRag(document, userId, apiKey);
          
          console.log(`Document processed for RAG: ${documentId}`);
          
          // Add to processed documents list
          processedDocs.push(document);
        } catch (docError) {
          console.error(`Error processing document ${file.name}:`, docError);
          failedFiles.push({ name: file.name, reason: docError.message });
          // Continue with other documents instead of failing everything
        }
      }
      
      // Update UI state even if some documents failed
      if (processedDocs.length > 0) {
        // Update documents state
        setDocuments(prev => [...prev, ...processedDocs]);
        setProcessedDocuments(prev => [...prev, ...processedDocs]);
        setIsRagReady(true);
        setIsSystemReady(true);
        
        // Update metrics
        setRagMetrics(prev => ({
          ...prev,
          documentsProcessed: prev.documentsProcessed + processedDocs.length
        }));
        
        // If some files failed but others succeeded, still consider it a partial success
        if (failedFiles.length > 0) {
          const failedNames = failedFiles.map(f => f.name).join(', ');
          setError(`Processed ${processedDocs.length} file(s) successfully, but failed to process: ${failedNames}`);
        }
        
        return processedDocs;
      } else {
        throw new Error(`No documents were successfully processed. Errors: ${failedFiles.map(f => `${f.name} (${f.reason})`).join(', ')}`);
      }
    } catch (err) {
      console.error('Error processing PDF for RAG:', err);
      setError(err.message || 'Failed to process PDF');
      handleError(err);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [documents, userId, apiKey]);
  
  // Execute a RAG query
  const executeQuery = useCallback(async (query) => {
    setIsLoading(true);
    setError(null);
    const startTime = Date.now();
    
    try {
      // Auto-initialize with apiKey if not already initialized
      if (!isGeminiInitialized() && apiKey) {
        const success = initializeGemini(apiKey);
        if (!success) {
          throw new Error('Failed to initialize Gemini API with the provided key.');
        }
        setInitialized(true);
        setIsSystemReady(true);
      } else if (!isGeminiInitialized()) {
        throw new Error('Gemini API not initialized. Please enter API key first.');
      }
      
      if (documents.length === 0) {
        throw new Error('No documents uploaded. Please upload at least one PDF document.');
      }
      
      const result = await executeRagQuery(query);
      
      // Calculate response time
      const responseTime = Date.now() - startTime;
      
      // Update metrics
      setRagMetrics(prev => {
        const newTotalTime = (prev.averageResponseTime * prev.documentsProcessed) + responseTime;
        const newCount = prev.documentsProcessed + 1;
        return {
          ...prev,
          totalTokensUsed: prev.totalTokensUsed + 100, // Approximate tokens used
          averageResponseTime: newTotalTime / newCount,
          lastResponseTime: responseTime
        };
      });
      
      // Update document usage for the sources
      if (result.sources && result.sources.length > 0) {
        const uniqueDocIds = [...new Set(result.sources.map(src => src.id))];
        uniqueDocIds.forEach(docId => {
          updateDocumentUsage(docId);
        });
      }
      
      return result;
    } catch (err) {
      console.error('Error executing RAG query:', err);
      setError(err.message || 'Failed to execute query');
      handleError(err);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [documents, apiKey]);
  
  // Remove a document from the system
  const removeDocument = useCallback(async (documentId) => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Remove from RAG system first
      const ragClearSuccess = await clearRAGSystem(documentId);
      
      if (!ragClearSuccess) {
        throw new Error('Failed to remove document from RAG system');
      }
      
      // Then delete from storage
      await deleteDocument(documentId, userId);
      
      // Update documents state
      setDocuments(prev => prev.filter(doc => doc.id !== documentId));
      setProcessedDocuments(prev => prev.filter(doc => doc.id !== documentId));
      
      return true;
    } catch (err) {
      console.error('Error removing document:', err);
      setError(err.message || 'Failed to remove document');
      handleError(err);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [userId]);
  
  // Check if a document is already in the RAG system
  const isDocumentInSystem = useCallback((documentId) => {
    return isDocumentInRagSystem(documentId);
  }, []);
  
  // Reset error state
  const clearError = useCallback(() => {
    setError(null);
  }, []);
  
  // Reset the RAG system and clear all documents
  const resetSystem = useCallback(async () => {
    setIsLoading(true);
    try {
      await cleanRAGSystem();
      
      // Clear the local state
      setProcessedDocuments([]);
      setIsRagReady(false);
      setIsSystemReady(false);
      
      // Clear stored document IDs in session storage to prevent auto-restoration
      sessionStorage.removeItem('rag_document_ids');
      
      // Clear context from the supabase database as well
      if (supabase && session?.user) {
        try {
          // Deactivate all active RAG sessions for this user
          await supabase
            .from('rag_sessions')
            .update({ status: 'inactive' })
            .eq('user_id', session.user.id)
            .eq('status', 'active');
        } catch (e) {
          console.warn('Failed to deactivate RAG sessions:', e);
        }
      }
      
      console.log('RAG system reset successful');
    } catch (error) {
      console.error('Error resetting RAG system:', error);
      setError('Failed to reset RAG system: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  }, [supabase, session]);
  
  // Load API key from session storage on component mount
  useEffect(() => {
    const savedApiKey = sessionStorage.getItem('gemini_api_key') || apiKey;
    
    if (savedApiKey) {
      initializeSystem(savedApiKey);
    }
  }, [initializeSystem, apiKey]);
  
  // Reload documents when user changes
  useEffect(() => {
    if (initialized && userId) {
      loadDocuments();
    }
  }, [initialized, userId, loadDocuments]);
  
  return {
    isLoading,
    error,
    documents,
    isSystemReady,
    processedDocuments,
    isRagReady,
    ragMetrics,
    initializeSystem,
    processPdfForRag,
    executeQuery,
    removeDocument,
    isDocumentInSystem,
    loadDocuments,
    clearRagError: clearError,
    resetSystem
  };
};

export default useRagSystem;