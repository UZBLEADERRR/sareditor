import { create } from 'zustand';

import type { ChatMessage } from '../ai/providers/toolChat';
import { uid } from '../utils/id';

export type ChatEntry = {
  id: string;
  role: 'user' | 'agent' | 'error';
  text: string;
  /** What the run changed, one line each. Shown under the agent's reply. */
  changes?: string[];
  /** Set when the run wrote to the project, so the message can offer an undo. */
  editId?: string;
  /** Cleared once the user undoes it. */
  undone?: boolean;
  at: number;
};

type Thread = {
  entries: ChatEntry[];
  /** Raw provider history, so follow-up messages keep their context. */
  history: ChatMessage[];
};

type AgentChatState = {
  threads: Record<string, Thread>;
  thread: (projectId: string) => Thread;
  append: (projectId: string, entry: Omit<ChatEntry, 'id' | 'at'>) => string;
  setHistory: (projectId: string, history: ChatMessage[]) => void;
  markUndone: (projectId: string, entryId: string) => void;
  clear: (projectId: string) => void;
};

const EMPTY: Thread = { entries: [], history: [] };

/**
 * The conversation with the editing agent, kept per project.
 *
 * Deliberately not persisted: the entries describe edits that already live in
 * the project, and a chat restored from disk would offer undo buttons for runs
 * whose snapshots have long since rolled out of the project's own history.
 */
export const useAgentChat = create<AgentChatState>((set, get) => ({
  threads: {},

  thread: (projectId) => get().threads[projectId] ?? EMPTY,

  append: (projectId, entry) => {
    const id = uid('msg_');
    set((state) => {
      const thread = state.threads[projectId] ?? EMPTY;
      return {
        threads: {
          ...state.threads,
          [projectId]: {
            ...thread,
            entries: [...thread.entries, { ...entry, id, at: Date.now() }],
          },
        },
      };
    });
    return id;
  },

  setHistory: (projectId, history) =>
    set((state) => {
      const thread = state.threads[projectId] ?? EMPTY;
      // Long threads cost tokens on every turn; the tail carries the context.
      return { threads: { ...state.threads, [projectId]: { ...thread, history: history.slice(-40) } } };
    }),

  markUndone: (projectId, entryId) =>
    set((state) => {
      const thread = state.threads[projectId] ?? EMPTY;
      return {
        threads: {
          ...state.threads,
          [projectId]: {
            ...thread,
            entries: thread.entries.map((entry) =>
              entry.id === entryId ? { ...entry, undone: true } : entry
            ),
          },
        },
      };
    }),

  clear: (projectId) =>
    set((state) => ({ threads: { ...state.threads, [projectId]: { entries: [], history: [] } } })),
}));
