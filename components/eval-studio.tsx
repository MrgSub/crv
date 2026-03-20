"use client";

import {
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Download,

  LoaderCircle,
  Plus,

  Save,
  Scale,
  SendHorizontal,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import type { CatalogData, ModelOption } from "@/lib/catalog";
import { useComparisonStore } from "@/lib/comparison-store";
import {
  useEvalStore,
  useSavedSessionsStore,
  applyStreamBatch,
  markTurnErrors,
  createId,
  type ModelSelection,
  type ModelResponse,
  type Turn,
  type TurnValidator,
  type SavedSession,
  type PromptSuggestionState,
  type StreamEvent,
} from "@/lib/eval-store";
import { SchemaEditorDialog } from "@/components/schema-editor-dialog";
import type { InitialModelSelection } from "@/lib/default-selections";
import { SYSTEM_PROMPT_LIBRARY } from "@/lib/eval-presets";
import {
  parseJsonSchemaText,
  stringifyJsonSchema,
  type JsonZodSchema,
  type ValidationState,
} from "@/lib/schema-validation";
import { cn, formatDuration, formatTokenCount, formatUsd } from "@/lib/utils";

type EvalStudioProps = {
  catalog: CatalogData;
  initialSelections: InitialModelSelection[];
};

function statusMeta(status: ModelResponse["status"]) {
  if (status === "done") {
    return {
      label: "Done",
      icon: CheckCircle2,
      className: "text-[var(--success)] bg-[color:rgba(56,211,159,0.12)] ring-[color:rgba(56,211,159,0.24)]",
    };
  }

  if (status === "error") {
    return {
      label: "Error",
      icon: CircleAlert,
      className: "text-[var(--danger)] bg-[color:rgba(255,107,146,0.12)] ring-[color:rgba(255,107,146,0.24)]",
    };
  }

  if (status === "streaming") {
    return {
      label: "Streaming",
      icon: LoaderCircle,
      className: "text-[var(--accent)] bg-[color:rgba(78,203,255,0.12)] ring-[color:rgba(78,203,255,0.24)]",
    };
  }

  return {
    label: "Queued",
    icon: LoaderCircle,
    className: "text-[var(--muted-ink)] bg-[color:rgba(125,147,178,0.1)] ring-[color:rgba(125,147,178,0.22)]",
  };
}

function summarizeModel(model?: ModelOption) {
  if (!model) {
    return "Unavailable";
  }

  const details = [];
  if (model.contextWindow) {
    details.push(`${Intl.NumberFormat("en-US", { notation: "compact" }).format(model.contextWindow)} ctx`);
  }

  if (model.inputCost !== undefined && model.outputCost !== undefined) {
    details.push(`$${model.inputCost.toFixed(2)} / $${model.outputCost.toFixed(2)} per 1M`);
  }

  return details.join(" · ") || "OpenRouter";
}

function validationMeta(validation: ValidationState) {
  if (validation.status === "passed") {
    return {
      label: "Schema pass",
      className: "text-[var(--success)] bg-[color:rgba(56,211,159,0.12)] ring-[color:rgba(56,211,159,0.24)]",
    };
  }

  if (validation.status === "failed") {
    return {
      label: "Schema fail",
      className: "text-[var(--danger)] bg-[color:rgba(255,107,146,0.12)] ring-[color:rgba(255,107,146,0.24)]",
    };
  }

  return {
    label: validation.message,
    className: "text-[var(--muted-ink)] bg-[color:rgba(125,147,178,0.1)] ring-[color:rgba(125,147,178,0.22)]",
  };
}

function isSuccessfulResponse(response: ModelResponse) {
  return response.status === "done" && response.validation.status !== "failed";
}

function canSuggestPrompt(response: ModelResponse) {
  return response.status === "error" || response.validation.status === "failed";
}

function compareNullableNumbers(left?: number, right?: number) {
  if (left === undefined && right === undefined) {
    return 0;
  }

  if (left === undefined) {
    return 1;
  }

  if (right === undefined) {
    return -1;
  }

  return left - right;
}

function responseStatusSortValue(status: ModelResponse["status"]) {
  if (status === "done") {
    return 0;
  }

  if (status === "streaming") {
    return 1;
  }

  if (status === "queued") {
    return 2;
  }

  return 3;
}

function validationStatusSortValue(validation: ValidationState) {
  if (validation.status === "passed") {
    return 0;
  }

  if (validation.status === "failed") {
    return 1;
  }

  return 2;
}

type ResponseTableProps = {
  turn: Turn;
  turnId: string;
  responses: ModelResponse[];
};

function CompareCheckbox({ turnId, responseKey, label }: { turnId: string; responseKey: string; label: string }) {
  const responseId = `${turnId}:${responseKey}`;
  const checked = useComparisonStore((s) => s.checkedResponses.has(responseId));
  const toggle = useComparisonStore((s) => s.toggleChecked);
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={() => toggle(responseId)}
      className="h-4 w-4 accent-[var(--accent-strong)]"
      aria-label={`Select ${label} for comparison`}
    />
  );
}

function CompareButton({ turnId, responseKeys }: { turnId: string; responseKeys: string[] }) {
  const checkedResponses = useComparisonStore((s) => s.checkedResponses);
  const openCompareDialog = useComparisonStore((s) => s.openCompareDialog);
  const count = responseKeys.filter((key) => checkedResponses.has(`${turnId}:${key}`)).length;

  if (count < 2) return null;

  return (
    <button
      type="button"
      onClick={() => openCompareDialog(turnId)}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 py-1.5 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[var(--accent-foreground)] shadow-[0_10px_24px_rgba(29,176,243,0.22)] transition hover:bg-[var(--accent-strong)] active:scale-[0.98]"
    >
      <Scale aria-hidden="true" className="h-3.5 w-3.5" />
      Compare ({count})
    </button>
  );
}

async function suggestPromptForResponse(turn: Turn, response: ModelResponse) {
  if (!canSuggestPrompt(response)) return;

  const { systemPrompt, setPromptSuggestion, toggleResponseExpanded } = useEvalStore.getState();
  const responseId = `${turn.id}:${response.key}`;
  setPromptSuggestion(responseId, { status: "loading" });

  try {
    const { openRouterApiKey } = useEvalStore.getState();
    const suggestionResponse = await fetch("/api/suggest-system-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelKey: response.key,
        systemPrompt,
        prompt: turn.prompt,
        schemaText: turn.validator?.schemaText,
        responseContent: response.content || undefined,
        responseError: response.error,
        validationMessage:
          response.validation.status === "failed" ? response.validation.message : undefined,
        validationIssues:
          response.validation.status === "failed" ? response.validation.issues : undefined,
        openRouterApiKey: openRouterApiKey.trim() || undefined,
      }),
    });

    const data = (await suggestionResponse.json().catch(() => null)) as
      | { suggestedPrompt?: string; error?: string }
      | null;

    if (!suggestionResponse.ok || !data?.suggestedPrompt) {
      throw new Error(data?.error ?? "Failed to generate a suggested system prompt.");
    }

    toggleResponseExpanded(responseId);
    setPromptSuggestion(responseId, { status: "ready", prompt: data.suggestedPrompt });
  } catch (error) {
    setPromptSuggestion(responseId, {
      status: "error",
      error: error instanceof Error ? error.message : "Failed to generate a suggested system prompt.",
    });
  }
}

