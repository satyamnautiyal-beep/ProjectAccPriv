import { create } from 'zustand';

const generateId = () => Math.random().toString(36).substr(2, 9);

const INITIAL_MESSAGE = {
  id: generateId(),
  role: 'ai',
  text: "Hey! 👋 I'm your AI Enrollment Assistant. I can help you validate EDI files, run business checks, create batches, and process enrollments — all through conversation. What would you like to do?",
  suggestions: [
    { text: 'Check EDI files', action: 'validate' },
    { text: 'Run business checks', action: 'business' },
    { text: 'Create & process batch', action: 'batch' },
    { text: 'Show me status', action: 'status' },
  ],
};

const INITIAL_STEPS = [
  { id: '1', title: 'Understanding', detail: 'Listening...', status: 'pending' },
  { id: '2', title: 'Thinking', detail: 'Processing your request...', status: 'pending' },
  { id: '3', title: 'Acting', detail: 'Running workflows...', status: 'pending' },
  { id: '4', title: 'Responding', detail: 'Preparing answer...', status: 'pending' },
];

const useUIStore = create((set) => ({
  // --- UI toggles ---
  showAnnotations: true,
  toggleAnnotations: () => set((state) => ({ showAnnotations: !state.showAnnotations })),

  sidebarOpen: true,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  // --- AI Assistant chat state (persists across navigation) ---
  chatMessages: [INITIAL_MESSAGE],
  chatInput: '',
  chatIsProcessing: false,
  chatProcessSteps: INITIAL_STEPS,

  setChatMessages: (updater) =>
    set((state) => ({
      chatMessages: typeof updater === 'function' ? updater(state.chatMessages) : updater,
    })),

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

  clearChat: () =>
    set({
      chatMessages: [INITIAL_MESSAGE],
      chatInput: '',
      chatIsProcessing: false,
      chatProcessSteps: INITIAL_STEPS,
    }),
}));

export default useUIStore;
