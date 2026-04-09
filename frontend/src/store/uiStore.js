import { create } from 'zustand';

const useUIStore = create((set) => ({
  showAnnotations: true,
  toggleAnnotations: () => set((state) => ({ showAnnotations: !state.showAnnotations })),
  
  // Example of other global UI states
  sidebarOpen: true,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
}));

export default useUIStore;
