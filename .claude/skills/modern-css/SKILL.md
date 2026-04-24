---
name: modern-css
description: Use when touching any CSS — new files, edits, audits, refactors, `<style>` blocks, CSS-in-JS, Tailwind config, design-token files, or reviewing CSS a teammate wrote. Applies to vanilla CSS, shadow DOM internals, web-component consumers, VS Code webviews, and framework-scoped styles. Skip signals — file imports `openai`/other non-CSS SDK, `.py`/`.go`/`.rs` files without embedded styles. Skipping when applicable ships miscalibrated output — wrong browser target, hardcoded values where tokens exist, cascade fights fixed with `!important`, shadow-DOM piercing selectors, viewport queries for component-internal layout, `transform: translateZ(0)` for layer promotion — that passes local checks but breaks in production browsers, themes, or shadow roots.
---

# Modern CSS

> **STOP.** Before any CSS edit, audit, or review, output the detection one-liner to the user:
>
> ```
> Target: {browser target}. Tokens: {explicit/implicit/none, with prefix if any}. Boundary: {shadow internals / light DOM / web-component consumer}.
> ```
>
> **This is non-negotiable.** It gives the user an interrupt point — they can correct miscalibration before the first edit corrupts output. Skipping the one-liner is the most common way this skill fails. Violating the letter of this rule violates the spirit of this skill; there are no exceptions for "simple edits," "quick fixes," or "I already know this project."
>
> **How to fill it in:** run the detection spine below (Step 1 browser target → Step 2 tokens → Step 3 boundary).
> **What to do next:** before the first CSS edit, (a) create one TodoWrite task per applicable reference (see routing table) and (b) `Read` each file to mark its task complete. Reading means the Read tool, not memory. A reference with no Todo is a reference that will not get read — this is how prior sessions of this skill have failed.

Write CSS that matches the project's real context — not generic 2018 CSS, not bleeding-edge features the target doesn't support, not raw values when the project has tokens.

## How to use this skill

1. Run the detection spine (below) once per styling context.
2. Report what was detected — the one-liner is mandatory.
3. For each situation in the routing table that applies, create a TodoWrite task "Read modern-css references/{leaf}.md — {one-line why}" and complete it by Read-ing the file. Do this before the first CSS edit. See "Enforcing reference loading" below.
4. Follow the load-bearing rules at all times.

## Detection spine

Run once per styling context (new file, new component, or context shift). Cache mentally for the session.

### Step 1 — Browser target

Check signals in order. First match wins.

1. **`package.json` has `engines.vscode`** → VS Code extension path:
   - **Has web entry point** (`browser` field in `package.json`) → target is **Baseline "widely available"** (web surface = many browsers/versions).
   - **Desktop-only** → map the VS Code engine version to its Electron version, then to its Chromium version. Use that Chromium as the target.
2. **`.browserslistrc`, `browserslist`, or `package.json.browserslist`** → use the query literally.
3. **Explicit note in README / CLAUDE.md** about browser support → honor it.
4. **None of the above** → default to **Baseline "widely available"**.

**Output:** a concrete target string, e.g. "Chromium 122+", "Baseline widely available", "last 2 Chrome + last 2 Firefox".

### Step 2 — Token system

Detect explicit first. If nothing, infer implicit. Never propose formal tokenization unsolicited.

**Explicit signals:**

- `--vscode-*` tokens referenced anywhere → VS Code webview context. `--vscode-*` IS the semantic layer. Use it directly; don't wrap it.
- CSS files with `--*:` declarations → enumerate via grep.
- Token files: `tokens.css`, `theme.css`, `variables.css`, or a `design-tokens/` directory.
- Tailwind config (`tailwind.config.{js,ts,cjs,mjs}`) → extract theme tokens.
- CSS-in-JS theme exports.

**Convention inspection (when explicit tokens exist):**

- Casing (kebab / camel / other)
- Prefix pattern (e.g., `--gl-*`)
- Tier structure (primitives only / primitive + semantic / three-tier)

