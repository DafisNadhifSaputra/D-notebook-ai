import { supabase } from '../utils/supabaseClient';
import { getCurrentUser } from './authService';
import { compressDocumentText } from '../utils/documentCompression';
import { clearRAGSystem, reloadRAGContext } from './geminiService';

/**
 * Helper function to get current user ID safely
 * @returns {Promise<string|null>} - User ID if logged in, null otherwise
 */
const getCurrentUserId = async () => {
  const user = await getCurrentUser();
  if (!user) {
    console.warn('User not logged in when trying to access document service.');
    return null;
  }
  return user.id;
};

/**
 * Utility function for safe JSON stringification with Unicode handling
 * Used by metadata processing functions to ensure valid JSON
 */
const sanitizeForJsonStringify = (obj) => {
  return JSON.stringify(obj, (key, value) => {
    // Handle non-finite numbers
    if (typeof value === 'number' && !isFinite(value)) {
      if (isNaN(value)) return 0;
      return value > 0 ? 1.7976931348623157e+308 : -1.7976931348623157e+308;
    }
    return value;
  });
};

// Replace control characters in string sanitization - using a safer pattern
const controlCharsRegex = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;
const sanitizeString = (str) => {
  return String(str)
    // Replace control characters with spaces (in a safe way for ESLint)
    .replace(controlCharsRegex, ' ')
    // Remove problematic Unicode characters
    .replace(/[\uD800-\uDFFF\uFFFE\uFFFF]/g, '')
    // Replace UTF-16 surrogate pairs with simpler characters
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '?')
    // Remove Unicode escape sequences
    .replace(/\\u[0-9a-fA-F]{4}/g, '');
};

// Add utility function to sanitize metadata objects more thoroughly
const sanitizeMetadataObject = (obj) => {
  if (!obj || typeof obj !== 'object') {
    return {};
  }
  
  const sanitized = {};
  
  Object.keys(obj).forEach(key => {
    try {
      const value = obj[key];
      
      // Handle different value types
      if (value === null || value === undefined) {
        sanitized[key] = null;
      } else if (typeof value === 'string') {
        // Enhanced sanitization for strings - handle more Unicode character ranges
        sanitized[key] = sanitizeString(value).substring(0, 10000); 
      } else if (typeof value === 'number') {
        // Handle invalid numbers
        sanitized[key] = isNaN(value) || !isFinite(value) ? 0 : value;
      } else if (typeof value === 'boolean') {
        // Booleans can be stored directly
        sanitized[key] = value;
      } else if (Array.isArray(value)) {
        // Sanitize arrays with max length protection
        sanitized[key] = value
          .slice(0, 1000) // Safety limit for array length
          .map(item => {
            if (typeof item === 'string') {
              // Apply same enhanced string sanitization to array items
              return sanitizeString(item).substring(0, 1000);
            } else if (typeof item === 'number') {
              // Handle invalid numbers
              return isNaN(item) || !isFinite(item) ? 0 : item;
            } else if (typeof item === 'boolean') {
              return item;
            } else if (item === null) {
              return null;
            } else if (typeof item === 'object') {
              // Recursively sanitize nested objects, but only one level deep to avoid loops
              return JSON.stringify(sanitizeMetadataObject(item)).substring(0, 1000);
            }
            return null; // Default for unsupported types
          });
      } else if (typeof value === 'object') {
        // Recursively sanitize nested objects
        sanitized[key] = sanitizeMetadataObject(value);
      }
    } catch (error) {
      console.warn(`Error sanitizing metadata key "${key}":`, error);
      sanitized[key] = null; // Use null for values that failed sanitization
    }
  });
  
  return sanitized;
};

/**
 * Save a document object to storage
 * @param {Object} document - Document object with id, title, text content, and metadata
 * @returns {Promise<string>} - ID of the stored document
 */
export const saveDocument = async (document) => {
  if (!document || !document.id || !document.title || !document.text) {
    throw new Error('Invalid document object. Required fields: id, title, text');
  }
  
  // Extract relevant information
  const { id, title, text, filename, sizeBytes, pageCount } = document;
  
  // Use existing storeDocument function with the extracted data
  await storeDocument(
    title || filename, 
    text,
    { 
      originalFilename: filename,
      pageCount: pageCount || 1,
      documentId: id,
      sizeBytes
    },
    false // not public by default
  );
  
  return id;
};

/**
 * Stores a document in Supabase and returns the document ID
 * @param {string} title - Document title (often the file name)
 * @param {string} content - Document content as text
 * @param {Object} metadata - Additional metadata about the document
 * @param {boolean} isPublic - Whether the document is publicly accessible
 * @returns {Promise<string>} - ID of the stored document
 */
