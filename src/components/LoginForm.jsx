import React, { useState, useEffect } from 'react';
import { loginUser, registerUser } from '../services/authService';
import { Eye, EyeOff, LogIn, UserPlus, Mail, Lock, User, BookOpen, AlertCircle, Moon, Sun } from 'lucide-react';
import './LoginForm.css';

const LoginForm = ({ theme, onToggleTheme }) => { 
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState(''); 
  const [password, setPassword] = useState('');
  const [name, setName] = useState(''); 
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formStatus, setFormStatus] = useState(null);

  // Reset form status after showing success message
  useEffect(() => {
    let timer;
    if (formStatus === 'success') {
      timer = setTimeout(() => {
        setFormStatus(null);
      }, 3000);
    }
    return () => clearTimeout(timer);
  }, [formStatus]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setFormStatus(null);
    setLoading(true);

    try {
      if (isLogin) {
        await loginUser(email, password); 
      } else {
        await registerUser(email, password, name); 
        // Show success message after registration
        setFormStatus('success');
        // Switch to login form after successful registration
        setTimeout(() => setIsLogin(true), 1500);
      }
      setPassword('');
      setName('');
    } catch (err) {
      console.error('Login/Register Error:', err);
      setError(err.message || 'Terjadi kesalahan. Silakan coba lagi.');
    } finally {
      setLoading(false);
    }
  };

  const toggleFormMode = () => {
    setIsLogin(!isLogin);
    setError('');
    setFormStatus(null);
    // Clear fields when switching forms for better security
    setPassword('');
  };

  return (
    <div className="login-form-container" data-theme={theme}>
      <div className="theme-toggle">
        <button 
          onClick={onToggleTheme} 
          className="theme-toggle-btn" 
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </button>
      </div>

      <div className="login-form-card">
        <div className="form-header">
          <div className="app-logo">
            <BookOpen size={32} strokeWidth={2.5} />
            <span>D'Notebook</span>
          </div>
          <div className='welcome'>
          <h2>{isLogin ? 'Selamat Datang Kembali' : 'Buat Akun Baru'}</h2>
          </div>
        </div>
        
        {error && (
          <div className="alert alert-danger">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}
        
        {formStatus === 'success' && (
          <div className="alert alert-success">
            <span>Registrasi berhasil! Silahkan login dengan akun baru Anda.</span>
          </div>
        )}
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">
              <Mail size={18} className="input-icon" />
              <span>Email</span>
            </label>
            <input
              type="email"
              id="email"
              className="form-control"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nama@contoh.com"
              required
              disabled={loading}
              autoComplete="email"
              autoFocus
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="password">
              <Lock size={18} className="input-icon" />
              <span>Password</span>
            </label>
            <div className="password-input-wrapper">
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                className="form-control"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isLogin ? "Masukkan password Anda" : "Buat password yang kuat"}
                required
                disabled={loading}
                autoComplete={isLogin ? "current-password" : "new-password"}
                minLength={6}
              />
              <button 
                type="button" 
                className="password-toggle-btn" 
                onClick={() => setShowPassword(!showPassword)}
                tabIndex="-1"
                aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {!isLogin && (
              <small className="form-text text-muted">Password minimal 6 karakter</small>
            )}
          </div>
          
          {!isLogin && (
            <div className="form-group">
              <label htmlFor="name">
                <User size={18} className="input-icon" />
                <span>Nama (Opsional)</span>
              </label> 
              <input
                type="text"
                id="name"
                className="form-control"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nama Anda"
                disabled={loading}
                autoComplete="name"
              />
            </div>
          )}
          
          <div className="form-action">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? (
                <>
                  <span className="loading-spinner"></span>
                  <span>{isLogin ? 'Masuk...' : 'Mendaftar...'}</span>
                </>
              ) : (
                <>
                  {isLogin ? <LogIn size={18} /> : <UserPlus size={18} />}
                  <span>{isLogin ? 'Masuk' : 'Daftar'}</span>
                </>
              )}
            </button>
          </div>
        </form>
        
        <div className="form-toggle">
          <button
            type="button"
            className="btn-link"
            onClick={toggleFormMode}
            disabled={loading}
          >
            {isLogin ? 'Belum memiliki akun? Daftar' : 'Sudah memiliki akun? Login'}
          </button>
        </div>
      </div>
      
      <div className="login-illustrations">
        <div className="illustration-bubble one"></div>
        <div className="illustration-bubble two"></div>
        <div className="illustration-bubble three"></div>
        <div className="illustration-blob"></div>
      </div>
      
      <div className="login-features">
        <div className="feature-item">
          <div className="feature-icon">📚</div>
          <h3>Analisis PDF</h3>
          <p>Unggah dan analisis dokumen PDF dengan mudah</p>
        </div>
        
        <div className="feature-item">
          <div className="feature-icon">🤖</div>
          <h3>Gemini AI</h3>
          <p>Powered dengan teknologi AI dari Google</p>
        </div>
        
        <div className="feature-item">
          <div className="feature-icon">💡</div>
          <h3>RAG System</h3>
          <p>Jawaban yang relevan dari dokumen Anda</p>
        </div>
      </div>
      
      <div className="developer-info">
        Developed with ❤️ by <a href="#" onClick={(e) => e.preventDefault()}>Dafis Nadhif Saputra</a> &copy; {new Date().getFullYear()}
      </div>
    </div>
  );
};

export default LoginForm;