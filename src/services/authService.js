import { supabase } from '../utils/supabaseClient';

// Simple authentication service using Supabase Auth

/**
 * Register a new user using Supabase Auth.
 * @param {string} email - User's email (using username as email for simplicity).
 * @param {string} password - User's password.
 * @param {string} name - User's display name (optional).
 * @returns {Promise<object>} - The user object from Supabase.
 */
export const registerUser = async (email, password, name) => {
  const { data, error } = await supabase.auth.signUp({
    email: email,
    password: password,
    options: {
      data: {
        full_name: name || email, // Store name in user metadata
      }
    }
  });

  if (error) {
    console.error('Supabase registration error:', error);
    // Provide more specific error messages
    if (error.message.includes('already registered')) {
      throw new Error('Email sudah terdaftar. Silakan gunakan email lain atau login.');
    } else if (error.message.includes('Password should be at least')) {
      throw new Error('Password harus minimal 6 karakter.');
    } else {
      throw new Error(error.message || 'Gagal mendaftar. Silakan coba lagi.');
    }
  }

  // Return user data (might need email confirmation depending on Supabase settings)
  return data.user;
};

/**
 * Login user using Supabase Auth.
 * @param {string} email - User's email.
 * @param {string} password - User's password.
 * @returns {Promise<object>} - The user object from Supabase.
 */
export const loginUser = async (email, password) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email,
    password: password,
  });

  if (error) {
    console.error('Supabase login error:', error);
    if (error.message.includes('Invalid login credentials')) {
      throw new Error('Email atau password salah.');
    } else {
      throw new Error(error.message || 'Gagal login. Silakan coba lagi.');
    }
  }

  return data.user;
};

/**
 * Get current logged-in user session from Supabase.
 * This function is now asynchronous.
 * @returns {Promise<object|null>} - The user object if logged in, otherwise null.
 */
export const getCurrentUser = async () => {
  const { data: { session }, error } = await supabase.auth.getSession();

  if (error) {
    console.error('Error getting Supabase session:', error);
    return null;
  }

  if (!session) {
    return null;
  }

  // Return the user object, potentially adding name from metadata
  const user = session.user;
  return {
    id: user.id,
    email: user.email,
    name: user.user_metadata?.full_name || user.email, // Get name from metadata
    // Add other relevant user fields if needed
  };
};

/**
 * Logout user using Supabase Auth.
 * @returns {Promise<void>}
 */
export const logoutUser = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error('Supabase logout error:', error);
    throw new Error(error.message || 'Gagal logout.');
  }
};

/**
 * Listen for authentication state changes.
 * @param {function} callback - Function to call when auth state changes.
 * @returns {object} - Subscription object with an unsubscribe method.
 */
export const onAuthStateChange = (callback) => {
  const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
    console.log('Auth event:', event);
    const user = session?.user ? {
      id: session.user.id,
      email: session.user.email,
      name: session.user.user_metadata?.full_name || session.user.email,
    } : null;
    callback(user);
  });

  return authListener;
};