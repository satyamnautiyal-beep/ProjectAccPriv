'use client';

import React, { useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bot,
  Send,
  Sparkles,
  Loader2,
  CheckCircle2,
  Circle,
  Plus,
  ArrowLeft,
  MessageSquare,
} from 'lucide-react';
import styles from './ai-assistant.module.css';
import useUIStore from '@/store/uiStore';

const generateId = () => Math.random().toString(36).substr(2, 9);

const PROMPT_SUGGESTIONS = [
  { text: 'How many files did we receive today?' },
  { text: 'What is the current member status?' },
  { text: 'How many clarifications are pending?' },
  { text: 'What is the status of active batches?' },
];

const ACTION_TEXT = {
  validate: 'Check and validate all EDI files for structure',
  business: 'Run business validation checks on pending members',
  batch: 'Create a batch from ready members',
  process: 'Process batch through enrollment pipeline',
  status: 'Show me the current system status',
  clarification: 'Show me members needing attention',
  help: 'Help',
};

function formatTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function AIAssistantPage() {
  const router = useRouter();
  const {
    chatHistory,
    activeConversationId,
    getChatMessages,
    chatInput,
    chatIsProcessing,
    chatProcessSteps,
    setChatInput,
    setChatIsProcessing,
    setChatMessages,
    addMessage,
    updateChatStep,
    resetChatSteps,
    startNewConversation,
    switchConversation,
  } = useUIStore();

  const messagesEndRef = useRef(null);
  const abortControllerRef = useRef(null);
  const inputRef = useRef(null);

  const chatMessages = getChatMessages();
  const hasMessages = chatMessages.length > 0;

  // On first mount, start a conversation if none is active
  useEffect(() => {
    if (!activeConversationId) {
      startNewConversation();
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatIsProcessing]);

  const cancelStream = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const streamLLMChat = async (userMessage) => {
    cancelStream();
    resetChatSteps();
    setChatIsProcessing(true);

    updateChatStep('1', 'active', 'Analyzing your message...');

    const history = chatMessages.map((m) => ({ role: m.role, text: m.text }));

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let thinkingCount = 0;

    try {
      const res = await fetch('/api/assistant/chat/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, history }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let errText = `Server error ${res.status}`;
        try { errText = await res.text(); } catch {}
        throw new Error(errText);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          let payload;
          try { payload = JSON.parse(raw); } catch { continue; }

          switch (payload.type) {
            case 'thinking':
              thinkingCount++;
              if (thinkingCount === 1) {
                // First thinking = LLM received the message
                updateChatStep('1', 'completed', 'Intent detected');
                updateChatStep('2', 'active', payload.message || 'Fetching data...');
              } else {
                // Subsequent thinking = tool calls running
                updateChatStep('2', 'active', payload.message || 'Fetching data...');
              }
              break;

            case 'status_update':
              updateChatStep('2', 'completed', 'Data retrieved');
              updateChatStep('3', 'active', 'Analyzing results...');
              setChatMessages((prev) => [
                ...prev,
                {
                  id: generateId(),
                  role: 'ai',
                  text: payload.message,
                  isStatusUpdate: true,
                  details: payload.details,
                  timestamp: new Date().toISOString(),
                },
              ]);
              break;

            case 'response':
              updateChatStep('1', 'completed', 'Intent detected');
              updateChatStep('2', 'completed', 'Data retrieved');
              updateChatStep('3', 'completed', 'Analysis complete');
              updateChatStep('4', 'active', 'Generating response...');
              setChatMessages((prev) => [
                ...prev,
                {
                  id: generateId(),
                  role: 'ai',
                  text: payload.message,
                  suggestions: payload.suggestions,
                  timestamp: new Date().toISOString(),
                },
              ]);
              break;

            case 'done':
              updateChatStep('4', 'completed', 'Response ready');
              setChatIsProcessing(false);
              break;

            default:
              break;
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setChatMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: 'ai',
            text: `❌ Could not reach the server. Please make sure the backend is running.\n\n${err.message}`,
            timestamp: new Date().toISOString(),
          },
        ]);
      }
      setChatIsProcessing(false);
    }
  };

  const handleSend = (e) => {
    e.preventDefault();
    if (!chatInput.trim() || chatIsProcessing) return;

    const query = chatInput.trim();
    setChatInput('');

    addMessage({ id: generateId(), role: 'user', text: query });
    streamLLMChat(query);
  };

  const handleSuggestionClick = (text) => {
    if (chatIsProcessing) return;
    addMessage({ id: generateId(), role: 'user', text });
    streamLLMChat(text);
  };

  const handleActionSuggestion = (action) => {
    const message = ACTION_TEXT[action] || action;
    addMessage({ id: generateId(), role: 'user', text: message });
    streamLLMChat(message);
  };

  const handleNewChat = () => {
    startNewConversation();
    inputRef.current?.focus();
  };

  return (
    <div className={styles.pageWrapper}>

      {/* LEFT SIDEBAR: History */}
      <aside className={styles.sidebar}>
        {/* Back to main */}
        <button className={styles.backButton} onClick={() => router.push('/dashboard')}>
          <ArrowLeft size={14} />
          Back
        </button>

        {/* New Chat */}
        <button className={styles.newChatButton} onClick={handleNewChat}>
          <Plus size={16} />
          New Chat
        </button>

        {/* Conversation list */}
        <div className={styles.historyList}>
          {chatHistory.map((conv) => (
            <button
              key={conv.id}
              className={`${styles.historyItem} ${
                conv.id === activeConversationId ? styles.historyItemActive : ''
              }`}
              onClick={() => switchConversation(conv.id)}
            >
              <MessageSquare size={13} className={styles.historyIcon} />
              <div className={styles.historyItemContent}>
                <span className={styles.historyTitle}>{conv.title}</span>
                <span className={styles.historyTime}>
                  {formatTime(conv.createdAt)}
                </span>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* CENTER: Chat area */}
      <main className={styles.chatColumn}>
        {/* Header */}
        <div className={styles.chatHeader}>
          <div className={styles.chatTitle}>
            <Bot size={18} color="var(--primary)" />
            HealthEnroll AI
          </div>
        </div>

        {/* Messages or Welcome screen */}
        <div className={styles.chatWindow}>
          {!hasMessages ? (
            /* Welcome / empty state */
            <div className={styles.welcomeScreen}>
              <Sparkles size={40} color="var(--primary)" className={styles.welcomeIcon} />
              <h2 className={styles.welcomeTitle}>How can I help you today?</h2>
              <div className={styles.promptGrid}>
                {PROMPT_SUGGESTIONS.map((s, i) => (
                  <button
                    key={i}
                    className={styles.promptCard}
                    onClick={() => handleSuggestionClick(s.text)}
                    disabled={chatIsProcessing}
                  >
                    {s.text}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Chat messages */
            <>
              {chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`${styles.messageWrapper} ${
                    msg.role === 'user' ? styles.messageWrapperUser : styles.messageWrapperAI
                  }`}
                >
                  <div
                    className={`${styles.message} ${
                      msg.role === 'user' ? styles.messageUser : styles.messageAI
                    }`}
                  >
                    <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>{msg.text}</div>

                    {msg.suggestions && msg.suggestions.length > 0 && (
                      <div className={styles.suggestionsContainer}>
                        {msg.suggestions.map((suggestion, idx) => (
                          <button
                            key={idx}
                            className={styles.suggestionButton}
                            onClick={() => handleActionSuggestion(suggestion.action)}
                            disabled={chatIsProcessing}
                          >
                            {suggestion.text}
                          </button>
                        ))}
                      </div>
                    )}

                    {msg.isStatusUpdate && msg.details && (
                      <div className={styles.detailsBox}>
                        {Object.entries(msg.details)
                          .filter(([, value]) => typeof value !== 'object' || value === null)
                          .map(([key, value]) => (
                            <div key={key} style={{ fontSize: '0.85rem', marginTop: '6px' }}>
                              <strong>{key}:</strong> {String(value)}
                            </div>
                          ))}
                      </div>
                    )}

                    {msg.timestamp && (
                      <div className={styles.timestamp}>{formatTime(msg.timestamp)}</div>
                    )}
                  </div>
                </div>
              ))}

              {chatIsProcessing && (
                <div className={`${styles.messageWrapper} ${styles.messageWrapperAI}`}>
                  <div className={`${styles.message} ${styles.messageAI}`}>
                    <div className={styles.typingIndicator}>
                      <div className={styles.dot}></div>
                      <div className={styles.dot}></div>
                      <div className={styles.dot}></div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <form className={styles.inputArea} onSubmit={handleSend}>
          <input
            ref={inputRef}
            type="text"
            className={styles.input}
            placeholder="Message your enrollment assistant..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            disabled={chatIsProcessing}
          />
          <button
            type="submit"
            className={styles.sendButton}
            disabled={!chatInput.trim() || chatIsProcessing}
            aria-label="Send message"
          >
            <Send size={16} />
          </button>
        </form>
      </main>

      {/* RIGHT SIDEBAR: AI Processing */}
      <aside className={styles.processingColumn}>
        <div className={styles.processingHeader}>
          <Sparkles size={16} color="var(--primary)" />
          <span className={styles.processingTitle}>AI Processing</span>
        </div>

        <div className={styles.processingBody}>
          {chatProcessSteps.map((step) => {
            let StepIcon = Circle;
            let iconClass = styles.stepIcon;

            if (step.status === 'active') {
              StepIcon = Loader2;
              iconClass = `${styles.stepIcon} ${styles.stepIconActive}`;
            } else if (step.status === 'completed') {
              StepIcon = CheckCircle2;
              iconClass = `${styles.stepIcon} ${styles.stepIconCompleted}`;
            }

            return (
              <div key={step.id} className={styles.stepItem}>
                <div className={iconClass}>
                  <StepIcon
                    size={14}
                    className={step.status === 'active' ? styles.spinIcon : ''}
                  />
                </div>
                <div className={styles.stepContent}>
                  <div
                    className={`${styles.stepTitle} ${
                      step.status === 'active'
                        ? styles.stepTitleActive
                        : step.status === 'pending'
                        ? styles.stepTitlePending
                        : ''
                    }`}
                  >
                    {step.title}
                  </div>
                  <div className={styles.stepDetail}>{step.detail}</div>
                </div>
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
