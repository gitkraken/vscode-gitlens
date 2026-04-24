# Output Format — Layer 1 / 2 / 3 Templates

The audit report has three layers, in this order:

1. **Layer 1 — Summary.** Answers "how bad is it, where do I start, and what can I tell stakeholders." Optimized for scanning by both engineers and non-technical readers.
2. **Layer 2 — Issue table.** Answers "what's the full landscape." One row per issue, sortable by file or severity.
3. **Layer 3 — Detailed findings.** Answers "how do I fix each one." Grouped by file.

This file is the source of truth for every required section, subsection, field, and template. If a section is marked REQUIRED, emit it or write the explicit "does not apply" statement the skill prescribes — never silently omit.

---

## Layer 1 — Summary

### Template

```
# A11y Audit — [target path]

**Framework:** [detected framework]
**Product type:** [detected product type]
**Scope:** [single file / N files in directory]

**Scope boundary (REQUIRED — read before citing this report):**
[One paragraph naming what this audit covers and — critically — what it does NOT cover. An audit of a single component is not an audit of the page, feature, or product that contains it. Anyone citing this report for a planning, compliance, or customer-facing decision must read this paragraph first.]

**Extrapolation warning (REQUIRED):**
[One sentence explicitly forbidding issue-count extrapolation. Example: "Do NOT multiply this audit's issue count by the number of files in the surface to estimate total scope — other files will have different issue profiles." If the reader needs a total scope estimate, the skill cannot provide one and must say so plainly.]

**What to tell customers today (REQUIRED, one sentence, plain language):**
[A single sentence a product manager could paste into a customer email without translation. Must be: (a) factually grounded in this audit's findings, (b) scoped to what this audit covers (do NOT imply the whole product), (c) free of ARIA/WCAG jargon. Follow with one sentence: "Timeline commitments and cross-product messaging belong in a remediation proposal, not this audit."]

**Notation legend (REQUIRED, short):**
- **Severity** — P0/P1/P2/P3 = user impact only. P0 = cannot complete a core workflow. P1 = significant friction. P2 = works with difficulty. P3 = minor / spec-compliance.
- **Effort** — S = <0.5 day, M = 0.5–2 days, L = 2+ days or requires a design decision.
- **Risk** — Low = pattern is well-established and the code change is mechanical. Med = validate against spec + one SR pass before merge. High = fix could introduce a new a11y bug; requires extra care.
- **Fix Confidence** — High = safe after visual check. Medium = apply, then validate + SR pass before merge. Low = NOT a code change yet; see the issue's Design Decision block.

## Summary

**Plain-English status (REQUIRED — write this BEFORE any tables or counts):**
[One or two sentences a non-expert reader can say aloud in a meeting. State: (a) what real users cannot do, in plain terms, and (b) whether the work is proceedable or design-blocked. Do NOT use ARIA jargon here. Reject your own draft if a PM or VP would need to ask what it means.]

**Total issues: [N]** — P0: [N] | P1: [N] | P2: [N] | P3: [N]

**Fix Confidence breakdown:** High: [N] | Medium: [N] | Low: [N] — of which **design-blocked: [N]**, **technically uncertain: [N]**
[The split matters for planning: *design-blocked* Low items are waiting on a human decision, not on engineering capability. *Technically uncertain* Low items are where the skill does not have enough information from the code to prescribe a fix confidently. Both deserve Low confidence; the reasons are different. REQUIRED when N(Low) > 0.]

**Rough sizing (engineer-days, one familiar developer):** [single final range, e.g., "3.5–13 days"]
[Compute as a sum of per-issue Effort ranges: S ≈ 0.25–0.5 days, M ≈ 0.5–2 days, L ≈ 2–5 days. Emit ONE final range. Do not show the arithmetic. Do not recalculate mid-sentence. Do not edit the number inline.]
- **Excluded from range:** [N] design-blocked item(s). The range resumes once those items have a design decision.
- **Caveat:** Assumes no QA/regression cycles, no surprise unknowns, and no rework. Not calendar time. Not sprint-estimable — the skill has no team-velocity context.

**"N/A" is a legitimate sizing answer** when every issue is design-blocked AND the Options for the design decision span an order of magnitude in implementation scope (e.g., "add a key handler" vs "refactor scroll architecture"). In that case, write `N/A — all findings are design-blocked. The range resumes once the [N] design decisions below are made.` Do NOT emit a numeric range whose span exceeds one order of magnitude; the number is not useful and downstream rollups cannot consume it. See `ScrollbarContainer.tsx` audit for an example.

**WCAG 2.1 AA criteria affected (this file only):**
- **Currently failing:** [Comma-separated list of WCAG criteria numbers, e.g., `2.1.1, 4.1.2, 1.1.1, 4.1.1`. Only list criteria where a P0 or P1 issue indicates non-compliance.]
- **Addressed after all issues in this audit are fixed (subject to runtime verification):** [Criteria that would move from failing to passing after every issue in this audit is merged.]
- **NOT covered by this audit (cannot verify from code alone):** [Criteria where code analysis cannot determine pass/fail — typically contrast, focus visibility, text resizing.]

[REQUIRED. A leader asking "are we compliant?" needs the three answers above plainly. Do NOT write "the component is WCAG 2.1 AA compliant" as a conclusion — the skill cannot prove compliance from code alone; it can only identify file-level criteria status.]

### High-Leverage Fixes (Shared Components)
[Only include this section if shared component issues were found. Use the SAME Effort/Risk and Fix Confidence notation as the All Issues table in Layer 2.]

| Component | Issue | Severity | Effort / Risk | Fix Confidence |
|---|---|---|---|---|
| [component] | [one-line] | [P0-P3] | [e.g., S/Low] | [High/Medium/Low] |

### Top Patterns
- [Most common pattern — e.g., "Missing accessible names on icon-only buttons (5 instances)"]
- [Second]
- [Third if applicable]

### Issue Groups (Must Ship Together)
[REQUIRED when ANY of the following apply. If none apply, write "No multi-issue dependencies — every issue can be fixed independently." and move on.]

A group is required when:
1. Two or more issues participate in the same **composite ARIA pattern** (grid, menu, listbox, tree, tabs, radiogroup, combobox, dialog).
2. Two or more issues share a **container-role contract**.
3. One issue's fix **depends on a shared symbol** whose scope crosses issues — e.g., a duplicate-DOM-id fix must land everywhere the id is derived.
4. Fixing one issue **cascades** into another.
5. Two or more issues require the **same new utility or helper** (e.g., both need a `.sr-only` class that doesn't exist).

**Group: [name]** — Issues #[list]
**Dependency type:** [ARIA pattern / shared symbol / cascade / shared utility / cascade + shared design decision — pick the label that best fits; combined labels are allowed]
**Why together:** [One sentence: what breaks concretely if only part of this group is merged.]

[Repeat per group.]

**Issue Group label glossary (REQUIRED when this audit uses any Issue Groups):** immediately after the group list, add a short glossary defining each distinct dependency-type label used in this audit in one clause each. The label vocabulary is flexible across audits, so downstream rollups (`/a11y-remediate`) can only align semantically if each audit defines its own labels. Example: `- shared utility — both issues need the same new helper/class that does not exist yet.` / `- cascade — fixing one issue exposes or requires the other.` / `- cascade + shared design decision — both are rooted in the same unresolved architectural choice.`

### Safely Shippable Now

[REQUIRED. The developer reading this report needs an unambiguous "start here" list. An issue qualifies if ALL of the following are true:
1. NOT a member of any Issue Group above.
2. Fix Confidence is `High` or `Medium`.
3. Risk is `Low` or `Med` (never `High`).
4. The Fix field contains a concrete code change, not a design decision.

If no issues qualify, say so explicitly.]

**Safely shippable (independent PRs):**

| # | Severity | File | Description | Effort / Risk | Fix Confidence |
|---|---|---|---|---|---|
| [N] | [P0-P3] | [file] | [short] | [S/Low] | [High/Medium] |

**Design-blocked:**

| # | Severity | File | Description | Decision required | Typical owner |
|---|---|---|---|---|---|
| [N] | [P0-P3] | [file] | [short] | [one sentence] | [role, not a name] |

**"None" case (REQUIRED wording when no issue qualifies as safely shippable):** instead of emitting an empty table, write the "Safely shippable (independent PRs):" header followed by exactly: `**None** — all issues in this audit are {design-blocked / dependency-blocked / runtime-verification-blocked / [other specific reason]}. This means the audit completed; it does not mean no audit was done.` Pick the most specific reason class; don't write "None" without it. Downstream rollups (`/a11y-remediate`) depend on the reason clause to cite this audit correctly.

### Verification Playbook
[REQUIRED. Load `references/verification.md` for full content. Minimum fields:
- Primary screen reader + browser pair (by product type)
- Keyboard-only checklist (no mouse)
- Automated sanity check (axe / Lighthouse) — do NOT predict tool output
- No-AT fallback (what the dev CAN and CANNOT verify without AT)
- Per-P0 reproduction recipe (1-3 keyboard-only steps per P0)]

### Items Requiring Runtime Tooling to Confirm
[REQUIRED framing: these are NOT outstanding audit work and NOT hidden issue counts. They are items where static code analysis cannot produce a yes/no answer.]

- **[Concern]** — To confirm: [runtime check]. If confirmed as a problem, implication: [severity/scope].
```

