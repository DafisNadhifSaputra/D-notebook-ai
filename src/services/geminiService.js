import { GoogleGenerativeAI } from '@google/generative-ai';
import { Document } from 'langchain/document';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { storeDocument, storeDocumentChunks, performVectorSearch, createRagSession, updateRagSessionAccess, getActiveRagDocuments } from './documentService';
import { supabase } from '../utils/supabaseClient';


// Sistem penyimpanan dokumen dan indeks untuk RAG - Hybrid (memory + database)
let vectorStore = null;
let currentSessionId = null;
// Define sessionId variable
let sessionId = null;
let conversationId = null;
let geminiApiKey = null; // Adding geminiApiKey variable
const documentIds = new Set();
let embeddings = null;
let memoryVectorStore = [];
// Add SOURCE_REFERENCES definition as a let instead of const to allow reassignment
let SOURCE_REFERENCES = {};

// Attempt to initialize RAG system from database on module load
(async () => {
  try {
    const session = await supabase.auth.getSession();
    const documents = await getActiveRagDocuments();
    if (documents && documents.length > 0) {
      console.log(`Found ${documents.length} active documents, restoring RAG context in background`);
      // We'll restore on initialization with API key later
    }
  } catch (e) {
    console.warn('Failed to initialize RAG system from database:', e);
  }
})();

/**
 * Memeriksa apakah Gemini API telah diinisialisasi
 * @returns {boolean} - True jika Gemini API telah diinisialisasi, false jika belum
 */
export const isGeminiInitialized = () => {
  return geminiApiKey !== null && window.geminiAI !== undefined;
};

// Default AI configuration
const defaultAIConfig = {
    temperature: 0.2,
    maxOutputTokens: 65536,
    topP: 0.95,
    topK: 64,
    model: 'gemini-2.0-flash', // Updated to use 2.0-flash as default
    chunkSize: 1000,
    chunkOverlap: 200,
    showThinkingProcess: false, // Default to not showing thinking process
};

// Performance metrics tracking
const ragPerformanceMetrics = {
  queries: 0,
  totalResponseTime: 0,
  averageResponseTime: 0,
  successfulQueries: 0,
  failedQueries: 0,
  documentCitations: {},  // Track which documents are most cited
  queryTypes: {
    math: 0,
    general: 0,
    factual: 0
  }
};

/**
 * Reset performance metrics
 */
export const resetPerformanceMetrics = () => {
  ragPerformanceMetrics.queries = 0;
  ragPerformanceMetrics.totalResponseTime = 0;
  ragPerformanceMetrics.averageResponseTime = 0;
  ragPerformanceMetrics.successfulQueries = 0;
  ragPerformanceMetrics.failedQueries = 0;
  ragPerformanceMetrics.documentCitations = {};
  ragPerformanceMetrics.queryTypes = { math: 0, general: 0, factual: 0 };
};

/**
 * Clear the RAG system's vector store and session data
 */
export const resetRAGSystem = () => {
  vectorStore = null;
  currentSessionId = null;
  console.log('RAG system cleared');
};

/**
 * Get current performance metrics
 * @returns {Object} Performance metrics
 */
export const getPerformanceMetrics = () => {
  return { ...ragPerformanceMetrics };
};

/**
 * Track performance metrics for a query
 * @param {String} query - The user query
 * @param {Number} responseTime - Response time in ms
 * @param {Boolean} success - Whether the query was successful
 * @param {Array} citedDocuments - Array of document names cited in response
 */
const trackQueryPerformance = (query, responseTime, success, citedDocuments = []) => {
  ragPerformanceMetrics.queries++;
  ragPerformanceMetrics.totalResponseTime += responseTime;
  ragPerformanceMetrics.averageResponseTime = 
    ragPerformanceMetrics.totalResponseTime / ragPerformanceMetrics.queries;
  
  if (success) {
    ragPerformanceMetrics.successfulQueries++;
  } else {
    ragPerformanceMetrics.failedQueries++;
  }
  
  // Track cited documents
  citedDocuments.forEach(doc => {
    if (!ragPerformanceMetrics.documentCitations[doc]) {
      ragPerformanceMetrics.documentCitations[doc] = 0;
    }
    ragPerformanceMetrics.documentCitations[doc]++;
  });
  
  // Categorize query type
  if (/persamaan|rumus|formula|equation|differential|integral|matemat/i.test(query)) {
    ragPerformanceMetrics.queryTypes.math++;
  } else if (/apa|siapa|kapan|di mana|mengapa|bagaimana|what|who|when|where|why|how/i.test(query)) {
    ragPerformanceMetrics.queryTypes.factual++;
  } else {
    ragPerformanceMetrics.queryTypes.general++;
  }
};

/**
 * Inisialisasi Gemini AI dengan API Key
 * @param {string} apiKey - API Key untuk Gemini AI
 * @returns {Object} - Instance dari GoogleGenerativeAI
 */
export const initGeminiAI = (apiKey) => {
  try {
    return new GoogleGenerativeAI(apiKey);
  } catch (error) {
    console.error('Error initializing Gemini AI:', error);
    throw new Error('Failed to initialize Gemini AI');
  }
};

/**
 * Validates the Gemini API key by making a test call
 * @param {string} apiKey - API Key untuk Gemini AI
 * @returns {Promise<boolean>} - True if valid, throws error if invalid
 */
export const validateGeminiApiKey = async (apiKey) => {
  try {
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('API key is empty');
    }

    // Initialize the API client
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Try to access a model to verify the API key works
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    // Make a simple test call
    await model.generateContent('Test API key validity');
    
    // If we get here, the key is valid
    return true;
  } catch (error) {
    console.error('API Key validation error:', error);
    throw new Error('API Key tidak valid. Silakan periksa dan coba lagi.');
  }
};

/**
 * Memproses dokumen untuk sistem RAG dan menyimpannya ke Supabase
 * @param {Array<{name: string, text: string}>} documents - Array dokumen yang berisi teks
 * @param {string} apiKey - API Key untuk Gemini AI
 * @param {Object} config - Konfigurasi untuk pemrosesan dokumen (opsional)
 * @returns {Promise<boolean>} - true jika pemrosesan berhasil, false jika gagal
 */
