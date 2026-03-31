---
name: eval-mcp
description: "Evaluates LLM prompts via the eval MCP tools (eval_prompt, eval_suite, eval_consistency, eval_batch, eval_rank, validate_output). Use when asked to eval, test, benchmark, or validate a prompt, check model behavior, run consistency checks, or compare models."
---

# Eval MCP

Fast LLM prompt evaluation using the eval MCP tools. Test prompts against models, run regression suites, check consistency, and compare models — all without deploying.

## Tool Selection

| Goal | Tool | When |
|------|------|------|
| Test one prompt against 1–50 models | `eval_prompt` | Quick spot-check |
| Run a matrix of test cases × models | `eval_suite` | Regression suite |
| Check if a model is flaky on one prompt | `eval_consistency` | After finding a failure |
| Test one prompt against ALL models | `eval_batch` | Model comparison / selection |
| Rank models from batch/suite results | `eval_rank` | Choosing best model |
| Validate a raw response string | `validate_output` | Debugging a specific output |
| Improve a failing prompt | `suggest_system_prompt` | After eval failures |
| List available models | `list_models` | Discovery |

## Two Eval Modes

### Text/JSON Mode (default)

The model receives a system prompt + user prompt and returns text. Assertions parse the response as JSON.

**Use for:** Any step that produces structured JSON output (classification, extraction, scoring, analysis).

### Tool-Calling Mode (with `tools` + `toolMocks` + `maxTurns`)

The model receives tool definitions via OpenRouter's native function-calling API. It makes real tool calls, receives mock results, and can do multi-turn reasoning.

**Use for:** Agents that delegate via tool calls (orchestrators, routers, planners).

**Critical:** Never use text/JSON mode to evaluate tool-calling agents. A model that outputs perfect JSON text may completely fail at structured tool calling, and vice versa.

## Workflow

### 1. Gather Context

Before writing test cases, read the source:

- **System prompt** — the full prompt text the model receives in production
- **Production model** — the exact model ID used in production (e.g., `anthropic/claude-haiku-4.5`)
- **Output schema** — the expected output shape (Zod schema, JSON Schema, or type definition)
- **Input format** — how the user prompt is assembled in production (template, prior step outputs, context injection)

### 2. Build the User Prompt

The user prompt MUST match how production code assembles it. If the production code injects context sections, prior step outputs, or metadata, replicate that format exactly:

```
## Prior Context

### Source "step_name" Output
\`\`\`json
{"key": "value"}
\`\`\`

## Input
Subject: Example
From: Alice <alice@example.com>

Body text here.
```

**Critical:** Mismatched formatting causes the model to behave differently than in production. Read the production code that builds the prompt and replicate its structure.

### 3. Write Assertions

#### JSON Path Assertions

```json
{"path": "classification", "equals": "spam"}
{"path": "score", "type": "number"}
{"path": "details.plan", "isNotNull": true}
{"path": "details.plan", "isNull": true}
{"path": "summary", "matches": "\\burgent\\b"}
```

Assertion types:
- `equals` — exact value match
- `type` — type check (`"string"`, `"number"`, `"boolean"`, `"object"`, `"array"`)
- `isNull` / `isNotNull` — null checks
- `matches` — regex pattern match

#### Tool-Calling Assertions

When using `tools` + `toolMocks`, assertions target the `allToolCalls` array:

```json
{"path": "allToolCalls[0].name", "equals": "search"}
{"path": "allToolCalls[0].input.query", "matches": "user request"}
{"path": "allToolCalls[1].name", "equals": "display_results"}
```

**Important:** Tool call arguments are under `.input`, not `.arguments`.

### 4. Run the Eval

#### Text/JSON Mode

```
eval_suite with:
  models: ["<production-model-id>"]
  systemPrompt: <full system prompt — never truncate>
  testCases: [<test cases with assertions>]
  timeoutMs: 60000
```

#### Tool-Calling Mode

```
eval_suite with:
  models: ["<production-model-id>"]
  systemPrompt: <system prompt>
  tools: [<tool definitions matching production>]
  toolMocks: {"tool_name": <canned response>}
  maxTurns: 3
  testCases: [<test cases with tool-call assertions>]
  timeoutMs: 30000
```

### 5. Interpret Results

