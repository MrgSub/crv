import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { ModelOption } from "@/lib/catalog";
import { DEFAULT_SYSTEM_PROMPT, SYSTEM_PROMPT_LIBRARY } from "@/lib/eval-presets";
import {
  parseJsonSchemaText,
  stringifyJsonSchema,
  validateJsonResponse,
  type ValidationState,
} from "@/lib/schema-validation";
import type { InitialModelSelection } from "@/lib/default-selections";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelSelection = {
  id: string;
  providerId: string;
  modelKey: string;
};

export type ModelResponse = {
  key: string;
  label: string;
  providerName: string;
  content: string;
  status: "queued" | "streaming" | "done" | "error";
  durationMs?: number;
  ttftMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
  finishReason?: string | null;
  error?: string;
  validation: ValidationState;
};

export type TurnValidator = {
  label: string;
  schemaText: string;
};

export type Turn = {
  id: string;
  prompt: string;
  createdAt: number;
  responses: Record<string, ModelResponse>;
  validator: TurnValidator | null;
};

export type SavedSession = {
  id: string;
  name: string;
  savedAt: number;
  systemPrompt: string;
  schemaText: string;
  turns: Turn[];
};

export type PromptSuggestionState = {
  status: "idle" | "loading" | "ready" | "error";
  prompt?: string;
  error?: string;
};