**Implicit pattern fallback (no explicit tokens):**

- Grep existing CSS for actual values used: spacing (padding, margin, gap), sizing, typography (font-size, line-height), border-radius.
- Extract values that appear 3+ times → identify implicit scales (e.g., "4/8/12/16/24/32px — 8-point spacing").
- Match these when writing new CSS.

**Output shape:**

- _Explicit:_ "Project tokens: `--gl-*` prefix, kebab-case, two-tier. Use `--gl-space-md`, not `16px`."
- _Implicit:_ "No explicit tokens. Implicit spacing: 4/8/12/16/24/32 (8-point). Match these."
- _Neither:_ "No consistent patterns. Use reasonable round values."
- _VS Code:_ always flag `--vscode-*` availability.

### Step 3 — Styling boundary

**Signals:**

- `customElements.define` / `extends HTMLElement` in target file → shadow root context likely.
- Lit / Stencil / FAST imports in the file.
- Deps on `@spectrum-web-components`, `shoelace`, etc.
- `<style>` tag inside a lit template → **shadow root internals**.
- Plain `.css` file or global stylesheet → **light DOM**.
- Styling an existing custom element from outside → **web component consumer**.

**Output — one label:**

- **Shadow root internals** → use `:host`, styles are scoped automatically, expose `::part` thoughtfully.
- **Web component consumer** → custom properties + `::part` + `::slotted` only; don't reach inside.
- **Light DOM** → standard cascade.

### Report what was detected

Before writing CSS, output a one-liner:

> Target: {target}. Tokens: {tokens}. Boundary: {boundary}.

This is non-negotiable. It surfaces miscalibration before it corrupts output. The user can interrupt and correct.

### Ambiguity handling

| Dimension | Ambiguous →                                                           |
| --------- | --------------------------------------------------------------------- |
| Target    | Default to Baseline "widely available"                                |
| Tokens    | If none detected, flag "no token system detected"; use literal values |
| Boundary  | Default to light DOM; ask if writing component code                   |

## Load-bearing rules (always apply)

- Never reach for `!important` or specificity escalation to fix a cascade problem. Use `@layer` or `:where()` instead. (→ `references/cascade.md`)
- Never invent CSS syntax. If unsure a property or value exists as specified, flag uncertainty rather than guessing. Verify via MDN or caniuse when tool access allows.
- Never use features above the detected browser target. If a modern feature is needed but unsupported, say so instead of silently downgrading.
- Never hardcode values when explicit or implicit tokens exist. Match the token system that's already there; don't impose a new one.
- Never use viewport media queries for component-internal layout. Use container queries instead. Pages still use media queries; preference/capability media queries (`prefers-reduced-motion`, `hover`, etc.) are always media queries regardless. (→ `references/responsive.md`)
- Never reach into shadow DOM from outside. Use `::part`, `::slotted`, or custom properties. (→ `references/selectors.md`)
- Never use `transform: translateZ(0)` or permanent `will-change` for layer promotion. Use `isolation: isolate` or `contain` instead. (→ `references/performance.md`)
- Name custom properties by role, not appearance. `--color-accent`, not `--blue`. In component code, prefer semantic tokens over primitives. (→ `references/theming.md`)

## When to load which reference

Read the relevant reference file before writing CSS in these cases:

| Situation                                                                                                                                     | Read                        |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| About to write grid, flex, sizing, or positioning code                                                                                        | `references/layout.md`      |
| Adapting to viewport, container size, or user preferences (reduced motion, color scheme, contrast)                                            | `references/responsive.md`  |
| Hitting a z-index puzzle, optimizing rendering, handling offscreen content, or stacking-context issues                                        | `references/performance.md` |
| Fighting specificity, tempted by `!important`, organizing cascade order                                                                       | `references/cascade.md`     |
| Writing selectors, state-based styling, pseudo-classes, or styling inside/consuming a web component                                           | `references/selectors.md`   |
| Working with colors, theming, custom properties, dark mode, or authoring tokens                                                               | `references/theming.md`     |
| Animating elements, adding transitions, using scroll-driven effects, implementing view transitions, or positioning popovers / anchor-based UI | `references/animation.md`   |

