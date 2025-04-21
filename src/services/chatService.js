import { supabase } from '../utils/supabaseClient';
import { getCurrentUser } from './authService';

// Helper function to get current user ID safely
const getCurrentUserId = async () => {
  const user = await getCurrentUser();
  if (!user) {
    // Handle cases where user is not logged in, maybe redirect or throw specific error
    console.warn('User not logged in when trying to access chat service.');
    return null;
  }
  return user.id;
};

/**
 * Get all chat history (conversations) for the current user from Supabase.
 * @returns {Promise<Array>} - Array of conversation objects.
 */
export const getUserChatHistory = async () => {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from('conversations')
    .select('id, title, created_at, updated_at') // Select only necessary fields for the list
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Error fetching user chat history:', error);
    throw new Error('Gagal mengambil riwayat percakapan.');
  }

  // Map data to match the previous structure if needed, or adjust components
  return data || [];
};

/**
 * Create a new conversation in Supabase.
 * @param {string} title - Initial title for the conversation.
 * @returns {Promise<object>} - The newly created conversation object.
 */
export const createNewConversation = async (title = 'New Chat') => {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('User not logged in');

  const { data, error } = await supabase
    .from('conversations')
    .insert([{ user_id: userId, title: title }])
    .select()
    .single(); // Use single() if you expect only one row back

  if (error) {
    console.error('Error creating new conversation:', error);
    throw new Error('Gagal membuat percakapan baru.');
  }

  return data;
};

/**
 * Get a specific conversation and its messages from Supabase.
 * @param {string} conversationId - The ID of the conversation.
 * @returns {Promise<object|null>} - Conversation object with messages, or null if not found.
 */
export const getConversation = async (conversationId) => {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  // 1. Fetch conversation details
  const { data: convData, error: convError } = await supabase
    .from('conversations')
    .select('id, title, created_at, updated_at')
    .eq('id', conversationId)
    .eq('user_id', userId) // Ensure user owns the conversation
    .single();

  if (convError) {
    if (convError.code === 'PGRST116') { // Not found code
      console.warn(`Conversation ${conversationId} not found or user does not have access.`);
      return null;
    }
    console.error('Error fetching conversation:', convError);
    throw new Error('Gagal mengambil detail percakapan.');
  }

  if (!convData) return null;

  // 2. Fetch messages for the conversation
  const { data: messagesData, error: messagesError } = await supabase
    .from('messages')
    .select('id, role, content, created_at, metadata')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (messagesError) {
    console.error('Error fetching messages:', messagesError);
    throw new Error('Gagal mengambil pesan percakapan.');
  }

  // Combine conversation data with messages
  return {
    ...convData,
    messages: messagesData || [],
  };
};

/**
 * Add a message to a conversation in Supabase.
 * @param {string} conversationId - The ID of the conversation.
 * @param {string} role - Role of the message sender ('user', 'assistant', 'thinking').
 * @param {string} content - The message content.
 * @param {object|null} metadata - Optional metadata (e.g., for thinking messages).
 * @returns {Promise<object>} - The newly added message object.
 */
export const addMessageToConversation = async (conversationId, role, content, metadata = null) => {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('User not logged in');

  // 1. Insert the new message
  const { data: messageData, error: messageError } = await supabase
    .from('messages')
    .insert([{
      conversation_id: conversationId,
      user_id: userId,
      role: role,
      content: content,
      metadata: metadata,
    }])
    .select()
    .single();

  if (messageError) {
    console.error('Error adding message:', messageError);
    throw new Error('Gagal menambahkan pesan.');
  }

  // 2. Update the conversation's updated_at timestamp (and title if first user message)
  const updatePayload = { updated_at: new Date().toISOString() };

  // Check if it's the first user message to update title
  if (role === 'user') {
    const { count, error: countError } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .eq('role', 'user');

    if (countError) {
      console.error('Error counting user messages:', countError);
      // Continue without updating title if count fails
    } else if (count === 1) {
      updatePayload.title = content.substring(0, 30) + (content.length > 30 ? '...' : '');
    }
  }

  const { error: updateConvError } = await supabase
    .from('conversations')
    .update(updatePayload)
    .eq('id', conversationId)
    .eq('user_id', userId);

  if (updateConvError) {
    console.error('Error updating conversation timestamp/title:', updateConvError);
    // Log error but proceed, message was already added
  }

  return messageData;
};

/**
 * Delete a conversation and its messages from Supabase.
 * @param {string} conversationId - The ID of the conversation to delete.
 * @returns {Promise<void>}
 */
export const deleteConversation = async (conversationId) => {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('User not logged in');

  // Supabase cascade delete should handle messages if foreign key is set up correctly.
  // Otherwise, delete messages first:
  /*
  const { error: msgError } = await supabase
    .from('messages')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('user_id', userId); // Ensure user owns messages too

  if (msgError) {
    console.error('Error deleting messages for conversation:', msgError);
    throw new Error('Gagal menghapus pesan terkait.');
  }
  */

  // Delete the conversation itself
  const { error } = await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId)
    .eq('user_id', userId); // Ensure user owns the conversation

  if (error) {
    console.error('Error deleting conversation:', error);
    throw new Error('Gagal menghapus percakapan.');
  }
};

/**
 * Clear all conversations and messages for the current user from Supabase.
 * @returns {Promise<void>}
 */
export const clearAllConversations = async () => {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('User not logged in');

  // Similar to deleteConversation, cascade delete is preferred.
  // Otherwise, delete messages first:
  /*
  const { error: msgError } = await supabase
    .from('messages')
    .delete()
    .eq('user_id', userId);
  if (msgError) {
    console.error('Error deleting all user messages:', msgError);
    throw new Error('Gagal menghapus semua pesan pengguna.');
  }
  */

  // Delete all conversations for the user
  const { error } = await supabase
    .from('conversations')
    .delete()
    .eq('user_id', userId);

  if (error) {
    console.error('Error clearing all conversations:', error);
    throw new Error('Gagal menghapus semua percakapan.');
  }
};

// Remove localStorage related code and memory functions as they are replaced by Supabase
// const CHAT_HISTORY_KEY = ... (removed)
// const CHAT_MEMORY_KEY = ... (removed)
// initializeChatStorage = ... (removed)
// saveChatHistory = ... (removed)
// getConversationMemory = ... (removed)
// updateConversationMemory = ... (removed)
// clearConversationMemory = ... (removed)
// clearAllConversationMemories = ... (removed)