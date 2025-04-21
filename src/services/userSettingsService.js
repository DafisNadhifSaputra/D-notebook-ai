import { supabase } from '../utils/supabaseClient';
import { getCurrentUser } from './authService';

/**
 * Helper function to get current user ID safely
 * @returns {Promise<string|null>} - User ID if logged in, null otherwise
 */
const getCurrentUserId = async () => {
  const user = await getCurrentUser();
  if (!user) {
    console.warn('User not logged in when trying to access user settings service.');
    return null;
  }
  return user.id;
};

/**
 * Get user settings from the database
 * @returns {Promise<Object>} User settings object
 */
export const getUserSettings = async () => {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  try {
    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 is "row not found"
      console.error('Error fetching user settings:', error);
      throw new Error('Gagal mengambil pengaturan pengguna');
    }

    return data || null;
  } catch (err) {
    console.error('Error in getUserSettings:', err);
    return null;
  }
};

/**
 * Get user's API key from database
 * @returns {Promise<string|null>} The API key or null if not found
 */
export const getApiKey = async () => {
  try {
    const settings = await getUserSettings();
    return settings?.api_key || null;
  } catch (err) {
    console.error('Error getting API key:', err);
    return null;
  }
};

/**
 * Get user's preferred AI configuration
 * @returns {Promise<Object>} AI configuration object with default values
 */
export const getAIConfig = async () => {
  try {
    const settings = await getUserSettings();
    
    // Default AI config if settings not found
    const defaultConfig = {
      temperature: 0.2,
      maxOutputTokens: 65536,
      topP: 0.95,
      topK: 64,
      model: 'gemini-2.0-flash', // Default model is now gemini-2.0-flash
      responseStyle: 'balanced',
      showThinkingProcess: false
    };

    if (!settings) {
      return defaultConfig;
    }

    // Merge saved settings with defaults
    return {
      ...defaultConfig,
      ...settings.ai_config,
      model: settings.default_model || defaultConfig.model // Use default_model field with fallback
    };
  } catch (err) {
    console.error('Error getting AI config:', err);
    // Return defaults if there's an error
    return {
      temperature: 0.2,
      maxOutputTokens: 65536,
      topP: 0.95,
      topK: 64,
      model: 'gemini-2.0-flash',
      responseStyle: 'balanced',
      showThinkingProcess: false
    };
  }
};

/**
 * Save API key to database
 * @param {string} apiKey - API Key to save
 * @returns {Promise<boolean>} - True if successful
 */
export const saveApiKey = async (apiKey) => {
  const userId = await getCurrentUserId();
  if (!userId) {
    console.error('Cannot save API key: User not logged in');
    throw new Error('User not logged in');
  }

  try {
    // Check if user settings already exist
    const existingSettings = await getUserSettings();

    if (existingSettings) {
      // Update existing settings
      const { error } = await supabase
        .from('user_settings')
        .update({ api_key: apiKey, updated_at: new Date().toISOString() })
        .eq('user_id', userId);

      if (error) throw error;
    } else {
      // Create new settings
      const { error } = await supabase
        .from('user_settings')
        .insert([{ 
          user_id: userId, 
          api_key: apiKey,
          default_model: 'gemini-2.0-flash' // Ensure default model is set
        }]);

      if (error) throw error;
    }

    // Also store in localStorage as backup
    localStorage.setItem('gemini_api_key', apiKey);
    
    return true;
  } catch (err) {
    console.error('Error saving API key:', err);
    throw new Error('Gagal menyimpan API key: ' + err.message);
  }
};

/**
 * Save AI configuration to database
 * @param {Object} config - AI configuration object
 * @returns {Promise<boolean>} - True if successful
 */
export const saveAIConfig = async (config) => {
  const userId = await getCurrentUserId();
  if (!userId) {
    console.error('Cannot save AI config: User not logged in');
    throw new Error('User not logged in');
  }

  try {
    // Extract model from config for separate storage
    const { model, ...aiConfigWithoutModel } = config;
    
    // Check if user settings already exist
    const existingSettings = await getUserSettings();

    if (existingSettings) {
      // Update existing settings
      const { error } = await supabase
        .from('user_settings')
        .update({ 
          default_model: model, 
          ai_config: aiConfigWithoutModel,
          updated_at: new Date().toISOString() 
        })
        .eq('user_id', userId);

      if (error) throw error;
    } else {
      // Create new settings
      const { error } = await supabase
        .from('user_settings')
        .insert([{ 
          user_id: userId,
          default_model: model,
          ai_config: aiConfigWithoutModel
        }]);

      if (error) throw error;
    }

    return true;
  } catch (err) {
    console.error('Error saving AI config:', err);
    throw new Error('Gagal menyimpan konfigurasi AI: ' + err.message);
  }
};

/**
 * Delete API key from database
 * @returns {Promise<boolean>} - True if successful
 */
export const deleteApiKey = async () => {
  const userId = await getCurrentUserId();
  if (!userId) return false;

  try {
    const { error } = await supabase
      .from('user_settings')
      .update({ api_key: null })
      .eq('user_id', userId);

    if (error) throw error;
    
    // Also remove from localStorage
    localStorage.removeItem('gemini_api_key');
    
    return true;
  } catch (err) {
    console.error('Error deleting API key:', err);
    return false;
  }
};

/**
 * Get backup API key from localStorage if database retrieval fails
 * @returns {string|null} API key from localStorage or null
 */
export const getBackupApiKey = () => {
  return localStorage.getItem('gemini_api_key') || null;
};