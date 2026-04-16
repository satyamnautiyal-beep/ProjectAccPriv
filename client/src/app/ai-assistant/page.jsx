'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, Sparkles, Loader2, CheckCircle2, Circle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import styles from './ai-assistant.module.css';
import Annotation from '@/components/Annotation';
import RemoveBottomPadding from '@/components/RemoveBottomPadding';

const generateId = () => Math.random().toString(36).substr(2, 9);

export default function AIAssistantPage() {
  const router = useRouter();
  const [messages, setMessages] = useState([
    { id: generateId(), role: 'ai', text: 'Hello! I am your AI Enrollment Assistant. Ask me about members, batches, or enrollment status.' }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [processSteps, setProcessSteps] = useState([
    { id: '1', title: 'Understanding Query', detail: 'Waiting for input...', status: 'pending' },
    { id: '2', title: 'Fetching Data', detail: 'Fetching necessary records...', status: 'pending' },
    { id: '3', title: 'Analyzing Results', detail: 'Evaluating business readiness...', status: 'pending' },
    { id: '4', title: 'Generating Response', detail: 'Synthesizing answer...', status: 'pending' }
  ]);

  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isProcessing]);

  const simulateProcessingFlow = async (queryText) => {
    setIsProcessing(true);
    
    // Reset steps
    setProcessSteps(steps => steps.map(s => ({ ...s, status: 'pending', detail: s.id === '1' ? 'Interpreting intent' : s.detail })));

    const updateStep = (id, status, detail) => {
      setProcessSteps(prev => prev.map(step => 
        step.id === id ? { ...step, status, detail: detail || step.detail } : step
      ));
    };

    const delay = (ms) => new Promise(res => setTimeout(res, ms));

    // Step 1: Understanding
    updateStep('1', 'active');
    await delay(1000);
    updateStep('1', 'completed', 'Intent extracted: Status Query');

    // Step 2: Retrieval
    updateStep('2', 'active', 'Querying /api/members and /api/batches');
    await delay(1500);
    updateStep('2', 'completed', 'Found 12 ready members, 1 pending batch');

    // Step 3: Analysis
    updateStep('3', 'active', 'Checking against readiness criteria');
    await delay(1200);
    updateStep('3', 'completed', 'Readiness criteria met');

    // Step 4: Generation
    updateStep('4', 'active', 'Formatting natural language response');
    await delay(1000);
    updateStep('4', 'completed', 'Response ready');

    // Final AI response determination based on input
    let responseText = "Based on the latest data, there are action items pending in the enrollment queue.";
    let actions = [];

    if (queryText.toLowerCase().includes('ready') || queryText.toLowerCase().includes('enrollment')) {
      responseText = "12 members are ready for enrollment. Batch 002 is prepared for approval.";
      actions = [
        { label: 'View Ready Members', route: '/member-review' },
        { label: 'Go to Batch Preparation', route: '/batch-preparation' }
      ];
    } else if (queryText.toLowerCase().includes('batch')) {
      responseText = "Batch 002 is currently awaiting your signature. It contains 12 clean members.";
      actions = [
        { label: 'Review Batch 002', route: '/batch-preparation' }
      ];
    } else if (queryText.toLowerCase().includes('clarification')) {
      responseText = "There are 3 members requiring clarifications due to missing Plan IDs.";
      actions = [
        { label: 'Provide Info', route: '/clarifications' }
      ];
    } else {
      responseText = "I've reviewed the system. Currently, your queue requires attention in Member Review and Batch Preparation.";
    }

    setMessages(prev => [...prev, {
      id: generateId(),
      role: 'ai',
      text: responseText,
      actions
    }]);

    setIsProcessing(false);
  };

  const handleSend = (e) => {
    e.preventDefault();
    if (!inputValue.trim() || isProcessing) return;

    const query = inputValue.trim();
    setInputValue('');

    // Add user message
    setMessages(prev => [...prev, { id: generateId(), role: 'user', text: query }]);

    // Trigger AI flow
    simulateProcessingFlow(query);
  };

  const handleActionClick = (route) => {
    router.push(route);
  };

  return (
    <div className={styles.container}>
      <RemoveBottomPadding />
      {/* LEFT COLUMN: CHAT INTERFACE */}
      <div className={styles.chatColumn}>
        <div style={{display: 'flex', flexDirection: 'column', height: '100%'}}>
          <div className={styles.chatHeader}>
            <div className={styles.chatTitle}>
              <Bot className="lucide-icon" size={20} color="var(--primary)" />
              AI Enrollment Assistant
            </div>
          </div>
          
          <Annotation 
            title="Chat Interface" 
            what="Conversational UX" 
            why="Lowers cognitive load" 
            how="Allows natural language queries directly over the data warehouse without complex navigation."
          >
            <div className={styles.chatWindow}>
            {messages.map((msg) => (
              <div key={msg.id} className={`${styles.messageWrapper} ${msg.role === 'user' ? styles.messageWrapperUser : styles.messageWrapperAI}`}>
                <div className={`${styles.message} ${msg.role === 'user' ? styles.messageUser : styles.messageAI}`}>
                  <div>{msg.text}</div>
                  
                  {/* Optional Action Buttons from AI */}
                  {msg.actions && msg.actions.length > 0 && (
                    <div className={styles.quickActions}>
                      {msg.actions.map(action => (
                        <button 
                          key={action.label} 
                          className={styles.quickActionButton}
                          onClick={() => handleActionClick(action.route)}
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            
            {/* Loading / Typing indicator */}
            {isProcessing && (
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
            what="Action Trigger" 
            why="Contextual prompts" 
            how="Clear placeholder guides users to optimal queries (members, batches, status)."
          >
            <form className={styles.inputArea} onSubmit={handleSend}>
              <input
                type="text"
                className={styles.input}
                placeholder="Ask about members, batches, or enrollment status..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                disabled={isProcessing}
              />
              <button 
                type="submit" 
                className={styles.sendButton}
                disabled={!inputValue.trim() || isProcessing}
              >
                <Send size={18} />
              </button>
            </form>
          </Annotation>
        </div>
      </div>

      {/* RIGHT COLUMN: PROCESSING PANEL */}
      <div className={styles.processingColumn}>
        <Annotation 
          title="Processing Panel" 
          what="System Transparency" 
          why="Builds trust" 
          how="Exposes step-by-step reasoning (Perplexity style) so users understand exactly how the AI arrived at its conclusion."
        >
          <div style={{display: 'flex', flexDirection: 'column', height: '100%'}}>
            <div className={styles.processingHeader}>
              <div className={styles.processingTitle}>
                <Sparkles className="lucide-icon" size={20} color="var(--primary)" />
                AI Processing
              </div>
            </div>
          
          <div className={styles.processingBody}>
            {processSteps.map((step) => {
              
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
                    <StepIcon size={14} className={step.status === 'active' ? 'animate-spin' : ''} />
                  </div>
                  <div className={styles.stepContent}>
                    <div className={`${styles.stepTitle} ${step.status === 'active' ? styles.stepTitleActive : (step.status === 'pending' ? styles.stepTitlePending : '')}`}>
                      {step.title}
                    </div>
                    <div className={styles.stepDetail}>
                      {step.detail}
                    </div>
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
