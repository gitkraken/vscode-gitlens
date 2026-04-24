# Flow-Audit Output Format — Layer 1 / 2 / 3 Templates

The flow-audit report has three layers, in this order:

1. **Layer 1 — Summary.** Answers "how bad is the composition, where do I start, and what can I tell stakeholders." Optimized for scanning by engineer + designer.
2. **Layer 2 — Flow findings table.** One row per finding, numbered `F1, F2, …` (the `F` prefix distinguishes flow findings from component findings `#1, #2, …` so downstream remediation rollups can disambiguate).
3. **Layer 3 — Detailed findings.** Answers "how do I fix each one" with a Design Decision block when the fix is not a simple code diff.

This file is the source of truth for every required section, subsection, field, and template. If a section is marked REQUIRED, emit it or write the explicit "does not apply" statement the skill prescribes — never silently omit.

The Layer 1 Summary must be **consumable by `/a11y-remediate`** without modification. See "Hand-off notes" at the end of this file for the contract.

---

## Layer 1 — Summary

### Template

```
# A11y Flow Audit — [view path]

**Framework:** [detected framework]
**Product type:** [detected product type]
**Scope:** flow / view / composition

**Scope boundary (REQUIRED — read before citing this report):**
This audit covers the COMPOSITION of the view at [view path] — landmarks, heading hierarchy, focus management across components, cross-component interactions. It does NOT audit the internals of each component individually (see `/a11y-audit` for component-level findings). Anyone citing this report for a planning, compliance, or customer-facing decision must read this paragraph first. Compliance claims broader than "this view's composition" belong in a remediation proposal, not this audit.

**Components in scope (enumerated from the view at audit time):**
- `[ComponentA]` from `[path]`
- `[ComponentB]` from `[path]`
- ... one bullet per rendered component
[REQUIRED. This list is the authoritative scope. Findings can only be about these components or their composition. If a component renders conditionally (via a route, feature flag, or conditional state), note the condition: "`ComponentC` — rendered only on admin routes".]

**Extrapolation warning (REQUIRED):**
Do NOT generalize this view's flow status to other views in the product. Each view composes different components with different interactions; composition bugs don't repeat predictably. If the reader needs a product-wide flow status, multiple flow audits (one per view) are required. This audit answers only: "is THIS view's composition healthy?"

**What to tell customers today (REQUIRED — but calibrate to surface type):**
[A single sentence a product manager could paste into a customer email without translation. Must be: (a) factually grounded in this audit's findings, (b) scoped to this view (do NOT imply other views or the whole product), (c) free of ARIA/WCAG jargon. Follow with one sentence: "Timeline commitments and cross-product messaging belong in a remediation proposal, not this audit."

**Surface-type calibration (Obs 10):** the canonical template assumes there is a customer-facing "page." For tooling / IDE-embedded / webview / desktop-embedded surfaces, there often isn't. Choose one of:

- **(a) Phrase in terms of the surface:** render the sentence in surface language — e.g., "When you open the GitLens Home view, you'll see…" or "Inside the Launchpad panel, you'll notice…". Use this when the surface has a recognizable user-facing name.
- **(b) Mark N/A with note:** render the line as `**What to tell customers today:** (N/A — tooling surface, no public customer-facing page)` and omit the sentence. Use this when the surface has no user-facing name or is purely internal.

Do not force a "page" framing onto a surface that doesn't have one.]

**Notation legend (REQUIRED, short):**
- **Severity** — P0/P1/P2/P3 = user impact only. P0 = cannot complete a core workflow. P1 = significant friction. P2 = works with difficulty. P3 = minor / spec-compliance.
- **Effort** — S = <0.5 day, M = 0.5–2 days, L = 2+ days or requires a design decision.
- **Risk** — Low = pattern is well-established and the code change is mechanical. Med = validate against spec + keyboard pass before merge. High = fix could introduce a new a11y bug; requires extra care.
- **Fix Confidence** — High = safe after visual check. Medium = apply, then validate + keyboard + SR pass before merge. Low = NOT a code change yet; see the finding's Design Decision block.

## Summary

**Plain-English flow status (REQUIRED — write this BEFORE any tables or counts):**
[One or two sentences a non-expert reader can say aloud in a meeting. State: (a) what composition issues real users will experience, in plain terms (e.g., "keyboard users cannot reach main content without Tabbing through the entire nav every time they open this view"), and (b) whether the work is proceedable or design-blocked. Do NOT use ARIA jargon here. Reject your own draft if a PM or VP would need to ask what it means.]

**Total findings: [N]** — P0: [N] | P1: [N] | P2: [N] | P3: [N]

**Fix Confidence breakdown:** High: [N] | Medium: [N] | Low: [N] — of which **design-blocked: [N]**, **technically uncertain: [N]**
[The split matters for planning: *design-blocked* Low items are waiting on a human decision, not on engineering capability. *Technically uncertain* Low items are where the skill does not have enough information from the code to prescribe a fix confidently. Both deserve Low confidence; the reasons are different. REQUIRED when N(Low) > 0.]

**Rough sizing (engineer-days, one familiar developer):** [single final range, e.g., "3.5–11 days"]
[Compute as a sum of per-finding Effort ranges: S ≈ 0.25–0.5 days, M ≈ 0.5–2 days, L ≈ 2–5 days. Emit ONE final range. Do not show the arithmetic.

**Design-blocked-heavy calibration (Obs 6):** when ≥50% of findings are design-blocked (Low Fix Confidence for design reasons), the TOTAL range is misleading as the lead number — readers anchor on it and over-estimate actionable work. In this case, lead with the UNBLOCKED range first, then cite the design-blocked range separately. Template:

`**Rough sizing:** 0.5–1 engineer-day actionable today; 3–8 engineer-days design-blocked (resumes once the decisions in F1, F2, F4 land).`

When <50% are design-blocked, use the original single-range format.]
- **Excluded from range:** [N] design-blocked finding(s). The range resumes once those items have a design decision.
- **Excluded from range:** runtime-tooling items (tab-order verification, announcement-timing checks) — these are verification tasks, not engineering tasks.
- **Caveat:** Assumes no QA/regression cycles, no surprise unknowns, and no rework. Not calendar time. Not sprint-estimable — the skill has no team-velocity context.

**WCAG 2.1 AA criteria affected (this view's composition only):**
- **Currently failing:** [Comma-separated list of WCAG criterion numbers, e.g., `1.3.1, 2.4.1, 2.4.3, 4.1.2`. Only list criteria where a P0 or P1 finding indicates non-compliance at the composition level.]
- **Addressed after all findings in this audit are fixed (subject to runtime verification):** [Criteria that would move from failing to passing after every finding here is resolved.]
- **NOT covered by this audit (cannot verify from code alone):** [Criteria where code analysis cannot determine pass/fail — typically the runtime-only list: 1.4.3, 1.4.11, 2.4.7, 4.1.3 announcement timing.]

[REQUIRED. A leader asking "is this view compliant?" needs the three answers above plainly. Do NOT write "the view is WCAG 2.1 AA compliant" as a conclusion — the skill cannot prove compliance from code alone; it can only identify composition-level criteria status.]

### Cross-Component Dependency Notes
[REQUIRED when any finding involves 2+ components. If every finding lives inside a single component, write "All findings are scoped to a single component each — no cross-component dependencies." and move on.]

[For each cross-component finding, one entry:]
- **F[N]** — involves [ComponentA] and [ComponentB]. Dependency: [what connects them — shared landmark, focus handoff, live-region conflict, colliding accessible name]. Why together: [one sentence, concrete].

### High-Leverage Fixes (Composition-Level)
[Include this section if any finding affects multiple components' accessible experience through a single root-cause fix — e.g., adding a view-level live region replaces three component-level live regions.]

| Root-cause fix | Findings resolved | Severity range | Effort / Risk | Fix Confidence |
|---|---|---|---|---|
| [e.g., introduce app-shell skip link] | F1, F3 | P1–P2 | S/Low | High |

### Top Patterns
- [Most common pattern — e.g., "Unlabeled repeated landmarks (2 instances)"]
- [Second]
- [Third if applicable]

### Landmark Map & Heading Outline (OPTIONAL — Obs 3)

[Include this section ONLY when the flow has nontrivial landmark structure (2+ landmarks) OR heading hierarchy (3+ headings, OR any level skip, OR any heading outside an expected landmark). Skip for trivial flows (single `<main>`, single `<h1>`, nothing unusual) — the diagram adds noise for designers when the structure is already obvious from the text summary.

When included, render an ASCII tree showing the landmark map (top) and the heading outline (below). Designers use this to spot structural issues in under five seconds. Template:

```

