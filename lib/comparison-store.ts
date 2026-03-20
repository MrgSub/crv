import { create } from "zustand";

type ComparisonState = {
  checkedResponses: Set<string>;
  compareDialogTurnId: string | null;
  toggleChecked: (responseId: string) => void;
  getCheckedCount: (turnId: string, responseKeys: string[]) => number;
  openCompareDialog: (turnId: string) => void;
  closeCompareDialog: () => void;
  reset: () => void;
};

export const useComparisonStore = create<ComparisonState>((set, get) => ({
  checkedResponses: new Set(),
  compareDialogTurnId: null,

  toggleChecked: (responseId) =>
    set((state) => {
      const next = new Set(state.checkedResponses);
      if (next.has(responseId)) {
        next.delete(responseId);
      } else {
        next.add(responseId);
      }
      return { checkedResponses: next };
    }),

  getCheckedCount: (turnId, responseKeys) => {
    const { checkedResponses } = get();
    return responseKeys.filter((key) => checkedResponses.has(`${turnId}:${key}`)).length;
  },

  openCompareDialog: (turnId) => set({ compareDialogTurnId: turnId }),
  closeCompareDialog: () => set({ compareDialogTurnId: null }),

  reset: () => set({ checkedResponses: new Set(), compareDialogTurnId: null }),
}));
