"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Plus, Trash2, X } from "lucide-react";

import type { JsonZodSchema } from "@/lib/schema-validation";
import { cn } from "@/lib/utils";

type SchemaEditorDialogProps = {
  initialSchema: JsonZodSchema;
  onClose: () => void;
  onSave: (schema: JsonZodSchema) => void;
};

type SchemaNodeType = JsonZodSchema["type"];

const NODE_TYPE_OPTIONS: Array<{ value: SchemaNodeType; label: string }> = [
  { value: "object", label: "Object" },
  { value: "array", label: "Array" },
  { value: "string", label: "String" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
  { value: "enum", label: "Enum" },
  { value: "literal", label: "Literal" },
];

function createDefaultSchema(type: SchemaNodeType = "object"): JsonZodSchema {
  switch (type) {
    case "object":
      return { type: "object", properties: {}, additionalProperties: false };
    case "array":
      return { type: "array", items: createDefaultSchema("string") };
    case "string":
      return { type: "string" };
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "enum":
      return { type: "enum", values: ["value"] };
    case "literal":
      return { type: "literal", value: "value" };
  }
}

function cloneSchema(schema: JsonZodSchema) {
  return JSON.parse(JSON.stringify(schema)) as JsonZodSchema;
}

function toNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const next = Number(trimmed);
  return Number.isFinite(next) ? next : undefined;
}

function parseLiteral(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  try {
    return JSON.parse(trimmed) as string | number | boolean | null;
  } catch {
    return trimmed;
  }
}

