import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { NameMode } from './agents';

/**
 * UI-only state. Server data lives in TanStack Query, never here. Only preferences are persisted;
 * the session token is never stored (see api.ts).
 */
interface UiState {
  nameMode: NameMode;
  projectId: string | null;
  /** The "Yeni iş" dialog and the text it opens with. */
  newTask: { open: boolean; prompt: string; agent: string | null };
  setNameMode: (mode: NameMode) => void;
  setProjectId: (id: string | null) => void;
  openNewTask: (prompt?: string, agent?: string) => void;
  closeNewTask: () => void;
}

/** localStorage can be missing or throw (private windows, blocked storage); never let that break the UI. */
const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value);
    } catch {
      // Preference just won't survive a reload.
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name);
    } catch {
      // ignore
    }
  },
};

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      nameMode: 'technical',
      projectId: null,
      newTask: { open: false, prompt: '', agent: null },
      setNameMode: (nameMode) => set({ nameMode }),
      setProjectId: (projectId) => set({ projectId }),
      openNewTask: (prompt = '', agent) =>
        set({ newTask: { open: true, prompt, agent: agent ?? null } }),
      closeNewTask: () => set({ newTask: { open: false, prompt: '', agent: null } }),
    }),
    {
      name: 'squadboard.ui',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ nameMode: s.nameMode, projectId: s.projectId }),
    },
  ),
);
