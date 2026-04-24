# Output Format — Remediation Proposal Structure

A remediation proposal is a decider-facing artifact. It takes one or more audit outputs plus user-supplied context and produces the planning document a leader needs for a stakeholder meeting or a customer commitment. It is NOT a re-statement of the audit; it is the translation of audit findings into decisions.

**Structure (in order):**

0. **Executive Summary** — one-page TL;DR answering the four decision questions. Scannable in 30 seconds.
1. **Header block** — what this proposal covers, inputs used, limits.
2. **Program Status (plain English)** — the executive-level read.
3. **Audit Coverage Summary** — what's been audited and what hasn't.
4. **Compliance Rollup** — from `compliance-rollup.md`.
5. **Staffing Ask** — from `staffing-translation.md`.
6. **Sprint Plan** — what ships when.
7. **Critical Path** — from `critical-path.md`.
8. **Customer Communication** — from `customer-framing.md`.
9. **Risk of Deferral** — from `deferral-risk.md`.
10. **Explicit Gaps** — what this proposal cannot answer and why.

Every section below tells you what to emit AND what to refuse to emit if inputs are missing.

---

## Section 0 — Executive Summary (REQUIRED, one page, up top)

The rest of the proposal is 10 sections deep. Leaders don't have time to assemble a meeting talking-track from Sections 2, 5, 7, and 9. This section is the pre-assembled one-pager — the scannable answer to the four decision questions.

Emit in this exact shape:

```
## Executive Summary

**Bottom line:** [One sentence. What's the punchline? Example: "We have enough data to ship 2 fixes this sprint; we do NOT have enough data to commit to the Q3 compliance target, and we will have a commit-or-defer answer in [default: today + 4 weeks, OR user-provided date]."]

**The four meeting answers:**

1. **Q3 compliance commit?** — [Yes / No / Commit-or-defer-by-date]. One sentence on why.
2. **Staffing ask?** — [Phase 1 (this sprint): N engineers, Safely-Shippable items, fits current capacity. Phase 2 (once decisions land): N engineers × N sprints.] Do not show arithmetic here; that lives in Section 5.
3. **Customer status today?** — [One sentence, plain language, bounded to audited scope. See Section 8 for the full draft.]
4. **Cost of deferring a quarter?** — [User-harm: what users continue to experience. Commercial: only cite if user supplied contract context. One sentence each.]

**The leader's next three actions (in order):**

1. [Most urgent action — usually "engage [role] to establish decision ETA for D1"]
2. [Second action — usually "authorize auditing of [N] additional files in parallel"]
3. [Third action — usually "book follow-up meeting in [N] weeks to finalize commit-or-defer"]

**What this proposal CANNOT answer — summary:** [3-4 bullet distillation of Section 10, NOT the full 10-gap list. The curated version a leader can state briefly: "we're missing A, B, C — we will close these by [action/date]."]
```

**Rules for this section:**

- Fits on one screen / one printed page. If it doesn't, cut. The Exec Summary is the whole proposal condensed, not a preview of everything.
- NEVER uses ARIA codes (no "4.1.2 Name, Role, Value"). Plain language.
- NEVER shows derivation / arithmetic — those live in Section 5.
- Every answer above maps directly to content later in the proposal. The Exec Summary is extracted from Sections 2, 5, 7, 8, 9, 10 — not invented.
- If the proposal genuinely cannot answer one of the four questions (e.g., no contract context → cannot answer cost of deferring), say so in one sentence and point to the specific input gap.

---

## Section 1 — Header block

```
# A11y Remediation Proposal — [scope name]

**Date:** [YYYY-MM-DD]
**Prepared by:** [producing agent / user]

**Proposal scope:** [Audits covered + product/feature name — e.g., "Graph column header + (future) graph body audits, within gitkraken-components library".]

**Audits in scope:**
- [list of audit files consumed, with paths]

**User-supplied context:**
- Team: [size, focus-time fraction, sprint cadence, PR cycle, existing commitments]
- Compliance target: [standard, deadline, source — e.g., "WCAG 2.1 AA by Q3 per government contract clause X"]
- Named owners (optional): [role → person mappings]
- Unaudited surface estimate: [count or "unknown"]

**Missing context (flag anything user did not provide):**
- [Bullet list — each unprovided input = a known gap in this proposal]
```

---

## Section 2 — Program Status (plain English)

One or two sentences, non-expert readable, that a VP could hear once and understand. Same standard as the audit's `Plain-English status` but aggregated across all audits in scope.

```
**Program status (plain English):**
[Aggregate statement. Example: "Across the one file audited so far, keyboard-only and screen-reader users cannot operate the graph column header's buttons; most fixes are waiting on a shared-library design decision that has not yet been scheduled."]
```

---

