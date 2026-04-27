import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const generateId = () => Math.random().toString(36).substr(2, 9);

const INITIAL_STEPS = [
  { id: '1', title: 'Understanding Query', detail: 'Waiting for input...', status: 'pending' },
  { id: '2', title: 'Fetching Data', detail: 'Waiting...', status: 'pending' },
  { id: '3', title: 'Analyzing', detail: 'Waiting...', status: 'pending' },
  { id: '4', title: 'Generating Response', detail: 'Waiting...', status: 'pending' },
];

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
      chatProcessSteps: INITIAL_STEPS,

      // Derived: get messages for the active conversation
      getChatMessages: () => {
        const state = get();
        const conv = state.chatHistory.find((c) => c.id === state.activeConversationId);
        return conv ? conv.messages : [];
      },

      setChatInput: (value) => set({ chatInput: value }),
      setChatIsProcessing: (value) => set({ chatIsProcessing: value }),

      setChatProcessSteps: (updater) =>
        set((state) => ({
          chatProcessSteps:
            typeof updater === 'function' ? updater(state.chatProcessSteps) : updater,
        })),

      updateChatStep: (id, status, detail) =>
        set((state) => ({
          chatProcessSteps: state.chatProcessSteps.map((step) =>
            step.id === id ? { ...step, status, detail: detail || step.detail } : step
          ),
        })),

      resetChatSteps: () => set({ chatProcessSteps: INITIAL_STEPS }),

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

      // Start a brand-new conversation and make it active
      startNewConversation: () => {
        const newConv = createNewConversation();
        set((state) => ({
          chatHistory: [newConv, ...state.chatHistory],
          activeConversationId: newConv.id,
          chatInput: '',
          chatIsProcessing: false,
          chatProcessSteps: INITIAL_STEPS,
        }));
        return newConv.id;
      },

      // Switch to an existing conversation
      switchConversation: (id) =>
        set({
          activeConversationId: id,
          chatInput: '',
          chatIsProcessing: false,
          chatProcessSteps: INITIAL_STEPS,
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
          chatProcessSteps: INITIAL_STEPS,
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
      }),
    }
  )
);

export default useUIStore;