const responseColumnHelper = createColumnHelper<ModelResponse>();

function ResponseDataTable({
  turn,
  turnId,
  responses,
}: ResponseTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const toggleChecked = useComparisonStore((s) => s.toggleChecked);
  const expandedResponses = useEvalStore((s) => s.expandedResponses);
  const promptSuggestions = useEvalStore((s) => s.promptSuggestions);
  const onToggleExpanded = useEvalStore((s) => s.toggleResponseExpanded);
  const applySuggestedPrompt = useEvalStore((s) => s.applySuggestedPrompt);

  const columns = useMemo(
    () => [
      responseColumnHelper.display({
        id: "select",
        header: "",
        enableSorting: false,
        cell: ({ row }) => <CompareCheckbox turnId={turnId} responseKey={row.original.key} label={row.original.label} />,
      }),
      responseColumnHelper.accessor(
        (response) => `${response.providerName} ${response.label}`.toLowerCase(),
        {
          id: "model",
          header: "Model",
          cell: ({ row }) => {
            const response = row.original;

            return (
              <div className="min-w-0">
                <div className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-[var(--muted-ink)]">
                  {response.providerName}
                </div>
                <div className="mt-2 font-semibold text-[var(--ink)]">{response.label}</div>
              </div>
            );
          },
        },
      ),
      responseColumnHelper.accessor((response) => responseStatusSortValue(response.status), {
        id: "status",
        header: "Status",
        cell: ({ row }) => {
          const response = row.original;
          const meta = statusMeta(response.status);
          const StatusIcon = meta.icon;

          return (
            <div
              className={cn(
                "inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full px-3 py-2 text-sm font-medium ring-1 ring-inset",
                meta.className,
              )}
            >
              <StatusIcon
                aria-hidden="true"
                className={cn("h-4 w-4", response.status === "streaming" ? "animate-spin" : "")}
              />
              {meta.label}
            </div>
          );
        },
      }),
      responseColumnHelper.accessor((response) => validationStatusSortValue(response.validation), {
        id: "validation",
        header: "Validation",
        cell: ({ row }) => {
          const validationChip = validationMeta(row.original.validation);

          return (
            <div
              className={cn(
                "inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-3 py-2 text-sm font-medium ring-1 ring-inset",
                validationChip.className,
              )}
            >
              {validationChip.label}
            </div>
          );
        },
      }),
      responseColumnHelper.accessor((response) => response.ttftMs, {
        id: "ttft",
        header: "TTFT",
        sortingFn: (left, right) =>
          compareNullableNumbers(left.original.ttftMs, right.original.ttftMs),
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-mono text-[var(--ink)]">
            {formatDuration(row.original.ttftMs)}
          </span>
        ),
      }),
      responseColumnHelper.accessor((response) => response.durationMs, {
        id: "total",
        header: "Total",
        sortingFn: (left, right) =>
          compareNullableNumbers(left.original.durationMs, right.original.durationMs),
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-mono text-[var(--ink)]">
            {formatDuration(row.original.durationMs)}
          </span>
        ),
      }),
      responseColumnHelper.accessor((response) => response.estimatedCost, {
        id: "cost",
        header: "Cost",
        sortingFn: (left, right) =>
          compareNullableNumbers(left.original.estimatedCost, right.original.estimatedCost),
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-mono text-[var(--ink)]">
            {formatUsd(row.original.estimatedCost)}
          </span>
        ),
      }),
      responseColumnHelper.accessor((response) => response.totalTokens, {
        id: "tokens",
        header: "Tokens",
        sortingFn: (left, right) =>
          compareNullableNumbers(left.original.totalTokens, right.original.totalTokens),
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-mono text-[var(--ink)]">
            {formatTokenCount(row.original.totalTokens)}
          </span>
        ),
      }),
      responseColumnHelper.display({
        id: "response",
        header: "Response",
        enableSorting: false,
        cell: ({ row }) => {
          const response = row.original;
          const responseId = `${turnId}:${response.key}`;
          const isExpanded = Boolean(expandedResponses[responseId]);
          const suggestionState = promptSuggestions[responseId] ?? { status: "idle" as const };

          return (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onToggleExpanded(responseId)}
                aria-expanded={isExpanded}
               className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full border border-[var(--line)] bg-[var(--canvas-strong)] px-3 py-2 text-sm font-medium text-[var(--ink-soft)] transition hover:border-[var(--line-strong)] hover:bg-[color:rgba(17,31,53,0.96)]"
              >
                <span>{isExpanded ? "Hide response" : "View response"}</span>
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "h-4 w-4 transition-transform duration-180 ease-out",
                    isExpanded ? "rotate-180" : "",
                  )}
                />
              </button>
              {canSuggestPrompt(response) ? (
                <button
                  type="button"
                  onClick={() => void suggestPromptForResponse(turn, response)}
                  disabled={suggestionState.status === "loading"}
                  className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2 text-sm font-medium text-[var(--ink)] transition hover:border-[var(--line-strong)] hover:bg-[var(--canvas-strong)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {suggestionState.status === "loading" ? (
                    <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles aria-hidden="true" className="h-4 w-4" />
                  )}
                  Suggest new prompt
                </button>
              ) : null}
            </div>
          );
        },
      }),
    ],
    [expandedResponses, onToggleExpanded, promptSuggestions, turn, turnId],
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: responses,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    isMultiSortEvent: (event) => {
      return Boolean(
        event &&
          typeof event === "object" &&
          "shiftKey" in event &&
          (event as { shiftKey?: boolean }).shiftKey,
      );
    },
    maxMultiSortColCount: 4,
  });

  return (
    <div className="mt-4 overflow-hidden rounded-[1.25rem] border border-[var(--line)] bg-[var(--panel-strong)] shadow-[var(--shadow-md)]">
      <div className="border-b border-[var(--line)] bg-[linear-gradient(90deg,rgba(9,17,31,0.98),rgba(13,23,40,0.94))] px-4 py-3 font-mono text-[0.68rem] uppercase tracking-[0.18em] text-[var(--muted-ink)]">
        Shift-click headers to add more sort rules.
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="bg-[color:rgba(9,17,31,0.9)] text-[var(--muted-ink)]">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sortState = header.column.getIsSorted();
                  const sortIndex = sorting.findIndex((entry) => entry.id === header.column.id);

                  return (
                    <th
                      key={header.id}
                      className="px-4 py-3 font-mono text-[0.68rem] uppercase tracking-[0.18em]"
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={(event) => header.column.toggleSorting(undefined, event.shiftKey)}
                           className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 py-2 text-left transition hover:bg-[color:rgba(17,31,53,0.82)]"
                        >
                          <span>{flexRender(header.column.columnDef.header, header.getContext())}</span>
                          {sortState ? (
                             <span className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--canvas-strong)] px-2 py-1 text-[0.62rem] tracking-[0.16em] text-[var(--ink)]">
                              {sortIndex + 1}
                              <ChevronDown
                                aria-hidden="true"
                                className={cn("h-3.5 w-3.5", sortState === "asc" ? "rotate-180" : "")}
                              />
                            </span>
                          ) : (
                            <ArrowUpDown aria-hidden="true" className="h-3.5 w-3.5" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => {
              const response = row.original;
              const responseId = `${turnId}:${response.key}`;
              const isExpanded = Boolean(expandedResponses[responseId]);
              const suggestionState = promptSuggestions[responseId] ?? { status: "idle" as const };

              return (
                <Fragment key={row.id}>
                  <tr className="border-t border-[var(--line)] align-top">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-4">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                  {isExpanded ? (
                    <tr className="border-t border-[var(--line)] bg-[color:rgba(6,11,20,0.76)]">
                      <td colSpan={row.getVisibleCells().length} className="px-4 py-4">
                        <div className="flex max-h-[26rem] overflow-y-auto rounded-[1.1rem] border border-[var(--line)] bg-[linear-gradient(180deg,rgba(10,18,31,0.98),rgba(13,23,40,0.98))] p-4">
                          {response.error ? (
                            <p className="whitespace-pre-wrap break-words text-sm leading-7 text-[var(--danger)]">
                              {response.error}
                            </p>
                          ) : response.content ? (
                            <p
                              aria-live={response.status === "streaming" ? "polite" : undefined}
                              className="whitespace-pre-wrap break-words text-sm leading-7 text-[var(--ink)]"
                            >
                              {response.content}
                            </p>
                          ) : (
                            <div className="flex min-h-28 w-full items-center justify-center text-sm text-[var(--muted-ink)]">
                              Waiting for first token...
                            </div>
                          )}
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2 font-mono text-[0.68rem] uppercase tracking-[0.18em] text-[var(--muted-ink)]">
                            <span className="rounded-full border border-[var(--line)] bg-[var(--canvas-strong)] px-3 py-2">
                              prompt {formatTokenCount(response.promptTokens)}
                            </span>
                          <span className="rounded-full border border-[var(--line)] bg-[var(--canvas-strong)] px-3 py-2">
                            completion {formatTokenCount(response.completionTokens)}
                          </span>
                          {response.finishReason ? (
                            <span className="rounded-full border border-[var(--line)] bg-[var(--canvas-strong)] px-3 py-2">
                              {response.finishReason}
                            </span>
                          ) : null}
                        </div>
                        {response.validation.status === "failed" ? (
                          <div className="mt-4 rounded-[1rem] border border-[color:rgba(255,107,146,0.18)] bg-[color:rgba(255,107,146,0.08)] p-3 text-sm leading-6 text-[var(--danger)]">
                            {response.validation.issues.map((issue) => (
                              <p key={issue}>{issue}</p>
                            ))}
                          </div>
                        ) : null}
                        {suggestionState.status === "ready" && suggestionState.prompt ? (
                          <div className="mt-4 rounded-[1rem] border border-[color:rgba(102,184,255,0.18)] bg-[color:rgba(102,184,255,0.08)] p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-[var(--info)]">
                                  Suggested system prompt
                                </p>
                                <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                                  Generated by the same model from its failed run.
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => applySuggestedPrompt(suggestionState.prompt!)}
                                className="inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-foreground)] transition hover:bg-[var(--accent-strong)] active:scale-[0.98]"
                              >
                                Use suggested prompt
                              </button>
                            </div>
                            <div className="mt-3 max-h-64 overflow-y-auto rounded-[0.95rem] border border-[color:rgba(102,184,255,0.14)] bg-[color:rgba(6,11,20,0.62)] p-3 text-sm leading-7 text-[var(--ink)] whitespace-pre-wrap break-words">
                              {suggestionState.prompt}
                            </div>
                          </div>
                        ) : null}
                        {suggestionState.status === "error" && suggestionState.error ? (
                          <div className="mt-4 rounded-[1rem] border border-[color:rgba(255,184,106,0.18)] bg-[color:rgba(255,184,106,0.1)] p-3 text-sm leading-6 text-[var(--warning)]">
                            {suggestionState.error}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function EvalStudio({ catalog, initialSelections }: EvalStudioProps) {
  // Eval store
  const systemPrompt = useEvalStore((s) => s.systemPrompt);
  const setSystemPrompt = useEvalStore((s) => s.setSystemPrompt);
  const selectedSystemPromptId = useEvalStore((s) => s.selectedSystemPromptId);
  const schemaText = useEvalStore((s) => s.schemaText);
  const setSchemaText = useEvalStore((s) => s.setSchemaText);
  const isSchemaEditorOpen = useEvalStore((s) => s.isSchemaEditorOpen);
  const setIsSchemaEditorOpen = useEvalStore((s) => s.setIsSchemaEditorOpen);
  const prompt = useEvalStore((s) => s.prompt);
  const setPrompt = useEvalStore((s) => s.setPrompt);
  const turns = useEvalStore((s) => s.turns);
  const setTurns = useEvalStore((s) => s.setTurns);
  const selectedModels = useEvalStore((s) => s.selectedModels);
  const isSubmitting = useEvalStore((s) => s.isSubmitting);
  const setIsSubmitting = useEvalStore((s) => s.setIsSubmitting);
  const showOnlySuccess = useEvalStore((s) => s.showOnlySuccess);
  const setShowOnlySuccess = useEvalStore((s) => s.setShowOnlySuccess);
  const showSavedSessions = useEvalStore((s) => s.showSavedSessions);
  const setShowSavedSessions = useEvalStore((s) => s.setShowSavedSessions);
  const timeoutSeconds = useEvalStore((s) => s.timeoutSeconds);
  const setTimeoutSeconds = useEvalStore((s) => s.setTimeoutSeconds);
  const openRouterApiKey = useEvalStore((s) => s.openRouterApiKey);
  const setOpenRouterApiKey = useEvalStore((s) => s.setOpenRouterApiKey);
  const applyPreset = useEvalStore((s) => s.applyPreset);
  const resetConfig = useEvalStore((s) => s.resetConfig);
  const clearTurns = useEvalStore((s) => s.clearTurns);
  const initModels = useEvalStore((s) => s.initModels);

  // Saved sessions store (persisted)
  const savedSessions = useSavedSessionsStore((s) => s.savedSessions);
  const saveTurnToSession = useSavedSessionsStore((s) => s.saveTurnToSession);
  const saveAllTurns = useSavedSessionsStore((s) => s.saveAllTurns);
  const loadSessionFromStore = useSavedSessionsStore((s) => s.loadSession);
  const deleteSavedSession = useSavedSessionsStore((s) => s.deleteSavedSession);
  const importSessionsToStore = useSavedSessionsStore((s) => s.importSessions);

  // Comparison store
  const compareDialogTurnId = useComparisonStore((s) => s.compareDialogTurnId);
  const closeCompareDialog = useComparisonStore((s) => s.closeCompareDialog);
  const checkedResponses = useComparisonStore((s) => s.checkedResponses);
  const resetComparison = useComparisonStore((s) => s.reset);

  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    initModels(initialSelections);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadSession = (session: SavedSession) => {
    loadSessionFromStore(session);
    setSystemPrompt(session.systemPrompt);
    setSchemaText(session.schemaText);
    useEvalStore.getState().setSelectedSystemPromptId("");
    setTurns(session.turns);
    useEvalStore.getState().setExpandedResponses({});
    useEvalStore.getState().setPromptSuggestions({});
    setShowSavedSessions(false);
  };

  const exportSessions = () => {
    const data = JSON.stringify(savedSessions, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `eval-studio-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importSessions = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result as string) as SavedSession[];
        importSessionsToStore(imported);
      } catch {
        // invalid file
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const selectedPreset = useMemo(
    () => SYSTEM_PROMPT_LIBRARY.find((entry) => entry.id === selectedSystemPromptId),
    [selectedSystemPromptId],
  );

  const parsedSchema = useMemo(() => parseJsonSchemaText(schemaText), [schemaText]);
  const hasSchema = schemaText.trim().length > 0;
  const schemaError = parsedSchema.ok ? null : parsedSchema.error;
  const schemaReady = !hasSchema || parsedSchema.ok;
  const editorInitialSchema = useMemo<JsonZodSchema>(() => {
    if (parsedSchema.ok && parsedSchema.schema) {
      return parsedSchema.schema;
    }

    return { type: "object", properties: {}, additionalProperties: false };
  }, [parsedSchema]);

  const modelsByKey = useMemo(
    () => new Map(catalog.models.map((model) => [model.key, model])),
    [catalog.models],
  );

  const modelsByProvider = useMemo(() => {
    const map = new Map<string, ModelOption[]>();

    for (const model of catalog.models) {
      const list = map.get(model.providerId);
      if (list) {
        list.push(model);
      } else {
        map.set(model.providerId, [model]);
      }
    }

    return map;
  }, [catalog.models]);

  const canSubmit =
    !isSubmitting && prompt.trim().length > 0 && selectedModels.length > 0 && schemaReady;
  const hasTurns = turns.length > 0;
  const allCatalogModelsSelected =
    selectedModels.length === catalog.models.length &&
    selectedModels.every((selection, index) => selection.modelKey === catalog.models[index]?.key);
  const visiblePromptPills = selectedModels.slice(0, 5);
  const hiddenPromptPillCount = Math.max(0, selectedModels.length - visiblePromptPills.length);
  const latestTurn = turns[turns.length - 1];
  const latestResponses = latestTurn ? Object.values(latestTurn.responses) : [];
  const latestSuccessCount = latestResponses.filter(isSuccessfulResponse).length;
  const latestFailureCount = latestResponses.filter(
    (response) => response.status === "error" || response.validation.status === "failed",
  ).length;
  const latestStreamingCount = latestResponses.filter(
    (response) => response.status === "queued" || response.status === "streaming",
  ).length;

  const addSelection = () => {
    const fallback = catalog.models[0];
    if (!fallback) return;
    useEvalStore.getState().addSelection(fallback);
  };

  const selectAllModels = () => {
    useEvalStore.getState().selectAllModels(catalog.models);
  };

  const updateSelection = (id: string, next: Partial<ModelSelection>) => {
    useEvalStore.getState().updateSelection(id, next, modelsByProvider);
  };

  const removeSelection = (id: string) => {
    useEvalStore.getState().removeSelection(id);
  };

  const compareDialogTurn = compareDialogTurnId
    ? turns.find((t) => t.id === compareDialogTurnId) ?? null
    : null;
  const compareDialogResponses = compareDialogTurn
    ? Object.values(compareDialogTurn.responses).filter((r) =>
        checkedResponses.has(`${compareDialogTurn.id}:${r.key}`),
      )
    : [];

  const submitPrompt = async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || isSubmitting || selectedModels.length === 0 || !schemaReady) {
      return;
    }

    const turnId = createId("turn");
    const turnValidator = hasSchema
      ? {
          label: selectedPreset?.name ?? "Custom schema",
          schemaText,
        }
      : null;
    const responseSeed = Object.fromEntries(
      selectedModels.map((selection) => {
        const model = modelsByKey.get(selection.modelKey);

        return [
          selection.modelKey,
          {
            key: selection.modelKey,
            label: model?.label ?? selection.modelKey,
            providerName: model?.providerName ?? selection.providerId,
            content: "",
            status: "queued" as const,
            validation: turnValidator
              ? { status: "unavailable" as const, message: "Awaiting final JSON" }
              : { status: "unavailable" as const, message: "No schema" },
          },
        ];
      }),
    );

    const nextTurn: Turn = {
      id: turnId,
      prompt: trimmedPrompt,
      createdAt: Date.now(),
      responses: responseSeed,
      validator: turnValidator,
    };

    const historyPayload = turns.map((turn) => ({
      prompt: turn.prompt,
      responses: Object.fromEntries(
        Object.entries(turn.responses)
          .filter(([, response]) => response.content.trim())
          .map(([key, response]) => [key, response.content]),
      ),
    }));

    setTurns((current) => [...current, nextTurn]);
    setPrompt("");
    setIsSubmitting(true);

    const parsedTimeout = parseFloat(timeoutSeconds);
    const timeoutMs =
      !Number.isNaN(parsedTimeout) && parsedTimeout > 0
        ? Math.round(parsedTimeout * 1000)
        : undefined;

    try {
      const response = await fetch("/api/eval", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemPrompt,
          prompt: trimmedPrompt,
          history: historyPayload,
          selectedModels: selectedModels.map((selection) => ({ key: selection.modelKey })),
          timeoutMs,
          openRouterApiKey: openRouterApiKey.trim() || undefined,
        }),
      });

      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Request failed.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const pendingEvents: StreamEvent[] = [];
      let flushScheduled = false;

      const flushEvents = () => {
        flushScheduled = false;
        if (pendingEvents.length === 0) return;
        const batch = pendingEvents.splice(0);
        setTurns((current) => applyStreamBatch(current, turnId, batch));
      };

      const enqueueEvent = (event: StreamEvent) => {
        pendingEvents.push(event);
        if (!flushScheduled) {
          flushScheduled = true;
          requestAnimationFrame(flushEvents);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.indexOf("\n");

        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (line) {
            enqueueEvent(JSON.parse(line) as StreamEvent);
          }

          newlineIndex = buffer.indexOf("\n");
        }
      }

      // Flush any remaining events synchronously
      flushEvents();

      const trailing = buffer.trim();
      if (trailing) {
        enqueueEvent(JSON.parse(trailing) as StreamEvent);
        flushEvents();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "The request failed.";
      setTurns((current) => markTurnErrors(current, turnId, message));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main id="main-content" className="min-h-screen overflow-x-hidden bg-[var(--page-bg)] text-[var(--ink)]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1560px] flex-col px-4 py-4 sm:px-6 lg:px-8 lg:py-8">
        <section className="relative overflow-hidden rounded-[2rem] border border-[var(--line)] bg-[var(--hero-bg)] px-6 py-8 shadow-[var(--shadow-lg)] sm:px-8 lg:px-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(78,203,255,0.14),transparent_34%),radial-gradient(circle_at_85%_18%,rgba(93,122,255,0.16),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_100%)]" />
          <div className="pointer-events-none absolute inset-y-0 right-[-8%] w-[44%] bg-[linear-gradient(180deg,rgba(78,203,255,0.12),rgba(78,203,255,0))] blur-3xl" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-4">
              <span className="inline-flex min-h-11 items-center rounded-full border border-[var(--line)] bg-[color:rgba(10,18,31,0.74)] px-4 py-2 font-mono text-[0.72rem] uppercase tracking-[0.24em] text-[var(--accent)] shadow-[0_0_0_1px_rgba(78,203,255,0.05)]">
                AI Lab Command Center
              </span>
              <div className="space-y-3">
                <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.04em] text-[var(--ink)] sm:text-5xl lg:text-6xl">
                  Run multi-model evals in a live dark-room console.
                </h1>
                <p className="max-w-2xl text-base leading-7 text-[var(--ink-soft)] sm:text-lg">
                  Configure the roster, pin one shared instruction set, and monitor latency, token burn, schema health, and failure recovery from a single operator surface.
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[420px]">
              <div className="rounded-3xl border border-[var(--line)] bg-[color:rgba(10,18,31,0.7)] p-4 shadow-[0_0_0_1px_rgba(78,203,255,0.04)] backdrop-blur">
                <div className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-[var(--muted-ink)]">Models</div>
                <div className="mt-2 text-3xl font-semibold tracking-[-0.04em]">{selectedModels.length}</div>
              </div>
              <div className="rounded-3xl border border-[var(--line)] bg-[color:rgba(10,18,31,0.7)] p-4 shadow-[0_0_0_1px_rgba(78,203,255,0.04)] backdrop-blur">
                <div className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-[var(--muted-ink)]">Catalog</div>
                <div className="mt-2 text-3xl font-semibold tracking-[-0.04em]">{catalog.models.length}</div>
              </div>
              <div className="rounded-3xl border border-[var(--line)] bg-[color:rgba(10,18,31,0.7)] p-4 shadow-[0_0_0_1px_rgba(78,203,255,0.04)] backdrop-blur">
                <div className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-[var(--muted-ink)]">Turns</div>
                <div className="mt-2 text-3xl font-semibold tracking-[-0.04em]">{turns.length}</div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid flex-1 gap-6 lg:grid-cols-[340px_minmax(0,1fr)] 2xl:grid-cols-[380px_minmax(0,1fr)]">
          <aside className="space-y-6 lg:sticky lg:top-8 lg:self-start">
            <div className="rounded-[1.75rem] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-md)] backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[0.72rem] uppercase tracking-[0.22em] text-[var(--muted-ink)]">
                    System prompt
                  </p>
                  <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em]">Shared instructions</h2>
                </div>
                <Sparkles aria-hidden="true" className="mt-1 h-5 w-5 text-[var(--accent-strong)]" />
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label className="grid gap-2 text-sm font-medium">
                  <span>Prompt library</span>
                  <select
                    value={selectedSystemPromptId}
                    onChange={(event) => applyPreset(event.target.value)}
                    name="systemPromptLibrary"
                    className="min-h-12 rounded-2xl border border-[var(--line)] bg-[var(--canvas-strong)] px-4 text-base text-[var(--ink)] outline-none transition"
                  >
                    <option value="">Custom prompt</option>
                    {SYSTEM_PROMPT_LIBRARY.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={resetConfig}
                   className="inline-flex min-h-12 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--panel-strong)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition hover:border-[var(--line-strong)] hover:bg-[var(--canvas-strong)] active:scale-[0.98]"
                >
                  Reset
                </button>
              </div>
              <label className="mt-4 block">
                <span className="sr-only">System prompt</span>
                <textarea
                  value={systemPrompt}
                  onChange={(event) => {
                    useEvalStore.getState().setSelectedSystemPromptId("");
                    setSystemPrompt(event.target.value);
                  }}
                  name="systemPrompt"
                  autoComplete="off"
                   className="min-h-48 max-h-80 w-full resize-y overflow-y-auto rounded-[1.25rem] border border-[var(--line)] bg-[var(--canvas-soft)] px-4 py-3 text-base leading-7 outline-none transition"
                  spellCheck={false}
                />
              </label>
              <label className="mt-4 block">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">Response schema (JSON)</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-[var(--muted-ink)]">
                      {hasSchema ? "validation on" : "validation off"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsSchemaEditorOpen(true)}
                       className="inline-flex min-h-10 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2 text-sm font-medium text-[var(--ink)] transition hover:border-[var(--line-strong)] hover:bg-[var(--canvas-strong)] active:scale-[0.98]"
                    >
                      Open editor
                    </button>
                  </div>
                </div>
                <textarea
                  value={schemaText}
                  onChange={(event) => {
                    useEvalStore.getState().setSelectedSystemPromptId("");
                    setSchemaText(event.target.value);
                  }}
                  name="responseSchema"
                  autoComplete="off"
                  placeholder='{"type":"object","properties":{}}'
                   className="min-h-40 max-h-80 w-full resize-y overflow-y-auto rounded-[1.25rem] border border-[var(--line)] bg-[var(--canvas-soft)] px-4 py-3 font-mono text-sm leading-7 outline-none transition"
                  spellCheck={false}
                />
              </label>
              <div
                className={cn(
                  "mt-3 rounded-[1.1rem] px-4 py-3 text-sm leading-6",
                  schemaError
                     ? "border border-[color:rgba(255,107,146,0.18)] bg-[color:rgba(255,107,146,0.08)] text-[var(--danger)]"
                     : "border border-[var(--line)] bg-[color:rgba(10,18,31,0.55)] text-[var(--muted-ink)]",
                )}
              >
                {schemaError
                  ? `Schema JSON is invalid: ${schemaError}`
                  : hasSchema
                    ? "Responses are checked after each model finishes streaming. Passing cards are marked as successes; invalid JSON or schema mismatches are marked as failures."
                    : "Leave the schema blank for free-form comparisons, or choose a library preset to validate structured JSON output."}
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-md)] backdrop-blur">
              <p className="font-mono text-[0.72rem] uppercase tracking-[0.22em] text-[var(--muted-ink)]">
                OpenRouter API key
              </p>
              <label className="mt-3 block">
                <span className="sr-only">OpenRouter API key</span>
                <input
                  type="password"
                  value={openRouterApiKey}
                  onChange={(event) => setOpenRouterApiKey(event.target.value)}
                  placeholder="sk-or-… (optional, falls back to server key)"
                  name="openRouterApiKey"
                  autoComplete="off"
                  className="w-full rounded-2xl border border-[var(--line)] bg-[var(--canvas-soft)] px-4 py-3 font-mono text-sm leading-7 outline-none transition placeholder:text-[var(--muted-ink)]"
                  spellCheck={false}
                />
              </label>
              <p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">
                {openRouterApiKey.trim() ? "Using your personal key." : "Using the server-configured key."}
              </p>
            </div>

            <div className="rounded-[1.75rem] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-md)] backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[0.72rem] uppercase tracking-[0.22em] text-[var(--muted-ink)]">
                    Model roster
                  </p>
                  <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em]">Providers and models</h2>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={selectAllModels}
                    disabled={isSubmitting || allCatalogModelsSelected || catalog.models.length === 0}
                     className="inline-flex min-h-11 items-center rounded-full border border-[var(--line)] bg-[var(--panel-strong)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition hover:border-[var(--line-strong)] hover:bg-[var(--canvas-strong)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Run on all models
                  </button>
                  <button
                    type="button"
                    onClick={addSelection}
                     className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-foreground)] shadow-[0_12px_32px_rgba(29,176,243,0.24)] transition active:scale-[0.98] hover:bg-[var(--accent-strong)]"
                  >
                    <Plus className="h-4 w-4" />
                    Add
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-4">
                {allCatalogModelsSelected ? (
                  <div className="rounded-[1.25rem] border border-[var(--line)] bg-[var(--canvas-soft)] px-4 py-3 text-sm leading-6 text-[var(--muted-ink)]">
                    Running against the full catalog. Individual model selectors are hidden while all models are selected.
                  </div>
                ) : (
                  selectedModels.map((selection, index) => {
                    const providerModels = modelsByProvider.get(selection.providerId) ?? [];
                    const model = modelsByKey.get(selection.modelKey);

                    return (
                      <div
                        key={selection.id}
                        className="rounded-[1.25rem] border border-[var(--line)] bg-[var(--canvas-soft)] p-3"
                      >
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="font-mono text-[0.72rem] uppercase tracking-[0.22em] text-[var(--muted-ink)]">
                            Slot {index + 1}
                          </div>
                          {selectedModels.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => removeSelection(selection.id)}
                              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-[var(--muted-ink)] transition hover:bg-[color:rgba(255,255,255,0.05)] active:scale-[0.98]"
                              aria-label={`Remove model slot ${index + 1}`}
                            >
                              <Trash2 aria-hidden="true" className="h-4 w-4" />
                            </button>
                          ) : null}
                        </div>

                        <div className="grid min-w-0 gap-3">
                          <label className="grid min-w-0 gap-2 text-sm font-medium">
                            <span>Provider</span>
                            <select
                              value={selection.providerId}
                              onChange={(event) =>
                                updateSelection(selection.id, { providerId: event.target.value })
                              }
                              name={`provider-${selection.id}`}
                               className="min-h-12 w-full min-w-0 max-w-full rounded-2xl border border-[var(--line)] bg-[var(--canvas-strong)] px-4 text-base text-[var(--ink)] outline-none transition"
                            >
                              {catalog.providers.map((provider) => (
                                <option key={provider.id} value={provider.id}>
                                  {provider.name}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="grid min-w-0 gap-2 text-sm font-medium">
                            <span>Model</span>
                            <select
                              value={selection.modelKey}
                              onChange={(event) =>
                                updateSelection(selection.id, { modelKey: event.target.value })
                              }
                              name={`model-${selection.id}`}
                               className="min-h-12 w-full min-w-0 max-w-full rounded-2xl border border-[var(--line)] bg-[var(--canvas-strong)] px-4 text-base text-[var(--ink)] outline-none transition"
                            >
                              {providerModels.map((providerModel) => (
                                <option key={providerModel.key} value={providerModel.key}>
                                  {providerModel.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <p className="mt-3 text-sm leading-6 text-[var(--muted-ink)]">{summarizeModel(model)}</p>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </aside>

          <section className="flex min-h-[70vh] flex-col rounded-[1.75rem] border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--shadow-lg)] backdrop-blur sm:p-5">
            <div className="grid gap-4 border-b border-[var(--line)] pb-5 xl:grid-cols-[minmax(0,1.25fr)_320px]">
              <div className="rounded-[1.5rem] border border-[var(--line)] bg-[linear-gradient(180deg,rgba(13,23,40,0.98),rgba(9,17,31,0.98))] p-3 shadow-[var(--shadow-md)] sm:p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {visiblePromptPills.map((selection) => {
                    const model = modelsByKey.get(selection.modelKey);

                    return (
                      <span
                        key={selection.id}
                        className="inline-flex min-h-11 items-center rounded-full border border-[var(--line)] bg-[var(--panel-frost)] px-4 py-2 text-sm text-[var(--ink)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                      >
                        <span className="font-semibold">{model?.providerName ?? selection.providerId}</span>
                        <span className="mx-2 text-[var(--muted-ink)]">/</span>
                        <span>{model?.label ?? selection.modelKey}</span>
                      </span>
                    );
                  })}
                  {hiddenPromptPillCount > 0 ? (
                    <span className="inline-flex min-h-11 items-center rounded-full border border-[var(--line)] bg-[var(--panel-frost)] px-4 py-2 text-sm text-[var(--muted-ink)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                      {hiddenPromptPillCount} more
                    </span>
                  ) : null}
                </div>

                <label className="block">
                  <span className="sr-only">Chat message</span>
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                        event.preventDefault();
                        void submitPrompt();
                      }
                    }}
                    placeholder="Ask every selected model the same thing..."
                    name="prompt"
                    autoComplete="off"
                    className="min-h-32 max-h-56 w-full resize-y overflow-y-auto rounded-[1.25rem] border border-[var(--line)] bg-[var(--canvas-soft)] px-4 py-3 text-base leading-7 outline-none transition"
                    spellCheck={false}
                  />
                </label>

                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm leading-6 text-[var(--muted-ink)]">
                    Streams via OpenRouter. Prices come from models.dev and are estimated from reported token usage.
                  </p>
                  <button
                    type="button"
                    onClick={() => void submitPrompt()}
                    disabled={!canSubmit}
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--accent-foreground)] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 hover:bg-[var(--accent-strong)]"
                  >
                    {isSubmitting ? (
                      <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
                    ) : (
                      <SendHorizontal aria-hidden="true" className="h-4 w-4" />
                    )}
                    Send to {selectedModels.length} model{selectedModels.length === 1 ? "" : "s"}
                  </button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <div className="rounded-[1.5rem] border border-[var(--line)] bg-[linear-gradient(145deg,rgba(17,31,53,0.96),rgba(9,17,31,0.92))] p-4 shadow-[var(--shadow-md)]">
                  <div className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-[var(--muted-ink)]">
                    Session overview
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-[var(--line)] bg-[var(--canvas-soft)] p-3">
                      <div className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[var(--muted-ink)]">Roster</div>
                      <div className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">{selectedModels.length}</div>
                    </div>
                    <div className="rounded-2xl border border-[var(--line)] bg-[var(--canvas-soft)] p-3">
                      <div className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[var(--muted-ink)]">Turns</div>
                      <div className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">{turns.length}</div>
                    </div>
                    <div className="rounded-2xl border border-[var(--line)] bg-[var(--canvas-soft)] p-3">
                      <div className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[var(--muted-ink)]">Schema</div>
                      <div className="mt-2 text-sm font-semibold uppercase tracking-[0.16em] text-[var(--ink)]">
                        {hasSchema ? "Active" : "Optional"}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-[var(--line)] bg-[var(--canvas-soft)] p-3">
                      <div className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[var(--muted-ink)]">Timeout</div>
                      <input
                        type="number"
                        min="0.5"
                        max="300"
                        step="0.5"
                        value={timeoutSeconds}
                        onChange={(event) => setTimeoutSeconds(event.target.value)}
                        placeholder="—"
                        className="mt-2 w-full bg-transparent text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)] outline-none placeholder:text-[var(--muted-ink)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <div className="mt-1 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-[var(--muted-ink)]">
                        {timeoutSeconds ? "seconds" : "disabled"}
                      </div>
                    </div>
                    </div>
                </div>

                <div className="rounded-[1.5rem] border border-[var(--line)] bg-[linear-gradient(180deg,rgba(13,23,40,0.98),rgba(9,17,31,0.96))] p-4 shadow-[var(--shadow-md)]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-[var(--muted-ink)]">
                        Latest run
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">
                        {latestTurn
                          ? "Keep the active run visible while the grid reshapes around each model result."
                          : "Send a prompt to populate the live response board and compare runs side by side."}
                      </p>
                    </div>
                    <div className="rounded-full border border-[var(--line)] bg-[var(--canvas-soft)] px-3 py-2 font-mono text-[0.66rem] uppercase tracking-[0.18em] text-[var(--muted-ink)]">
                      {latestTurn ? "Live" : "Idle"}
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                    <div className="rounded-2xl border border-[color:rgba(56,211,159,0.18)] bg-[color:rgba(56,211,159,0.08)] p-3 text-[var(--success)]">
                      <div className="font-mono text-[0.66rem] uppercase tracking-[0.2em]">Success</div>
                      <div className="mt-2 text-xl font-semibold tracking-[-0.04em]">{latestSuccessCount}</div>
                    </div>
                    <div className="rounded-2xl border border-[color:rgba(255,107,146,0.18)] bg-[color:rgba(255,107,146,0.08)] p-3 text-[var(--danger)]">
                      <div className="font-mono text-[0.66rem] uppercase tracking-[0.2em]">Issues</div>
                      <div className="mt-2 text-xl font-semibold tracking-[-0.04em]">{latestFailureCount}</div>
                    </div>
                    <div className="rounded-2xl border border-[color:rgba(102,184,255,0.18)] bg-[color:rgba(102,184,255,0.08)] p-3 text-[var(--info)]">
                      <div className="font-mono text-[0.66rem] uppercase tracking-[0.2em]">In flight</div>
                      <div className="mt-2 text-xl font-semibold tracking-[-0.04em]">{latestStreamingCount}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3 border-b border-[var(--line)] px-2 pb-4">
                <div>
                  <p className="font-mono text-[0.72rem] uppercase tracking-[0.22em] text-[var(--muted-ink)]">
                    Conversation
                  </p>
                  <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em]">Parallel outputs</h2>
                </div>
               <div className="flex flex-wrap items-center justify-end gap-2">
                  <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 rounded-full border border-[var(--line)] bg-[var(--panel-frost)] px-4 py-2 text-sm text-[var(--ink)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                    <input
                      type="checkbox"
                     name="showOnlySuccess"
                     checked={showOnlySuccess}
                     onChange={(event) => setShowOnlySuccess(event.target.checked)}
                     className="h-4 w-4 accent-[var(--accent-strong)]"
                   />
                   <span>Show only success</span>
                 </label>
                  <button
                      type="button"
                      onClick={() => saveAllTurns(turns, systemPrompt, schemaText)}
                      disabled={!hasTurns || isSubmitting}
                      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--panel-frost)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition hover:border-[var(--line-strong)] hover:bg-[var(--canvas-strong)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Save aria-hidden="true" className="h-4 w-4" />
                      Save session
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowSavedSessions(!showSavedSessions)}
                      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--panel-frost)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition hover:border-[var(--line-strong)] hover:bg-[var(--canvas-strong)] active:scale-[0.98]"
                    >
                      <Download aria-hidden="true" className="h-4 w-4" />
                      Load ({savedSessions.length})
                    </button>
                    <button
                      type="button"
                      onClick={exportSessions}
                      disabled={savedSessions.length === 0}
                      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--panel-frost)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition hover:border-[var(--line-strong)] hover:bg-[var(--canvas-strong)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Download aria-hidden="true" className="h-4 w-4" />
                      Export
                    </button>
                    <button
                      type="button"
                      onClick={() => importInputRef.current?.click()}
                      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--panel-frost)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition hover:border-[var(--line-strong)] hover:bg-[var(--canvas-strong)] active:scale-[0.98]"
                    >
                      <Upload aria-hidden="true" className="h-4 w-4" />
                      Import
                    </button>
                    <input
                      ref={importInputRef}
                      type="file"
                      accept=".json"
                      onChange={importSessions}
                      className="hidden"
                    />
                    <button
                      type="button"
                     onClick={() => {
                          clearTurns();
                          resetComparison();
                        }}
                     disabled={!hasTurns || isSubmitting}
                       className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--panel-frost)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition hover:border-[var(--line-strong)] hover:bg-[var(--canvas-strong)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                     <X aria-hidden="true" className="h-4 w-4" />
                     Clear
                   </button>
                   <div className="rounded-full bg-[var(--canvas)] px-4 py-2 font-mono text-[0.72rem] uppercase tracking-[0.2em] text-[var(--muted-ink)]">
                     streamed · metered · side-by-side
                   </div>
              </div>
              </div>

              {showSavedSessions ? (
              <div className="mt-4 rounded-[1.25rem] border border-[var(--line)] bg-[linear-gradient(180deg,rgba(13,23,40,0.98),rgba(9,17,31,0.96))] p-4 shadow-[var(--shadow-md)]">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-[0.72rem] uppercase tracking-[0.22em] text-[var(--muted-ink)]">
                    Saved sessions ({savedSessions.length})
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowSavedSessions(false)}
                    className="inline-flex min-h-9 items-center justify-center rounded-full border border-[var(--line)] px-3 py-1 text-sm text-[var(--muted-ink)] transition hover:bg-[var(--canvas-strong)]"
                  >
                    <X aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
                {savedSessions.length === 0 ? (
                  <p className="mt-3 text-sm text-[var(--muted-ink)]">No saved sessions yet.</p>
                ) : (
                  <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                    {savedSessions.map((session) => (
                      <div
                        key={session.id}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--canvas-soft)] p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-[var(--ink)]">{session.name}</p>
                          <p className="mt-1 font-mono text-[0.66rem] text-[var(--muted-ink)]">
                            {new Date(session.savedAt).toLocaleString()} · {session.turns.length} turn{session.turns.length === 1 ? "" : "s"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => loadSession(session)}
                            className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-[var(--accent-foreground)] transition hover:bg-[var(--accent-strong)] active:scale-[0.98]"
                          >
                            Load
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteSavedSession(session.id)}
                            className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-full text-[var(--muted-ink)] transition hover:bg-[color:rgba(255,107,146,0.12)] hover:text-[var(--danger)]"
                          >
                            <Trash2 aria-hidden="true" className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              ) : null}

              <div className="mt-4 flex-1 space-y-5 overflow-y-auto pr-1">
              {turns.length === 0 ? (
                  <div className="flex min-h-[360px] items-center justify-center rounded-[1.5rem] border border-dashed border-[var(--line)] bg-[linear-gradient(180deg,rgba(10,18,31,0.94),rgba(13,23,40,0.94))] p-8 text-center">
                  <div className="max-w-lg space-y-4">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent)]/12 text-[var(--accent-strong)]">
                      <Sparkles className="h-7 w-7" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-semibold tracking-[-0.03em]">Start your first eval round</h3>
                      <p className="mt-3 text-base leading-7 text-[var(--muted-ink)]">
                        Enter a prompt below to stream all selected models concurrently. Each result card shows time to first token, total duration, token usage, and estimated cost.
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {turns.map((turn) => {
                const turnResponses = Object.values(turn.responses);
                const passedCount = turnResponses.filter((response) => response.validation.status === "passed").length;
                const failedCount = turnResponses.filter((response) => response.validation.status === "failed").length;
                const hasEstimatedCost = turnResponses.some(
                  (response) => response.estimatedCost !== undefined && !Number.isNaN(response.estimatedCost),
                );
                const totalEstimatedCost = turnResponses.reduce(
                  (sum, response) => sum + (response.estimatedCost ?? 0),
                  0,
                );
                const hiddenCount = showOnlySuccess
                  ? turnResponses.filter((response) => !isSuccessfulResponse(response)).length
                  : 0;
                const visibleResponses = showOnlySuccess
                  ? turnResponses.filter(isSuccessfulResponse)
                  : turnResponses;

                return (
                 <article key={turn.id} className="turn-card rounded-[1.5rem] border border-[var(--line)] bg-[linear-gradient(180deg,rgba(13,23,40,0.98),rgba(9,17,31,0.96))] p-4 shadow-[var(--shadow-md)] sm:p-5">
                   <div className="rounded-[1.25rem] border border-[var(--line)] bg-[linear-gradient(135deg,rgba(17,31,53,0.94),rgba(10,18,31,0.92))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                    <div className="flex items-center justify-between gap-3">
                        <div className="font-mono text-[0.72rem] uppercase tracking-[0.22em] text-[var(--muted-ink)]">
                          User prompt
                        </div>
                        <button
                          type="button"
                          onClick={() => saveTurnToSession(turn, systemPrompt, schemaText)}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--panel-frost)] px-3 py-1.5 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-[var(--muted-ink)] transition hover:border-[var(--line-strong)] hover:bg-[var(--canvas-strong)] hover:text-[var(--ink)] active:scale-[0.98]"
                        >
                          <Save aria-hidden="true" className="h-3.5 w-3.5" />
                          Save turn
                        </button>
                        <CompareButton turnId={turn.id} responseKeys={turnResponses.map((r) => r.key)} />
                      </div>
                      <p className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-[1.02rem] leading-7 text-[var(--ink)]">
                        {turn.prompt}
                      </p>
                    <div className="mt-4 flex flex-wrap items-center gap-2 font-mono text-[0.68rem] uppercase tracking-[0.18em] text-[var(--muted-ink)]">
                       <span className="rounded-full border border-[var(--line)] bg-[var(--panel-frost)] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                        total $ {hasEstimatedCost ? formatUsd(totalEstimatedCost) : "-"}
                      </span>
                      {turn.validator ? (
                         <span className="rounded-full border border-[var(--line)] bg-[var(--panel-frost)] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                          schema {turn.validator.label}
                        </span>
                      ) : null}
                      {turn.validator ? (
                         <span className="rounded-full border border-[color:rgba(56,211,159,0.22)] bg-[color:rgba(56,211,159,0.12)] px-3 py-2 text-[var(--success)] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                          pass {passedCount}
                        </span>
                      ) : null}
                      {turn.validator ? (
                         <span className="rounded-full border border-[color:rgba(255,107,146,0.22)] bg-[color:rgba(255,107,146,0.12)] px-3 py-2 text-[var(--danger)] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                          fail {failedCount}
                        </span>
                      ) : null}
                      {hiddenCount > 0 ? (
                         <span className="rounded-full border border-[var(--line)] bg-[var(--canvas-soft)] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                          hidden {hiddenCount}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {visibleResponses.length === 0 ? (
                     <div className="mt-4 rounded-[1.25rem] border border-dashed border-[var(--line)] bg-[color:rgba(13,23,40,0.82)] p-5 text-sm leading-7 text-[var(--muted-ink)]">
                      No successful responses match this turn yet.
                    </div>
                  ) : (
                    <ResponseDataTable
                      turn={turn}
                      turnId={turn.id}
                      responses={visibleResponses}
                    />
                  )}
                </article>
                );
              })}
            </div>

          </section>
        </section>
      </div>
      {isSchemaEditorOpen ? (
        <SchemaEditorDialog
          initialSchema={editorInitialSchema}
          onClose={() => setIsSchemaEditorOpen(false)}
          onSave={(schema) => {
            useEvalStore.getState().setSelectedSystemPromptId("");
            setSchemaText(stringifyJsonSchema(schema));
            setIsSchemaEditorOpen(false);
          }}
        />
      ) : null}
      {compareDialogTurnId && compareDialogResponses.length >= 2 ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[color:rgba(0,0,0,0.72)] backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeCompareDialog();
          }}
        >
          <div className="relative mx-4 flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-[1.75rem] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-lg)]">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-6 py-4">
              <div>
                <p className="font-mono text-[0.72rem] uppercase tracking-[0.22em] text-[var(--muted-ink)]">
                  Comparison
                </p>
                <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
                  {compareDialogResponses.length} model calls side by side
                </h2>
              </div>
              <button
                type="button"
                onClick={() => closeCompareDialog()}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-[var(--muted-ink)] transition hover:bg-[color:rgba(255,255,255,0.05)]"
                aria-label="Close comparison"
              >
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>

            <div className="overflow-x-auto overflow-y-auto p-6">
              <table className="min-w-full border-collapse text-left text-sm">
                <thead className="text-[var(--muted-ink)]">
                  <tr>
                    <th className="px-4 py-3 font-mono text-[0.68rem] uppercase tracking-[0.18em]">Metric</th>
                    {compareDialogResponses.map((r) => (
                      <th key={r.key} className="px-4 py-3 font-mono text-[0.68rem] uppercase tracking-[0.18em]">
                        <div>{r.providerName}</div>
                        <div className="mt-1 font-semibold text-[var(--ink)]">{r.label}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "Status", render: (r: ModelResponse) => statusMeta(r.status).label },
                    { label: "TTFT", render: (r: ModelResponse) => formatDuration(r.ttftMs) },
                    { label: "Total", render: (r: ModelResponse) => formatDuration(r.durationMs) },
                    { label: "Cost", render: (r: ModelResponse) => formatUsd(r.estimatedCost) },
                    { label: "Prompt tokens", render: (r: ModelResponse) => formatTokenCount(r.promptTokens) },
                    { label: "Completion tokens", render: (r: ModelResponse) => formatTokenCount(r.completionTokens) },
                    { label: "Total tokens", render: (r: ModelResponse) => formatTokenCount(r.totalTokens) },
                    { label: "Finish reason", render: (r: ModelResponse) => r.finishReason ?? "-" },
                    { label: "Validation", render: (r: ModelResponse) => validationMeta(r.validation).label },
                  ].map((metric) => (
                    <tr key={metric.label} className="border-t border-[var(--line)]">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-[0.68rem] uppercase tracking-[0.18em] text-[var(--muted-ink)]">
                        {metric.label}
                      </td>
                      {compareDialogResponses.map((r) => (
                        <td key={r.key} className="whitespace-nowrap px-4 py-3 font-mono text-sm text-[var(--ink)]">
                          {metric.render(r)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-6 grid gap-4" style={{ gridTemplateColumns: `repeat(${compareDialogResponses.length}, minmax(0, 1fr))` }}>
                {compareDialogResponses.map((r) => (
                  <div key={r.key} className="flex flex-col rounded-[1.25rem] border border-[var(--line)] bg-[linear-gradient(180deg,rgba(10,18,31,0.98),rgba(13,23,40,0.98))]">
                    <div className="border-b border-[var(--line)] px-4 py-3">
                      <div className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-[var(--muted-ink)]">
                        {r.providerName}
                      </div>
                      <div className="mt-1 font-semibold text-[var(--ink)]">{r.label}</div>
                    </div>
                    <div className="max-h-[28rem] overflow-y-auto p-4">
                      {r.error ? (
                        <p className="whitespace-pre-wrap break-words text-sm leading-7 text-[var(--danger)]">
                          {r.error}
                        </p>
                      ) : r.content ? (
                        <p className="whitespace-pre-wrap break-words text-sm leading-7 text-[var(--ink)]">
                          {r.content}
                        </p>
                      ) : (
                        <p className="text-sm text-[var(--muted-ink)]">No content</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