export const processDocumentsForRAG = async (documents, apiKey, config = {}) => {
  try {
    if (!documents || documents.length === 0) {
      console.error('No documents provided for processing');
      return false;
    }

    if (!apiKey || apiKey.trim() === '') {
      console.error('API key is required for document processing');
      return false;
    }

    // Override default config dengan config yang diberikan
    const { chunkSize, chunkOverlap } = { 
      ...defaultAIConfig, 
      ...config,
      chunkSize: config.chunkSize || 1500, // Chunk yang lebih besar untuk persamaan matematika
      chunkOverlap: config.chunkOverlap || 300 // Overlap lebih besar untuk mempertahankan konteks
    };
    
    console.log(`Processing ${documents.length} documents with chunkSize=${chunkSize}, chunkOverlap=${chunkOverlap}`);
    
    // Membuat dokumen untuk LangChain dengan metadata yang lebih lengkap
    const docs = [];
    const storedDocumentIds = [];

    // Initialize embeddings with Gemini for use with both memory store and database
    console.log('Initializing embeddings with Gemini...');
    const embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: apiKey,
      modelName: "models/text-embedding-004", 
    });

    // Verify embeddings before proceeding
    try {
      console.log('Verifying embedding functionality...');
      const testEmbedding = await embeddings.embedQuery('Persamaan gelombang');
      if (!testEmbedding || testEmbedding.length === 0) {
        throw new Error('Embedding test failed - returned empty vector');
      }
      console.log('Embedding test successful');
    } catch (embErr) {
      console.error('Embedding verification failed:', embErr);
      throw new Error('Failed to initialize embeddings: ' + embErr.message);
    }

    // Proses setiap dokumen
    for (const doc of documents) {
      // Detect mathematical content
      const containsEquations = /(\\\(.*?\\\)|\\\[.*?\\\]|\$.*?\$|\$\$.*?\$\$|equation|persamaan)/i.test(doc.text);
      
      console.log(`Processing document: ${doc.name} (size: ${Math.round(doc.size / 1024)} KB, equations: ${containsEquations ? 'yes' : 'no'})`);
      
      // Store document in Supabase
      const documentMetadata = {
        fileName: doc.name,
        fileSize: doc.size,
        pageCount: doc.pages || 1,
        processingDate: new Date().toISOString(),
        containsEquations: containsEquations
      };
      
      // Store the full document first
      const documentId = await storeDocument(
        doc.name,
        doc.text,
        documentMetadata,
        false // Not public by default
      );
      
      storedDocumentIds.push(documentId);
      
      // Create LangChain document
      const langChainDoc = new Document({
        pageContent: doc.text,
        metadata: { 
          source: doc.name,
          documentId: documentId,
          ...documentMetadata
        }
      });
      
      docs.push(langChainDoc);
    }

    // Split documents into chunks
    const enhancedDocs = await createOptimizedChunks(docs, { chunkSize, chunkOverlap });
    
    console.log(`Documents split into ${enhancedDocs.length} chunks`);

    // Create memory vector store for immediate use
    console.log('Creating in-memory vector store...');
    vectorStore = await MemoryVectorStore.fromDocuments(enhancedDocs, embeddings);
    
    // Store chunks in Supabase for persistent storage - using batches for efficiency
    console.log('Storing chunks in database...');
    const chunkBatchSize = 50;
    
    for (let i = 0; i < enhancedDocs.length; i += chunkBatchSize) {
      const batchDocs = enhancedDocs.slice(i, i + chunkBatchSize);
      console.log(`Processing batch ${Math.floor(i/chunkBatchSize) + 1} of ${Math.ceil(enhancedDocs.length/chunkBatchSize)}...`);
      
      // Generate embeddings for this batch
      const batchEmbeddings = await processDocumentChunksInBatches(batchDocs, embeddings);
      
      // Format chunks for storage
      const chunksForStorage = batchDocs.map((doc, idx) => ({
        content: doc.pageContent,
        metadata: {
          ...doc.metadata,
          position: i + idx,
        }
      }));
      
      // Store this batch in Supabase
      await storeDocumentChunks(
        chunksForStorage[0].metadata.documentId,
        chunksForStorage, 
        batchEmbeddings
      );
    }
    
    // Create a RAG session for these documents
    currentSessionId = await createRagSession(storedDocumentIds, config);
    console.log(`Created RAG session with ID: ${currentSessionId}`);
    
    // Test the vector store
    await testVectorStore();
    
    return true;
  } catch (error) {
    console.error('Error processing documents for RAG:', error);
    // Reset vector store if processing failed
    vectorStore = null;
    throw new Error('Failed to process documents for RAG: ' + error.message);
  }
};

/**
 * Test the vector store with sample queries
 */
const testVectorStore = async () => {
  if (!vectorStore) return;
  
  // Test sample queries to ensure retrieval works
  const testQueries = [
    'test',
    'persamaan',
    'persamaan gelombang',
    'wave equation'
  ];
  
  console.log('Testing vector store with sample queries...');
  
  for (const query of testQueries) {
    try {
      const testResults = await vectorStore.similaritySearch(query, 1);
      console.log(`Test query "${query}" returned ${testResults.length} results`);
      if (testResults.length > 0) {
        console.log(`First result snippet: "${testResults[0].pageContent.substring(0, 100)}..."`);
      }
    } catch (e) {
      console.warn(`Test query "${query}" failed:`, e);
    }
  }
};

/**
 * Menjalankan query menggunakan sistem RAG dan Gemini AI
 * @param {string} query - Pertanyaan dari pengguna
 * @param {string} apiKey - API key untuk Gemini AI
 * @param {Object} aiConfig - Konfigurasi untuk model AI (opsional)
 * @param {Array} conversationHistory - Riwayat percakapan sebelumnya
 * @returns {Promise<Object>} - Respons dari Gemini AI beserta metadata konfigurasi
 */
export const queryWithRAG = async (query, apiKey, aiConfig = {}, conversationHistory = []) => {
  const startTime = Date.now();
  let success = false;
  let citedDocuments = [];
  
  try {
    // Initialize Gemini with API key
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Combine default config with provided config
    const config = { ...defaultAIConfig, ...aiConfig };
    const { 
      temperature, 
      maxOutputTokens, 
      topP, 
      topK, 
      model, 
      responseStyle,
      showThinkingProcess 
    } = config;

    // Update session access time if we have a session ID
    if (currentSessionId) {
      updateRagSessionAccess(currentSessionId).catch(err => 
        console.warn('Error updating RAG session access time:', err)
      );
    }

    // Verify that documents have been processed
    if (!vectorStore) {
      throw new Error('Tidak ada dokumen yang diproses. Silakan unggah minimal 1 file PDF terlebih dahulu.');
    }

    // Context and citations for RAG
    let context = '';
    let citations = [];
    
    console.log("RAG Query:", query);
    
    // Detect mathematical query
    const isMathQuery = /persamaan|rumus|formula|equation|differential|gelombang|wave|eigen|laplace|laplacian|turunan|derivative|integral/i.test(query);
    
    // Generate query variations to improve search results
    let queryVariations = generateQueryVariations(query, isMathQuery);

    // First try using in-memory vector store
    let relevantDocs = [];
    try {
      relevantDocs = await getRelevantDocsFromMemory(queryVariations);
    } catch (memoryError) {
      console.warn('Error querying in-memory vector store:', memoryError);
      // If in-memory fails, fallback to database
    }
    
    // If we didn't get enough results from memory, try database
    if (relevantDocs.length < 3) {
      try {
        console.log('Not enough results from memory store, trying database retrieval...');
        const dbDocs = await getRelevantDocsFromDatabase(query, apiKey);
        
        // Combine results from memory and database
        relevantDocs = [...relevantDocs, ...dbDocs];
        
        // Deduplicate
        relevantDocs = deduplicateDocuments(relevantDocs);
      } catch (dbError) {
        console.warn('Error querying database for documents:', dbError);
        // Continue with what we have from memory if database fails
      }
    }
    
    if (relevantDocs.length === 0) {
      throw new Error('Tidak dapat menemukan informasi yang relevan dalam dokumen yang diunggah. Silakan coba pertanyaan lain atau unggah dokumen yang sesuai.');
    }
    
    // Log info about found documents
    console.log(`Found ${relevantDocs.length} relevant documents`);
    console.log("Document sources:", relevantDocs.map(d => d.metadata?.source || 'unknown'));
    
    // Format context and prepare citations
    context = formatContextFromDocs(relevantDocs, citations);

    // Generate Gemini model with the selected configuration
    const geminiModel = genAI.getGenerativeModel({ 
      model: model,
      generationConfig: {
        temperature: temperature,
        maxOutputTokens: maxOutputTokens,
        topP: topP,
        topK: topK,
      }
    });
    
    // Build system prompt
    const systemPrompt = buildSystemPrompt(isMathQuery, showThinkingProcess, responseStyle);
    
    // Format chat history for Gemini
    const chatHistory = formatChatHistory(conversationHistory);
    
    // Prepare the complete prompt
    let promptText = systemPrompt;
    promptText += `\nGunakan informasi berikut untuk membantu menjawab: \n${context}\n\n`;
    promptText += "Pertanyaan: " + query;
    
    // Add special instructions for math queries
    if (isMathQuery) {
      promptText += addMathInstructions();
    }
    
    // Add reference format instructions
    promptText += "\n\nSelalu akhiri respons Anda dengan bagian REFERENSI yang menyebutkan dokumen asal dan halaman (jika ada). Format referensi harus seperti ini:\n\nREFERENSI:\n[1] Nama File A (halaman X)\n[2] Nama File B (halaman Y)";

    console.log("Sending prompt with thinking process:", showThinkingProcess);
    console.log("Prompt summary:", promptText.substring(0, 200) + "... [truncated]");
    
    // Generate response
    const result = await generateResponseFromGemini(geminiModel, promptText, chatHistory);
    const responseText = result.response ? result.response.text() : result.text();
    
    console.log("Raw response summary:", responseText.substring(0, 200) + "... [truncated]");
    
    // Process response to extract thinking process if enabled
    const { finalResponse, thinkingProcess } = extractThinkingProcess(responseText, showThinkingProcess);
    
    // Ensure there's a reference section
    const formattedResponse = ensureReferences(finalResponse, citations);
    
    // Extract document citations from response
    const docPattern = /\[(.*?)\]/g;
    let match;
    while ((match = docPattern.exec(responseText)) !== null) {
      citedDocuments.push(match[1]);
    }
    
    success = true;
    return {
      text: formattedResponse,
      thinkingProcess: thinkingProcess,
      usedConfig: {
        temperature,
        maxOutputTokens,
        topP,
        topK,
        model,
        responseStyle,
        showThinkingProcess,
      },
      citations: citations,
      sessionId: currentSessionId
    };
  } catch (error) {
    console.error('Error querying with RAG:', error);
    success = false;
    throw new Error('Failed to query: ' + error.message);
  } finally {
    const responseTime = Date.now() - startTime;
    trackQueryPerformance(query, responseTime, success, citedDocuments);
  }
};