function FieldShell({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("grid gap-2 text-sm font-medium", className)}>
      <span>{title}</span>
      {children}
    </label>
  );
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex min-h-11 items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--panel-frost)] px-4 py-2 text-sm text-[var(--ink)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function SchemaNodeEditor({
  label,
  node,
  onChange,
  canRemove,
  onRemove,
  depth = 0,
}: {
  label: string;
  node: JsonZodSchema;
  onChange: (next: JsonZodSchema) => void;
  canRemove?: boolean;
  onRemove?: () => void;
  depth?: number;
}) {
  const propertyEntries = node.type === "object" ? Object.entries(node.properties) : [];

  return (
    <div className="rounded-[1.25rem] border border-[var(--line)] bg-[linear-gradient(180deg,rgba(17,31,53,0.94),rgba(10,18,31,0.92))] p-4 shadow-[var(--shadow-md)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-[var(--muted-ink)]">
            {depth === 0 ? "Root schema" : "Nested node"}
          </div>
          <h3 className="mt-2 text-base font-semibold tracking-[-0.02em] text-[var(--ink)]">{label}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FieldShell title="Type" className="min-w-[11rem]">
            <select
              value={node.type}
              onChange={(event) => onChange(createDefaultSchema(event.target.value as SchemaNodeType))}
              className="min-h-11 rounded-2xl border border-[var(--line)] bg-[var(--canvas)] px-4 text-sm outline-none transition"
            >
              {NODE_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FieldShell>
          {canRemove && onRemove ? (
            <button
              type="button"
              onClick={onRemove}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-[var(--muted-ink)] transition hover:bg-[color:rgba(255,255,255,0.05)] active:scale-[0.98]"
              aria-label={`Remove ${label}`}
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <FieldShell title="Description" className="md:col-span-2">
          <input
            value={node.description ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              onChange({
                ...node,
                description: value || undefined,
              });
            }}
            className="min-h-11 rounded-2xl border border-[var(--line)] bg-[var(--canvas)] px-4 text-sm outline-none transition"
            placeholder="Optional schema hint"
          />
        </FieldShell>

        <div className="flex flex-wrap gap-2 md:col-span-2">
          <Toggle
            checked={Boolean(node.optional)}
            label="Optional"
            onChange={(checked) => onChange({ ...node, optional: checked || undefined })}
          />
          <Toggle
            checked={Boolean(node.nullable)}
            label="Nullable"
            onChange={(checked) => onChange({ ...node, nullable: checked || undefined })}
          />
        </div>

        {node.type === "string" ? (
          <>
            <FieldShell title="Min length">
              <input
                type="number"
                value={node.minLength ?? ""}
                onChange={(event) => onChange({ ...node, minLength: toNumber(event.target.value) })}
                className="min-h-11 rounded-2xl border border-[var(--line)] bg-[var(--canvas)] px-4 text-sm outline-none transition"
              />
            </FieldShell>
            <FieldShell title="Max length">
              <input
                type="number"
                value={node.maxLength ?? ""}
                onChange={(event) => onChange({ ...node, maxLength: toNumber(event.target.value) })}
                className="min-h-11 rounded-2xl border border-[var(--line)] bg-[var(--canvas)] px-4 text-sm outline-none transition"
              />
            </FieldShell>
            <FieldShell title="Format" className="md:col-span-2">
              <select
                value={node.format ?? ""}
                onChange={(event) =>
                  onChange({
                    ...node,
                    format: (event.target.value || undefined) as "email" | "datetime" | undefined,
                  })
                }
                className="min-h-11 rounded-2xl border border-[var(--line)] bg-[var(--canvas)] px-4 text-sm outline-none transition"
              >
                <option value="">Plain string</option>
                <option value="email">Email</option>
                <option value="datetime">Datetime</option>
              </select>
            </FieldShell>
          </>
        ) : null}

        {node.type === "number" ? (
          <>
            <FieldShell title="Minimum">
              <input
                type="number"
                value={node.min ?? ""}
                onChange={(event) => onChange({ ...node, min: toNumber(event.target.value) })}
                className="min-h-11 rounded-2xl border border-[var(--line)] bg-[var(--canvas)] px-4 text-sm outline-none transition"
              />
            </FieldShell>
            <FieldShell title="Maximum">
              <input
                type="number"
                value={node.max ?? ""}
                onChange={(event) => onChange({ ...node, max: toNumber(event.target.value) })}
                className="min-h-11 rounded-2xl border border-[var(--line)] bg-[var(--canvas)] px-4 text-sm outline-none transition"
              />
            </FieldShell>
            <div className="md:col-span-2">
              <Toggle checked={Boolean(node.int)} label="Integer only" onChange={(checked) => onChange({ ...node, int: checked || undefined })} />
            </div>
          </>
        ) : null}

        {node.type === "enum" ? (
          <FieldShell title="Values" className="md:col-span-2">
            <input
              value={node.values.join(", ")}
              onChange={(event) =>
                onChange({
                  ...node,
                  values: event.target.value
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
                })
              }
              className="min-h-11 rounded-2xl border border-[var(--line)] bg-[var(--canvas)] px-4 text-sm outline-none transition"
              placeholder="draft, active, archived"
            />
          </FieldShell>
        ) : null}

        {node.type === "literal" ? (
          <FieldShell title="Literal value" className="md:col-span-2">
            <input
              value={JSON.stringify(node.value)}
              onChange={(event) => onChange({ ...node, value: parseLiteral(event.target.value) })}
              className="min-h-11 rounded-2xl border border-[var(--line)] bg-[var(--canvas)] px-4 font-mono text-sm outline-none transition"
              placeholder='"approved" or 1 or true'
            />
          </FieldShell>
        ) : null}

        {node.type === "array" ? (
          <>
            <FieldShell title="Min items">
              <input
                type="number"
                value={node.minItems ?? ""}
                onChange={(event) => onChange({ ...node, minItems: toNumber(event.target.value) })}
                className="min-h-11 rounded-2xl border border-[var(--line)] bg-[var(--canvas)] px-4 text-sm outline-none transition"
              />
            </FieldShell>
            <FieldShell title="Max items">
              <input
                type="number"
                value={node.maxItems ?? ""}
                onChange={(event) => onChange({ ...node, maxItems: toNumber(event.target.value) })}
                className="min-h-11 rounded-2xl border border-[var(--line)] bg-[var(--canvas)] px-4 text-sm outline-none transition"
              />
            </FieldShell>
            <div className="md:col-span-2">
              <SchemaNodeEditor
                label={`${label} item`}
                node={node.items}
                depth={depth + 1}
                onChange={(items) => onChange({ ...node, items })}
              />
            </div>
          </>
        ) : null}

        {node.type === "object" ? (
          <>
            <div className="md:col-span-2 flex flex-wrap gap-2">
              <Toggle
                checked={Boolean(node.additionalProperties)}
                label="Allow extra keys"
                onChange={(checked) => onChange({ ...node, additionalProperties: checked || undefined })}
              />
              <button
                type="button"
                onClick={() => {
                  const nextKey = `field_${propertyEntries.length + 1}`;
                  onChange({
                    ...node,
                    properties: {
                      ...node.properties,
                      [nextKey]: createDefaultSchema("string"),
                    },
                  });
                }}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--canvas-soft)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition hover:border-[var(--line-strong)] hover:bg-[var(--canvas-strong)] active:scale-[0.98]"
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                Add property
              </button>
            </div>

            <div className="md:col-span-2 space-y-3">
              {propertyEntries.length === 0 ? (
                <div className="rounded-[1rem] border border-dashed border-[var(--line)] bg-[var(--canvas)] px-4 py-5 text-sm text-[var(--muted-ink)]">
                  Add properties to define the object shape.
                </div>
              ) : null}

              {propertyEntries.map(([key, value], index) => (
                <div key={`${key}-${index}`} className="space-y-3 rounded-[1.1rem] bg-[var(--canvas)] p-3">
                  <FieldShell title="Property name">
                    <input
                      value={key}
                      onChange={(event) => {
                        const nextKey = event.target.value;
                        if (!nextKey || nextKey === key) {
                          return;
                        }

                        const nextProperties = Object.fromEntries(
                          Object.entries(node.properties).map(([propertyKey, propertyValue]) => [
                            propertyKey === key ? nextKey : propertyKey,
                            propertyValue,
                          ]),
                        );

                        onChange({
                          ...node,
                          properties: nextProperties,
                        });
                      }}
                      className="min-h-11 rounded-2xl border border-[var(--line)] bg-[var(--panel-frost)] px-4 text-sm outline-none transition"
                    />
                  </FieldShell>

                  <SchemaNodeEditor
                    label={key}
                    node={value}
                    depth={depth + 1}
                    canRemove
                    onRemove={() => {
                      const nextProperties = { ...node.properties };
                      delete nextProperties[key];
                      onChange({ ...node, properties: nextProperties });
                    }}
                    onChange={(nextValue) => {
                      onChange({
                        ...node,
                        properties: {
                          ...node.properties,
                          [key]: nextValue,
                        },
                      });
                    }}
                  />
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function SchemaEditorDialog({ initialSchema, onClose, onSave }: SchemaEditorDialogProps) {
  const [draft, setDraft] = useState<JsonZodSchema>(() => cloneSchema(initialSchema));

  const preview = useMemo(() => JSON.stringify(draft, null, 2), [draft]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(4,10,18,0.72)] p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-lg)]">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-5 sm:px-6">
          <div>
            <div className="font-mono text-[0.72rem] uppercase tracking-[0.22em] text-[var(--muted-ink)]">
              Interactive schema editor
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[var(--ink)]">
              Build a response schema visually
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted-ink)]">
              Create object, array, string, enum, and literal fields without hand-writing JSON. Saving replaces the schema JSON in the eval panel.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--panel-frost)] text-[var(--muted-ink)] transition hover:border-[var(--line-strong)] hover:bg-[var(--canvas-strong)] active:scale-[0.98]"
            aria-label="Close schema editor"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <div className="grid flex-1 gap-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="overflow-y-auto p-5 sm:p-6">
            <SchemaNodeEditor label="Response" node={draft} onChange={setDraft} />
          </div>

          <aside className="border-t border-[var(--line)] bg-[linear-gradient(180deg,rgba(9,17,31,0.98),rgba(13,23,40,0.98))] p-5 lg:border-l lg:border-t-0 lg:p-6">
            <div className="font-mono text-[0.72rem] uppercase tracking-[0.22em] text-[var(--muted-ink)]">
              JSON preview
            </div>
            <pre className="mt-4 max-h-[60vh] overflow-auto rounded-[1.25rem] border border-[var(--line)] bg-[var(--canvas-soft)] p-4 font-mono text-xs leading-6 text-[var(--ink)]">
              {preview}
            </pre>
          </aside>
        </div>

        <div className="flex flex-col gap-3 border-t border-[var(--line)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-sm leading-6 text-[var(--muted-ink)]">
            Use the editor for structure, then fine-tune the raw JSON if you want more advanced constraints.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--panel-frost)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition hover:border-[var(--line-strong)] hover:bg-[var(--canvas-strong)] active:scale-[0.98]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSave(draft)}
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-[var(--accent-foreground)] transition hover:bg-[var(--accent-strong)] active:scale-[0.98]"
            >
              Use schema
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
