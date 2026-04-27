'use client';

import React, { useRef, useEffect } from 'react';
import { Bot, Send, Sparkles, Loader2, CheckCircle2, Circle } from 'lucide-react';
import styles from './ai-assistant.module.css';
import Annotation from '@/components/Annotation';
import RemoveBottomPadding from '@/components/RemoveBottomPadding';
import useUIStore from '@/store/uiStore';

const generateId = () => Math.random().toString(36).substr(2, 9);

const ACTION_TEXT = {
  validate: 'Check and validate all EDI files for structure',
  business: 'Run business validation checks on pending members',
  batch: 'Create a batch from ready members',
  process: 'Process batch through enrollment pipeline',
  status: 'Show me the current system status',
  clarification: 'Show me members needing attention',
  help: 'Help',
};

export default function AIAssistantPage() {
  const {
    chatMessages,
    chatInput,
    chatIsProcessing,
    chatProcessSteps,
    setChatMessages,
    setChatInput,
    setChatIsProcessing,
    updateChatStep,
    resetChatSteps,
    clearChat,
  } = useUIStore();

  const messagesEndRef = useRef(null);
  const abortControllerRef = useRef(null);

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

    updateChatStep('1', 'completed', 'Got it!');
    updateChatStep('2', 'active', 'Thinking...');

    // Build history from current messages (exclude the new user message — it's sent separately)
    const history = chatMessages.map((m) => ({ role: m.role, text: m.text }));

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch('/api/assistant/chat/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, history }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          let payload;
          try { payload = JSON.parse(raw); } catch { continue; }

          switch (payload.type) {
            case 'thinking':
              updateChatStep('2', 'active', payload.message);
              updateChatStep('3', 'pending', 'Running workflows...');
              break;

            case 'status_update':
              updateChatStep('3', 'active', payload.message);
              setChatMessages((prev) => [
                ...prev,
                {
                  id: generateId(),
                  role: 'ai',
                  text: payload.message,
                  isStatusUpdate: true,
                  details: payload.details,
                },
              ]);
              break;

            case 'response':
              updateChatStep('3', 'completed', 'Done!');
              updateChatStep('4', 'active', 'Preparing response...');
              setChatMessages((prev) => [
                ...prev,
                {
                  id: generateId(),
                  role: 'ai',
                  text: payload.message,
                  suggestions: payload.suggestions,
                },
              ]);
              break;

            case 'done':
              updateChatStep('4', 'completed', 'Response ready!');
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
            text: '❌ Something went wrong. Please try again.',
            suggestions: [{ text: 'Show system status', action: 'status' }],
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

    setChatMessages((prev) => [
      ...prev,
      { id: generateId(), role: 'user', text: query },
    ]);

    streamLLMChat(query);
  };

  const handleSuggestion = (action) => {
    const message = ACTION_TEXT[action] || action;
    setChatMessages((prev) => [
      ...prev,
      { id: generateId(), role: 'user', text: message },
    ]);
    streamLLMChat(message);
  };

  return (
    <div className={styles.container}>
      <RemoveBottomPadding />

      {/* LEFT COLUMN: CHAT INTERFACE */}
      <div className={styles.chatColumn}>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div className={styles.chatHeader}>
            <div className={styles.chatTitle}>
              <Bot className="lucide-icon" size={20} color="var(--primary)" />
              Conversational Enrollment Assistant
            </div>
            <button
              onClick={clearChat}
              disabled={chatIsProcessing}
              style={{
                background: 'none',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                padding: '4px 10px',
                fontSize: '0.75rem',
                cursor: 'pointer',
                color: 'var(--muted)',
              }}
            >
              Clear chat
            </button>
          </div>

          <Annotation
            title="Chat Interface"
            what="Conversational UX"
            why="Natural language interaction"
            how="Chat with the LLM-powered agent. Context is preserved as you navigate between pages."
          >
            <div className={styles.chatWindow}>
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
                            onClick={() => handleSuggestion(suggestion.action)}
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

              <div ref={messagesEndRef} />
            </div>
          </Annotation>

          <Annotation
            title="Input Field"
            what="Natural Language Prompt"
            why="Conversational control"
            how="Ask anything — the LLM understands context from your full conversation history."
          >
            <form className={styles.inputArea} onSubmit={handleSend}>
              <input
                type="text"
                className={styles.input}
                placeholder="Ask anything about your enrollment pipeline..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                disabled={chatIsProcessing}
              />
              <button
                type="submit"
                className={styles.sendButton}
                disabled={!chatInput.trim() || chatIsProcessing}
              >
                <Send size={18} />
              </button>
            </form>
          </Annotation>
        </div>
      </div>

      {/* RIGHT COLUMN: PROCESSING INSIGHTS */}
      <div className={styles.processingColumn}>
        <Annotation
          title="Assistant Reasoning"
          what="Step-by-Step Transparency"
          why="Builds confidence"
          how="See exactly what the assistant is thinking and doing at each stage."
        >
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div className={styles.processingHeader}>
              <div className={styles.processingTitle}>
                <Sparkles className="lucide-icon" size={20} color="var(--primary)" />
                AI Reasoning
              </div>
            </div>

            <div className={styles.processingBody}>
              {chatProcessSteps.map((step) => {
                let StepIcon = Circle;
                let iconClass = styles.stepIcon;

                if (step.status === 'active') {
                  StepIcon = Loader2;
                  iconClass = `${styles.stepIcon} ${styles.stepIconActive} animate-spin`;
                } else if (step.status === 'completed') {
                  StepIcon = CheckCircle2;
                  iconClass = `${styles.stepIcon} ${styles.stepIconCompleted}`;
                }

                return (
                  <div key={step.id} className={styles.stepItem}>
                    <div className={iconClass}>
                      <StepIcon
                        size={14}
                        className={step.status === 'active' ? 'animate-spin' : ''}
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
          </div>
        </Annotation>
      </div>
    </div>
  );
}