/**
 * Generate variations of the query to improve search results
 */
function generateQueryVariations(query, isMathQuery) {
  let queryVariations = [
    query,
    `"${query}"`,
    `${query} formula`,
  ];
  
  if (isMathQuery) {
    queryVariations = [
      ...queryVariations,
      `bentuk ${query}`,
      `${query} matematika`,
      `formula ${query}`,
      `persamaan ${query.replace('persamaan', '')}`.trim(),
      `equation ${query}`,
      `wave equation`,
      `persamaan gelombang`,
      `poisson equation`,
      `persamaan poisson`,
      `mathematical ${query}`,
      `matematis ${query}`,
      `definisi ${query}`,
      `bentuk matematis ${query}`
    ];
    
    if (query.toLowerCase().includes('gelombang') || query.toLowerCase().includes('wave')) {
      queryVariations.push(
        'wave equation definition',
        'persamaan gelombang definisi',
        'bentuk matematis persamaan gelombang',
        'partial differential equation wave',
        'persamaan diferensial parsial gelombang'
      );
    }
    
    if (query.toLowerCase().includes('poisson')) {
      queryVariations.push(
        'poisson equation definition',
        'persamaan poisson definisi',
        'bentuk matematis persamaan poisson',
        'laplace equation',
        'persamaan laplace'
      );
    }
  }
  
  // Try to add document names to queries
  const docNames = getDocumentNames();
  if (docNames.length > 0) {
    docNames.forEach(name => {
      if (name.toLowerCase().includes('strauss') || name.toLowerCase().includes('differential')) {
        queryVariations.push(`${query} ${name}`);
      }
    });
    
    queryVariations.push(`${query} dalam ${docNames.join(' ')}`);
  }
  
  console.log("Query variations:", queryVariations);
  return queryVariations;
}

/**
 * Get relevant documents from the in-memory vector store
 * @param {Array<string>} queryVariations - Array of query variations to try
 * @returns {Promise<Array>} - Array of relevant documents
 */
async function getRelevantDocsFromMemory(queryVariations) {
  if (!vectorStore) return [];
  
  let allRelevantDocs = [];
  
  // Set up retriever
  const retriever = vectorStore.asRetriever({ 
    k: 7,
    filter: null,
    searchType: "similarity"
  });
  
  // Try each query variation
  for (const variation of queryVariations) {
    try {
      console.log(`Trying query variation: "${variation}"`);
      
      const relevantDocs = await retriever.getRelevantDocuments(variation);
      
      if (relevantDocs && relevantDocs.length > 0) {
        console.log(`Found ${relevantDocs.length} results with query variation: "${variation}"`);
        console.log(`First result: "${relevantDocs[0].pageContent.substring(0, 100)}..."`);
        
        allRelevantDocs = [...allRelevantDocs, ...relevantDocs];
        
        if (allRelevantDocs.length >= 5) {
          break;
        }
      }
    } catch (err) {
      console.warn(`Error with query variation "${variation}":`, err);
    }
  }
  
  // Try MMR search as fallback
  if (allRelevantDocs.length === 0) {
    try {
      console.log("Trying MMR search...");
      const mmrResults = await vectorStore.maximalMarginalRelevance(
        queryVariations[0],
        { k: 5, fetchK: 20 }
      );
      
      if (mmrResults && mmrResults.length > 0) {
        allRelevantDocs = [...allRelevantDocs, ...mmrResults];
      }
    } catch (err) {
      console.warn("Error with MMR search:", err);
    }
  }
  
  return deduplicateDocuments(allRelevantDocs);
}

/**
 * Get relevant documents from the database using vector search
 * @param {string} query - User query
 * @param {string} apiKey - Gemini API key (optional if embeddings already initialized)
 * @param {Array<string>} documentIds - Optional document IDs to search within
 * @param {Object} options - Search options
 * @returns {Promise<Array>} - Array of relevant documents
 */
async function getRelevantDocsFromDatabase(query, apiKey = null, documentIds = [], options = {}) {
  try {
    // Create embeddings if API key is provided
    let queryEmbedding;
    let localEmbeddings;
    
    if (apiKey) {
      // Create embeddings with provided API key
      localEmbeddings = new GoogleGenerativeAIEmbeddings({
        apiKey: apiKey,
        modelName: "models/text-embedding-004",
      });
      
      // Generate embedding for the query using our robust retry mechanism
      try {
        queryEmbedding = await retryWithAdvancedBackoff(
          async () => localEmbeddings.embedQuery(query),
          {
            maxRetries: 6, // Increase max retries for query embedding
            initialDelay: 1000,
            maxDelay: 15000,
            retryStatusCodes: [429, 500, 502, 503, 504]
          }
        );
      } catch (embeddingError) {
        console.error("Failed to generate query embedding after multiple retries:", embeddingError);
        // Create a fallback using lexical search in database
        console.log("Falling back to non-vector search approach due to embedding failure");
        return fallbackNonVectorSearch(query);
      }
    } else if (embeddings) {
      // Try to use existing embeddings if already initialized
      try {
        queryEmbedding = await embeddings.embedQuery(query);
      } catch (embErr) {
        console.error("Error generating query embedding without API key:", embErr);
        return fallbackNonVectorSearch(query);
      }
    } else {
      console.warn("No embeddings available for database search");
      return fallbackNonVectorSearch(query);
    }
    
    // Perform vector search in database
    const results = await performVectorSearch(queryEmbedding, documentIds, options.limit || 10);
    
    if (!results || results.length === 0) {
      console.log('No relevant documents found in database');
      return [];
    }
    
    // Get document titles to include with results
    const uniqueDocIds = [...new Set(results.map(item => item.document_id))];
    let documentTitles = {};
    
    try {
      const { data: documents } = await supabase
        .from('documents')
        .select('id, title, metadata')
        .in('id', uniqueDocIds);
      
      if (documents && documents.length > 0) {
        documents.forEach(doc => {
          documentTitles[doc.id] = doc.title || doc.metadata?.filename || 'Unnamed Document';
        });
      }
    } catch (titleError) {
      console.warn('Error retrieving document titles:', titleError);
    }
    
    // Convert to LangChain document format
    return results.map(result => new Document({
      pageContent: result.content,
      metadata: {
        ...result.metadata ? (typeof result.metadata === 'string' ? JSON.parse(result.metadata) : result.metadata) : {},
        document_id: result.document_id,
        source: documentTitles[result.document_id] || 'Unknown Document',
        document_title: documentTitles[result.document_id] || 'Unknown Document',
        score: result.similarity
      }
    }));
  } catch (error) {
    console.error("Error retrieving documents from database:", error);
    return [];
  }
}

/**
 * Deduplicate documents by content
 */
function deduplicateDocuments(docs) {
  const uniqueDocs = new Map();
  const result = [];
  
  docs.forEach(doc => {
    const contentId = doc.pageContent.substring(0, 100);
    if (!uniqueDocs.has(contentId)) {
      uniqueDocs.set(contentId, doc);
      result.push(doc);
    }
  });
  
  return result;
}

/**
 * Mengosongkan sistem RAG
 * @returns {boolean} - True jika berhasil membersihkan
 */
export const cleanRAGSystem = async () => {
  try {
    documentIds.clear();
    vectorStore = null;
    currentSessionId = null;
    conversationId = null;
    memoryVectorStore = [];
    
    // Clear session storage
    sessionStorage.removeItem('rag_document_ids');
    sessionStorage.removeItem('rag_conversation_id');
    
    console.log('RAG system cleaned successfully');
    return true;
  } catch (error) {
    console.error('Error cleaning RAG system:', error);
    return false;
  }
};

/**
 * Memeriksa apakah sistem RAG siap digunakan
 * @returns {boolean} - True jika sistem RAG siap, false jika tidak
 */
export const isRagSystemReady = () => {
  // Check if vector store is initialized
  return vectorStore !== null && typeof vectorStore.similaritySearch === 'function';
};