If a task spans multiple situations (e.g., building a new component touches layout + theming), load all matching references.

## Enforcing reference loading (TodoWrite gating)

Two prior field tests of this skill (n=1, n=2) both read **zero** references. Prose that says "read the reference before writing CSS" gets skipped. A pending TodoWrite task is harder to skip because it sits in the visible task list as incomplete.

**Flow:**

1. Run detection spine → output the one-liner.
2. Scan the routing table. For each row that applies to the current task, call TodoWrite to create a task formatted:
   ```
   Read modern-css references/{leaf}.md — {one-line why it applies}
   ```
3. Before the first CSS Read or Edit against project code, work through the tasks: use the Read tool on each referenced file, then mark the corresponding task completed. You may read in parallel.
4. If, after Read-ing, a reference turns out not to apply, mark the task completed with a one-sentence note in chat explaining what you expected vs. what the file covered. Never silently skip.

**Rationalization check.** If you catch yourself thinking "I already know what that reference says" — create the task and Read anyway. Skills evolve; your memory is stale. The discipline exists because the skill's authors have seen agents (including this one) confidently skip references and ship miscalibrated output. Memory is not evidence.

**What "applies" means.** An audit that touches cascade, tokens, animations, and selectors creates _four_ tasks, not one. For audits specifically, assume `cascade.md`, `theming.md`, and the audit-relevant subset of `selectors.md`/`responsive.md`/`animation.md`/`performance.md` all apply unless you can name what makes them irrelevant.

## When auditing existing CSS

When reviewing a codebase rather than writing new CSS:

- **Weight recommendations to the deployment context.** A VS Code extension that doesn't support RTL still benefits from logical properties (expressiveness), but a 290-instance migration has different priority than in an i18n-ready web app. State the context-specific rationale, not generic best-practice justification.
- **Triage within findings.** Don't treat all instances as equal severity. A continuous spinner without `prefers-reduced-motion` is higher severity than a 150ms opacity fade. A hardcoded color in a themed component is higher severity than one in a syntax-highlighting block. Report the severity distribution, not just the count.
- **Recommend implementation strategy, not just the fix.** "Create a shared mixin" vs. "wrap individually" vs. "global reset" are different approaches with different tradeoffs. Name the strategy.
- **Classify hardcoded values before recommending token migration.** Three categories: (a) should _be_ a token (repeated semantic value), (b) should _derive from_ a token via `color-mix()` or relative color syntax (opacity/lightness variant), (c) intentionally absolute (shadows, syntax highlighting, one-off decorative). Only (a) and (b) need action.
- **Check for architectural gaps, not just lint-level issues.** In web component codebases: `::part()` exposure (too many? too few?), `:host` styling consistency, style duplication across components, animation performance (compositor-friendly `transform`/`opacity` vs. layout-triggering `width`/`height`/`top`/`left`), dead/unused CSS.
- **Prioritize across findings.** Rank by: (1) _Broken under real conditions_ — hardcoded values that fail on theme switch, animations that ignore reduced-motion, z-index bugs from misunderstood stacking contexts. These are bugs. (2) _Architectural debt that compounds_ — style duplication, inconsistent `:host` patterns, no `::part` exposure strategy. Gets worse with every new component. (3) _Modernization with measurable benefit_ — performance gains, fewer selectors, simpler state. Worth doing but not urgent. (4) _Modernization for code quality_ — cleaner shorthands, modern selectors replacing working old ones. Apply to new code, migrate opportunistically. Lead with tier 1, end with tier 4.
- **Specify migration scope for large findings.** For findings with 50+ instances: recommend _new-code-only_ unless the finding is severity tier 1 (broken under real conditions). For tier 1, recommend a focused migration. For tier 2-4, recommend a lint rule for new code + opportunistic migration when already touching the file. A small team cannot absorb a 290-instance migration alongside feature work.