export const storeDocument = async (title, content, metadata = {}, isPublic = false) => {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('User not logged in');

  try {
    // Sanitize title more thoroughly
    const sanitizedTitle = title ? 
      String(title)
        // Replace control characters with spaces
        .replace(controlCharsRegex, ' ')
        // Remove problematic Unicode characters
        .replace(/[\uD800-\uDFFF\uFFFE\uFFFF]/g, '')
        .replace(/[\u2060-\u2069\u0080-\u009F]/g, '')
        // Replace UTF-16 surrogate pairs with simpler characters
        .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '?')
        // Remove Unicode escape sequences
        .replace(/\\u[0-9a-fA-F]{4}/g, '')
        // Limit length
        .slice(0, 255) : 'Untitled Document';
    
    // Enhanced content sanitization
    let sanitizedContent;
    try {
      // First try compression which also sanitizes content
      const compressedContent = await compressDocumentText(content);
      
      // Additional safety checks for Unicode issues
      sanitizedContent = compressedContent
        // Remove control characters
        .replace(controlCharsRegex, ' ')
        // Remove problematic Unicode characters
        .replace(/[\uD800-\uDFFF\uFFFE\uFFFF]/g, '')
        // Replace non-printable characters
        .replace(/[\u2060-\u2069\u0080-\u009F]/g, '')
        // Replace UTF-16 surrogate pairs with simpler characters
        .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '?')
        // Remove Unicode escape sequences
        .replace(/\\u[0-9a-fA-F]{4}/g, '');
    } catch (compressionError) {
      console.error('Error compressing document:', compressionError);
      
      // Use plain content with sanitization if compression fails
      sanitizedContent = String(content)
        // Remove control characters
        .replace(controlCharsRegex, ' ')
        // Remove problematic Unicode characters
        .replace(/[\uD800-\uDFFF\uFFFE\uFFFF]/g, '')
        // Replace non-printable characters
        .replace(/[\u2060-\u2069\u0080-\u009F]/g, '')
        // Replace UTF-16 surrogate pairs
        .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '?')
        // Remove Unicode escape sequences
        .replace(/\\u[0-9a-fA-F]{4}/g, '')
        // Limit size to prevent DB issues
        .substring(0, 1000000);
    }
    
    // Sanitize metadata to prevent issues with nested objects and JSON
    const sanitizedMetadata = sanitizeMetadataObject(metadata);
    
    // Fix invalid numbers in metadata
    const fixedMetadata = JSON.parse(
      JSON.stringify(sanitizedMetadata)
        .replace(/:null/g, ':null')
        .replace(/:NaN/g, ':0')
        .replace(/:Infinity/g, ':1.7976931348623157e+308')
        .replace(/:-Infinity/g, ':-1.7976931348623157e+308')
    );
    
    sanitizedMetadata.processedBy = 'RAG System'; 
    sanitizedMetadata.sanitizedAt = new Date().toISOString();
    
    // Prepare the final payload
    const documentPayload = {
      user_id: userId,
      title: sanitizedTitle,
      content: sanitizedContent,
      metadata: fixedMetadata, // Use fixed metadata
      is_public: isPublic,
      file_size: sanitizedContent.length,
      page_count: fixedMetadata.pageCount || 1,
    };
    
    console.log('[storeDocument] Sanitized document payload created:', {
      ...documentPayload,
      content: `${documentPayload.content.substring(0, 100)}... (${documentPayload.content.length} chars)`
    });
    
    // Test content for problematic Unicode before sending to Supabase
    try {
      // This will throw an error if there are remaining invalid UTF-16 surrogate pairs
      JSON.stringify({ test: sanitizedContent });
    } catch (error) { // Renamed jsonError to error
      console.warn('Content still contains invalid UTF-16 characters, additional sanitization needed:', error);
      
      // Apply more aggressive sanitization
      documentPayload.content = documentPayload.content
        // Replace any remaining problematic characters with space
        .replace(/[^\x20-\x7E\xA0-\uD7FF\uE000-\uFFFD\u10000-\u10FFFF]/g, ' ')
        .replace(/\uFFFD/g, ' '); // Replace replacement character with space
    }
    
    // Insert into documents table
    const { data, error } = await supabase
      .from('documents')
      .insert(documentPayload)
      .select('id')
      .single();
      
    if (error) {
      console.error('Error storing document in Supabase:', error);
      
      if (error.message && (
        error.message.includes('unicode') || 
        error.message.includes('UTF') || 
        error.message.includes('character')
      )) {
        console.log('Unicode-related error detected despite sanitization.');
        throw new Error('Gagal menyimpan dokumen: Karakter Unicode tidak didukung. Coba hapus karakter khusus pada dokumen.');
      }
      
      throw new Error('Gagal menyimpan dokumen: ' + error.message);
    }
    
    return data.id;
  } catch (error) {
    console.error('Error in storeDocument function:', error);
    throw new Error('Gagal menyimpan dokumen: ' + error.message);
  }
};

/**
 * Store document chunks with embeddings for RAG
 * @param {string} documentId - ID of the parent document 
 * @param {Array<Object>} chunks - Array of document chunks with content and metadata
 * @param {Array<Array<number>>} embeddings - Array of embeddings corresponding to chunks
 * @returns {Promise<Array>} - IDs of the stored chunks
 */