// Global variable to store the API key for Gemini

/**
 * Initialize the Gemini API client
 * @param {string} apiKey - Gemini API key
 */
export const initializeGemini = (apiKey) => {
  try {
    if (!apiKey || apiKey.trim() === '') {
      console.warn('Empty API key provided to initializeGemini');
      return false;
    }
    
    // Store the API key for later use
    geminiApiKey = apiKey;
    
    // Initialize the global Gemini client
    window.geminiAI = new GoogleGenerativeAI(apiKey);
    console.log('Gemini successfully initialized with provided API key');
    return true;
  } catch (error) {
    console.error('Error initializing Gemini:', error);
    return false;
  }
};

/**
 * Get the current Gemini API key
 * @returns {string|null} - The current API key or null if not set
 */
export const getGeminiApiKey = () => {
  return geminiApiKey;
};

/**
 * Create a new RAG session in the database
 * @returns {Promise<string>} - Session ID
 */
const createRagSessionInDB = async (userId) => {
  if (!userId) {
    console.warn('Creating anonymous RAG session');
    // Generate a random session ID for anonymous users
    return `anon-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
  
  try {
    const { data, error } = await supabase
      .from('rag_sessions')
      .insert([
        { 
          user_id: userId,
          document_ids: Array.from(documentIds),
          status: 'active',
          last_accessed_at: new Date().toISOString()
        }
      ])
      .select('id')
      .single();
      
    if (error) {
      console.error('Error creating RAG session:', error);
      throw error;
    }
    
    return data.id;
  } catch (error) {
    console.error('Failed to create RAG session:', error);
    return null;
  }
};

/**
 * Update the RAG session with the latest document IDs
 * @param {string} sessionId - The session ID to update
 * @returns {Promise<boolean>} - True if successful
 */
const updateRagSession = async (sessionId, userId) => {
  if (!sessionId || !userId) return false;
  
  try {
    const { error } = await supabase
      .from('rag_sessions')
      .update({ 
        document_ids: Array.from(documentIds),
        last_accessed_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .eq('user_id', userId);
      
    if (error) {
      console.error('Error updating RAG session:', error);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Failed to update RAG session:', error);
    return false;
  }
};

/**
 * Associate the current RAG session with a conversation
 * @param {string} convId - Conversation ID
 */
export const setConversationId = (convId) => {
  conversationId = convId;
  
  // If we have a session ID and there's a user logged in
  if (sessionId && supabase.auth.getSession()) {
    supabase
      .from('rag_sessions')
      .update({ conversation_id: convId })
      .eq('id', sessionId)
      .then(({ error }) => {
        if (error) {
          console.error('Error linking conversation to RAG session:', error);
        }
      });
  }
};

/**
 * Get the current conversation ID
 * @returns {string|null} - Conversation ID
 */
export const getConversationId = () => {
  return conversationId;
};

/**
 * Process a document for the RAG system
 * @param {Object} document - Document object with text content
 * @returns {Promise<boolean>} - True if successful
 */
export const processDocumentForRag = async (document, userId = null, apiKey = null) => {
  // First try the explicitly passed API key
  let effectiveApiKey = apiKey;
  
  // If no API key was passed, try the stored one
  if (!effectiveApiKey) {
    effectiveApiKey = geminiApiKey;
  }
  
  // If still no API key, try to get it from window.geminiAI
  if (!effectiveApiKey && window.geminiAI && window.geminiAI._apiKey) {
    effectiveApiKey = window.geminiAI._apiKey;
  }

  if (!effectiveApiKey) {
    console.error('No Gemini API key found for document processing');
    throw new Error('Gemini API key not found. Please initialize Gemini first.');
  }

  try {
    // First, ensure the document exists in the documents table
    // This step is crucial to avoid foreign key constraint violations
    let documentId = document.id;
    
    // If user is authenticated, verify the document exists in Supabase
    if (userId) {
      try {
        // Check if document exists in the database
        const { data: existingDoc } = await supabase
          .from('documents')
          .select('id')
          .eq('id', documentId)
          .single();
          
        if (!existingDoc) {
          console.log(`Document ${documentId} does not exist in database. Creating it first.`);
          // If document doesn't exist, create it first
          documentId = await storeDocument(
            document.title || document.filename || 'Untitled Document',
            document.text || '',
            {
              originalFilename: document.filename,
              pageCount: document.pages || 1,
              documentId: document.id,
              sizeBytes: document.size || document.text?.length || 0
            },
            false // not public by default
          );
          
          // Update the document object with the new ID if needed
          if (documentId !== document.id) {
            document.id = documentId;
          }
          
          console.log(`Created document in database with ID: ${documentId}`);
        } else {
          console.log(`Document ${documentId} already exists in database.`);
        }
      } catch (dbError) {
        console.error('Error verifying document in database:', dbError);
        // Create the document as a fallback
        documentId = await storeDocument(
          document.title || document.filename || 'Untitled Document',
          document.text || '',
          {
            originalFilename: document.filename,
            pageCount: document.pages || 1,
            documentId: document.id,
            sizeBytes: document.size || document.text?.length || 0
          },
          false
        );
        document.id = documentId;
      }
    }

    // Split the text into chunks
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    
    const textChunks = await textSplitter.splitText(document.text);
    
    // Initialize vector store if it doesn't exist
    if (!vectorStore) {
      const embeddings = new GoogleGenerativeAIEmbeddings({ apiKey: effectiveApiKey });
      vectorStore = new MemoryVectorStore(embeddings);
    }
    
    // Add document to vector store
    await vectorStore.addDocuments(
      textChunks.map(chunk => ({
        pageContent: chunk,
        metadata: {
          documentId: document.id,
          title: document.title,
          filename: document.filename,
          createdAt: document.createdAt
        }
      }))
    );
    
    // Track that this document has been added
    documentIds.add(document.id);
    
    // Create or update RAG session
    if (!sessionId) {
      sessionId = await createRagSessionInDB(userId);
    } else {
      await updateRagSession(sessionId, userId);
    }
    
    // If user is authenticated, store the document chunks in Supabase for persistence
    if (userId) {
      const embeddings = new GoogleGenerativeAIEmbeddings({ apiKey: effectiveApiKey });
      const chunkEmbeddings = await Promise.all(
        textChunks.map(chunk => embeddings.embedQuery(chunk).catch(() => null))
      );
      
      try {
        const chunkInserts = textChunks.map((chunk, index) => ({
          document_id: document.id,
          chunk_index: index,
          content: chunk,
          user_id: userId,
          embedding: chunkEmbeddings[index]
        }));
        
        // Use the storeDocumentChunks function to handle upsert properly
        await storeDocumentChunks(document.id, 
          chunkInserts.map(c => ({ content: c.content, metadata: { chunk_index: c.chunk_index } })), 
          chunkEmbeddings
        );
        
        console.log(`Successfully stored ${chunkInserts.length} chunks for document ${document.id}`);
      } catch (chunkError) {
        console.error('Error storing document chunks:', chunkError);
        // Continue even if chunk storage fails - we still have the in-memory vector store
      }
    }
    
    return true;
  } catch (error) {
    console.error('Error processing document for RAG:', error);
    // Propagate the error for better handling upstream
    throw error; // Re-throw the error instead of returning false
  }
};

/**
 * Execute a RAG query against the processed documents
 * @param {string} query - User query
 * @returns {Promise<Object>} - Query results with context
 */
export const executeRagQuery = async (query) => {
  if (!isGeminiInitialized()) {
    throw new Error('Gemini API belum diinisialisasi. Masukkan API key terlebih dahulu.');
  }
  
  if (!vectorStore || documentIds.size === 0) {
    throw new Error('Tidak ada dokumen yang telah diproses. Unggah dokumen terlebih dahulu.');
  }
  
  try {
    // Search for relevant context
    const searchResults = await vectorStore.similaritySearch(query, 5);
    
    const context = searchResults.map(result => result.pageContent).join('\n\n');
    
    // Generate response from Gemini
    const model = window.geminiAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const sourceDocs = searchResults.map(result => ({
      id: result.metadata.documentId,
      title: result.metadata.title || result.metadata.filename
    }));
    
    const prompt = `
    Berikut adalah query dari pengguna:
    "${query}"
    
    Berdasarkan konteks berikut dari dokumen yang telah diunggah:
    ${context}
    
    Berikan jawaban yang akurat dan komprehensif sesuai dengan konteks yang diberikan. 
    Jika pertanyaan tidak dapat dijawab berdasarkan konteks, katakan bahwa Anda tidak memiliki informasi yang cukup.
    Jawaban tidak perlu menyebutkan bahwa informasi berasal dari konteks yang diberikan.
    `;
    
    const result = await model.generateContent(prompt);
    const response = result.response;
    
    return {
      answer: response.text(),
      sources: sourceDocs,
      context
    };
  } catch (error) {
    console.error('Error executing RAG query:', error);
    throw new Error('Gagal mengeksekusi query: ' + error.message);
  }
};

/**
 * Clear a specific document from the RAG system
 * @param {string} documentId - ID of document to clear
 * @returns {boolean} - True if successful
 */
export const clearRAGSystem = async (documentId) => {
  try {
    if (!vectorStore) return true; // Nothing to clear
    
    // If documentId is provided, only remove that document
    if (documentId) {
      const apiKey = window.geminiAI?._apiKey;
      if (!apiKey) {
        console.warn('Cannot clear specific document from RAG without initialized API key.');
        return false; // Or handle differently, maybe just clear the whole store?
      }
      // Create new vector store without the specified document
      const embeddings = new GoogleGenerativeAIEmbeddings({ apiKey });
      
      // We need to rebuild the vector store without the specified document
      // This is a limitation of MemoryVectorStore not having a delete method
      const newVectorStore = new MemoryVectorStore(embeddings);
      
      // Get all documents from the current vector store
      const allDocs = await vectorStore.similaritySearch("", 1000);
      
      // Filter out the document to be removed
      const docsToKeep = allDocs.filter(doc => 
        doc.metadata.documentId !== documentId
      );
      
      // Add the remaining documents to the new vector store
      if (docsToKeep.length > 0) {
        await newVectorStore.addDocuments(docsToKeep);
      }
      
      // Replace the old vector store
      vectorStore = newVectorStore;
      
      // Update documentIds set
      documentIds.delete(documentId);
      
      // Update session in database if we have one
      if (sessionId) {
        const session = await supabase.auth.getSession();
        if (session?.data?.session?.user) {
          await updateRagSession(sessionId, session.data.session.user.id);
        }
      }
      
      return true;
    }
    
    // If no documentId provided, clear everything
    vectorStore = null;
    documentIds.clear();
    
    return true;
  } catch (error) {
    console.error('Error clearing RAG system:', error);
    return false;
  }
};

/**
 * Reload RAG context from persisted documents
 * @param {Array} documents - Array of document objects
 * @returns {Promise<boolean>} - True if successful
 */
export const reloadRAGContext = async (documents) => {
  if (!documents || documents.length === 0) return false;
  
  // Get the API key - try multiple sources to ensure we have it
  let apiKey = geminiApiKey;
  
  // Fallback to window.geminiAI if available
  if (!apiKey && window.geminiAI && typeof window.geminiAI._apiKey === 'string') {
    apiKey = window.geminiAI._apiKey;
  }
  
  if (!apiKey) {
    console.error('No API key available for reloading RAG context. Make sure Gemini is initialized first.');
    return false;
  }

  // Clear existing vector store
  vectorStore = null;
  documentIds.clear();
  
  try {
    const session = await supabase.auth.getSession();
    const userId = session?.data?.session?.user?.id;
    
    // Process each document, passing the API key explicitly
    for (const document of documents) {
      await processDocumentForRag(document, userId, apiKey); 
    }
    
    console.log(`Successfully reloaded RAG context with ${documents.length} documents.`);
    return true;
  } catch (error) {
    console.error('Error reloading RAG context:', error);
    return false;
  }
};

/**
 * Get the current RAG session ID
 * @returns {string|null} - Session ID
 */
export const getRagSessionId = () => {
  return sessionId;
};

/**
 * Get the list of document IDs currently in the RAG system
 * @returns {Array} - Array of document IDs
 */
export const getActiveDocumentIds = () => {
  return Array.from(documentIds);
};

/**
 * Check if a document is already in the RAG system
 * @param {string} documentId - Document ID to check
 * @returns {boolean} - True if document is in the system
 */
export const isDocumentInRagSystem = (documentId) => {
  return documentIds.has(documentId);
};

/**
 * Create optimized chunks for mathematical content
 * @param {Array<Document>} documents - LangChain documents to split
 * @param {Object} config - Configuration including chunkSize and chunkOverlap
 * @returns {Promise<Array<Document>>} - Split documents
 */
const createOptimizedChunks = async (documents, config) => {
  const { chunkSize = 1500, chunkOverlap = 300 } = config;
  
  // Create text splitter with special handling for math content
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    // Ensure equations aren't split in the middle by defining separators
    separators: [
      "\n## Page", // First try to split by page boundaries
      "\n\n",      // Then by paragraph
      "\n",        // Then by line
      ". ",        // Then by sentence
      " ",         // Then by word
      ""           // Finally by character
    ],
    keepSeparator: true,
  });
  
  // Split documents into chunks
  console.log('Splitting documents into chunks...');
  const splitDocs = await textSplitter.splitDocuments(documents);
  console.log(`Split ${documents.length} documents into ${splitDocs.length} chunks`);
  
  // Add metadata about chunk position and optimize math content
  return splitDocs.map((doc, index) => {
    // Check if this chunk likely contains math content
    const containsEquations = doc.metadata?.containsEquations || 
                             (/(\$|\\\(|\\\[|\\begin\{equation\}|\\frac|∫|∂|∇|∆|∑)/.test(doc.pageContent));
    
    // For chunks with equations, decrease chunk size slightly to ensure safe embedding
    if (containsEquations) {
      // If we have very long equations, they may need special handling
      const equationCount = (doc.pageContent.match(/(\$|\\\(|\\\[)/g) || []).length;
      
      // Add metadata about math content
      return {
        ...doc,
        metadata: {
          ...doc.metadata,
          chunkIndex: index,
          containsEquations,
          equationCount,
          chunkType: "math_content"
        }
      };
    }
    
    // Regular content
    return {
      ...doc,
      metadata: {
        ...doc.metadata,
        chunkIndex: index
      }
    };
  });
};

/**
 * Process embeddings in batches with enhanced error handling and retry mechanism
 * @param {Array<Object>} chunks - Document chunks to embed
 * @param {Object} embeddings - Embeddings interface
 * @returns {Promise<Array>} - Array of embeddings for each chunk
 */
const processEmbeddingsInBatches = async (chunks, embeddings) => {
  const batchSize = 3; // Smaller batch size to reduce load on API
  let allEmbeddings = [];
  
  console.log(`Processing embeddings for ${chunks.length} chunks in batches of ${batchSize}`);
  
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const batchTexts = batch.map(chunk => chunk.pageContent);
    
    try {
      console.log(`Processing batch ${Math.floor(i/batchSize) + 1} of ${Math.ceil(chunks.length/batchSize)}`);
      
      // Create an array to track which embeddings need processing
      const batchResults = new Array(batch.length);
      const pendingIndexes = batch.map((_, idx) => i + idx);
      
      // Process each embedding with individual retry mechanism
      await Promise.all(batchTexts.map(async (text, batchIdx) => {
        try {
          // Enhanced retry logic with exponential backoff for each individual embedding
          batchResults[batchIdx] = await retryWithAdvancedBackoff(
            async () => embeddings.embedQuery(text),
            {
              maxRetries: 5,
              initialDelay: 1000,
              maxDelay: 10000,
              retryStatusCodes: [429, 500, 502, 503, 504]
            }
          );
        } catch (err) {
          console.warn(`Failed to generate embedding after multiple retries for chunk ${i + batchIdx}:`, err.message);
          // Create fallback embedding - zero vector of appropriate size
          batchResults[batchIdx] = new Array(1536).fill(0);
        }
      }));
      
      allEmbeddings = [...allEmbeddings, ...batchResults];
      
      // Add longer delay between batches to prevent rate limiting
      if (i + batchSize < chunks.length) {
        const delayMs = 800 + Math.random() * 400; // 800-1200ms delay
        await new Promise(resolve => setTimeout(resolve, delayMs));
        console.log(`Waiting ${Math.round(delayMs)}ms before next batch to avoid rate limits...`);
      }
    } catch (error) {
      console.error(`Error processing embeddings batch ${Math.floor(i/batchSize) + 1}:`, error);
      // Create fallback embeddings for this batch - zero vectors of appropriate size
      const fallbackEmbeddings = batchTexts.map(() => new Array(1536).fill(0));
      allEmbeddings = [...allEmbeddings, ...fallbackEmbeddings];
    }
  }
  
  return allEmbeddings;
};

/**
 * Helper function to retry operations with exponential backoff
 * @param {Function} operation - Async function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @returns {Promise<any>} - Result of successful operation
 */
const retryWithBackoff = async (operation, maxRetries) => {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
      console.log(`Operation failed, retrying in ${Math.round(delay/1000)} seconds... (Attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // If we've exhausted all retries, throw the last error
  throw lastError;
};

/**
 * Advanced retry mechanism with exponential backoff and jitter
 * Specifically designed for handling API rate limiting and service unavailable errors
 * 
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Configuration options
 * @param {number} options.maxRetries - Maximum number of retry attempts
 * @param {number} options.initialDelay - Initial delay in ms 
 * @param {number} options.maxDelay - Maximum delay in ms
 * @param {Array<number>} options.retryStatusCodes - HTTP status codes to retry
 * @returns {Promise<any>} - Result of successful operation
 */
const retryWithAdvancedBackoff = async (fn, options = {}) => {
  const { 
    maxRetries = 5, 
    initialDelay = 1000, 
    maxDelay = 10000,
    retryStatusCodes = [429, 500, 502, 503, 504]
  } = options;
  
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Determine if this error should trigger a retry
      let shouldRetry = false;
      
      // Check if it's a network error (like 503 Service Unavailable)
      if (error.status && retryStatusCodes.includes(error.status)) {
        shouldRetry = true;
      } 
      // Check for error response object (common in API client errors)
      else if (error.response && error.response.status && 
               retryStatusCodes.includes(error.response.status)) {
        shouldRetry = true;
      } 
      // Check for error message containing status code
      else if (error.message && 
               retryStatusCodes.some(code => error.message.includes(`${code}`))) {
        shouldRetry = true;
      }
      // Embedded Google API errors
      else if (error.message && error.message.includes('failed to fetch')) {
        shouldRetry = true;
      }
      // Specific Gemini embedding API errors
      else if (error.message && 
              (error.message.toLowerCase().includes('service unavailable') ||
               error.message.toLowerCase().includes('resource exhausted') ||
               error.message.toLowerCase().includes('deadline exceeded'))) {
        shouldRetry = true;
      }
      
      // If we shouldn't retry, break out of the loop
      if (!shouldRetry) {
        console.warn('Error not retriable:', error);
        throw error;
      }
      
      // Calculate delay with exponential backoff and jitter
      const exponentialDelay = Math.min(
        maxDelay,
        initialDelay * Math.pow(2, attempt)
      );
      
      // Add jitter to prevent thundering herd problem (±20% randomness)
      const jitter = exponentialDelay * (0.8 + Math.random() * 0.4);
      
      // Log the retry attempt
      console.log(
        `API request failed (${error.status || error.message || 'unknown error'}), ` +
        `retrying in ${Math.round(jitter/1000)} seconds... ` +
        `(Attempt ${attempt + 1}/${maxRetries})`
      );
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, jitter));
    }
  }
  
  // If we've exhausted all retries
  console.error(`Failed after ${maxRetries} retry attempts. Last error:`, lastError);
  throw lastError;
};