## Section 3 — Audit Coverage Summary

A small table listing every audit in scope with its scope and key findings.

```
| Audit file | Scope | P0 | P1 | P2 | P3 | Design-blocked |
|---|---|---|---|---|---|---|
| [file] | [component/directory] | [N] | [N] | [N] | [N] | [N] |

**Unaudited surface:** [list of surfaces/files that were not audited, OR "unknown — has not been scoped"]

**Coverage-gap note:** [one sentence on what the unaudited surface means for any broader commitment]
```

---

## Section 4 — Compliance Rollup

Load `compliance-rollup.md` for templates. Emit:

```
### Compliance rollup (audited scope only)

**Criteria failing today (audited scope):**
[Table per compliance-rollup.md]

**Criteria resolvable by proposed fixes:**
[Subset — code-level only]

**Criteria that remain failing until design decisions resolve:**
[List]

**Criteria requiring runtime verification:**
[List]

**Compliance claim bounds:** [explicit statement about scope — e.g., "This rollup applies to the audited files only; the graph as a whole cannot be assessed without further audits."]
```

---

## Section 5 — Staffing Ask

Load `staffing-translation.md` for format picker. Pick the most-constrained format the user's inputs support.

```
### Staffing ask

**Headline (emit first, no arithmetic):**
[One or two sentences with the conclusion the leader can quote directly. Example: "Phase 1 (this sprint): 1–2 engineers on Safely-Shippable items; fits current capacity. Phase 2 (post-decision): 2 engineers × 1–2 sprints on design-blocked group." No formulas, no division, no symbols.]

**Input basis:** [what user-supplied context this uses]

**Detailed derivation (for engineering review):**

[Format A / B / C from staffing-translation.md — this is where the arithmetic lives]

**What this number does NOT include:** [QA regression cycles, downstream product verification, unknown design-decision latency]
```

The headline is what Raj / a leader will quote. The derivation is what an engineering lead will validate. Keep them separated so the leader doesn't have to extract the conclusion from formulas.

---

## Section 6 — Sprint Plan

Only emit this section if the user provided sprint cadence AND the critical path has been established. Otherwise say:

```
### Sprint plan

Sprint plan requires: (a) sprint cadence input (provided: [yes/no]), (b) design-decision ETAs (provided: [yes/no]). With current inputs, the earliest emit-able form is [eng-days listing] rather than a sprint-by-sprint schedule.
```

When inputs allow:

```
### Sprint plan

**Sprint N (this sprint):** [Safely-shippable items landing]
- Issue #X — [description] — [owner if known, else engineer role]
- Issue #Y — [description] — [owner]
- [...]

**Sprint N+1:** [Next-sprint work — dependent on decisions landing before sprint start]
- [...]

**Pending sprint placement:** [Items that require design decisions with no ETA yet]
- [...]
```

---

## Section 7 — Critical Path

Load `critical-path.md`. Emit the full critical-path template.

---

## Section 8 — Customer Communication

Load `customer-framing.md`. Emit:

```
### Customer communication draft

**For customer-facing use (bounded to audited scope):**
[Template 1 / 2 / 3 from customer-framing.md based on situation]

**For internal PM use:**
[PM template]

**For internal VP use:**
[VP template]
```

All three are optional — include only what the user's context supports. Never fabricate a customer commitment the user hasn't authorized.

---

## Section 9 — Risk of Deferral

Load `deferral-risk.md`. Emit:

```
### Risk of deferral

[Three-scenario analysis from deferral-risk.md: ship now / defer one quarter / partial defer]

**User-harm risk:** [bounded to audit findings]

**Commercial / contract risk:** [only if user provided compliance context]

**Partial-ship warnings:** [Issue Groups that must not be split]

**Honest bottom-line sentence:** [per deferral-risk.md template]
```

---

## Section 10 — Explicit Gaps

This is the section that distinguishes a trustworthy proposal from a fabricated one. Every place the proposal declined to emit a number or a commitment, state so here:

```
### What this proposal CANNOT answer

- [Gap 1 — e.g., "Q3 go/no-go commitment: requires design-decision ETAs (not provided) and unaudited-surface scoping (not yet performed)."]
- [Gap 2 — e.g., "Calendar-time estimate: requires team velocity and existing-commitment input (not provided)."]
- [Gap 3 — e.g., "Downstream product regression cost: requires engagement with vscode-gitlens and desktop app teams."]

**How to close each gap:** [Concrete next step per gap — e.g., "Schedule 30min with shared-library maintainer to establish decision ETA."]
```

### Gap taxonomy — invalidating vs additive

Not all gaps are equivalent. Classify each gap as **invalidating** or **additive** and place it accordingly. The two classes carry different propagation rules.

