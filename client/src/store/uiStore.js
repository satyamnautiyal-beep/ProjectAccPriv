import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const generateId = () => Math.random().toString(36).substr(2, 9);

// INITIAL_STEPS removed — chatProcessSteps is now a dynamic append-only event log

const createNewConversation = () => ({
  id: generateId(),
  title: 'New Conversation',
  createdAt: new Date().toISOString(),
  messages: [],
});

const useUIStore = create(
  persist(
    (set, get) => ({
      // --- UI toggles ---
      showAnnotations: true,
      toggleAnnotations: () => set((state) => ({ showAnnotations: !state.showAnnotations })),

      sidebarOpen: true,
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

      // --- AI Assistant chat state ---
      chatHistory: [],
      activeConversationId: null,
      chatInput: '',
      chatIsProcessing: false,
      // Dynamic event log — replaces the old 4-item fixed INITIAL_STEPS array.
      // Each entry: { id, timestamp, eventType, message }
      chatProcessSteps: [],

      // Derived: get messages for the active conversation
      getChatMessages: () => {
        const state = get();
        const conv = state.chatHistory.find((c) => c.id === state.activeConversationId);
        return conv ? conv.messages : [];
      },

      setChatInput: (value) => set({ chatInput: value }),
      setChatIsProcessing: (value) => set({ chatIsProcessing: value }),

      // Append a new event log entry — grows the log by exactly 1
      appendEventLogEntry: (entry) =>
        set((state) => ({
          chatProcessSteps: [...state.chatProcessSteps, entry],
        })),

      // Reset the event log and clear processing state
      resetEventLog: () => set({ chatProcessSteps: [], chatIsProcessing: false, pendingThinkingSteps: [] }),

      // Backward-compat stub — no-op so existing call sites don't throw
      updateChatStep: () => {},

      // Backward-compat — delegates to resetEventLog
      resetChatSteps: () => get().resetEventLog(),

      // Pending thinking steps for the current in-flight query.
      // Accumulated as thinking SSE events arrive, then attached to the response message.
      pendingThinkingSteps: [],

      appendPendingThinkingStep: (step) =>
        set((state) => ({
          pendingThinkingSteps: [...state.pendingThinkingSteps, step],
        })),

      clearPendingThinkingSteps: () => set({ pendingThinkingSteps: [] }),

      // Add a message — preserve timestamp if already set
      addMessage: (message) =>
        set((state) => {
          const msgWithTime = {
            ...message,
            timestamp: message.timestamp || new Date().toISOString(),
          };
          return {
            chatHistory: state.chatHistory.map((conv) => {
              if (conv.id !== state.activeConversationId) return conv;
              const updatedMessages = [...conv.messages, msgWithTime];
              const title =
                conv.title === 'New Conversation' && message.role === 'user'
                  ? message.text.slice(0, 40) + (message.text.length > 40 ? '…' : '')
                  : conv.title;
              return { ...conv, messages: updatedMessages, title };
            }),
          };
        }),

      // Update messages in active conversation (for streaming)
      setChatMessages: (updater) =>
        set((state) => ({
          chatHistory: state.chatHistory.map((conv) => {
            if (conv.id !== state.activeConversationId) return conv;
            const newMessages =
              typeof updater === 'function' ? updater(conv.messages) : updater;
            const firstUser = newMessages.find((m) => m.role === 'user');
            const title =
              firstUser && conv.title === 'New Conversation'
                ? firstUser.text.slice(0, 40) + (firstUser.text.length > 40 ? '…' : '')
                : conv.title;
            return { ...conv, messages: newMessages, title };
          }),
        })),

      // --- Completed batch run logs ---
      // Keyed by batchId. Each entry: { batchId, events, processed, failed, phase, memberCount }
      // Persisted so "View run log" survives navigation and page refresh.
      completedRuns: {},

      // Save or update a completed run's state
      saveCompletedRun: (state) =>
        set((prev) => ({
          completedRuns: { ...prev.completedRuns, [state.batchId]: state },
        })),

      // Start a brand-new conversation and make it active
      startNewConversation: () => {
        const newConv = createNewConversation();
        set((state) => ({
          chatHistory: [newConv, ...state.chatHistory],
          activeConversationId: newConv.id,
          chatInput: '',
          chatIsProcessing: false,
          chatProcessSteps: [],
          pendingThinkingSteps: [],
        }));
        return newConv.id;
      },

      // Switch to an existing conversation
      switchConversation: (id) =>
        set({
          activeConversationId: id,
          chatInput: '',
          chatIsProcessing: false,
          chatProcessSteps: [],
          pendingThinkingSteps: [],
        }),

      clearChat: () =>
        set((state) => ({
          chatHistory: state.chatHistory.map((conv) =>
            conv.id === state.activeConversationId
              ? { ...conv, messages: [], title: 'New Conversation' }
              : conv
          ),
          chatInput: '',
          chatIsProcessing: false,
          chatProcessSteps: [],
          pendingThinkingSteps: [],
        })),
    }),
    {
      name: 'ui-store',
      // Only persist what needs to survive a refresh — skip transient processing state
      partialize: (state) => ({
        chatHistory: state.chatHistory,
        activeConversationId: state.activeConversationId,
        showAnnotations: state.showAnnotations,
        sidebarOpen: state.sidebarOpen,
        completedRuns: state.completedRuns,
      }),
    }
  )
);

export default useUIStore;