/**
 * Fallback search method that doesn't use vector embeddings
 * Used when embedding API is unavailable
 * 
 * @param {string} query - The user query
 * @returns {Promise<Array<Document>>} - Array of relevant documents
 */
async function fallbackNonVectorSearch(query) {
  console.log("Using fallback non-vector search method");
  
  try {
    // Get currently stored document IDs
    const activeDocIds = Array.from(documentIds);
    
    if (!activeDocIds.length) {
      console.warn("No active documents found for fallback search");
      return [];
    }
    
    // Prepare keywords from query - remove stop words and split
    const keywords = query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => 
        word.length > 2 && 
        !['and', 'the', 'for', 'with', 'yang', 'dari', 'atau', 'dan', 'adalah'].includes(word)
      );
    
    console.log("Search keywords:", keywords);
    
    // Try to get relevant document chunks from database using text search
    try {
      const { data: chunks, error } = await supabase
        .from('document_chunks')
        .select('content, document_id, metadata')
        .in('document_id', activeDocIds)
        .filter(keywords.map(keyword => `content.ilike.%${keyword}%`).join(' or '))
        .limit(10);
        
      if (error) {
        console.error("Error in fallback database search:", error);
      } else if (chunks && chunks.length > 0) {
        console.log(`Found ${chunks.length} relevant chunks using fallback keyword search`);
        
        // Convert to LangChain document format
        return chunks.map(chunk => new Document({
          pageContent: chunk.content,
          metadata: {
            ...chunk.metadata,
            documentId: chunk.document_id,
            source: chunk.metadata?.source || 'unknown',
            fallbackSearch: true
          }
        }));
      }
    } catch (dbError) {
      console.warn("Database fallback search failed:", dbError);
    }
    
    // If database search failed or returned no results, try in-memory
    if (vectorStore) {
      console.log("Trying lexical search in memory store");
      // Use simple lexical matching as a last resort
      const allDocs = await vectorStore.similaritySearch("", 100);
      
      // Simple relevance scoring based on keyword matching
      const scoredDocs = allDocs.map(doc => {
        const content = doc.pageContent.toLowerCase();
        const score = keywords.reduce((total, keyword) => {
          return total + (content.includes(keyword) ? 1 : 0);
        }, 0);
        return { doc, score };
      });
      
      // Sort by score and take top 5
      const relevantDocs = scoredDocs
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(item => {
          // Mark as coming from fallback search
          item.doc.metadata = {
            ...item.doc.metadata,
            fallbackSearch: true,
            matchScore: item.score
          };
          return item.doc;
        });
      
      console.log(`Found ${relevantDocs.length} relevant documents using in-memory lexical search`);
      return relevantDocs;
    }
    
    console.warn("All fallback search methods failed");
    return [];
  } catch (error) {
    console.error("Error in fallback search:", error);
    return [];
  }
}