Landmarks (current state):
└─ <header>
└─ <main>
├─ <nav aria-label="primary">
└─ <section aria-labelledby="h-overview">
└─ h1 "Home"
├─ h2 "Quick start"
└─ h2 "Recent activity"

```

Represent the CURRENT state from the code, not the desired state. If a finding proposes changes (e.g., F1 suggests introducing an `<h1>`), the tree shows what's there today — the Design Decision block in F1 describes the change. If there's no `<h1>` at all, represent it explicitly: `(no h1 — level-3 headings only)`. If a heading lives OUTSIDE a landmark, show it as a sibling to the landmark, not nested.]

### Finding Groups (Must Ship Together)
[REQUIRED when ANY of the following apply. If none apply, write "No multi-finding dependencies — every finding can be fixed independently." and move on.]

A group is required when:
1. Two or more findings participate in the same **focus-handoff chain** (a dialog opens from a component, closes, restores to the trigger — all three pieces must land together).
2. Two or more findings share a **landmark contract** (adding `<main>` AND the skip-link target; labeling two `<nav>`s at once).
3. Two or more findings share a **live-region consolidation** (collapsing three component-level polite regions into one view-level region).
4. Fixing one finding **cascades** into another (adding a landmark changes the skip-link requirement).

**Group: [name]** — Findings F[list]
**Dependency type:** [focus chain / landmark contract / live-region consolidation / cascade]
**Why together:** [One sentence: what breaks concretely if only part of this group is merged.]

[Repeat per group.]

### Safely Shippable Now

[REQUIRED. The developer reading this report needs an unambiguous "start here" list. A finding qualifies if ALL of the following are true:
1. NOT a member of any Finding Group above.
2. Fix Confidence is `High` or `Medium`.
3. Risk is `Low` or `Med` (never `High`).
4. The Fix field contains a concrete code change, not a design decision.

If no findings qualify, say so explicitly.

**Empty-by-construction rendering (Obs 9):** when the Safely-Shippable table is empty because every finding is a member of a Finding Group, design-blocked, or otherwise gated, render the section as:

`**None** — all findings in this flow audit are design-blocked or belong to Finding Groups that must ship together. This means the flow audit completed; it does not mean no audit was done.`

This wording prevents the Meera-persona misread of "empty table = nothing shippable = audit did nothing." The absence of shippable items is a finding about the audit's state, not a gap in its execution.]

**Safely shippable (independent PRs):**

| F# | Severity | Component(s) | Description | Effort / Risk | Fix Confidence |
|---|---|---|---|---|---|
| F[N] | [P0-P3] | [component or "view composition"] | [short] | [S/Low] | [High/Medium] |

**Design-blocked:**

| F# | Severity | Component(s) | Description | Decision required | Typical owner |
|---|---|---|---|---|---|
| F[N] | [P0-P3] | [component or "view composition"] | [short] | [one sentence] | [role, not a name] |

### Items Requiring Runtime Tooling to Confirm
[REQUIRED framing: these are NOT outstanding audit work and NOT hidden finding counts. They are items where static code analysis cannot produce a yes/no answer. Flow audits typically have MORE of these than component audits because tab order, focus restoration timing, and announcement ordering all depend on runtime behavior.]

- **Full tab-order verification** — To confirm: open the view in a browser, Tab from page load through the complete sequence; record the order; compare to the visual reading order. Flow audit flagged potential mismatches at [findings]; this runtime pass confirms or clears them. If confirmed as a problem, implication: additional P[N] findings.
- **Modal focus restore on close** — To confirm: trigger each dialog that the view renders; close via Escape, close via overlay click, close via explicit button; verify focus returns to the trigger (or sensible fallback) in each case. Flow audit verified the on-open path statically but cannot verify the actual restored-focus location at runtime.
- **Live-region announcement timing** — To confirm: trigger the flows that announce (save, error, loading transition) with a screen reader running; confirm the expected announcement fires, in the expected order, without being dropped or stepped on. Flow audit verified no region conflicts statically, but runtime timing is a separate check.
- [Additional items as applicable to the view]
```