- **All pass** → prompt is good, ship it
- **Assertion failures** → fix the prompt, NEVER loosen assertions
- **"Response is not valid JSON"** → model emitted malformed JSON; if production uses structured output (Zod/JSON Schema mode), this may not reproduce in production — flag but don't block
- **Flaky failures** → run `eval_consistency` with 10+ runs, then strengthen the prompt

### 6. Confirm with Consistency Check

After fixing a flaky prompt, ALWAYS run `eval_consistency` with 10 runs on the previously-failing case. A single pass is insufficient — 10/10 confirms the fix is reliable.

```
eval_consistency with:
  modelKey: "<production-model-id>"
  prompt: <the failing user prompt>
  systemPrompt: <full system prompt>
  runs: 10
  assertions: [<the assertions that were flaky>]
  timeoutMs: 60000
```

Only ship when pass rate is 100% (or ≥90% for inherently ambiguous cases with documented justification).

## Prompt Fix Patterns

Battle-tested fixes for common model misbehaviors:

### Model Nests Fields at Wrong Level

The model places a field at the JSON root instead of inside a parent object. Add explicit structural warnings at both the field definition and the output schema:

```
# fieldName (INSIDE parentObject, not at root level)
⚠️ fieldName is a field INSIDE the "parentObject" object. Do NOT place it as a top-level key.
```

And reinforce in the Output section:

```
Respond with a JSON object containing exactly these N top-level keys (and NO other top-level keys):
```

### Model Over-Applies a Rule

A rule intended for one field bleeds into other decisions. Add explicit scope notes:

```
The "X excludes Y" rule applies ONLY to fieldA; it does NOT suppress fieldB.
```

Example: `topIntent="fyi" does NOT suppress shouldDraftReply — if a human asks a question, draft a reply regardless of intent label.`

### Model Can't Distinguish Similar Categories

Collapse categories the model confuses into a single value:

```
type is one of: "otp" | "magic-link" (use "magic-link" for both password resets and sign-in links)
```

### Model Wavers Between Two Values

1. **Negative disambiguation**: `→"money" (NOT "support", NOT "notification")`
2. **Narrow competing scope**: `Use "notification" ONLY for authentication flows`
3. **Concrete examples**: `"Coffee Monday?" → shouldDraftReply=true`
4. **Confirm**: `eval_consistency` with 10 runs, target ≥90% pass rate

### Model Narrates After Tool Calls

1. Explicit instruction: "After calling display tools, your response MUST be empty."
2. Negative examples: "No 'Done', no 'Here you go', no summary."
3. Rationale: "The UI already shows the result."

### Model Wraps JSON in Markdown Fences

Add to the output section: `Respond with ONLY a raw JSON object (no markdown fences, no \`\`\`json blocks).`

Note: The eval MCP's JSON parser strips markdown fences automatically, so this affects assertion path resolution but not parsing.

## Model Selection Workflow

When choosing which model to use for a prompt:

1. **`eval_batch`** — quick first pass across all models (text mode). Filters out models that can't follow instructions at all.
2. **Narrow to top candidates, run `eval_suite`** — for tool-calling agents, use `tools` + `toolMocks` + `maxTurns`.
3. **`eval_consistency`** on finalists — 10 runs each to catch flaky models.
4. **`eval_rank`** — pass results from step 1 or 2 to get a ranked leaderboard by composite score.
5. **Validate in production** — evals with mock tool results can't catch all edge cases.

Key learnings:
- Models that excel at text JSON output may fail at structured tool calling
- Narration discipline varies wildly between models
- Cheaper/faster models often match or beat expensive ones on routing accuracy
- Parallel tool calling is a differentiator for multi-step agents

## Cost Awareness

| Operation | Approximate Cost |
|-----------|-----------------|
| Single `eval_prompt` / `eval_suite` | ~$0.005–0.01 |
| `eval_consistency` (10 runs) | ~$0.05 |
| `eval_batch` (all models) | ~$0.50 |

Be targeted — don't run `eval_batch` when you only need to test one model.

## Key Rules

1. **Use the production model** — evals must validate the actual model's behavior, not a substitute
2. **Never loosen assertions** — if a test fails, fix the prompt so the model produces correct output
3. **Full system prompts** — always pass the complete prompt; truncated prompts cause schema drift
4. **Match production format** — user prompts must mirror how production code assembles them
5. **Always confirm with consistency** — after fixing a flaky case, run 10x before shipping
6. **Tool-calling for agents** — always use `tools` + `toolMocks` + `maxTurns` when evaluating tool-calling agents