**Invalidating gaps** — a placeholder or simulated input that, if wrong, corrupts every number derived from it. These MUST appear both (a) as a caveat at the top of the proposal (Executive Summary, Section 1, or a proposal-wide calibration line) AND (b) in every section that uses the affected numbers — not just Section 10.

Examples of invalidating gaps:

- Placeholder / simulated team context (team size, focus-time, sprint cadence). Every staffing, sprint, and calendar figure inherits the placeholder.
- Placeholder sprint capacity or "assumed 40% remaining capacity" without user confirmation.
- A compliance deadline the user has not confirmed but which every Phase/milestone claim depends on.

**Additive gaps** — a missing input that would enrich the proposal if filled, but whose absence does not invalidate any number already emitted. These belong in Section 10 only.

Examples of additive gaps:

- Missing owner names (roles are used instead; every number is still valid).
- Missing contract consequence language (risk framing is less specific; scenarios still hold).
- Missing interim-workaround documentation (customer section is less complete; does not affect sizing).
- Missing exact unaudited-file inventory when a rough count is cited with the "unknown" hedge already in place.

**Classification rule:** if filling the gap would force recomputation of a headline number or change a Yes/No commitment, it is invalidating. Otherwise additive. When in doubt, treat as invalidating — over-flagging is safer than under-flagging.

---

## Rules across all sections

### Never fabricate numbers

- Engineer-days come from audit Effort ranges. State the range.
- Engineer-weeks/sprints come only from user-supplied cadence.
- Headcount comes only from user-supplied team size + parallelization analysis.
- Calendar dates come only from user-supplied commitments.

### Never fabricate owners

- Use role names from audit Design Decision blocks.
- Add person names ONLY if user provided a role→name mapping.
- Never guess "probably X" for an owner.

### Never inflate risk

- User-harm risk: scope to audit findings.
- Contract risk: require user-supplied contract context.

### Never hide a gap

- Section 10 is mandatory. A proposal with no "Explicit Gaps" section has something hidden.

### Every number must have provenance

- "3.5–13 engineer-days (from audit `Effort / Risk` fields, sum of S/M/L ranges)"
- "1 sprint (using user-supplied 2-week sprints and 60% focus-time)"
- "2 engineers × 2 sprints (using [team-size input] and parallelization across Safely-Shippable items)"

If a reader can't trace a number back to its input, it's fabricated — remove it.

---

## Hand-off consumption rules (cross-audit rollups)

These rules govern how the proposal cites and aggregates content from multiple `/a11y-audit` outputs. See also `compliance-rollup.md` and `staffing-translation.md` for the per-section rules they cover.

### Issue-number citations use filename-prefixed form

Every audit starts issue numbering at #1. Cross-audit references to "Issue #3" are ambiguous. All issue references in the proposal — in prose, tables, Issue Group citations, Sprint Plan, Critical Path — MUST use the form `{filename-stem}#N`.

- ✅ `draggable-graph-header#3`, `scrollbar-container#1`
- ❌ `Issue #3` (ambiguous when two audits are in scope)

If a source audit notes a numbering gap (e.g., `Note: no issue #5 — withdrawn during drafting.`), preserve that note in any rollup table where a reader might scan for a contiguous sequence.

### Issue Group labels are preserved verbatim across audits

Different audits use different Issue Group dependency-type labels — e.g., `DraggableGraphHeader.tsx` uses "shared utility" vs "cascade" as distinct labels; `ScrollbarContainer.tsx` uses a combined "cascade + shared design decision" label. This vocabulary is flexible by design (per the audit skill's Issue Group glossary requirement).

When rolling up:

- **Preserve each audit's original label verbatim in its citation.** Do not rename "shared utility" to "cascade + shared design decision" or vice versa to force uniformity.
- **Group by semantic category in the rollup section**, and add a one-line note that labels differ across source audits. Example: `Rollup groups combine issues that share a design decision, regardless of each audit's exact label (DraggableGraphHeader uses "shared utility" and "cascade"; ScrollbarContainer uses "cascade + shared design decision").`
- **Never silently relabel.** Relabeling destroys the source audit's semantics.

### Safely-Shippable "None" cases cite the reason, not a default

An audit whose Safely-Shippable section reads `**None** — all issues in this audit are {reason}` has completed; it did not skip the section. When rolling up:

- Cite the audit with its reason clause (e.g., `ScrollbarContainer: None — all issues design-blocked`). Do not abbreviate to `None` without the reason.
- Do not default to implying the audit was incomplete or skipped. The rollup narrative must read "audit X found nothing safely shippable because {reason}," not "audit X did not identify shippable items."
- When computing a total Safely-Shippable count across audits, a "None" audit contributes 0 — but the rollup text must still name the audit in any "audits contributing" list so its scope is visible.