type StreamEvent =
  | { type: "model-start"; modelKey: string }
  | { type: "model-chunk"; modelKey: string; delta: string; elapsedMs: number }
  | {
    type: "model-finish";
    modelKey: string;
    durationMs: number;
    ttftMs?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    estimatedCost?: number;
    finishReason?: string | null;
  }
  | { type: "model-error"; modelKey: string; error: string; durationMs: number }
  | { type: "batch-finish" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

type EvalState = {
  // Session config
  systemPrompt: string;
  selectedSystemPromptId: string;
  schemaText: string;
  timeoutSeconds: string;
  openRouterApiKey: string;

  // Models
  selectedModels: ModelSelection[];

  // Turns
  turns: Turn[];
  isSubmitting: boolean;
  prompt: string;

  // UI
  expandedResponses: Record<string, boolean>;
  promptSuggestions: Record<string, PromptSuggestionState>;
  showOnlySuccess: boolean;
  isSchemaEditorOpen: boolean;
  showSavedSessions: boolean;

  // Session config actions
  setSystemPrompt: (value: string) => void;
  setSelectedSystemPromptId: (id: string) => void;
  setSchemaText: (value: string) => void;
  setTimeoutSeconds: (value: string) => void;
  setOpenRouterApiKey: (value: string) => void;
  applyPreset: (id: string) => void;
  resetConfig: () => void;
  applySuggestedPrompt: (suggestedPrompt: string) => void;

  // Model actions
  setSelectedModels: (models: ModelSelection[]) => void;
  addSelection: (fallback: ModelOption) => void;
  selectAllModels: (models: ModelOption[]) => void;
  updateSelection: (
    id: string,
    next: Partial<ModelSelection>,
    modelsByProvider: Map<string, ModelOption[]>,
  ) => void;
  removeSelection: (id: string) => void;

  // Turn actions
  setTurns: (turns: Turn[] | ((current: Turn[]) => Turn[])) => void;
  setPrompt: (value: string) => void;
  setIsSubmitting: (value: boolean) => void;
  clearTurns: () => void;

  // UI actions
  toggleResponseExpanded: (id: string) => void;
  setExpandedResponses: (value: Record<string, boolean>) => void;
  setPromptSuggestion: (id: string, state: PromptSuggestionState) => void;
  setPromptSuggestions: (value: Record<string, PromptSuggestionState>) => void;
  setShowOnlySuccess: (value: boolean) => void;
  setIsSchemaEditorOpen: (value: boolean) => void;
  setShowSavedSessions: (value: boolean) => void;

  // Initialization
  initModels: (selections: InitialModelSelection[]) => void;
};

type SavedSessionsState = {
  savedSessions: SavedSession[];
  saveTurnToSession: (turn: Turn, systemPrompt: string, schemaText: string) => void;
  saveAllTurns: (turns: Turn[], systemPrompt: string, schemaText: string) => void;
  loadSession: (session: SavedSession) => SavedSession;
  deleteSavedSession: (id: string) => void;
  importSessions: (imported: SavedSession[]) => void;
};

// ---------------------------------------------------------------------------
// Eval store
// ---------------------------------------------------------------------------

export const useEvalStore = create<EvalState>()((set, get) => ({
  // Session config
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  selectedSystemPromptId: "",
  schemaText: "",
  timeoutSeconds: "",
  openRouterApiKey: "",

  // Models
  selectedModels: [],

  // Turns
  turns: [],
  isSubmitting: false,
  prompt: "",

  // UI
  expandedResponses: {},
  promptSuggestions: {},
  showOnlySuccess: false,
  isSchemaEditorOpen: false,
  showSavedSessions: false,

  // Session config actions
  setSystemPrompt: (value) => set({ systemPrompt: value }),
  setSelectedSystemPromptId: (id) => set({ selectedSystemPromptId: id }),
  setSchemaText: (value) => set({ schemaText: value }),
  setTimeoutSeconds: (value) => set({ timeoutSeconds: value }),
  setOpenRouterApiKey: (value) => set({ openRouterApiKey: value }),

  applyPreset: (id) => {
    const preset = SYSTEM_PROMPT_LIBRARY.find((entry) => entry.id === id);
    if (preset) {
      set({
        selectedSystemPromptId: id,
        systemPrompt: preset.prompt,
        schemaText: stringifyJsonSchema(preset.schema),
      });
    } else {
      set({ selectedSystemPromptId: id, schemaText: "" });
    }
  },

  resetConfig: () =>
    set({
      selectedSystemPromptId: "",
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      schemaText: "",
    }),

  applySuggestedPrompt: (suggestedPrompt) =>
    set({ selectedSystemPromptId: "", systemPrompt: suggestedPrompt }),

  // Model actions
  setSelectedModels: (models) => set({ selectedModels: models }),

  addSelection: (fallback) =>
    set((state) => ({
      selectedModels: [
        ...state.selectedModels,
        {
          id: createId("selection"),
          providerId: fallback.providerId,
          modelKey: fallback.key,
        },
      ],
    })),

  selectAllModels: (models) =>
    set({
      selectedModels: models.map((model) => ({
        id: createId("selection"),
        providerId: model.providerId,
        modelKey: model.key,
      })),
    }),

  updateSelection: (id, next, modelsByProvider) =>
    set((state) => ({
      selectedModels: state.selectedModels.map((selection) => {
        if (selection.id !== id) return selection;
        const updated = { ...selection, ...next };
        if (next.providerId) {
          const providerModels = modelsByProvider.get(next.providerId) ?? [];
          if (!providerModels.some((model) => model.key === updated.modelKey)) {
            updated.modelKey = providerModels[0]?.key ?? updated.modelKey;
          }
        }
        return updated;
      }),
    })),

  removeSelection: (id) =>
    set((state) => ({
      selectedModels: state.selectedModels.filter((s) => s.id !== id),
    })),

  // Turn actions
  setTurns: (turnsOrFn) =>
    set((state) => ({
      turns: typeof turnsOrFn === "function" ? turnsOrFn(state.turns) : turnsOrFn,
    })),

  setPrompt: (value) => set({ prompt: value }),
  setIsSubmitting: (value) => set({ isSubmitting: value }),

  clearTurns: () =>
    set({ turns: [], expandedResponses: {}, promptSuggestions: {} }),

  // UI actions
  toggleResponseExpanded: (id) =>
    set((state) => ({
      expandedResponses: { ...state.expandedResponses, [id]: !state.expandedResponses[id] },
    })),

  setExpandedResponses: (value) => set({ expandedResponses: value }),

  setPromptSuggestion: (id, suggestion) =>
    set((state) => ({
      promptSuggestions: { ...state.promptSuggestions, [id]: suggestion },
    })),

  setPromptSuggestions: (value) => set({ promptSuggestions: value }),
  setShowOnlySuccess: (value) => set({ showOnlySuccess: value }),
  setIsSchemaEditorOpen: (value) => set({ isSchemaEditorOpen: value }),
  setShowSavedSessions: (value) => set({ showSavedSessions: value }),

  // Initialization
  initModels: (selections) =>
    set({
      selectedModels: selections.map((s) => ({
        id: createId("selection"),
        providerId: s.providerId,
        modelKey: s.modelKey,
      })),
    }),
}));

// ---------------------------------------------------------------------------
// Saved sessions store (with persist middleware)
// ---------------------------------------------------------------------------

export const useSavedSessionsStore = create<SavedSessionsState>()(
  persist(
    (set, get) => ({
      savedSessions: [],

      saveTurnToSession: (turn, systemPrompt, schemaText) => {
        const name = `Turn: ${turn.prompt.slice(0, 60)}${turn.prompt.length > 60 ? "…" : ""}`;
        const session: SavedSession = {
          id: createId("session"),
          name,
          savedAt: Date.now(),
          systemPrompt,
          schemaText,
          turns: [turn],
        };
        set({ savedSessions: [session, ...get().savedSessions] });
      },

      saveAllTurns: (turns, systemPrompt, schemaText) => {
        if (turns.length === 0) return;
        const name = `Session (${turns.length} turn${turns.length === 1 ? "" : "s"}) — ${new Date().toLocaleString()}`;
        const session: SavedSession = {
          id: createId("session"),
          name,
          savedAt: Date.now(),
          systemPrompt,
          schemaText,
          turns,
        };
        set({ savedSessions: [session, ...get().savedSessions] });
      },

      loadSession: (session) => session,

      deleteSavedSession: (id) =>
        set({ savedSessions: get().savedSessions.filter((s) => s.id !== id) }),

      importSessions: (imported) => {
        if (!Array.isArray(imported)) return;
        const existing = new Set(get().savedSessions.map((s) => s.id));
        const newSessions = imported.filter((s) => !existing.has(s.id));
        set({ savedSessions: [...newSessions, ...get().savedSessions] });
      },
    }),
    {
      name: "eval-studio-saved-sessions",
    },
  ),
);

// ---------------------------------------------------------------------------
// Re-exported helpers used in the component
// ---------------------------------------------------------------------------

export { createId };

export type { StreamEvent };

export function applyStreamBatch(
  turns: Turn[],
  turnId: string,
  batch: StreamEvent[],
): Turn[] {
  return turns.map((turn) => {
    if (turn.id !== turnId) return turn;

    let responses = turn.responses;
    let changed = false;

    for (const event of batch) {
      if (event.type === "batch-finish") continue;
      const prev = responses[event.modelKey];
      if (!prev) continue;

      let next: ModelResponse | undefined;

      if (event.type === "model-start") {
        next = { ...prev, status: "streaming" };
      } else if (event.type === "model-chunk") {
        next = {
          ...prev,
          status: "streaming",
          content: `${prev.content}${event.delta}`,
          ttftMs: prev.ttftMs ?? event.elapsedMs,
        };
      } else if (event.type === "model-finish") {
        const validationSource = turn.validator
          ? parseJsonSchemaText(turn.validator.schemaText)
          : null;
        const content = responses[event.modelKey]?.content ?? prev.content;
        const validation =
          validationSource && validationSource.ok && validationSource.validator
            ? validateJsonResponse(content, validationSource.validator)
            : { status: "unavailable" as const, message: "No schema" };

        next = {
          ...prev,
          status: "done",
          durationMs: event.durationMs,
          ttftMs: event.ttftMs ?? prev.ttftMs,
          promptTokens: event.promptTokens,
          completionTokens: event.completionTokens,
          totalTokens: event.totalTokens,
          estimatedCost: event.estimatedCost,
          finishReason: event.finishReason,
          validation,
        };
      } else {
        next = {
          ...prev,
          status: "error",
          durationMs: event.durationMs,
          error: event.error,
          validation: { status: "unavailable", message: "No structured result" },
        };
      }

      if (next) {
        if (!changed) {
          responses = { ...responses };
          changed = true;
        }
        responses[event.modelKey] = next;
      }
    }

    return changed ? { ...turn, responses } : turn;
  });
}

export function markTurnErrors(turns: Turn[], turnId: string, message: string): Turn[] {
  return turns.map((turn) => {
    if (turn.id !== turnId) return turn;

    const nextResponses = Object.fromEntries(
      Object.entries(turn.responses).map(([key, response]) => [
        key,
        response.status === "done"
          ? response
          : {
            ...response,
            status: "error" as const,
            error: message,
            validation: { status: "unavailable" as const, message: "No structured result" },
          },
      ]),
    );

    return { ...turn, responses: nextResponses };
  });
}
