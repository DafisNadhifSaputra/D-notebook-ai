import { createClient } from '@supabase/supabase-js';
import { useState, useEffect, createContext, useContext as useReactContext } from 'react';

// Mendapatkan variabel lingkungan dari Vite
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Debugging - cetak variabel lingkungan (hapus di production)
console.log('Supabase URL:', supabaseUrl ? 'Loaded' : 'Not loaded');
console.log('Supabase Anon Key:', supabaseAnonKey ? 'Loaded' : 'Not loaded');

// Validasi konfigurasi
if (!supabaseUrl) {
  console.error('Supabase URL belum dikonfigurasi. Silakan tambahkan VITE_SUPABASE_URL ke file .env');
  throw new Error('Supabase URL tidak ditemukan. Periksa file .env Anda.');
}

if (!supabaseAnonKey) {
  console.error('Supabase Anon Key belum dikonfigurasi. Silakan tambahkan VITE_SUPABASE_ANON_KEY ke file .env');
  throw new Error('Supabase Anon Key tidak ditemukan. Periksa file .env Anda.');
}

// Buat Supabase client dengan URL dan key valid
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Create a context for Supabase
const SupabaseContext = createContext(null);

// Provider component
export const SupabaseProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const value = {
    session,
    loading,
    supabase
  };

  return (
    <SupabaseContext.Provider value={value}>
      {children}
    </SupabaseContext.Provider>
  );
};

// Hook to use the Supabase context (renamed to avoid recursive calls)
export const useSupabaseContext = () => {
  const context = useReactContext(SupabaseContext);
  if (context === null) {
    throw new Error('useSupabaseContext must be used within a SupabaseProvider');
  }
  return context;
};

// For backward compatibility with existing code, export useContext alias
export const useContext = useSupabaseContext;