---

## Layer 2 — Flow Findings Table

### Template

```
## All Findings

| F# | Severity | Component(s) | Description | Effort / Risk | Fix Confidence | WCAG |
|---|---|---|---|---|---|---|
| F1 | P1 | HeaderNav + AppShell | Duplicate `<nav>`s unlabeled | S / Low | High | [1.3.1](https://www.w3.org/WAI/WCAG21/Understanding/info-and-relationships) |
| F2 | ... | | | | | |
```

### Column definitions

- **F#** — sequential finding number, F-prefixed. `F1, F2, F3, ...`. This distinguishes flow findings from component-audit findings (`#1, #2, ...`) in cross-audit remediation rollups where both audit types are consumed.
- **Severity** — P0 / P1 / P2 / P3. Use the severity guide in SKILL.md.
- **Component(s)** — single component name if the finding is scoped to one; comma-separated list if cross-component; "view composition" if the finding belongs to the view's structural composition (landmarks at the view level, skip link for the view, etc.).
- **Description** — ≤10 words.
- **Effort / Risk** — two axes, separated by `/`. Both required.
  - **Effort**: `S` / `M` / `L`.
  - **Risk**: `Low` / `Med` / `High`.
  - Any fix covered by Safety Rules defaults to `Risk: High` unless the Safety Self-check clears it explicitly.