---

## Layer 2 — Issue Table

### Template

```
## All Issues

| # | Severity | File | Line | Description | Effort / Risk | Fix Confidence | WCAG |
|---|---|---|---|---|---|---|---|
| 1 | P1 | button.ts | 316 | `aria-disabled` logic reads stale value | S / Low | High | [4.1.2](https://www.w3.org/WAI/WCAG21/Understanding/name-role-value) |
| 2 | ... | | | | | | |
```

### Column definitions

- **#** — sequential issue number.
- **Severity** — P0 / P1 / P2 / P3. Use the severity decision guide in SKILL.md.
- **File** — filename only; full path appears in Layer 3.
- **Line** — line number.
- **Description** — ≤10 words. Scannable summary, not full explanation.
- **Effort / Risk** — two axes, separated by `/`. Both required. Severity measures user impact; Effort/Risk measures how hard and how dangerous the fix is. Independent — a P0 issue can be S/Low, a P3 can be L/High.
  - **Effort**: `S` (<0.5 day focused) / `M` (0.5–2 days) / `L` (2+ days or requires design decision).
  - **Risk**: `Low` (mechanical, pattern well-established) / `Med` (validate against WAI-ARIA + SR pass before merge) / `High` (fix could introduce new a11y bug; needs "Why risk is High" line in Layer 3).
  - Display combined: `S/Low`, `S/High`, `M/Med`, `L/High`.
  - Any fix covered by Safety Rules defaults to `Risk: High` unless the Safety Self-check clears it explicitly.