/**
 * Process document chunks in more resilient batches with dynamic throttling 
 * @param {Array<Document>} enhancedDocs - Document chunks to process
 * @param {Object} embeddings - Embedding interface
 * @param {Object} config - Configuration options
 * @returns {Promise<boolean>} - Success status
 */
const processDocumentChunksInBatches = async (enhancedDocs, embeddings, config = {}) => {
  try {
    const {
      initialBatchSize = 10,
      minBatchSize = 2,
      retryDelayMs = 1000
    } = config;
    
    // Start with a reasonable batch size and adjust based on API behavior
    let currentBatchSize = initialBatchSize;
    let consecutiveFailures = 0;
    let consecutiveSuccesses = 0;
    const maxConsecutiveFailures = 3;
    
    // Create a queue of chunks to process
    const queue = [...enhancedDocs];
    const results = new Map(); // Map of index -> embedding
    
    console.log(`Processing ${queue.length} document chunks with adaptive batching`);
    
    while (queue.length > 0) {
      // Adjust batch size based on recent success/failure
      if (consecutiveFailures > 0) {
        // Reduce batch size after failures
        const newBatchSize = Math.max(minBatchSize, Math.floor(currentBatchSize / 2));
        if (newBatchSize !== currentBatchSize) {
          console.log(`Reducing batch size from ${currentBatchSize} to ${newBatchSize} after failures`);
          currentBatchSize = newBatchSize;
        }
        consecutiveFailures = 0;
      } else if (consecutiveSuccesses >= 3) {
        // Cautiously increase batch size after consistent success
        const newBatchSize = Math.min(initialBatchSize, currentBatchSize + 1);
        if (newBatchSize !== currentBatchSize) {
          console.log(`Increasing batch size from ${currentBatchSize} to ${newBatchSize} after sustained success`);
          currentBatchSize = newBatchSize;
        }
        consecutiveSuccesses = 0;
      }
      
      // Take next batch from queue
      const batchSize = Math.min(currentBatchSize, queue.length);
      const batch = queue.splice(0, batchSize);
      
      console.log(`Processing batch of ${batch.length} chunks (${queue.length} remaining)`);
      
      try {
        // Process embeddings with our advanced retry mechanism
        const batchEmbeddings = await Promise.all(
          batch.map(doc => 
            retryWithAdvancedBackoff(
              async () => ({
                index: enhancedDocs.indexOf(doc),
                embedding: await embeddings.embedQuery(doc.pageContent)
              }),
              {
                maxRetries: 5,
                initialDelay: 1000,
                maxDelay: 12000,
                retryStatusCodes: [429, 500, 502, 503, 504]
              }
            ).catch(err => {
              console.warn(`Failed to generate embedding after multiple retries:`, err.message);
              return {
                index: enhancedDocs.indexOf(doc),
                embedding: new Array(1536).fill(0) // Fallback zero vector
              };
            })
          )
        );
        
        // Store results
        batchEmbeddings.forEach(({index, embedding}) => {
          results.set(index, embedding);
        });
        
        // Track success
        consecutiveSuccesses++;
        consecutiveFailures = 0;
        
        // Add delay between batches to avoid rate limits
        if (queue.length > 0) {
          // Calculate delay - longer after larger batches
          const delayMs = retryDelayMs + (200 * batch.length);
          console.log(`Waiting ${delayMs}ms before next batch to avoid rate limits...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      } catch (error) {
        console.error(`Error processing document batch:`, error);
        
        // Track failure
        consecutiveFailures++;
        
        if (consecutiveFailures >= maxConsecutiveFailures) {
          console.warn(`Too many consecutive failures (${consecutiveFailures}), using fallback approach`);
          
          // Use fallback approach - put chunks back in queue and process individually
          queue.push(...batch);
          currentBatchSize = minBatchSize; // Reduce to minimum batch size
        } else {
          // Put chunks back in queue and retry with smaller batch size
          queue.push(...batch);
        }
        
        // Add longer delay after failure
        const delayMs = retryDelayMs * (Math.pow(2, consecutiveFailures));
        console.log(`Error occurred, waiting ${delayMs}ms before retrying...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    // Convert results map back to array in original order
    const finalEmbeddings = enhancedDocs.map((_, index) => {
      return results.get(index) || new Array(1536).fill(0);
    });
    
    return finalEmbeddings;
  } catch (error) {
    console.error('Error in batch document processing:', error);
    // Return array of zero vectors as fallback
    return enhancedDocs.map(() => new Array(1536).fill(0));
  }
};

/**
 * Get relevant documents from the in-memory storage
 * @param {string} query - User query
 * @param {Object} options - Search options
 * @returns {Array} - Relevant document chunks with metadata
 */
const getRelevantDocsFromMemoryDirect = async (query, options = {}) => {
  const { limit = 7, threshold = 0.5 } = options;
  
  try {
    if (!memoryVectorStore || memoryVectorStore.length === 0) {
      return [];
    }
    
    // Convert query to embedding
    const queryEmbedding = await embeddings.embedQuery(query);
    
    // Calculate similarity and rank documents
    const results = memoryVectorStore.map(doc => {
      const similarity = cosineSimilarity(queryEmbedding, doc.vector);
      return {
        ...doc,
        similarity,
        document_title: doc.metadata?.document_title || doc.metadata?.source || "Unknown Source"
      };
    });
    
    // Filter by threshold and sort by similarity
    const filteredResults = results
      .filter(doc => doc.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
    
    if (filteredResults.length > 0) {
      console.log(`Found ${filteredResults.length} results with query variation: "${query}"`);
      console.log(`First result: "${filteredResults[0].content.substring(0, 20)}..."`);
    }
    
    return filteredResults;
  } catch (error) {
    console.error('Error searching memory store:', error);
    return [];
  }
};

/**
 * Get formatted contexts for RAG prompt
 * @param {Array} relevantDocs - Relevant document chunks
 * @returns {string} - Formatted context string
 */
const getFormattedContexts = (relevantDocs) => {
  if (!relevantDocs || relevantDocs.length === 0) {
    return "";
  }
  
  // Group documents by source to create better references
  const docsBySource = {};
  
  relevantDocs.forEach((doc, index) => {
    // Generate a source identifier
    const docTitle = doc.metadata?.document_title || 'Unknown Source';
    const pageNumber = doc.metadata?.page || doc.metadata?.pageNumber || '';
    const sourceKey = `${docTitle}${pageNumber ? ' (page ' + pageNumber + ')' : ''}`;
    
    // Group by source
    if (!docsBySource[sourceKey]) {
      docsBySource[sourceKey] = [];
    }
    docsBySource[sourceKey].push(doc.content);
  });
  
  // Format contexts with clear source markers
  let formattedContext = "";
  let referenceCounter = 1;
  const sourceMap = {};
  
  for (const source in docsBySource) {
    const sourceRef = `[${referenceCounter}]`;
    sourceMap[sourceRef] = source;
    
    // Add source header and content
    const contents = docsBySource[source];
    contents.forEach(content => {
      formattedContext += `${content.trim()}\n${sourceRef}\n\n`;
    });
    
    referenceCounter++;
  }
  
  // Store source references for later use
  SOURCE_REFERENCES = sourceMap;
  
  return formattedContext.trim();
};

/**
 * Convert search results to grouped citations
 * @param {Array} relevantDocs - Relevant document chunks
 * @returns {Object} - Object with citations grouped by source
 */
const getSourceCitations = (relevantDocs) => {
  if (!relevantDocs || relevantDocs.length === 0) {
    return {};
  }
  
  const citations = {};
  
  relevantDocs.forEach((doc, index) => {
    // Create a citation key from document metadata
    const documentTitle = doc.metadata?.document_title || 'Unknown Source';
    const pageNumber = doc.metadata?.page || doc.metadata?.pageNumber;
    
    const citationKey = pageNumber ? `${documentTitle} (page ${pageNumber})` : documentTitle;
    
    if (!citations[citationKey]) {
      citations[citationKey] = {
        title: documentTitle,
        page: pageNumber,
        document_id: doc.metadata?.document_id,
        excerpts: []
      };
    }
    
    // Add an excerpt from this document
    if (doc.content && doc.content.length > 0) {
      // Limit excerpt length and add to the collection
      const excerpt = doc.content.substring(0, 200) + (doc.content.length > 200 ? '...' : '');
      citations[citationKey].excerpts.push(excerpt);
    }
  });
  
  return citations;
};

/**
 * Build system prompt for the AI
 * @param {boolean} isMathQuery - Whether the query is math-related
 * @param {boolean} showThinkingProcess - Whether to show thinking process
 * @param {string} responseStyle - Style of response (balanced, creative, precise)
 * @returns {string} - System prompt
 */
const buildSystemPrompt = (isMathQuery, showThinkingProcess, responseStyle) => {
  let prompt = "Anda adalah asisten AI yang membantu menjawab pertanyaan berdasarkan dokumen yang diberikan. ";
  
  // Add instructions based on response style
  if (responseStyle === 'precise') {
    prompt += "Berikan jawaban yang singkat, padat, dan faktual berdasarkan informasi dalam dokumen. ";
  } else if (responseStyle === 'creative') {
    prompt += "Berikan jawaban yang mendetail dan elaboratif, sambil tetap berpegang pada informasi dalam dokumen. ";
  } else { // balanced
    prompt += "Berikan jawaban yang seimbang antara kelengkapan dan kepadatan informasi berdasarkan dokumen. ";
  }
  
  // Add thinking process instructions if enabled
  if (showThinkingProcess) {
    prompt += "\n\nSEBELUM menjawab, tunjukkan proses berpikir secara komprehensif dengan format berikut:";
    prompt += "\n<PROSES_BERPIKIR>\n1. Analisis pertanyaan untuk memahami maksud pengguna\n2. Identifikasi informasi relevan dari dokumen\n3. Susun jawaban berdasarkan informasi tersebut\n</PROSES_BERPIKIR>\n\nKemudian berikan jawaban Anda.";
  }
  
  // Add math-specific instructions if it's a math query
  if (isMathQuery) {
    prompt += "\n\nPertanyaan terkait dengan matematika, persamaan, atau konsep fisika. ";
    prompt += "Tuliskan persamaan matematik dalam format LaTeX yang benar (menggunakan $...$ untuk inline dan $$...$$ untuk display). ";
    prompt += "Jelaskan arti setiap simbol dan interpretasi fisik dari persamaan jika perlu. ";
  }
  
  // General instructions for all queries
  prompt += "\n\nSebutkan sumber informasi dengan jelas dan jujur jika Anda tidak menemukan informasi yang relevan dalam dokumen.";
  prompt += "\nJANGAN mengarang informasi yang tidak ada dalam dokumen yang diberikan.";
  
  return prompt;
};

/**
 * Format chat history for Gemini
 * @param {Array} conversationHistory - Previous conversation messages
 * @returns {Array} - Formatted history for Gemini
 */
const formatChatHistory = (conversationHistory) => {
  if (!conversationHistory || !Array.isArray(conversationHistory) || conversationHistory.length === 0) {
    return [];
  }
  
  return conversationHistory
    .filter(msg => msg.role === 'user' || msg.role === 'assistant')
    .map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));
};

/**
 * Format context from document chunks
 * @param {Array} docs - Document chunks
 * @param {Array} citations - Citations array to populate
 * @returns {string} - Formatted context string
 */
const formatContextFromDocs = (docs, citations) => {
  if (!docs || docs.length === 0) {
    return "";
  }
  
  const formattedChunks = docs.map((doc, idx) => {
    // Create a citation
    const source = doc.metadata?.source || doc.metadata?.document_title || 'Unknown Source';
    const page = doc.metadata?.page || doc.metadata?.pageNumber;
    const citationText = page ? `${source} (halaman ${page})` : source;
    
    // Add to citations array
    if (Array.isArray(citations)) {
      citations.push({
        source: source,
        page: page,
        text: doc.pageContent?.substring(0, 200) || doc.content?.substring(0, 200) || "",
      });
    }
    
    // Format the chunk with its citation
    return `--- Dokumen #${idx + 1}: ${citationText} ---\n${doc.pageContent || doc.content}\n`;
  });
  
  return formattedChunks.join("\n\n");
};

/**
 * Get names of documents in the system
 * @returns {Array} - Array of document names
 */
const getDocumentNames = () => {
  // Placeholder function - in a real implementation, this would access documentIds
  // and retrieve document names from storage or memory
  return Array.from(documentIds).map(id => {
    // Try to find document name in memory
    if (memoryVectorStore && memoryVectorStore.length > 0) {
      const doc = memoryVectorStore.find(d => d.metadata?.documentId === id);
      if (doc) return doc.metadata?.document_title || doc.metadata?.source || id;
    }
    return id; // Default to ID if name not found
  });
};

/**
 * Calculate cosine similarity between two vectors
 * @param {Array} vec1 - First vector
 * @param {Array} vec2 - Second vector
 * @returns {number} - Cosine similarity score
 */
const cosineSimilarity = (vec1, vec2) => {
  if (!vec1 || !vec2 || !Array.isArray(vec1) || !Array.isArray(vec2)) return 0;
  if (vec1.length !== vec2.length) return 0;
  
  let dotProduct = 0;
  let mag1 = 0;
  let mag2 = 0;
  
  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    mag1 += vec1[i] * vec1[i];
    mag2 += vec2[i] * vec2[i];
  }
  
  mag1 = Math.sqrt(mag1);
  mag2 = Math.sqrt(mag2);
  
  if (mag1 === 0 || mag2 === 0) return 0;
  
  return dotProduct / (mag1 * mag2);
};

/**
 * Add math-specific instructions to the prompt
 * @returns {string} - Math instructions
 */
const addMathInstructions = () => {
  return `\n\nKarena pertanyaan Anda berkaitan dengan matematika atau persamaan fisika:
1. Saya akan menggunakan notasi LaTeX untuk persamaan ($...$ untuk inline dan $$...$$ untuk display)
2. Saya akan menjelaskan arti setiap simbol dalam persamaan
3. Jika perlu, saya akan memberikan interpretasi fisik dari persamaan tersebut`;
};

/**
 * Extract thinking process from AI response
 * @param {string} text - Raw AI response
 * @param {boolean} showThinking - Whether thinking was requested
 * @returns {Object} - Object with finalResponse and thinkingProcess
 */
const extractThinkingProcess = (text, showThinking) => {
  if (!showThinking || !text) {
    return { finalResponse: text, thinkingProcess: null };
  }
  
  // Look for thinking process patterns
  const thinkingPatterns = [
    /<PROSES_BERPIKIR>([\s\S]*?)<\/PROSES_BERPIKIR>/i,
    /PROSES BERPIKIR:([\s\S]*?)(?=\n\n)/i,
    /ANALISIS:([\s\S]*?)(?=\n\n)/i,
    /LANGKAH-LANGKAH:([\s\S]*?)(?=\n\n)/i
  ];
  
  let thinkingProcess = null;
  let finalResponse = text;
  
  for (const pattern of thinkingPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      thinkingProcess = match[1].trim();
      // Remove the thinking process from the final response
      finalResponse = text.replace(match[0], '').trim();
      break;
    }
  }
  
  // If no explicit thinking process found, but there's a clear multi-step analysis
  if (!thinkingProcess) {
    const analysisSections = text.split(/\n\d+\.\s/);
    if (analysisSections.length > 2) {
      // This looks like numbered steps, probably a thinking process
      const firstPart = text.split(/\n\n(?=[A-Z])/)[0];
      if (firstPart && firstPart.length < text.length * 0.7) {
        thinkingProcess = firstPart.trim();
        finalResponse = text.replace(firstPart, '').trim();
      }
    }
  }
  
  return { finalResponse, thinkingProcess };
};

/**
 * Generate response from Gemini model
 * @param {Object} model - Gemini model instance
 * @param {string} prompt - Text prompt
 * @param {Array} chatHistory - Previous conversation history
 * @returns {Promise<Object>} - Response from Gemini
 */
const generateResponseFromGemini = async (model, prompt, chatHistory = []) => {
  try {
    // If we have chat history, use it
    if (chatHistory && chatHistory.length > 0) {
      const chat = model.startChat({
        history: chatHistory,
        generationConfig: {
          maxOutputTokens: 65536,
        }
      });
      
      return await chat.sendMessage(prompt);
    }
    
    // Otherwise, use a single prompt
    return await model.generateContent(prompt);
  } catch (error) {
    console.error('Error generating content from Gemini:', error);
    throw new Error('Failed to generate response: ' + (error.message || 'Unknown error'));
  }
};

/**
 * Ensure the response has a references section
 * @param {string} response - AI response
 * @param {Array} citations - Citations array
 * @returns {string} - Response with references
 */
const ensureReferences = (response, citations) => {
  if (!response) return '';
  
  // Check if response already contains references section
  if (/\n\nREFEREN[CS]I:|\n\nSUMBER:|\n\nREFERENCES:/i.test(response)) {
    return response;
  }
  
  // If we have citations but no references section, add one
  if (citations && citations.length > 0) {
    let referenceSection = '\n\nREFERENSI:\n';
    const uniqueSources = {};
    
    citations.forEach((citation, idx) => {
      const sourceKey = citation.source + (citation.page ? ` (halaman ${citation.page})` : '');
      if (!uniqueSources[sourceKey]) {
        uniqueSources[sourceKey] = `[${idx + 1}] ${sourceKey}`;
      }
    });
    
    referenceSection += Object.values(uniqueSources).join('\n');
    return response + referenceSection;
  }
  
  return response;
};

/**
 * Update the RAG context for a specific conversation
 * Ensures that only the relevant documents are used for a particular conversation
 * 
 * @param {string} conversationId - The current conversation ID
 * @param {Array<string>} docIds - Array of document IDs that should be used for this conversation
 * @returns {Promise<boolean>} - True if successful, false otherwise
 */
export const updateRagContextForConversation = async (conversationId, docIds = []) => {
  if (!isGeminiInitialized()) {
    console.warn('Cannot update RAG context: Gemini not initialized');
    return false;
  }

  try {
    console.log(`Updating RAG context for conversation ${conversationId} with ${docIds.length} documents`);
    
    // Create or update a RAG session for this conversation
    if (currentSessionId) {
      await updateRagSessionAccess(currentSessionId);
    } else {
      currentSessionId = await createRagSession(docIds, conversationId);
    }
    
    // Store the conversation ID in the module variable
    // Fix: Don't assign conversationId to itself
    
    // Clear existing set and add new document IDs
    documentIds.clear();
    
    // Add the new document IDs
    if (Array.isArray(docIds)) {
      docIds.forEach(id => documentIds.add(id));
    }
    
    // Store for persistence
    sessionStorage.setItem('rag_document_ids', JSON.stringify(Array.from(documentIds)));
    sessionStorage.setItem('rag_conversation_id', conversationId);
    
    return true;
  } catch (error) {
    console.error('Error updating RAG context:', error);
    return false;
  }
};