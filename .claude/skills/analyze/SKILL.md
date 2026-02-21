---
name: analyze
description: Deep design and implementation analysis with devil's advocate evaluation
---

# /analyze - Deep Analysis

Perform thorough design and implementation analysis. Trace all code paths, play devil's advocate, and evaluate from multiple angles before recommending an approach.

## Usage

```
/analyze [description of change, design decision, or feature]
```

## When to Use

- Before implementing a complex feature or refactor
- When evaluating competing design approaches
- When a proposed change touches many files or core abstractions
- When performance, concurrency, or cross-platform implications are unclear

## Instructions

### 1. Scope the Analysis

- Restate the goal and constraints
- Identify all code areas that will be affected
- Map the dependency graph: what depends on what's changing?

### 2. Trace All Code Paths

For each affected function/method:

- Trace every caller (use grep for all import/call sites)
- Trace every callee (read the full implementation)
- Check both Node.js (`src/env/node/`) and Browser (`src/env/browser/`) paths
- Check sub-providers: `src/env/node/git/sub-providers/`, `src/git/sub-providers/`, `src/plus/integrations/providers/github/sub-providers/`
- Note decorator behavior (`@gate()`, `@memoize()`, `@sequentialize()`) that alters execution

### 3. Evaluate Edge Cases

For each proposed change, systematically consider:

- **Concurrency**: What happens with concurrent calls? Check `@gate()` interactions
- **Caching**: Will `@memoize()` or `GitCache` serve stale data after this change?
- **Error paths**: What happens when the operation fails? Check all catch sites
- **Empty/null states**: What if the input is empty, undefined, or in an unexpected state?
- **Platform differences**: Does this work in both Node.js and browser environments?
- **Disposal**: Are event listeners and subscriptions properly cleaned up?

### 4. Play Devil's Advocate

For each design decision, argue the opposing case:

- What's the simplest alternative that could work?
- What assumptions does this approach make? Are they guaranteed?
- What breaks if those assumptions are wrong?
- Is this solving the right problem, or a symptom?
- Could this be solved by configuration/data rather than code?
- What's the maintenance cost of this approach in 6 months?

### 5. Assess Risk

Rate each concern:

- **High risk** — Likely to cause bugs, data loss, or performance regression
- **Medium risk** — Could cause issues under specific conditions
- **Low risk** — Unlikely but worth noting

### 6. Present Analysis

```markdown
## Analysis: [Description]

### Goal

[What we're trying to achieve and why]

### Approach Evaluated

[Description of the proposed approach]

### Code Path Trace

[Entry point] -> [Function chain with decorators noted]

- Callers: [count] call sites in [files]
- Platform: Node.js [yes/no], Browser [yes/no]

### Edge Cases & Risks

| Concern     | Risk   | Details                        |
| ----------- | ------ | ------------------------------ |
| [Concern 1] | High   | [Specific scenario and impact] |
| [Concern 2] | Medium | [Specific scenario and impact] |

### Devil's Advocate

1. **Alternative approach**: [Simpler/different way] — [why it might be better or worse]
2. **Assumption risk**: [What we're assuming] — [what happens if wrong]

### Recommendation

[Recommended approach with specific reasoning]
[What to watch out for during implementation]
[Suggested verification steps]
```

## Anti-Patterns

- Do NOT rubber-stamp — always find at least one genuine concern or alternative
- Do NOT be contrarian for its own sake — ground concerns in specific code paths
- Do NOT skip the trace step — assumptions about "what calls what" are frequently wrong
- Do NOT ignore decorator behavior — `@gate()`, `@memoize()`, and `@sequentialize()` fundamentally change execution semantics
