---
name: investigate
description: Structured investigation of a bug or unexpected behavior before implementing a fix
---

# /investigate - Bug Investigation

Perform structured root cause analysis before implementing any fix.

## Usage

```
/investigate [symptom description or issue reference]
```

## Instructions

### 1. Understand the Symptom

- Restate the symptom to confirm understanding
- Identify: extension host or webview? Node.js or browser? Which feature area?
- Ask clarifying questions if ambiguous

### 1a. Relevance Assessment (for issues older than 1 year)

If the issue is older than 1 year, perform a quick relevance check before the full investigation:

1. Identify the feature area, code paths, UI elements, settings, or commands mentioned in the issue
2. Check if the referenced files still exist using `Glob` or `Grep`
3. If they exist, check `git log --since="<issue creation date>" -- <relevant files>` for significant changes
4. If files have been deleted or substantially rewritten, include a **Relevance Assessment** in the output:

```markdown
### Relevance Assessment

[One of:

- "Code path still exists — issue may still be relevant"
- "Code path no longer exists — [file(s)] deleted/removed since issue was filed"
- "Feature area significantly refactored — [summary of changes since issue creation]"
- "Unable to map issue to specific code paths — proceeding with investigation"]
```

If the code path no longer exists, note this prominently and consider whether the investigation should continue or if the issue should be recommended for closure.

### 2. Trace the Code Path

- Find the entry point (command, event handler, IPC message)
- Read every function in the call chain — do NOT assume behavior from names
- For decorated methods, understand how the decorator alters behavior (see Decorator Reference below)
- Read decorator source in `src/system/decorators/` if behavior is unclear

### 3. Form Hypotheses

- List at least 2 possible root causes
- For each, identify what evidence would confirm or refute it
- Gather evidence by reading code, checking error types, tracing data flow

### 4. Audit Impact

- Search for ALL call sites of functions you plan to modify
- Check both `src/env/node/` and `src/env/browser/` paths
- Check sub-providers: `src/env/node/git/sub-providers/` and `src/git/sub-providers/`

### 5. Assess Source Attribution

Before presenting findings, assess where the diagnosis came from:

- **Independent analysis** — Root cause was determined primarily by tracing code paths, reading implementations, and forming hypotheses from code evidence. The issue description described symptoms but did not point to the cause.
- **Confirmed reporter's diagnosis** — The issue already contained detailed code references, file paths, or a proposed root cause. The investigation verified these claims against the current code but did not independently discover the cause.

Be honest about this. Both are valuable — confirming a reporter's analysis is useful — but the reader should know what the investigation actually contributed.

### 6. Present Findings

```markdown
## Investigation: [Symptom]

### Symptom

[What goes wrong]

### Source Attribution

[One of: "Independent analysis from code tracing" | "Confirms reporter's diagnosis — the issue included [specific detail: code references / file paths / root cause hypothesis] which this investigation verified against current code" | "Mixed — [explain what came from the issue vs. independent tracing]"]

### Code Path

[Entry point] -> [Function 1] -> [Function 2 (@gate)] -> [Function 3]

### Root Cause

[Cause with file:line evidence]

### Alternative Causes Considered

1. [Alternative] — ruled out because [evidence]

### Proposed Fix

[Minimal change to address root cause]

### Impact

- Files to modify: [list]
- Call sites checked: [count]
- Platform paths verified: Node.js [yes/no], Browser [yes/no]
```

### 7. Get Confirmation

Present findings and proposed fix. Wait for user confirmation before implementing.

## Anti-Patterns

- Do NOT start implementing before completing the investigation
- Do NOT blame logging decorators for hangs — check `@gate()` first
- Do NOT propose disabling/removing a feature when asked to fix it
- Do NOT suppress errors — fix the root cause or propagate properly

## Decorator Reference

Source files: `src/system/decorators/`

### `@info()` / `@debug()` / `@trace()` — Logging (`log.ts`)

Same decorator at different log levels. Wraps methods to log entry/exit with timing and scope tracking.

**Options (`LogOptions`):**

- `args` — `false` to suppress, or function for custom formatting
- `exit` — `true` to log return value, or function for custom exit string
- `onlyExit` — Suppress entry log; `{ after: N }` only logs if duration > N ms
- `timing` — `false` to disable; `{ warnAfter: N }` overrides slow threshold (default 500ms)
- `when` — Conditional: skip logging entirely if returns false

**Key behavior:**

- Wraps Promise results via `.then()` — does NOT await them
- Slow calls (> 500ms default) log at WARN level
- Creates `ScopedLogger` for async context tracking

**`getScopedLogger()` constraints:**

- Must be called BEFORE any `await` in method body (browser uses counter-based fallback unreliable after `await`)
- Must be inside a method decorated with `@info()`/`@debug()`/`@trace()`
- ESLint rule `@gitlens/scoped-logger-usage` enforces both
- Node.js uses `AsyncLocalStorage` for reliable cross-async scope

### `@gate()` — Concurrent Call Deduplication (`gate.ts`)

Returns the SAME promise to concurrent callers. Only one invocation runs at a time per instance (or per grouping key).

**Options (`GateOptions`):**

- `timeout` — Default: 300000ms (5 minutes)
- `rejectOnTimeout` — Default: `true`. When `false`, retries instead of rejecting

**Key behavior:**

- Stores pending promise on instance via `$gate$methodName` property
- Clears gate via `.finally()` when promise settles
- Deadlock detection: warns at 90s and 180s, sends telemetry (`op/gate/deadlock`)
- On timeout: rejects with `CancellationError` (or retries if `rejectOnTimeout: false`)
- Optional `getGroupingKey` creates independent gates per key
- Synchronous returns pass through unaffected

**Common hang pattern:** If a gated method hangs, check what the promise is waiting for. Is there a circular dependency? Is a nested gated call waiting on the outer gate?

### `@memoize()` — Result Caching (`memoize.ts`)

Caches return value permanently on instance via `Object.defineProperty` (non-writable, non-configurable).

**Options (`MemoizeOptions`):**

- `resolver` — Custom cache key generator from arguments
- `version` — `'providers'` for version-keyed invalidation

**Key behavior:**

- Cache stored as instance property: `$memoize$methodName`
- Version-keyed: cache key prefixed with version counter; `invalidateMemoized('providers')` bumps counter causing cache miss
- **No TTL** — cached for lifetime of instance
- **Caches Promises** — a rejected Promise stays cached permanently
- Checks `Object.hasOwn(this, prop)` before computing

### `@sequentialize()` — Sequential Execution Queue (`sequentialize.ts`)

Queues async calls to execute one at a time (unlike `@gate()` which deduplicates).

**Options (`SequentializeOptions`):**

- `getDedupingKey` — Consecutive calls with same key share result while waiting
- `getQueueKey` — Creates independent parallel queues per key

**Key behavior:**

- Chains calls via `.then()` — each waits for previous to complete
- Without `getQueueKey`, all calls share single queue
- With `getQueueKey`, different keys execute in parallel

### Decorator Stacking

Execution order is bottom-up (outermost runs first):

```typescript
@debug()     // Runs 1st: creates scope, logs entry/exit
@gate()      // Runs 2nd: deduplicates concurrent calls
async method() { ... }
```

**Debugging priority:**

1. `@gate()` — hangs, timeouts, deadlocks
2. `@memoize()` — stale data, cached rejections
3. Logging decorators — rarely the cause