- **Fix Confidence** — `High` / `Medium` / `Low` (Low = Design Decision block required).
- **WCAG** — criterion number as a Markdown link to w3.org. Every citation in the table must be linked. See `references/wcag-criteria.md`.

**Table ordering:** sort by composition area first (view-level → cross-component → single-component findings), then by severity within each area.

---

## Layer 3 — Detailed Findings

### Template

```
## F[N] [P0-P3] — [Brief description]

**WCAG Criterion:** [Linked number and name, e.g., "[1.3.1 Info and Relationships](https://www.w3.org/WAI/WCAG21/Understanding/info-and-relationships)"]
**Components involved:** [specific component names and file paths — REQUIRED for cross-component findings; for single-component findings, one component name]
**Composition area:** [Landmarks / Headings / Focus flow / Live regions / Tab order / Accessible name collision — pick one]
**Effort / Risk:** [S/Low | S/Med | S/High | M/Low | M/Med | M/High | L/Low | L/Med | L/High]
**Fix Confidence:** [High | Medium | Low]
**Why risk:** [REQUIRED if Risk is Med or High. One sentence naming the specific thing that could go wrong if this fix is applied naively.]

**Problem (user impact):**
[MUST open with: "[User type] using [input method or AT] [attempting action in THIS view] [experiences failure]." The impact statement must be specific to this view's composition, not a generic AT-barrier description.

Good examples:
- "A NVDA screen-reader user loading the settings view hears 'navigation' twice in the landmark rotor with no way to distinguish the top-bar nav from the sidebar nav — both `<nav>`s are rendered without `aria-label`."
- "A keyboard-only user closing the filter modal finds focus dumped on `<body>` — the modal pulls focus in on open but the close handler does not restore focus to the filter button that triggered it."

Do NOT write: "Missing aria-label on nav." or "Focus not restored on modal close." Those describe code, not users. The flow dimension — what the composition produces — is what this audit exists to capture.]

**Current composition:**
[Describe the current DOM / component tree at the relevant level of detail. Show which components render which elements, and how they compose. Keep concise — the goal is to make the cross-component relationship visible.]

**Cross-component trace (REQUIRED for cross-component findings):**
[For findings that span 2+ components, explicitly name both sides and the contract between them. Example:
- "`FilterPanel` (src/components/filter-panel.tsx, line 42) renders `aria-live="polite"` on its status region.
- `ToastHost` (src/components/toast-host.tsx, line 12) also renders `aria-live="polite"` on its toast container.
- When a filter applies successfully AND a toast notification fires in the same tick, AT picks one region to announce and drops the other. The composition is what's broken, not either component in isolation."
This trace is mandatory for Rule 1 of the Pre-finalize pass in SKILL.md: every cross-component claim names both sides with file + line.]

**Fix:**
[Run the Safety Self-check (all 8 flow rules + the 5 component-carry-over rules, Rule 13 included) before writing this section. If any rule applies, either bundle the accompanying changes in this fix, or escalate.

If Fix Confidence is `Medium` or `High`: show the corrected code snippet(s), annotated with the component they belong in. If the fix spans multiple components, show each component's change separately.

If Fix Confidence is `Low`: emit a Design Decision block (template below), NOT free-form options.

**Design Decision block (REQUIRED when Fix Confidence is `Low`):**
- **Decision required:** [One sentence. What does a human have to decide before any code can be written?]
- **Typical owner:** [Role, not a person's name — e.g., "shared component library maintainer", "design system lead", "product designer", "view tech lead".]
- **Input needed to make the decision:** [What the decider needs to know.]
- **Options (one sentence each, no recommendation):**
  - Option A — [name and one-line tradeoff]
  - Option B — [name and one-line tradeoff]
- **Downstream work once decided:** [One short list of what implementation looks like after the decision — so the decider understands scope of their choice.]

**Pattern links (REQUIRED when the Fix references composite-pattern vocabulary):**
Cite the APG page for any referenced pattern (dialog, menu, listbox, combobox, tabs, grid, tree, radiogroup). Reader will not know these terms; the link is non-optional. See `references/aria-patterns.md` for pattern → URL mapping.

Any reference to a translation key, CSS class, helper, or constant must either cite the file where it is defined, or be tagged `[unverified: <symbol>]`. Per Rule 9 of the flow safety rules, an unverified symbol in a code diff forces Fix Confidence to Low with a Design Decision block.]

---
```