export const storeDocumentChunks = async (documentId, chunks, embeddings) => {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('User not logged in');
  
  if (!chunks || chunks.length === 0) {
    console.log('No chunks provided for document:', documentId);
    return []; // Return empty array if no chunks
  }
  
  // Ensure embeddings array matches chunks length, fill with zeros if needed
  if (!embeddings || embeddings.length !== chunks.length) {
    console.warn(`Embeddings array length (${embeddings?.length}) doesn't match chunks array length (${chunks.length}). Filling missing embeddings with zeros.`);
    const validEmbeddings = embeddings || [];
    embeddings = new Array(chunks.length).fill(null).map((_, i) => 
      validEmbeddings[i] || new Array(1536).fill(0)
    );
  }
  
  const EXPECTED_DIMENSIONS = 1536;
  
  try {
    // Track dimension warnings to reduce log noise
    let smallDimensionCount = 0;
    let largeDimensionCount = 0;
    let embeddingDimension = null;
    
    // Process embeddings: ensure correct format, dimension, and numeric values
    const processedEmbeddings = embeddings.map((embedding) => {
      if (!embedding) {
        return new Array(EXPECTED_DIMENSIONS).fill(0);
      }
      
      const embArray = Array.isArray(embedding) ? embedding : Object.values(embedding);
      
      // Record the embedding dimension for logging once
      if (embeddingDimension === null && embArray.length > 0) {
        embeddingDimension = embArray.length;
      }
      
      // Check for invalid values
      const hasInvalidValues = embArray.some(val => 
        typeof val !== 'number' || isNaN(val) || !isFinite(val)
      );
      
      if (hasInvalidValues) {
        return new Array(EXPECTED_DIMENSIONS).fill(0);
      }
      
      if (embArray.length === EXPECTED_DIMENSIONS) {
        return embArray;
      }
      
      // Adjust dimension if necessary
      if (embArray.length > EXPECTED_DIMENSIONS) {
        largeDimensionCount++;
        return embArray.slice(0, EXPECTED_DIMENSIONS);
      } else {
        smallDimensionCount++;
        const paddedEmbedding = [...embArray];
        while (paddedEmbedding.length < EXPECTED_DIMENSIONS) {
          paddedEmbedding.push(0);
        }
        return paddedEmbedding;
      }
    });

    // Log dimension adjustments once instead of for each chunk
    if (smallDimensionCount > 0) {
      console.log(`Adjusted ${smallDimensionCount} embeddings from ${embeddingDimension} to ${EXPECTED_DIMENSIONS} dimensions by padding with zeros`);
    }
    if (largeDimensionCount > 0) {
      console.log(`Adjusted ${largeDimensionCount} embeddings from ${embeddingDimension} to ${EXPECTED_DIMENSIONS} dimensions by truncating`);
    }

    // Sanitize chunks content before storage
    const sanitizedChunks = chunks.map(chunk => {
      // Get content from different possible field names
      let content = chunk.content || chunk.pageContent || '';
      
      // Apply sanitization to remove problematic Unicode characters
      const sanitizedContent = sanitizeString(content);
      
      // Sanitize metadata object
      const metadata = chunk.metadata || {};
      const sanitizedMetadata = sanitizeMetadataObject(metadata);
      
      return {
        content: sanitizedContent,
        metadata: sanitizedMetadata
      };
    });

    // Prepare data for upsert with sanitized content
    const upsertData = sanitizedChunks.map((chunk, index) => {
      // Convert metadata to string and handle potential JSON errors
      let metadataStr = '{}';
      try {
        // Use the sanitizeForJsonStringify utility function
        metadataStr = sanitizeForJsonStringify(chunk.metadata);
      } catch (error) { // Changed variable name to 'error' as 'jsonError' was unused
        console.warn(`Error stringifying metadata for chunk ${index}:`, error);
        // Fallback to empty object
      }
      
      return {
        document_id: documentId,
        user_id: userId,
        chunk_index: index, // Use the array index as the chunk_index
        content: chunk.content,
        metadata: metadataStr, // Use stringified metadata
        embedding: processedEmbeddings[index], // Use the processed embedding
      };
    });

    // Use upsert with the correct conflict target
    console.log(`Upserting ${upsertData.length} sanitized document chunks for document ${documentId}`);
    
    const batchSize = 100; // Supabase recommends batches of ~100 for upserts
    const chunkIds = [];
    let successCount = 0;
    let totalAttempted = 0;

    for (let i = 0; i < upsertData.length; i += batchSize) {
      const batch = upsertData.slice(i, i + batchSize);
      totalAttempted += batch.length;
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(upsertData.length / batchSize);
      
      console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} chunks)`);

      try {
        // Final validation of each batch item before sending to Supabase
        batch.forEach(item => {
          // Test if content can be JSON serialized
          try {
            JSON.stringify({ test: item.content });
          } catch (error) { // Renamed jsonError to error
            console.warn('Item content contains invalid characters, applying additional sanitization');
            item.content = item.content
              .replace(/[^\x20-\x7E\xA0-\uD7FF\uE000-\uFFFD\u10000-\u10FFFF]/g, ' ')
              .replace(/\uFFFD/g, ' ');
          }
        });

        const { data, error } = await supabase
          .from('document_chunks')
          .upsert(batch, { 
            onConflict: 'document_id, chunk_index', // Specify the columns causing conflict
            ignoreDuplicates: false // Ensure updates happen on conflict
          })
          .select('id'); // Select the IDs of the upserted rows

        if (error) {
          console.error(`Error upserting document chunks batch ${batchNum}:`, error);
          // Try to diagnose the error
          if (error.message && error.message.includes('Unicode')) {
            console.error('Unicode error detected in batch. Will retry with more aggressive sanitization');
            
            // Apply more aggressive sanitization to this batch
            const sanitizedBatch = batch.map(item => ({
              ...item,
              content: item.content
                // Replace anything that's not basic ASCII with space
                .replace(/[^\x20-\x7E]/g, ' ')
            }));
            
            // Retry with more aggressive sanitization
            const retryResult = await supabase
              .from('document_chunks')
              .upsert(sanitizedBatch, { 
                onConflict: 'document_id, chunk_index',
                ignoreDuplicates: false
              })
              .select('id');
              
            if (retryResult.data) {
              chunkIds.push(...retryResult.data.map(item => item.id));
              successCount += retryResult.data.length;
              console.log(`Successfully upserted batch ${batchNum} after additional sanitization`);
            } else if (retryResult.error) {
              console.error('Still failed after aggressive sanitization:', retryResult.error);
            }
          }
        } else {
          if (data && data.length > 0) {
            chunkIds.push(...data.map(item => item.id));
            successCount += data.length;
            console.log(`Successfully upserted batch ${batchNum}. ${data.length} chunks processed.`);
          } else {
            console.warn(`Batch ${batchNum} upsert returned no data, but no error reported.`);
          }
        }
      } catch (batchError) {
        console.error(`Exception during batch ${batchNum} upsert:`, batchError);
      }
    }
    
    // Clean up any extra chunks that are no longer needed
    try {
      await supabase
        .from('document_chunks')
        .delete()
        .eq('document_id', documentId)
        .gte('chunk_index', totalAttempted);
      
      console.log(`Cleaned up chunks with index >= ${totalAttempted} for document ${documentId}`);
    } catch (cleanupError) {
      console.warn('Exception during chunk cleanup:', cleanupError);
    }

    console.log(`Document chunks processing completed: ${successCount} chunks stored successfully`);
    return chunkIds;
  } catch (error) {
    console.error('Error in storeDocumentChunks:', error);
    throw error;
  }
};

/**
 * Retrieve all documents for the current user
 * @returns {Promise<Array>} - Array of document objects
 */
export const getUserDocuments = async () => {
  const userId = await getCurrentUserId();
  if (!userId) return [];
  
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
    
  if (error) {
    console.error('Error retrieving documents:', error);
    throw new Error('Gagal mengambil dokumen: ' + error.message);
  }
  
  return data || [];
};

/**
 * Retrieve public documents and documents shared with the current user
 * @returns {Promise<Array>} - Array of document objects
 */
export const getSharedDocuments = async () => {
  const userId = await getCurrentUserId();
  if (!userId) return [];
  
  try {
    // Use a simpler query first to avoid syntax issues
    const { data: publicDocs, error: publicError } = await supabase
      .from('documents')
      .select('*')
      .eq('is_public', true)
      .neq('user_id', userId);
      
    if (publicError) {
      console.error('Error retrieving public documents:', publicError);
    }
    
    // Get documents specifically shared with the user
    const { data: sharedDocs, error: sharedError } = await supabase
      .from('documents')
      .select('*')
      .eq('is_shared', true)
      .neq('user_id', userId);
      
    if (sharedError) {
      console.error('Error retrieving potentially shared documents:', sharedError);
    }
    
    // Filter out the ones not shared with this specific user
    const trulyShared = Array.isArray(sharedDocs) 
      ? sharedDocs.filter(doc => 
          Array.isArray(doc.shared_with) && doc.shared_with.includes(userId)
        )
      : [];
    
    // Combine results
    const combined = [
      ...(Array.isArray(publicDocs) ? publicDocs : []),
      ...trulyShared
    ];
    
    // Sort by creation date
    combined.sort((a, b) => 
      new Date(b.created_at) - new Date(a.created_at)
    );
    
    return combined;
  } catch (err) {
    console.error('Exception in getSharedDocuments:', err);
    return []; // Return empty array instead of throwing to prevent UI disruption
  }
};

/**
 * Share a document with specific users
 * @param {string} documentId - ID of the document to share
 * @param {Array<string>} userIds - Array of user IDs to share with
 * @returns {Promise<boolean>} - True if successful
 */
export const shareDocument = async (documentId, userIds) => {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('User not logged in');
  
  // First verify ownership of the document
  const { data: doc, error: checkError } = await supabase
    .from('documents')
    .select('user_id')
    .eq('id', documentId)
    .single();
    
  if (checkError || !doc) {
    throw new Error('Dokumen tidak ditemukan');
  }
  
  if (doc.user_id !== userId) {
    throw new Error('Anda tidak memiliki akses untuk membagikan dokumen ini');
  }
  
  // Update the document sharing settings
  const { error } = await supabase
    .from('documents')
    .update({
      is_shared: true,
      shared_with: userIds
    })
    .eq('id', documentId);
    
  if (error) {
    console.error('Error sharing document:', error);
    throw new Error('Gagal membagikan dokumen: ' + error.message);
  }
  
  return true;
};

/**
 * Make a document public or private
 * @param {string} documentId - ID of the document
 * @param {boolean} isPublic - Whether the document should be public
 * @returns {Promise<boolean>} - True if successful
 */
export const setDocumentPublic = async (documentId, isPublic) => {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('User not logged in');
  
  // First verify ownership of the document
  const { data: doc, error: checkError } = await supabase
    .from('documents')
    .select('user_id')
    .eq('id', documentId)
    .single();
    
  if (checkError || !doc) {
    throw new Error('Dokumen tidak ditemukan');
  }
  
  if (doc.user_id !== userId) {
    throw new Error('Anda tidak memiliki akses untuk mengubah dokumen ini');
  }
  
  // Update the document visibility
  const { error } = await supabase
    .from('documents')
    .update({
      is_public: isPublic,
      updated_at: new Date().toISOString()
    })
    .eq('id', documentId);
    
  if (error) {
    console.error('Error updating document visibility:', error);
    throw new Error('Gagal mengubah visibilitas dokumen: ' + error.message);
  }
  
  return true;
};

/**
 * Delete a document and all its chunks
 * @param {string} documentId - ID of the document to delete
 * @returns {Promise<{success: boolean, freedBytes: number}>} - Success status and bytes freed
 */
export const deleteDocument = async (documentId) => {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('User not logged in');
  
  try {
    // First verify ownership of the document
    const { data: doc, error: checkError } = await supabase
      .from('documents')
      .select('user_id, file_size')
      .eq('id', documentId)
      .single();
      
    if (checkError || !doc) {
      throw new Error('Dokumen tidak ditemukan');
    }
    
    if (doc.user_id !== userId) {
      throw new Error('Anda tidak memiliki akses untuk menghapus dokumen ini');
    }
    
    // Store the file size before deleting to return in the response
    const freedBytes = doc.file_size || 0;
    
    // Find all conversations that use this document
    const { data: affectedConversations, error: conversationError } = await supabase
      .from('conversations')
      .select('id, document_context')
      .contains('document_context', [documentId])
      .eq('user_id', userId);
    
    if (conversationError) {
      console.error('Error finding affected conversations:', conversationError);
    } else if (affectedConversations && affectedConversations.length > 0) {
      // Update each affected conversation to remove this document from context
      for (const conversation of affectedConversations) {
        const updatedContext = (conversation.document_context || []).filter(id => id !== documentId);
        await supabase
          .from('conversations')
          .update({ document_context: updatedContext })
          .eq('id', conversation.id)
          .eq('user_id', userId);
      }
    }
    
    // Delete all chunks associated with the document
    const { error: chunksError } = await supabase
      .from('document_chunks')
      .delete()
      .eq('document_id', documentId);
    
    if (chunksError) {
      console.error('Error deleting document chunks:', chunksError);
      throw new Error('Gagal menghapus dokumen: ' + chunksError.message);
    }

    // Delete the document
    const { error } = await supabase
      .from('documents')
      .delete()
      .eq('id', documentId);
      
    if (error) {
      console.error('Error deleting document:', error);
      throw new Error('Gagal menghapus dokumen: ' + error.message);
    }

    // Clear the document from RAG system
    clearRAGSystem(documentId);
    
    return { 
      success: true,
      freedBytes,
      documentId,
      affectedConversations: affectedConversations?.length || 0
    };
  } catch (error) {
    console.error('Error deleting document:', error);
    throw error;
  }
};

/**
 * Create or update a RAG session
 * @param {Array<string>} documentIds - Array of document IDs to include in the RAG session
 * @param {Object} config - Configuration for the RAG session
 * @returns {Promise<string>} - ID of the RAG session
 */
export const createRagSession = async (documentIds, config = {}) => {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('User not logged in');
  
  const { data, error } = await supabase
    .from('rag_sessions')
    .insert({
      user_id: userId,
      document_ids: documentIds,
      config,
      status: 'active',
      model_version: config.model || 'gemini-2.5-flash-preview-04-17',
      updated_at: new Date().toISOString(),
      last_accessed_at: new Date().toISOString()
    })
    .select('id')
    .single();
    
  if (error) {
    console.error('Error creating RAG session:', error);
    throw new Error('Gagal membuat sesi RAG: ' + error.message);
  }
  
  return data.id;
};

/**
 * Retrieve a user's active RAG sessions
 * @returns {Promise<Array>} - Array of RAG session objects
 */
export const getUserRagSessions = async () => {
  const userId = await getCurrentUserId();
  if (!userId) return [];
  
  const { data, error } = await supabase
    .from('rag_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false });
    
  if (error) {
    console.error('Error retrieving RAG sessions:', error);
    throw new Error('Gagal mengambil sesi RAG: ' + error.message);
  }
  
  return data || [];
};

/**
 * Update the last accessed time for a RAG session
 * @param {string} sessionId - ID of the RAG session
 * @returns {Promise<boolean>} - True if successful
 */
export const updateRagSessionAccess = async (sessionId) => {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('User not logged in');
  
  const { error } = await supabase
    .from('rag_sessions')
    .update({
      last_accessed_at: new Date().toISOString()
    })
    .eq('id', sessionId)
    .eq('user_id', userId);
    
  if (error) {
    console.error('Error updating RAG session access time:', error);
    // Non-critical error, don't throw
    return false;
  }
  
  return true;
};

/**
 * Search for documents using vector similarity
 * @param {Array<number>} queryEmbedding - The embedding vector for the query
 * @param {Array<string>} documentIds - Optional array of document IDs to limit search to
 * @param {number} limit - Maximum number of results to return
 * @returns {Promise<Array>} - Array of document chunks with similarity scores
 */
export const performVectorSearch = async (queryEmbedding, documentIds = [], limit = 5) => {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('User not logged in');
  
  // Validation to prevent common API errors
  if (!queryEmbedding || !Array.isArray(queryEmbedding)) {
    console.error('Invalid query embedding format:', queryEmbedding);
    throw new Error('Query embedding must be a non-empty array of numbers');
  }
  
  // Ensure embedding is an array of numbers with the expected dimension
  // Gemini embedding-004 generates 1536-dimensional vectors
  const EXPECTED_DIMENSIONS = 1536;
  let processedEmbedding = [...queryEmbedding];
  
  if (queryEmbedding.length !== EXPECTED_DIMENSIONS) {
    console.warn(`Query embedding dimensions mismatch: got ${queryEmbedding.length}, expected ${EXPECTED_DIMENSIONS}. Adjusting...`);
    
    if (queryEmbedding.length > EXPECTED_DIMENSIONS) {
      // If too large, truncate
      processedEmbedding = queryEmbedding.slice(0, EXPECTED_DIMENSIONS);
    } else {
      // If too small, pad with zeros
      processedEmbedding = [...queryEmbedding];
      while (processedEmbedding.length < EXPECTED_DIMENSIONS) {
        processedEmbedding.push(0);
      }
    }
  }
  
  // Ensure all values are valid numbers (not NaN or Infinity)
  const hasInvalidValues = processedEmbedding.some(val => 
    typeof val !== 'number' || isNaN(val) || !isFinite(val)
  );
  
  if (hasInvalidValues) {
    console.error('Invalid values in embedding vector');
    throw new Error('Embedding vector contains invalid values');
  }
  
  try {
    // First try using the RPC method (match_documents function)
    try {
      let query = supabase
        .rpc('match_documents', {
          query_embedding: processedEmbedding,
          match_threshold: 0.5, // Adjust as needed
          match_count: limit
        });
        
      // If documentIds provided, limit search to those documents
      if (documentIds && documentIds.length > 0) {
        query = query.in('document_id', documentIds);
      }
      
      const { data, error } = await query;
        
      if (error) {
        console.error('Error performing vector search via RPC:', error);
        // Will try fallback methods
        throw error;
      }
      
      console.log(`Vector search via RPC found ${data?.length || 0} results`);
      return data || [];
    } catch (rpcError) {
      // If RPC fails (function doesn't exist), try direct SQL query with cosine_distance
      console.warn('RPC vector search failed, trying direct query fallback:', rpcError.message);
      
      // Build a direct query using cosine_distance
      let queryText = `
        WITH document_ids AS (
          SELECT id FROM documents WHERE user_id = '${userId}'
        )
        SELECT 
          dc.id,
          dc.content,
          dc.metadata,
          dc.document_id,
          1 - (dc.embedding <=> $1) as similarity
        FROM 
          document_chunks dc
        WHERE 
          dc.user_id = '${userId}'
      `;
      
      // Add document filter if needed
      if (documentIds && documentIds.length > 0) {
        queryText += ` AND dc.document_id IN (${documentIds.map(id => `'${id}'`).join(',')})`;
      } else {
        queryText += ` AND dc.document_id IN (SELECT id FROM document_ids)`;
      }
      
      // Add similarity threshold and order/limit
      queryText += `
        AND (1 - (dc.embedding <=> $1)) > 0.5
        ORDER BY similarity DESC
        LIMIT ${limit};
      `;
      
      const { data, error } = await supabase.rpc('query_sql', { sql_query: queryText }, { 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: [processedEmbedding] })
      });
      
      if (error) {
        console.error('Direct SQL vector search failed:', error);
        // Will try text-based fallback
        throw error;
      }
      
      console.log(`Direct SQL vector search found ${data?.length || 0} results`);
      return data || [];
    }
  } catch (vectorSearchError) {
    console.warn('All vector search methods failed, falling back to text search:', vectorSearchError.message);
    
    // As last resort, fall back to text-based search
    return performTextSearch(queryEmbedding.join(' ').substring(0, 100), documentIds, limit);
  }
};

/**
 * Fallback text search when vector search is unavailable
 * @param {string} queryText - Text to search for 
 * @param {Array<string>} documentIds - Optional document IDs to filter by
 * @param {number} limit - Maximum results to return
 * @returns {Promise<Array>} - Search results
 */
const performTextSearch = async (queryText, documentIds = [], limit = 5) => {
  const userId = await getCurrentUserId();
  if (!userId) return [];
  
  try {
    // Extract meaningful keywords from query
    const keywords = queryText
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => 
        word.length > 2 && 
        !['and', 'the', 'for', 'with', 'yang', 'dari', 'atau', 'dan', 'adalah'].includes(word)
      );
    
    if (keywords.length === 0) {
      console.warn('No meaningful keywords found for text search');
      return [];
    }
    
    console.log('Fallback text search using keywords:', keywords);
    
    // Build query
    let query = supabase
      .from('document_chunks')
      .select(`
        id,
        content,
        document_id,
        metadata,
        user_id,
        chunk_index
      `)
      .eq('user_id', userId);
    
    // Add document filter if specified
    if (documentIds && documentIds.length > 0) {
      query = query.in('document_id', documentIds);
    }
    
    // Use ILIKE for the first keyword
    let filterQuery = `content.ilike.%${keywords[0]}%`;
    
    // Add additional keywords with OR
    for (let i = 1; i < Math.min(keywords.length, 3); i++) {
      filterQuery += ` or content.ilike.%${keywords[i]}%`;
    }
    
    query = query.or(filterQuery);
    
    // Add limit
    query = query.limit(limit);
    
    // Execute query
    const { data, error } = await query;
    
    if (error) {
      console.error('Fallback text search error:', error);
      return [];
    }
    
    console.log(`Fallback text search found ${data?.length || 0} results`);
    
    // Add document title to results by fetching document info
    if (data && data.length > 0) {
      const documentIds = [...new Set(data.map(item => item.document_id))];
      
      const { data: documents } = await supabase
        .from('documents')
        .select('id, title')
        .in('id', documentIds);
      
      const documentMap = {};
      if (documents) {
        documents.forEach(doc => {
          documentMap[doc.id] = doc.title;
        });
      }
      
      // Attach document titles and add similarity score
      return data.map((item, index) => ({
        ...item,
        document_title: documentMap[item.document_id] || 'Unknown Document',
        similarity: 0.5 - (index * 0.05) // Fake similarity scores
      }));
    }
    
    return data || [];
  } catch (error) {
    console.error('Error in fallback text search:', error);
    return [];
  }
};

/**
 * Get the total storage used by the current user in bytes
 * @returns {Promise<number>} - Total storage used in bytes
 */
export const getUserStorageUsed = async () => {
  const userId = await getCurrentUserId();
  if (!userId) return 0;
  
  const { data, error } = await supabase
    .from('documents')
    .select('file_size')
    .eq('user_id', userId);
    
  if (error) {
    console.error('Error retrieving storage info:', error);
    return 0;
  }
  
  return data.reduce((total, doc) => total + (doc.file_size || 0), 0);
};

/**
 * Check if user has enough storage available
 * @param {number} fileSize - Size of the file to check in bytes
 * @param {number} maxStorage - Maximum storage allowed in bytes (default: 100MB)
 * @returns {Promise<boolean>} - True if user has enough storage, false otherwise
 */
export const hasEnoughStorage = async (fileSize, maxStorage = 104857600) => {
  const currentStorage = await getUserStorageUsed();
  return (currentStorage + fileSize) <= maxStorage;
};

/**
 * Get storage usage statistics for the current user
 * @returns {Promise<Object>} - Storage statistics object
 */
export const getUserStorageStats = async () => {
  const MAX_STORAGE = 104857600; // 100MB in bytes
  const currentStorage = await getUserStorageUsed();
  
  const { data: documents, error } = await supabase
    .from('documents')
    .select('id, title, file_size, created_at')
    .eq('user_id', await getCurrentUserId())
    .order('created_at', { ascending: false });
    
  if (error) {
    console.error('Error retrieving document list:', error);
    return {
      used: currentStorage,
      max: MAX_STORAGE,
      percentage: (currentStorage / MAX_STORAGE) * 100,
      documents: []
    };
  }
  
  return {
    used: currentStorage,
    max: MAX_STORAGE,
    percentage: (currentStorage / MAX_STORAGE) * 100,
    documents: documents || []
  };
};

/**
 * Get storage usage information for the current user
 * @returns {Promise<Object>} - Object with storage usage information
 */
export const getStorageUsage = async () => {
  const userId = await getCurrentUserId();
  if (!userId) return { usedStorage: 0, totalStorage: 1000 * 1024 * 1024, percentage: 0 };
  
  try {
    // Get total size of user's documents
    const { data: documents, error: docsError } = await supabase
      .from('documents')
      .select('file_size')
      .eq('user_id', userId);
      
    if (docsError) {
      console.error('Error retrieving document sizes:', docsError);
      throw new Error('Gagal mendapatkan informasi penyimpanan');
    }
    
    // Calculate total used storage in bytes
    const usedStorage = documents?.reduce((total, doc) => total + (doc.file_size || 0), 0) || 0;
    
    // For now, set a fixed storage limit per user (example: 1GB)
    // In a production system, this would come from a subscription plan or user settings
    const totalStorage = 1000 * 1024 * 1024; // 1000 MB storage limit
    
    // Calculate percentage used
    const percentage = Math.min(Math.round((usedStorage / totalStorage) * 100), 100);
    
    return {
      usedStorage,
      totalStorage,
      percentage,
      documentsCount: documents?.length || 0,
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error getting storage usage:', error);
    throw error;
  }
};

/**
 * Clean up old documents to free up storage space
 * @param {number} targetBytes - Target bytes to free up
 * @returns {Promise<{success: boolean, freedBytes: number, deletedDocs: number}>}
 */
export const cleanupOldDocuments = async (targetBytes) => {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('User not logged in');
  
  // Get a list of documents sorted by last accessed time (oldest first)
  const { data, error } = await supabase
    .from('documents')
    .select('id, file_size, last_accessed_at')
    .eq('user_id', userId)
    .order('last_accessed_at', { ascending: true });
    
  if (error) {
    console.error('Error retrieving documents for cleanup:', error);
    throw new Error('Failed to retrieve documents for cleanup');
  }
  
  let freedBytes = 0;
  let deletedDocs = 0;
  
  for (const doc of data) {
    if (freedBytes >= targetBytes) break;
    
    try {
      await deleteDocument(doc.id);
      freedBytes += (doc.file_size || 0);
      deletedDocs++;
    } catch (err) {
      console.warn(`Failed to delete document ${doc.id} during cleanup:`, err);
    }
  }
  
  return { success: true, freedBytes, deletedDocs };
};

/**
 * Delete a conversation and optionally its associated documents
 * @param {string} conversationId - ID of the conversation to delete
 * @param {boolean} deleteDocuments - Whether to also delete the documents associated with this conversation
 * @returns {Promise<{success: boolean, deletedDocs: number, freedBytes: number}>}
 */
export const deleteConversationAndDocuments = async (conversationId, deleteDocuments = false) => {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('User not logged in');
  
  try {
    // First, get the conversation and its associated documents
    const { data: conversation, error: conversationError } = await supabase
      .from('conversations')
      .select('id, document_context')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .single();
      
    if (conversationError) {
      console.error('Error retrieving conversation:', conversationError);
      throw new Error('Gagal mengambil percakapan: ' + conversationError.message);
    }
    
    if (!conversation) {
      throw new Error('Percakapan tidak ditemukan');
    }
    
    let deletedDocs = 0;
    let freedBytes = 0;
    
    // If deleteDocuments is true and there are documents in the context, delete them
    if (deleteDocuments && conversation.document_context && conversation.document_context.length > 0) {
      // Get file sizes before deletion
      const { data: documentSizes } = await supabase
        .from('documents')
        .select('id, file_size')
        .in('id', conversation.document_context)
        .eq('user_id', userId);
      
      // Delete each document
      for (const docId of conversation.document_context) {
        try {
          await deleteDocument(docId);
          deletedDocs++;
          
          // Add the file size to freedBytes
          const docSize = documentSizes?.find(d => d.id === docId)?.file_size || 0;
          freedBytes += docSize;
        } catch (err) {
          console.warn(`Failed to delete document ${docId}:`, err);
        }
      }
    }
    
    // Remove the conversation from rag_sessions
    await supabase
      .from('rag_sessions')
      .update({ document_ids: [] })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);
    
    // Finally delete the conversation
    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', conversationId)
      .eq('user_id', userId);
      
    if (error) {
      console.error('Error deleting conversation:', error);
      throw new Error('Gagal menghapus percakapan: ' + error.message);
    }
    
    return { 
      success: true, 
      deletedDocs, 
      freedBytes
    };
  } catch (error) {
    console.error('Error deleting conversation and documents:', error);
    throw new Error('Gagal menghapus percakapan dan dokumen: ' + error.message);
  }
};

/**
 * Link documents to a conversation
 * @param {string} conversationId - ID of the conversation
 * @param {Array<string>} documentIds - IDs of documents to link
 * @returns {Promise<boolean>} - True if successful
 */
export const linkDocumentsToConversation = async (conversationId, documentIds) => {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('User not logged in');
  
  // Verify the conversation belongs to the user
  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('document_context')
    .eq('id', conversationId)
    .eq('user_id', userId)
    .single();
    
  if (convError || !conversation) {
    throw new Error('Percakapan tidak ditemukan');
  }
  
  // Get existing document context or initialize empty array
  const existingContext = conversation.document_context || [];
  
  // Combine existing and new documents, removing duplicates
  const updatedContext = Array.from(new Set([...existingContext, ...documentIds]));
  
  // Update the conversation with the new document context
  const { error } = await supabase
    .from('conversations')
    .update({
      document_context: updatedContext,
      updated_at: new Date().toISOString()
    })
    .eq('id', conversationId)
    .eq('user_id', userId);
    
  if (error) {
    console.error('Error linking documents to conversation:', error);
    throw new Error('Gagal menautkan dokumen ke percakapan: ' + error.message);
  }
  
  return true;
};

/**
 * Remove a document from a conversation
 * @param {string} conversationId - ID of the conversation
 * @param {string} documentId - ID of document to remove
 * @returns {Promise<boolean>} - True if successful
 */
export const removeDocumentFromConversation = async (conversationId, documentId) => {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('User not logged in');
  
  // Verify the conversation belongs to the user
  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('document_context')
    .eq('id', conversationId)
    .eq('user_id', userId)
    .single();
    
  if (convError || !conversation) {
    throw new Error('Percakapan tidak ditemukan');
  }
  
  // Filter out the document to remove
  const existingContext = conversation.document_context || [];
  const updatedContext = existingContext.filter(id => id !== documentId);
  
  // Update the conversation with the new document context
  const { error } = await supabase
    .from('conversations')
    .update({
      document_context: updatedContext,
      updated_at: new Date().toISOString()
    })
    .eq('id', conversationId)
    .eq('user_id', userId);
    
  if (error) {
    console.error('Error removing document from conversation:', error);
    throw new Error('Gagal menghapus dokumen dari percakapan: ' + error.message);
  }
  
  return true;
};

/**
 * Get documents associated with a conversation
 * @param {string} conversationId - ID of the conversation
 * @returns {Promise<Array>} - Array of document objects
 */
export const getConversationDocuments = async (conversationId) => {
  const userId = await getCurrentUserId();
  if (!userId) return [];
  
  // Get document IDs from the conversation
  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('document_context')
    .eq('id', conversationId)
    .eq('user_id', userId)
    .single();
    
  if (convError || !conversation || !conversation.document_context || conversation.document_context.length === 0) {
    return [];
  }
  
  // Get the documents
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .in('id', conversation.document_context);
    
  if (error) {
    console.error('Error retrieving conversation documents:', error);
    return [];
  }
  
  return data || [];
};

/**
 * Restore RAG context from a conversation
 * @param {string} conversationId - ID of the conversation
 * @returns {Promise<boolean>} - True if successful
 */
export const restoreRagContextFromConversation = async (conversationId) => {
  try {
    const documents = await getConversationDocuments(conversationId);
    if (!documents || documents.length === 0) {
      return false;
    }
    
    // Load documents back into the RAG system
    await reloadRAGContext(documents);
    return true;
  } catch (error) {
    console.error('Error restoring RAG context:', error);
    return false;
  }
};

/**
 * Get documents for a RAG session
 * @param {string} sessionId - ID of the RAG session
 * @returns {Promise<Array>} - Array of document objects
 */
export const getRagSessionDocuments = async (sessionId) => {
  const userId = await getCurrentUserId();
  if (!userId) return [];
  
  // Get the RAG session
  const { data: session, error: sessionError } = await supabase
    .from('rag_sessions')
    .select('document_ids, conversation_id')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .single();
    
  if (sessionError || !session) {
    console.error('Error retrieving RAG session:', sessionError);
    return [];
  }
  
  // If this session has a conversation ID, check if there are documents there
  if (session.conversation_id) {
    const conversationDocs = await getConversationDocuments(session.conversation_id);
    if (conversationDocs && conversationDocs.length > 0) {
      return conversationDocs;
    }
  }
  
  // If not, or if conversation has no documents, use the session's document_ids
  if (!session.document_ids || session.document_ids.length === 0) {
    return [];
  }
  
  // Get the documents
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .in('id', session.document_ids);
    
  if (error) {
    console.error('Error retrieving RAG session documents:', error);
    return [];
  }
  
  return data || [];
};

/**
 * Associate a RAG session with a conversation
 * @param {string} sessionId - ID of the RAG session
 * @param {string} conversationId - ID of the conversation
 * @returns {Promise<boolean>} - True if successful
 */
export const linkRagSessionToConversation = async (sessionId, conversationId) => {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('User not logged in');
  
  // Update the RAG session
  const { error } = await supabase
    .from('rag_sessions')
    .update({ 
      conversation_id: conversationId,
      updated_at: new Date().toISOString() 
    })
    .eq('id', sessionId)
    .eq('user_id', userId);
    
  if (error) {
    console.error('Error linking RAG session to conversation:', error);
    return false;
  }
  
  return true;
};

/**
 * Get active documents in the RAG system
 * @returns {Promise<Array>} - Array of document objects currently active in the RAG system
 */
export const getActiveRagDocuments = async () => {
  const userId = await getCurrentUserId();
  if (!userId) return [];
  
  // First try to get from the active RAG session
  const { data: sessions, error: sessionError } = await supabase
    .from('rag_sessions')
    .select('document_ids, conversation_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('last_accessed_at', { ascending: false })
    .limit(1);
    
  if (sessionError || !sessions || sessions.length === 0) {
    return [];
  }
  
  const activeSession = sessions[0];
  
  // Check if there's a linked conversation
  if (activeSession.conversation_id) {
    const conversationDocs = await getConversationDocuments(activeSession.conversation_id);
    if (conversationDocs && conversationDocs.length > 0) {
      return conversationDocs;
    }
  }
  
  // If no conversation or no docs in conversation, use session's document_ids
  if (!activeSession.document_ids || activeSession.document_ids.length === 0) {
    return [];
  }
  
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .in('id', activeSession.document_ids);
    
  if (error) {
    console.error('Error retrieving active RAG documents:', error);
    return [];
  }
  
  return data || [];
};

/**
 * Get document content by ID
 * @param {string} documentId - ID of the document to retrieve
 * @returns {Promise<string>} - Document content as text
 */
export const getDocumentContent = async (documentId) => {
  const userId = await getCurrentUserId();
  
  // Create query to get document
  let query = supabase
    .from('documents')
    .select('content, user_id, is_public, is_shared, shared_with')
    .eq('id', documentId)
    .single();
  
  const { data, error } = await query;
    
  if (error) {
    console.error('Error retrieving document content:', error);
    throw new Error('Gagal mengambil konten dokumen: ' + error.message);
  }
  
  // Check permissions - user should be the owner OR document should be public OR shared with them
  if (
    !data || 
    (
      data.user_id !== userId && 
      !data.is_public && 
      !(data.is_shared && data.shared_with && data.shared_with.includes(userId))
    )
  ) {
    throw new Error('Anda tidak memiliki akses ke dokumen ini');
  }
  
  // Update last accessed time in the background
  supabase
    .from('documents')
    .update({ last_accessed_at: new Date().toISOString() })
    .eq('id', documentId)
    .then(() => {})
    .catch(err => console.warn('Failed to update last_accessed_at:', err));
  
  return data.content || '';
};

/**
 * Get all documents for a specific user or the current user
 * @param {string} [userId] - Optional user ID (if not provided, uses current user)
 * @returns {Promise<Array>} - Array of document objects
 */
export const getDocuments = async (userId) => {
  // If userId is not provided, get current user ID
  if (!userId) {
    const user = await getCurrentUser();
    if (!user) return [];
    userId = user.id;
  }
  
  try {
    // Get user's own documents
    const { data: ownDocuments, error: ownError } = await supabase
      .from('documents')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
      
    if (ownError) {
      console.error('Error retrieving user documents:', ownError);
      throw new Error('Gagal mengambil dokumen: ' + ownError.message);
    }
    
    // Get public documents first (separate query)
    const { data: publicDocs, error: publicError } = await supabase
      .from('documents')
      .select('*')
      .eq('is_public', true)
      .neq('user_id', userId) // Exclude user's own documents
      .order('created_at', { ascending: false });
      
    if (publicError) {
      console.error('Error retrieving public documents:', publicError);
      // Non-critical error, continue
    }
    
    // Then get shared documents using array containment
    // Using a separate query to avoid the complex OR filter syntax issues
    const { data: sharedDocs, error: sharedError } = await supabase
      .from('documents')
      .select('*')
      .eq('is_shared', true)
      .neq('user_id', userId)
      .order('created_at', { ascending: false });
      
    if (sharedError) {
      console.error('Error retrieving shared documents:', sharedError);
      // Non-critical error, continue
    }
    
    // Filter shared docs where current user ID is in the shared_with array
    const filteredSharedDocs = (sharedDocs || []).filter(doc => {
      if (!doc.shared_with || !Array.isArray(doc.shared_with)) {
        return false;
      }
      return doc.shared_with.includes(userId);
    });
    
    // Combine all document sets
    const allDocuments = [
      ...(ownDocuments || []),
      ...(publicDocs || []),
      ...filteredSharedDocs
    ];
    
    // Remove duplicates (in case a document is both public and shared)
    const uniqueDocs = [];
    const docIds = new Set();
    
    for (const doc of allDocuments) {
      if (!docIds.has(doc.id)) {
        docIds.add(doc.id);
        uniqueDocs.push(doc);
      }
    }
    
    return uniqueDocs;
  } catch (err) {
    console.error('Error in getDocuments:', err);
    // Return empty array since the ownDocuments variable might not be defined in this scope
    return [];
  }
};

/**
 * Update document usage statistics
 * @param {string} documentId - ID of the document to update usage for
 * @param {Object} usageData - Object containing usage metrics to update
 * @returns {Promise<boolean>} - True if successful
 */
export const updateDocumentUsage = async (documentId, usageData = {}) => {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('User not logged in');
  
  try {
    // Get the current document metadata
    const { data: document, error: getError } = await supabase
      .from('documents')
      .select('metadata')
      .eq('id', documentId)
      .eq('user_id', userId)
      .single();
      
    if (getError) {
      console.error('Error retrieving document metadata:', getError);
      return false;
    }
    
    // Update metadata with usage statistics
    const currentMetadata = document.metadata || {};
    const usage = currentMetadata.usage || {};
    
    // Update usage counters
    const updatedUsage = {
      ...usage,
      accessCount: (usage.accessCount || 0) + 1,
      lastAccessed: new Date().toISOString(),
      totalQueries: (usage.totalQueries || 0) + (usageData.queryCount || 0),
      charactersFetched: (usage.charactersFetched || 0) + (usageData.charactersFetched || 0),
      ...usageData
    };
    
    // Save updated metadata
    const { error: updateError } = await supabase
      .from('documents')
      .update({
        metadata: {
          ...currentMetadata,
          usage: updatedUsage
        },
        last_accessed_at: new Date().toISOString()
      })
      .eq('id', documentId)
      .eq('user_id', userId);
      
    if (updateError) {
      console.error('Error updating document usage:', updateError);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Error in updateDocumentUsage:', error);
    return false;
  }
};