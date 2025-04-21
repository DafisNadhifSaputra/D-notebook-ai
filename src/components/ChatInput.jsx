import React, { useState, useRef, useEffect } from 'react';
import './ChatInput.css';

const ChatInput = ({ onSendMessage, isProcessing, isDisabled }) => {
  const [message, setMessage] = useState('');
  const textareaRef = useRef(null);
  const submitTimeoutRef = useRef(null);

  useEffect(() => {
    if (textareaRef.current) {
      // Auto-resize textarea
      textareaRef.current.style.height = 'auto';
      // Ensure minimum height and set max height
      const scrollHeight = textareaRef.current.scrollHeight;
      const maxHeight = 150; // Corresponds to max-height in CSS
      textareaRef.current.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
    }
  }, [message]);

  // Clean up any pending timeout on unmount
  useEffect(() => {
    return () => {
      if (submitTimeoutRef.current) {
        clearTimeout(submitTimeoutRef.current);
      }
    };
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!message.trim() || isProcessing || isDisabled) return;

    const messageToSend = message.trim();
    
    // Clear message immediately to prevent double submissions
    setMessage('');
    
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    
    // Ensure any existing timeout is cleared
    if (submitTimeoutRef.current) {
      clearTimeout(submitTimeoutRef.current);
    }
    
    // Send the message immediately - no delay
    onSendMessage(messageToSend);
  };

  const handleTextareaKeyDown = (e) => {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="chat-input">
      <form onSubmit={handleSubmit} className="chat-input-form">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleTextareaKeyDown}
          placeholder={isDisabled ? "Silakan upload dokumen dan proses PDF terlebih dahulu..." : "Tanyakan sesuatu tentang dokumen Anda..."}
          disabled={isDisabled || isProcessing}
          rows="1"
        />
        <button
          type="submit"
          disabled={!message.trim() || isProcessing || isDisabled}
          className="send-btn"
          aria-label="Kirim pesan"
        >
          {isProcessing ? (
            <div className="send-loader"></div>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </button>
      </form>
      
      {isDisabled && !isProcessing && (
        <div className="chat-input-status">
          <span className="status-text">Silakan upload dan proses dokumen PDF terlebih dahulu.</span>
        </div>
      )}
      
      {isProcessing && (
        <div className="chat-input-status">
          <span className="status-text">AI sedang memproses...</span>
        </div>
      )}
    </div>
  );
};

export default ChatInput;