### Important rules for Layer 3

- **Each finding is ONE finding.** Do not combine multiple composition issues into a single finding. If the view has a duplicate-nav bug AND a missing-skip-link bug, those are two separate findings, even if they share an underlying "the shell doesn't know how to compose landmarks" root cause.
- **The Fix section must be decisive.** State the fix clearly. Do NOT include reasoning process or "actually, on reflection..." narrative. If you change your grade mid-draft, rewrite the finding cleanly.
- **Cross-component findings MUST name both components explicitly.** The Pre-finalize pass in SKILL.md greps for "Component A" / "Component B" abstractions without concrete names; flunks findings that use placeholders.
- **Focus-handoff claims MUST be traceable to a specific component pair.** "The modal doesn't restore focus" is insufficient; the finding must name the modal component and the trigger component.
- **The `Problem (user impact)` field is not optional.** Code-defect-only descriptions are banned.

### Rendering conventions for findings (Obs 1, 2, 11, 12)

These conventions shape how each Layer 3 finding READS to a developer or designer. Apply them consistently across every finding in the audit.

#### Rule citations inline the rule name (Obs 1)

First citation of a rule in a given finding MUST include the rule name/description, not just the number. Subsequent citations in the same finding can be bare.

- First-time render: `per Rule 8 — Live-region single-owner:` then the sentence follows.
- Subsequent render in the same finding: `per Rule 8:` is acceptable.
- Rule names to use (from `safety-rules.md`): Rule 1 — Single `<main>` per view; Rule 2 — Heading hierarchy unbroken; Rule 3 — Every repeated landmark labeled; Rule 4 — Modal focus (in/trap/Escape/restore); Rule 5 — Skip links when >1 landmark; Rule 6 — Tab order matches visual reading order; Rule 7 — Accessible names don't collide; Rule 8 — Live-region single owner; Rule 13 — Dependent-finding fixes must be conditional.

Render example (from the home-webview audit's F3):

`Per Rule 8 — Live-region single-owner: the view currently has two polite regions; the fix must not add a third. Per Rule 8 (again, on the conditional-mount check): neither chip's region should be mounted-on-state; the consolidated region must persist.`

#### Reference-leaf citations mark themselves as internal (Obs 2)

When a finding cites one of the skill's leaf files (`focus-flow.md`, `landmarks.md`, `headings.md`, `safety-rules.md`, `aria-patterns.md`, `wcag-criteria.md`, `output-format.md`), the citation must signal it is a skill-internal reference, not a public spec. Convention: **use the phrasing `(see the skill's {name} reference)` on the first citation in a finding; subsequent citations may be bare.**

Render example (from F3):

`...documented in the skill's focus-flow reference under "Live-region anti-patterns." Subsequent references in this finding may cite focus-flow directly.`

Do NOT write `see focus-flow.md` as if it were a public doc — readers cannot open it.

#### Per-finding test-path-without-AT (Obs 11)

Every Layer 3 finding MUST include a `**How to test without an assistive technology:**` line (placed after the Fix / Design Decision block, before Pattern links). Provide a concrete path a developer without a screen reader can use to verify the fix landed. Canned patterns the skill can use:

