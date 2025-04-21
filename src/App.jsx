import { useState, useEffect } from 'react';
import './App.css';
import { getCurrentUser, onAuthStateChange, logoutUser } from './services/authService'; 
import LoginForm from './components/LoginForm';
import Chatbot from './components/Chatbot';
import ErrorMessage from './components/ErrorMessage';
import { BookOpen } from 'lucide-react';
import { SupabaseProvider } from './utils/supabaseClient';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); 
  const [appError, setAppError] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');

  // Check initial auth state and set up listener
  useEffect(() => {
    setLoading(true);
    // Check current session
    getCurrentUser()
      .then(currentUser => {
        setUser(currentUser);
      })
      .catch(error => {
        console.error("Error getting initial user:", error);
        setAppError('Gagal memuat sesi pengguna.');
      })
      .finally(() => {
        setLoading(false);
      });

    // Listen for auth changes (login/logout)
    const { data: authListener } = onAuthStateChange((_user) => {
      console.log('Auth state changed, new user:', _user);
      setUser(_user);
    });

    // Apply theme
    document.documentElement.setAttribute('data-theme', theme);

    // Cleanup listener on component unmount
    return () => {
      if (authListener?.unsubscribe) {
        authListener.unsubscribe();
      }
    };
  }, [theme]);

  // Handle logout
  const handleLogout = async () => {
    try {
      await logoutUser();
    } catch (error) {
      console.error("Logout error:", error);
      setAppError(error.message || 'Gagal logout.');
    }
  };

  // Toggle theme function
  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  };

  // Show loading indicator with improved styling
  if (loading) {
    return (
      <div className="loading-container" data-theme={theme}>
        <div className="loading-content">
          <div className="app-logo-loader">
            <BookOpen size={40} />
            <span>D'Notebook</span>
          </div>
          <div className="loading-spinner-large"></div>
          <p>Memuat aplikasi...</p>
        </div>
      </div>
    ); 
  }

  return (
    <SupabaseProvider>
      <div className="app-container" data-theme={theme}>
        {appError && (
          <ErrorMessage message={appError} onClose={() => setAppError(null)} />
        )}

        {user ? (
          <Chatbot 
            user={user} 
            onLogout={handleLogout} 
            onToggleTheme={toggleTheme} 
            theme={theme} 
          /> 
        ) : (
          <LoginForm theme={theme} onToggleTheme={toggleTheme} />
        )}
      </div>
    </SupabaseProvider>
  );
}

export default App;