- **Fix Confidence** — `High` (safe after visual verification) / `Medium` (apply, then validate + SR pass before merge) / `Low` (sketch only; emit Design Decision block, not a code diff).
- **WCAG** — criterion number as a Markdown link to w3.org. Every citation in the table must be linked. See `references/wcag-criteria.md` for the URL map.

**Table ordering:** sort by file/component first, then by severity within each file.

**Issue numbering:** numbers must be unique within an audit (start at #1, increment sequentially). When this audit is cited from another artifact (e.g., `/a11y-remediate` rollup), the citing artifact must use the form `{filename-stem}#N` (e.g., `draggable-graph-header#3`, `scrollbar-container#1`) to disambiguate across audits that each start at #1.

**Numbering gaps:** if the final issue table has a gap in the sequence (e.g., #1, #2, #3, #4, #6 with no #5 — because an in-progress finding was withdrawn), add a one-line note directly under the table: `Note: no issue #5 — [reason, one clause].` Downstream readers must not be left to infer that an issue was lost.

---

## Layer 3 — Detailed Findings

### Template

```
## [filename] — [full file path]

### #[N] [P0-P3] — [Brief description]

**WCAG Criterion:** [Linked number and name, e.g., "[4.1.2 Name, Role, Value](https://www.w3.org/WAI/WCAG21/Understanding/name-role-value)"]
**Line:** [line number]
**Effort / Risk:** [S/Low | S/Med | S/High | M/Low | M/Med | M/High | L/Low | L/Med | L/High]
**Fix Confidence:** [High | Medium | Low]
**Why risk:** [REQUIRED if Risk is Med or High. One sentence naming the specific thing that could go wrong if this fix is applied naively.]

**Problem (user impact):**
[MUST open with: "[User type] using [input method or AT] [attempting action] [experiences failure]."

Good examples:
- "A NVDA screen-reader user pressing Tab to reach the settings control skips over it — it is a `<span onClick>` with no role or tabindex, so it is invisible to both keyboard and screen reader."
- "A keyboard-only user opening the hidden-refs menu cannot activate any item — the list items have onClick handlers but no onKeyDown, so Enter/Space do nothing."

Do NOT write: "Missing role on menu." or "No aria-label on button." Those describe code, not users.]

**Code:**
[The relevant code snippet — keep short, just the problematic lines with enough context to locate them.]

**Fix:**
[Run the Safety Self-check before writing this section. If any rule applies, either bundle the accompanying changes in this fix, or escalate.

If Fix Confidence is `Medium` or `High`: show the corrected code snippet.

If Fix Confidence is `Low`: emit a Design Decision block (template below), NOT free-form options.

**Design Decision block (REQUIRED when Fix Confidence is `Low`):**
- **Decision required:** [One sentence. What does a human have to decide before any code can be written?]
- **Typical owner:** [Role, not a person's name — e.g., "shared component library maintainer", "design system lead", "product designer", "team tech lead".]
- **Input needed to make the decision:** [What the decider needs to know.]
- **Options (one sentence each, no recommendation):**
  - Option A — [name and one-line tradeoff]
  - Option B — [name and one-line tradeoff]
- **Downstream work once decided:** [One short list of what implementation looks like after the decision — so the decider understands scope of their choice.]

**Pattern links (REQUIRED when the Fix references composite-pattern vocabulary):**
Whenever the Fix or Design Decision uses terms like "roving tabindex", "aria-activedescendant", "focus trap", "menu pattern", "listbox pattern", "combobox pattern", "grid pattern", "tab pattern", "dialog pattern", "tree pattern", the skill MUST cite the relevant APG page. Reader will not know these terms; the link is non-optional. See `references/aria-patterns.md` for pattern → URL mapping.

Any reference to a translation key, CSS class, helper, or constant must either cite the file where it is defined, or be tagged `[unverified: <symbol>]`. Per Rule 4's sub-rule, an unverified symbol in a code diff forces Fix Confidence to Low with a Design Decision block.]

---
```

### Important rules for Layer 3

- **Do NOT include a "Found by" field.** The entire report is from code analysis — stating it on every issue is redundant.
- **Each issue is ONE issue.** Do not combine multiple bugs into a single finding. If a component has a role-override bug AND an aria-disabled bug, those are two separate issues.
- **The Fix section must be decisive.** State the fix clearly. Do NOT include reasoning process, second-guessing, or "actually, on reflection..." narrative. If you realize mid-analysis the issue is different than you first thought, **restart the finding from scratch** — do not leave the exploratory trail. (Rule 10 enforces this.)
- **The heading must match the content.** The brief description in the `### #N` heading must accurately describe the issue detailed below.
- **The `Problem (user impact)` field is not optional.** Code-defect-only descriptions are banned; they must open with the user-impact template.

---

## Directory audits — additional rules

For directory audits, add a per-file summary table after Layer 1 and before Layer 2:

```
### Files Audited

| File | Issues | Highest Severity | Notes |
|---|---|---|---|
| [filename] | [N] | [P0-P3 or Clean] | [e.g., "shared component — high leverage"] |
```

This lets a developer or tech lead quickly see which files need attention and which are clean.

---

## Severity calibration (reference — full text in SKILL.md)

Severity measures **user impact**, not technical severity or spec-compliance severity.

| Severity      | Definition                                                                                   | Test                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| P0 — Blocker  | AT user **cannot complete** a core workflow.                                                 | Would a screen-reader or keyboard-only user be completely stuck? If there's any workaround, it's not P0. |
| P1 — Critical | Core workflow **significantly degraded** — completable but with major friction or confusion. | User can finish, but it's painful.                                                                       |
| P2 — Serious  | Functionality **works but with unnecessary difficulty**. Non-core workflows may be blocked.  | User notices something is off but can work through it.                                                   |
| P3 — Minor    | **Technically non-compliant** but low real-world user impact.                                | Would a real user be affected? If only a contrived scenario, it's P3.                                    |

### Decision guide — apply after initial assessment

- Can the user complete the workflow? No → P0 or P1. Yes → P2 or P3.
- Core workflow vs peripheral? Core → bump up one level. Peripheral → bump down.
- Reasonable workaround? Yes → bump down one level.
- Affects multiple views/flows? Systemic → bump up one level.

### Common calibration mistakes

- A missing label on a single non-critical button is NOT P0 — P1 max (P2 if peripheral).
- A heading hierarchy issue is NOT P0 — degrades navigation but doesn't block workflows. Usually P2.
- `outline: none` on focus is P1-P2, not P0, IF there's any alternative indicator.
- `aria-hidden="true"` on visible content IS potentially P0 if that content contains critical information/actions.
