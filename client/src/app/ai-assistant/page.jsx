'use client';

import React, { useRef, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bot,
  Send,
  Sparkles,
  Plus,
  ArrowLeft,
  MessageSquare,
  ChevronDown,
  ChevronRight,
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

function statusBadgeClass(status) {
  if (status === 'Enrolled' || status === 'Enrolled (SEP)') return 'badgeGreen';
  if (status === 'In Review') return 'badgeAmber';
  return 'badgeRed';
}

// Collapsible reasoning block shown above each AI response
function ThinkingBlock({ steps }) {
  const [open, setOpen] = useState(false);
  if (!steps || steps.length === 0) return null;
  return (
    <div className={styles.thinkingBlock}>
      <button className={styles.thinkingToggle} onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{steps.length} reasoning step{steps.length !== 1 ? 's' : ''}</span>
      </button>
      {open && (
        <div className={styles.thinkingSteps}>
          {steps.map((s, i) => (
            <div key={i} className={styles.thinkingStep}>
              <span className={styles.thinkingStepDot} />
              <span className={styles.thinkingStepText}>{s.message}</span>
              <span className={styles.thinkingStepTime}>
                {new Date(s.timestamp).toLocaleTimeString([], {
                  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
                })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Batch summary card — replaces individual member cards in chat for large batches
function BatchSummaryCard({ msg, onExpand }) {
  const [expanded, setExpanded] = useState(false);
  const members = msg.batchMembers || [];
  const showToggle = members.length > 0;
  return (
    <div className={styles.batchSummaryCard}>
      <div className={styles.batchSummaryHeader}>
        <span className={styles.batchSummaryTitle}>Batch complete</span>
        <span className={styles.batchSummaryMeta}>{msg.batchId}</span>
      </div>
      <div className={styles.batchSummaryStats}>
        <span className={`${styles.batchStat} ${styles.batchStatGreen}`}>
          ✓ {msg.processed} enrolled
        </span>
        {msg.failed > 0 && (
          <span className={`${styles.batchStat} ${styles.batchStatRed}`}>
            ✗ {msg.failed} failed
          </span>
        )}
      </div>
      {showToggle && (
        <button
          className={styles.batchExpandToggle}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? 'Hide' : 'Show'} member details ({members.length})
        </button>
      )}
      {expanded && (
        <div className={styles.batchMemberList}>
          {members.map((m, i) => (
            <div key={i} className={styles.batchMemberRow}>
              <span className={styles.batchMemberName}>{m.name}</span>
              <span className={styles.batchMemberSubId}>{m.subscriber_id}</span>
              <span className={`${styles.statusBadge} ${styles[statusBadgeClass(m.status)]}`}>
                {m.status}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className={styles.timestamp}>{formatTime(msg.timestamp)}</div>
    </div>
  );
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
    pendingThinkingSteps,
    setChatInput,
    setChatIsProcessing,
    setChatMessages,
    addMessage,
    updateChatStep,
    resetChatSteps,
    appendEventLogEntry,
    resetEventLog,
    appendPendingThinkingStep,
    clearPendingThinkingSteps,
    startNewConversation,
    switchConversation,
  } = useUIStore();

  const [mounted, setMounted] = React.useState(false);
  const messagesEndRef = useRef(null);
  const abortControllerRef = useRef(null);
  const inputRef = useRef(null);
  const logContainerRef = useRef(null);
  const logEndRef = useRef(null);

  // Accumulate batch members during a streaming batch run
  const batchMembersRef = useRef([]);
  const batchInfoRef = useRef(null);

  const chatMessages = getChatMessages();
  const hasMessages = chatMessages.length > 0;

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (mounted && !activeConversationId) startNewConversation();
  }, [mounted]);

  // Scroll to bottom on mount (navigating from another page) and on conversation switch
  useEffect(() => {
    if (!mounted) return;
    // Use a small timeout to let the DOM render the messages before scrolling
    const t = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }, 50);
    return () => clearTimeout(t);
  }, [mounted, activeConversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatIsProcessing]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatProcessSteps]);

  const cancelStream = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const streamLLMChat = async (userMessage) => {
    cancelStream();
    resetEventLog();
    clearPendingThinkingSteps();
    batchMembersRef.current = [];
    batchInfoRef.current = null;
    setChatIsProcessing(true);

    const history = chatMessages
      // Only send actual text messages to the LLM — skip UI-only cards (batch summaries, member results)
      .filter((m) => m.text && !m.isBatchSummary && !m.isMemberResult)
      .map((m) => ({ role: m.role, text: m.text }));
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // Call the Python backend directly to bypass Next.js proxy buffering,
      // which prevents SSE events from streaming in real time.
      const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
      const res = await fetch(`${backendUrl}/api/assistant/chat/llm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
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
            case 'thinking': {
              const step = {
                id: generateId(),
                timestamp: new Date().toISOString(),
                message: payload.message,
              };
              // Append to live right-panel log
              appendEventLogEntry({ ...step, eventType: 'thinking' });
              // Also accumulate for attaching to the upcoming response message
              appendPendingThinkingStep(step);
              break;
            }

            case 'status_update':
              appendEventLogEntry({
                id: generateId(),
                timestamp: new Date().toISOString(),
                eventType: 'tool',
                message: payload.message,
              });
              // If this is a batch completion status, capture the info
              if (payload.details?.batchId) {
                batchInfoRef.current = payload.details;
              }
              // Don't add status_update as a chat message — it's noise
              break;

            case 'member_result':
              // Accumulate into batch members list — don't add individual cards to chat
              batchMembersRef.current.push({
                subscriber_id: payload.subscriber_id,
                name: payload.name,
                status: payload.status,
                summary: payload.summary,
              });
              appendEventLogEntry({
                id: generateId(),
                timestamp: new Date().toISOString(),
                eventType: 'member_result',
                message: `${payload.name}: ${payload.status}`,
              });
              break;

            case 'response': {
              appendEventLogEntry({
                id: generateId(),
                timestamp: new Date().toISOString(),
                eventType: 'result',
                message: 'Response generated',
              });
              // Snapshot the accumulated thinking steps and attach to this message
              const thinkingSnapshot = [...pendingThinkingSteps];
              clearPendingThinkingSteps();

              // If we have batch members, add a batch summary card first
              if (batchMembersRef.current.length > 0 && batchInfoRef.current) {
                const info = batchInfoRef.current;
                setChatMessages((prev) => [
                  ...prev,
                  {
                    id: generateId(),
                    role: 'ai',
                    isBatchSummary: true,
                    batchId: info.batchId,
                    processed: info.processed,
                    failed: info.failed,
                    batchMembers: [...batchMembersRef.current],
                    timestamp: new Date().toISOString(),
                  },
                ]);
                batchMembersRef.current = [];
                batchInfoRef.current = null;
              }

              setChatMessages((prev) => [
                ...prev,
                {
                  id: generateId(),
                  role: 'ai',
                  text: payload.message,
                  suggestions: payload.suggestions,
                  thinkingSteps: thinkingSnapshot,
                  timestamp: new Date().toISOString(),
                },
              ]);
              break;
            }

            case 'done':
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

  const handleActionSuggestion = (suggestion) => {
    const message = suggestion.text || ACTION_TEXT[suggestion.action] || suggestion.action;
    addMessage({ id: generateId(), role: 'user', text: message });
    streamLLMChat(message);
  };

  const handleNewChat = () => {
    startNewConversation();
    inputRef.current?.focus();
  };

  if (!mounted) return null;

  return (
    <div className={styles.pageWrapper}>

      {/* LEFT SIDEBAR: History */}
      <aside className={styles.sidebar}>
        <button className={styles.backButton} onClick={() => router.push('/dashboard')}>
          <ArrowLeft size={14} />
          Back
        </button>
        <button className={styles.newChatButton} onClick={handleNewChat}>
          <Plus size={16} />
          New Chat
        </button>
        <div className={styles.historyList}>
          {chatHistory.map((conv) => (
            <button
              key={conv.id}
              className={`${styles.historyItem} ${conv.id === activeConversationId ? styles.historyItemActive : ''}`}
              onClick={() => switchConversation(conv.id)}
            >
              <MessageSquare size={13} className={styles.historyIcon} />
              <div className={styles.historyItemContent}>
                <span className={styles.historyTitle}>{conv.title}</span>
                <span className={styles.historyTime}>{formatTime(conv.createdAt)}</span>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* CENTER: Chat area */}
      <main className={styles.chatColumn}>
        <div className={styles.chatHeader}>
          <div className={styles.chatTitle}>
            <Bot size={18} color="var(--primary)" />
            HealthEnroll AI
          </div>
        </div>

        <div className={styles.chatWindow}>
          {!hasMessages ? (
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
            <>
              {chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`${styles.messageWrapper} ${msg.role === 'user' ? styles.messageWrapperUser : styles.messageWrapperAI}`}
                >
                  {msg.isBatchSummary ? (
                    <BatchSummaryCard msg={msg} />
                  ) : msg.isMemberResult ? (
                    // Legacy member result cards (kept for backward compat with old messages)
                    <div className={styles.memberCard}>
                      <div className={styles.memberCardHeader}>
                        <span className={styles.memberName}>{msg.name}</span>
                        <span className={styles.memberSubId}>{msg.subscriber_id}</span>
                      </div>
                      <span className={`${styles.statusBadge} ${styles[statusBadgeClass(msg.status)]}`}>
                        {msg.status}
                      </span>
                      <p className={styles.memberSummary}>{msg.summary || 'No summary available'}</p>
                      <div className={styles.timestamp}>{formatTime(msg.timestamp)}</div>
                    </div>
                  ) : (
                    <div className={`${styles.message} ${msg.role === 'user' ? styles.messageUser : styles.messageAI}`}>
                      {/* Collapsible reasoning block — only on AI messages with thinking steps */}
                      {msg.role === 'ai' && msg.thinkingSteps && msg.thinkingSteps.length > 0 && (
                        <ThinkingBlock steps={msg.thinkingSteps} />
                      )}

                      <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>{msg.text}</div>

                      {msg.suggestions && msg.suggestions.length > 0 && (
                        <div className={styles.suggestionsContainer}>
                          {msg.suggestions.map((suggestion, idx) => (
                            <button
                              key={idx}
                              className={styles.suggestionButton}
                              onClick={() => handleActionSuggestion(suggestion)}
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
                  )}
                </div>
              ))}

              {chatIsProcessing && (
                <div className={`${styles.messageWrapper} ${styles.messageWrapperAI}`}>
                  <div className={styles.thinkingCard}>
                    <div className={styles.thinkingCardHeader}>
                      <span className={styles.thinkingSpinner} />
                      <span className={styles.thinkingCardTitle}>
                        {pendingThinkingSteps.length > 0
                          ? pendingThinkingSteps[pendingThinkingSteps.length - 1].message
                          : 'Thinking...'}
                      </span>
                    </div>
                    {pendingThinkingSteps.length > 1 && (
                      <div className={styles.thinkingCardSteps}>
                        {pendingThinkingSteps.slice(0, -1).map((s, i) => (
                          <div key={i} className={styles.thinkingCardStep}>
                            <span className={styles.thinkingCardStepCheck}>✓</span>
                            <span className={styles.thinkingCardStepText}>{s.message}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

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

      {/* RIGHT SIDEBAR: AI Processing live feed */}
      <aside className={styles.processingColumn}>
        <div className={styles.processingHeader}>
          <span className={styles.processingHeaderDot} />
          <span className={styles.processingTitle}>AI Processing</span>
          {chatIsProcessing && <span className={styles.processingLivePill}>LIVE</span>}
        </div>
        <div className={styles.processingBody} ref={logContainerRef}>
          {chatProcessSteps.length === 0 && !chatIsProcessing ? (
            <div className={styles.emptyLog}>
              <span className={styles.emptyLogIcon}>◎</span>
              <span>Waiting for activity</span>
            </div>
          ) : (
            <div className={styles.timeline}>
              {chatProcessSteps.map((entry, idx) => {
                const isLast = idx === chatProcessSteps.length - 1;
                const isTool = entry.eventType === 'tool';
                const isResult = entry.eventType === 'result';
                const isMemberResult = entry.eventType === 'member_result';
                // Show timestamp only when second changes from previous entry
                const prevEntry = chatProcessSteps[idx - 1];
                const prevSec = prevEntry ? new Date(prevEntry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : null;
                const thisSec = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                const showTime = thisSec !== prevSec;

                return (
                  <div key={entry.id} className={`${styles.timelineItem} ${isTool ? styles.timelineItemTool : ''} ${isResult ? styles.timelineItemResult : ''} ${isMemberResult ? styles.timelineItemMember : ''}`}>
                    {/* Connector line */}
                    {!isLast && <div className={`${styles.timelineLine} ${isTool ? styles.timelineLineGreen : ''}`} />}
                    {/* Dot */}
                    <div className={`${styles.timelineDot} ${isTool ? styles.timelineDotGreen : ''} ${isResult ? styles.timelineDotPurple : ''} ${isMemberResult ? styles.timelineDotAmber : ''} ${isLast && chatIsProcessing ? styles.timelineDotPulse : ''}`} />
                    {/* Content */}
                    <div className={styles.timelineContent}>
                      {showTime && (
                        <span className={styles.timelineTime}>{thisSec}</span>
                      )}
                      <span className={`${styles.timelineMessage} ${isTool ? styles.timelineMessageTool : ''} ${isResult ? styles.timelineMessageResult : ''}`}>
                        {entry.message}
                      </span>
                    </div>
                  </div>
                );
              })}
              {chatIsProcessing && (
                <div className={styles.timelineItem}>
                  <div className={`${styles.timelineDot} ${styles.timelineDotPulse}`} />
                  <div className={styles.timelineContent}>
                    <span className={styles.timelineProcessing}>
                      <span className={styles.timelineProcessingDot} />
                      <span className={styles.timelineProcessingDot} />
                      <span className={styles.timelineProcessingDot} />
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
          <div ref={logEndRef} />
        </div>
      </aside>
    </div>
  );
}

