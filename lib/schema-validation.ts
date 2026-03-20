import { z, type ZodTypeAny } from "zod";

type BaseNode = {
  description?: string;
  optional?: boolean;
  nullable?: boolean;
  default?: unknown;
};

type StringNode = BaseNode & {
  type: "string";
  minLength?: number;
  maxLength?: number;
  format?: "email" | "datetime";
};

type NumberNode = BaseNode & {
  type: "number";
  min?: number;
  max?: number;
  int?: boolean;
};

type BooleanNode = BaseNode & {
  type: "boolean";
};

type LiteralNode = BaseNode & {
  type: "literal";
  value: string | number | boolean | null;
};

type EnumNode = BaseNode & {
  type: "enum";
  values: string[];
};

type ArrayNode = BaseNode & {
  type: "array";
  items: JsonZodSchema;
  minItems?: number;
  maxItems?: number;
};

type ObjectNode = BaseNode & {
  type: "object";
  properties: Record<string, JsonZodSchema>;
  additionalProperties?: boolean;
};

export type JsonZodSchema =
  | StringNode
  | NumberNode
  | BooleanNode
  | LiteralNode
  | EnumNode
  | ArrayNode
  | ObjectNode;

export type ValidationState =
  | { status: "unavailable"; message: string }
  | { status: "passed"; message: string }
  | { status: "failed"; message: string; issues: string[] };

function applyBase(node: BaseNode, schema: ZodTypeAny) {
  let next = schema;

  if (node.description) {
    next = next.describe(node.description);
  }

  if (node.nullable) {
    next = next.nullable();
  }

  if (node.default !== undefined) {
    next = next.default(node.default);
  } else if (node.optional) {
    next = next.optional();
  }

  return next;
}

export function zodSchemaFromJson(schema: JsonZodSchema): ZodTypeAny {
  switch (schema.type) {
    case "string": {
      let next = z.string();

      if (schema.minLength !== undefined) {
        next = next.min(schema.minLength);
      }

      if (schema.maxLength !== undefined) {
        next = next.max(schema.maxLength);
      }

      if (schema.format === "email") {
        next = next.email();
      }

      if (schema.format === "datetime") {
        next = next.datetime();
      }

      return applyBase(schema, next);
    }

    case "number": {
      let next = z.number();

      if (schema.int) {
        next = next.int();
      }

      if (schema.min !== undefined) {
        next = next.min(schema.min);
      }

      if (schema.max !== undefined) {
        next = next.max(schema.max);
      }

      return applyBase(schema, next);
    }

    case "boolean":
      return applyBase(schema, z.boolean());

    case "literal":
      return applyBase(schema, z.literal(schema.value));

    case "enum":
      return applyBase(schema, z.enum(schema.values as [string, ...string[]]));

    case "array": {
      let next = z.array(zodSchemaFromJson(schema.items));

      if (schema.minItems !== undefined) {
        next = next.min(schema.minItems);
      }

      if (schema.maxItems !== undefined) {
        next = next.max(schema.maxItems);
      }

      return applyBase(schema, next);
    }

    case "object": {
      let next = z.object(
        Object.fromEntries(
          Object.entries(schema.properties).map(([key, value]) => [key, zodSchemaFromJson(value)]),
        ),
      );

      if (schema.additionalProperties) {
        next = next.catchall(z.unknown());
      }

      return applyBase(schema, next);
    }
  }
}

export function stringifyJsonSchema(schema: JsonZodSchema) {
  return JSON.stringify(schema, null, 2);
}

export function parseJsonSchemaText(source: string) {
  const trimmed = source.trim();

  if (!trimmed) {
    return {
      ok: true as const,
      schema: null,
      validator: null,
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as JsonZodSchema;
    return {
      ok: true as const,
      schema: parsed,
      validator: zodSchemaFromJson(parsed),
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Schema JSON is invalid.",
    };
  }
}

function extractJsonCandidate(source: string) {
  const trimmed = source.trim();

  if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
    const lines = trimmed.split("\n");
    return lines.slice(1, -1).join("\n").trim();
  }

  return trimmed;
}

function formatIssuePath(path: (string | number)[]) {
  if (path.length === 0) {
    return "root";
  }

  return path
    .map((segment) => (typeof segment === "number" ? `[${segment}]` : segment))
    .join(".")
    .replace(/\.\[/g, "[");
}

export function validateJsonResponse(source: string, validator: ZodTypeAny): ValidationState {
  const candidate = extractJsonCandidate(source);

  if (!candidate) {
    return {
      status: "failed",
      message: "Empty response",
      issues: ["The model did not return any JSON content."],
    };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    return {
      status: "failed",
      message: "Invalid JSON",
      issues: [error instanceof Error ? error.message : "The response is not valid JSON."],
    };
  }

  const result = validator.safeParse(parsed);

  if (result.success) {
    return {
      status: "passed",
      message: "Matches schema",
    };
  }

  return {
    status: "failed",
    message: `${result.error.issues.length} schema issue${result.error.issues.length === 1 ? "" : "s"}`,
    issues: result.error.issues.map((issue) => {
      const path = issue.path.filter(
        (segment): segment is string | number => typeof segment === "string" || typeof segment === "number",
      );

      return `${formatIssuePath(path)}: ${issue.message}`;
    }),
  };
}
