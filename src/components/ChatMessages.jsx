import React, { useEffect, useRef, useState } from 'react';
import { User, Bot, RefreshCw, ThumbsUp, ThumbsDown, ChevronDown, ChevronUp } from 'lucide-react';
import './ChatMessages.css';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

const ChatMessages = ({ messages, isProcessing, onRateMessage }) => {
  const messagesEndRef = useRef(null);
  const [viewingThinkingProcess, setViewingThinkingProcess] = useState({});
  const [showReferences, setShowReferences] = useState({});
  const [wasThinking, setWasThinking] = useState(false);
  const [expandedThinkingMessages, setExpandedThinkingMessages] = useState({});
  
  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);
  
  // Handle thinking process visibility
  useEffect(() => {
    if (isProcessing && !wasThinking) {
      // When processing starts, remember we were thinking
      setWasThinking(true);
    } else if (!isProcessing && wasThinking) {
      // When processing ends and we were thinking, set a small delay before
      // setting wasThinking back to false to avoid flicker
      setTimeout(() => {
        setWasThinking(false);
      }, 100);
    }
  }, [isProcessing, wasThinking]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const toggleThinkingProcess = (messageId) => {
    setViewingThinkingProcess(prev => ({
      ...prev, 
      [messageId]: !prev[messageId]
    }));
  };
  
  const toggleReferences = (messageId) => {
    setShowReferences(prev => ({
      ...prev, 
      [messageId]: !prev[messageId]
    }));
  };
  
  // Function to check if message likely contains math
  const containsMath = (content) => {
    return /(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\\begin\{equation\}|persamaan|equation)/i.test(content);
  };
  
  // Get associated thinking process for a message
  const getThinkingProcess = (messageId) => {
    // Find thinking process message that references this message
    const thinkingMessage = messages.find(m => 
      m.role === 'thinking' && 
      m.metadata?.relatedMessageId === messageId
    );
    
    return thinkingMessage?.content || null;
  };
  
  // Split content to extract references section - Improved parsing of references
  const splitContentAndReferences = (content) => {
    if (!content) return { mainContent: '', references: '' };
    
    // Patterns to detect reference sections with improved detection
    const refPatterns = [
      /\n\nREFERENSI\s*:\s*\n/i,
      /\n\nREFERENCE[S]\s*:\s*\n/i, 
      /\n\nDAFTAR PUSTAKA\s*:\s*\n/i,
      /\n\nSUMBER\s*:\s*\n/i,
      /\n\nREFERENSI:/i,
      /\n\nREFERENCES:/i,
      /\n\nSUMBER:/i
    ];
    
    for (const pattern of refPatterns) {
      const match = content.split(pattern);
      if (match.length > 1) {
        return { 
          mainContent: match[0].trim(), 
          references: match[1].trim()
        };
      }
    }
    
    // Check for reference markers like [1] for implicit references
    const refRegex = /\[\d+\]\s+[\w\s]+ \(halaman \d+\)/i;
    
    // If we find reference markers but no explicit section header, try to extract from the end
    if (refRegex.test(content)) {
      // Look for the last empty line followed by reference pattern
      const lines = content.split('\n');
      let refStartIndex = -1;
      
      // Find the line with reference pattern after an empty line
      for (let i = lines.length - 1; i >= 0; i--) {
        if (refRegex.test(lines[i]) && 
            (i === 0 || lines[i-1].trim() === '')) {
          refStartIndex = i;
          break;
        }
      }
      
      // If we found a reference line, split the content
      if (refStartIndex !== -1) {
        const mainContent = lines.slice(0, refStartIndex).join('\n').trim();
        const references = lines.slice(refStartIndex).join('\n').trim();
        return { mainContent, references };
      }
    }
    
    // No reference section found
    return { mainContent: content.trim(), references: '' };
  };
  
  // Enhanced markdown renderer with LaTeX support
  const MarkdownRenderer = ({ content, hasMath = false }) => (
    <div className={`markdown-content ${hasMath ? 'has-math' : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]} 
        rehypePlugins={[rehypeKatex]}
        components={{
          code({inline, className, children, ...props}) {
            // Filter out any custom props that React doesn't expect
            const { jsx, node, ...filteredProps } = props;
            const match = /language-(\w+)/.exec(className || '');
            return !inline && match ? (
              <SyntaxHighlighter
                style={vscDarkPlus}
                language={match[1]}
                PreTag="div"
                {...filteredProps}
              >
                {String(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
            ) : (
              <code className={className} {...filteredProps}>
                {children}
              </code>
            );
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );

  const toggleThinkingMessage = (id) => {
    setExpandedThinkingMessages(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  return (
    <div className="chat-messages">
      {messages.length === 0 && (
        <div className="empty-messages">
          <div className="empty-messages-icon">💬</div>
          <h3 className="empty-messages-heading">Belum ada pesan</h3>
          <p className="empty-messages-text">Mulailah dengan mengajukan pertanyaan atau mengunggah dokumen PDF.</p>
          <p className="empty-messages-tip">Tips: Anda dapat mengajukan pertanyaan tentang isi dokumen yang diunggah.</p>
        </div>
      )}

      {messages.map((message, index) => {
        const isUser = message.role === 'user';
        const isThinking = message.role === 'thinking';
        const isExpanded = expandedThinkingMessages[message.id];
        const relatedMessageId = message.metadata?.relatedMessageId;

        // Skip typing indicators that might still be in the state
        if (message.isTypingIndicator) return null;

        // If it's a thinking process message, render it differently
        if (isThinking) {
          return (
            <div 
              key={message.id || `thinking-${index}`} 
              className={`message-container thinking-container ${isExpanded ? 'expanded' : ''}`}
              data-related={relatedMessageId}
            >
              <div 
                className="thinking-header" 
                onClick={() => toggleThinkingMessage(message.id)}
              >
                <span>Proses Analisis</span>
                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </div>
              
              {isExpanded && (
                <div className="thinking-content">
                  {message.content.split('\n').map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              )}
            </div>
          );
        }

        const hasThinkingProcess = getThinkingProcess(message.id) !== null;
        const isViewingThinking = viewingThinkingProcess[message.id] || false;
        const thinkingContent = hasThinkingProcess ? getThinkingProcess(message.id) : null;
        
        const { mainContent, references } = splitContentAndReferences(message.content);
        const hasRef = !!references;
        const isShowingRef = showReferences[message.id] || false;
        
        // Check if likely contains mathematical content
        const hasMath = !isUser && containsMath(message.content);
        
        return (
          <React.Fragment key={message.id || `message-${index}`}>
            <div className={`message-container ${isUser ? 'user-message-container' : 'assistant-message-container'}`}>
              <div className={`message ${isUser ? 'user-message' : 'assistant-message'}`}>
                <div className="message-avatar">
                  {isUser ? <User size={18} /> : <Bot size={18} />}
                </div>
                
                <div className="message-content">
                  {message.isTypingIndicator ? (
                    <div className="typing-indicator">
                      <div className="dot"></div>
                      <div className="dot"></div>
                      <div className="dot"></div>
                    </div>
                  ) : (
                    <>
                      {isUser ? (
                        <div>{message.content}</div>
                      ) : (
                        <div className="bot-message">
                          <MarkdownRenderer 
                            content={isShowingRef ? message.content : mainContent} 
                            hasMath={hasMath}
                          />
                          
                          {/* References section if available */}
                          {hasRef && isShowingRef && (
                            <div className="references-container">
                              <div className="references-title">Referensi:</div>
                              <MarkdownRenderer content={references} />
                            </div>
                          )}
                          
                          {/* Controls for bot messages: thumbs up/down, thinking toggle */}
                          {!message.isTypingIndicator && (
                            <div className="message-controls">
                              <div className="message-actions">
                                {hasRef && (
                                  <button 
                                    className="message-action-btn" 
                                    onClick={() => toggleReferences(message.id)}
                                  >
                                    {isShowingRef ? 'Sembunyikan referensi' : 'Tampilkan referensi'}
                                  </button>
                                )}
                                
                                {hasThinkingProcess && (
                                  <button 
                                    className="message-action-btn"
                                    onClick={() => toggleThinkingProcess(message.id)}
                                    title="Tampilkan proses berpikir AI"
                                  >
                                    {isViewingThinking ? 'Sembunyikan proses berpikir' : 'Tampilkan proses berpikir'}
                                  </button>
                                )}
                              </div>

                              {onRateMessage && (
                                <div className="message-rating">
                                  <button 
                                    className="rating-btn" 
                                    onClick={() => onRateMessage(message.id, 'thumbs_up')}
                                    aria-label="Suka jawaban"
                                  >
                                    <ThumbsUp size={14} />
                                  </button>
                                  <button 
                                    className="rating-btn" 
                                    onClick={() => onRateMessage(message.id, 'thumbs_down')}
                                    aria-label="Tidak suka jawaban"
                                  >
                                    <ThumbsDown size={14} />
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      
                      {/* Thinking process display */}
                      {!isUser && hasThinkingProcess && isViewingThinking && (
                        <div className="thinking-process">
                          <div className="thinking-process-header">
                            <RefreshCw size={14} />
                            <span>Proses Berpikir AI</span>
                          </div>
                          <MarkdownRenderer content={thinkingContent} hasMath={hasMath} />
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </React.Fragment>
        );
      })}
      
      {isProcessing && wasThinking && (
        <div className="message-container assistant-message-container">
          <div className="message assistant-message thinking-message">
            <div className="message-avatar">
              <Bot size={18} />
            </div>
            <div className="message-content">
              <div className="thinking-indicator">
                AI sedang berpikir
                <div className="thinking-dots">
                  <div className="dot"></div>
                  <div className="dot"></div>
                  <div className="dot"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      <div ref={messagesEndRef} />
    </div>
  );
};

export default ChatMessages;