- **Keyboard-only traversal:** "Tab through the view from load; confirm focus visits [elements] in [order]."
- **Browser devtools A11y tab:** "In Chrome devtools → Elements → Accessibility pane, select the [element] and confirm [Name / Role / State]."
- **axe DevTools / Lighthouse / WAVE browser extension:** "Run axe DevTools on the view; confirm [specific rule or issue] is resolved."
- **DOM inspection:** "In Chrome devtools → Elements, confirm [attribute / element / structure] is present."

If a finding genuinely cannot be tested without AT (rare — typical examples: announcement timing, VoiceOver-specific rotor behavior), state so explicitly: `**How to test without an assistive technology:** Not possible for this finding — runtime AT verification is required. See "Items Requiring Runtime Tooling" in Layer 1.`

Render example (from F1):

`**How to test without an assistive technology:** In Chrome devtools → Elements → Accessibility pane, select the view's root; confirm exactly one element in the accessibility tree has role="heading" aria-level="1" inside the <main> landmark. In Elements, grep the page for <h1> and h[2-6]; confirm the sequence is h1 → h2 → h2 → ... with no skips.`

#### Component-level-coverage pointer (Obs 12)

Findings that touch a component's internals (even when the flow audit's Fix is at composition level) often surface component-level issues out of scope. Instead of citing "tracked separately via `/a11y-audit`" (which implies an existing backlog), render an actionable pointer.

Convention: `(For component-level coverage of {file}, run /a11y-audit on {file}.)`

Render example (from F3, at the end of the Cross-component trace or the Fix):

`(For component-level coverage of src/webviews/apps/plus/shared/components/account-chip.ts, run /a11y-audit on src/webviews/apps/plus/shared/components/account-chip.ts.)`

Use this same phrasing in the "Out-of-scope observations" section at the end of the audit: instead of generic "tracked separately," pin each observation to an explicit `/a11y-audit` invocation on the named file.

---

## Hand-off notes to `/a11y-remediate`

The Layer 1 Summary must be parseable by `/a11y-remediate` the same way a component-audit's Layer 1 is. This contract is load-bearing; preserve it exactly.

### Required Layer 1 sections for remediate consumption

The remediate skill reads these sections (by heading, in this order):

1. **Scope boundary** (paragraph) — tells remediate the audit's bounded claim. Remediate cites this verbatim when it produces customer-facing language.
2. **Components in scope** (bullet list) — authoritative enumeration of what's covered. Remediate uses this to detect "audited vs unaudited surface."
3. **Plain-English flow status** (1-2 sentences) — the input to remediate's customer-framing section.
4. **Total findings + severity counts** (P0/P1/P2/P3) — feeds the compliance rollup.
5. **Fix Confidence breakdown** (High/Medium/Low + design-blocked/technically-uncertain split) — feeds the staffing ask.
6. **Rough sizing (engineer-days)** — feeds staffing-translation.
7. **WCAG criteria affected** — three states (currently failing / addressable by fixes / runtime-only) — feeds compliance rollup.
8. **Cross-Component Dependency Notes** — NEW in flow audits. Remediate uses this to identify critical-path items that span components (these are higher-risk than single-component fixes because they require coordinated changes).
9. **Finding Groups** — feeds sprint planning (groups can't be split).
10. **Safely Shippable Now + Design-blocked** tables — direct inputs to sprint plans.
11. **Items Requiring Runtime Tooling** — remediate includes these in the "What this CANNOT answer" section of its proposal.

### Numbering contract

- Flow findings use `F1, F2, F3, ...`.
- Component audit findings use `#1, #2, #3, ...`.
- A cross-audit remediation rollup that cites both uses `{audit-name}:{F#-or-#N}` to disambiguate. Example: `graph-column-header-audit:#3` vs `dashboard-flow-audit:F2`.

If a flow audit's output is malformed (e.g., uses `#1` instead of `F1`, or omits the "Components in scope" enumeration), the remediation skill's extraction will degrade. Do not break the contract.

### Severity notation compatibility

Flow findings use the same `P0 / P1 / P2 / P3` severity notation as component audits. This is deliberate — severity measures user impact, not finding origin, and a P0 flow bug (keyboard user cannot reach main content) is the same class of problem as a P0 component bug (keyboard user cannot activate a control). Compliance rollups in remediate aggregate by severity across both audit types; breaking the notation would break that aggregation.
