import { create } from "zustand";

/**
 * Global "what is the user currently looking at" store. Pages that show a
 * specific record/task/scope call useAskContext.getState().setContext(...)
 * on mount (and clear on unmount) so that any Ask surface — especially the
 * right-side drawer, which is rendered once at the layout level and has no
 * other way to know what page it's floating over — can pass real context
 * to the backend instead of guessing from the URL.
 */
export interface AskPageContext {
  node_id?: string;
  node_name?: string;
  object_type?: string;
  task_id?: string;
  task_title?: string;
  scope_label?: string;
}

interface AskContextState {
  context: AskPageContext | null;
  setContext: (ctx: AskPageContext | null) => void;
}

export const useAskContextStore = create<AskContextState>((set) => ({
  context: null,
  setContext: (ctx) => set({ context: ctx }),
}));
