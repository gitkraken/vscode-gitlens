---
name: a11y-remediate
description: Use to produce a leader-facing remediation proposal from one or more /a11y-audit outputs plus team and product context. Translates audit findings into sprint plans, staffing asks, customer-facing language, compliance rollups, and critical-path analysis. Refuses to fabricate numbers, owners, or commitments beyond the inputs it has.
---

# A11y Remediate

Take one or more audit outputs plus user-supplied context and produce the planning artifact leaders need for stakeholder meetings, customer commitments, and team staffing decisions.

**Scope:** cross-audit, program-level. **Audience:** EM, lead, PM, VP. **This skill is NOT an audit** — it consumes audit output, it does not produce it. If there are no audits yet, run `/a11y-audit` first.

## How to use this skill

1. Run the detection spine (below) to establish inputs.
2. Emit the mandatory calibration one-liner BEFORE writing the proposal.
3. For every piece of context the user did NOT provide, mark the corresponding output section as "cannot calculate — requires [input]." Do not fabricate.
4. Read the relevant reference leaves per the routing table.
5. Write the proposal following `references/output-format.md`.
6. Run the Pre-finalize pass.

## Detection spine

Run once per proposal. The answers determine what the proposal can and cannot emit.

### Step 1 — Audits in scope

Identify which audit files this proposal consumes. User will usually name them; if not, ask. Read each audit and extract:

- Scope (single file / directory / etc.)
- Total issues by severity
- Fix Confidence breakdown (High / Medium / Low with design-blocked vs technically-uncertain split)
- WCAG criteria affected (failing today, resolvable by fixes, requiring runtime verification)
- Issue Groups and their "must ship together" constraints
- Safely Shippable Now and Design-blocked tables
- Per-P0 reproduction recipes
- Items Requiring Runtime Tooling

### Step 2 — Team context (USER-PROVIDED)

The skill cannot invent team characteristics. Ask the user for these if not provided:

- **Team size:** how many engineers could work on this?
- **Focus-time fraction:** what percentage of their time is actually focused work? (Default 50% if not stated, flag the caveat.)
- **Sprint cadence:** 1-week? 2-week? Not using sprints? Kanban?
- **PR review cycle:** how long from PR open to merge, typically?
- **Existing commitments:** what else is the team working on right now?

If team size is not provided, the skill cannot emit headcount × time staffing asks. Say so plainly.

### Step 3 — Compliance / product context (USER-PROVIDED)

- **Compliance target:** WCAG 2.1 AA? WCAG 2.2? A specific subset?
- **Deadline:** specific date? Quarter? None?
- **Source:** customer contract? Internal mandate? Product launch? Regulatory?
- **User population:** if known, scope of affected users (for deferral-risk framing).

If compliance context is missing, the skill cannot answer "is Q3 realistic?" or emit contract/legal risk framing.

### Step 4 — Audit coverage state

- How many files are in the total surface (the whole product, feature, library)?
- How many have been audited?
- Is a plan to audit the rest in motion?

If the unaudited surface is unknown, the skill cannot give a program-wide status. State so.

### Step 5 — Named owners (USER-PROVIDED, optional)

If the user provides a mapping from "role" (library maintainer, design system lead) to a person name, the proposal can use names in internal PM/VP sections. Otherwise, roles only.

**Never fabricate names.** "Probably John on the shared-lib team" is banned.

### Mandatory calibration one-liner

Before writing the proposal, emit this exact one-liner:

> Audits in scope: {N, file names}. Team: {size + velocity, or "not provided"}. Compliance target: {standard + deadline, or "not provided"}. Unaudited surface: {count or "unknown"}. Named owners: {"yes, mapped" or "no, roles only"}.

This tells the reader what the proposal is operating with. The proposal's output fidelity matches these inputs — missing inputs = refused outputs, not fabricated ones.

## Load-bearing rules (always apply)

Full content in the referenced leaves. Compressed list:

1. **Never fabricate numbers** — every number has provenance (audit field or user-supplied input). Unknown → "requires [input]." (→ all references)
2. **Never fabricate owners** — roles only, unless user provided names. Never "probably X." (→ `critical-path.md`)
3. **Never claim compliance at a scope larger than audited** — a 1-file audit does not answer "is the graph compliant?" (→ `compliance-rollup.md`)
4. **Never convert engineer-days to calendar weeks without velocity input** — the conversion requires focus-time, cadence, and existing-commitments data. (→ `staffing-translation.md`)
5. **Customer-facing language is bounded by audit scope** — never imply a commitment beyond what audits cover. (→ `customer-framing.md`)
6. **Risk-of-deferral splits user-harm from contract risk** — they lead to different conversations. Contract risk requires user-supplied contract context. (→ `deferral-risk.md`)
7. **Critical path surfaces design decisions as serial blockers** — a commitment without decision-ETA for every blocker is not defensible. (→ `critical-path.md`)
8. **Every proposal ends with an explicit "What this CANNOT answer" section** — gaps are not hidden; they are listed so the leader can close them. (→ `output-format.md`)

## When to load which reference

| Situation                                                         | Read                                        |
| ----------------------------------------------------------------- | ------------------------------------------- |
| Building the staffing ask section                                 | `staffing-translation.md`                   |
| Drafting customer, PM, or VP communication                        | `customer-framing.md`                       |
| Rolling up WCAG criteria state across audits                      | `compliance-rollup.md` + `wcag-criteria.md` |
| Framing risk of deferral (ship / defer / partial defer scenarios) | `deferral-risk.md`                          |
| Identifying critical path through design decisions                | `critical-path.md`                          |
| Writing the proposal structure (all 10 sections)                  | `output-format.md`                          |
| Looking up WCAG criterion details                                 | `wcag-criteria.md`                          |

Most proposals touch most references. Load what applies.

## Proposal outputs

Proposals are written to `remediation-proposals/{scope}-proposal.md` (or wherever the user specifies). See `references/output-format.md` for the full 10-section structure. In brief:

1. Header block (inputs + missing context)
2. Program Status (plain English)
3. Audit Coverage Summary
4. Compliance Rollup
5. Staffing Ask
6. Sprint Plan
7. Critical Path
8. Customer Communication
9. Risk of Deferral
10. Explicit Gaps (what this CANNOT answer)

Section 10 is mandatory. A proposal with no gaps section is hiding something.

## Pre-finalize pass (MANDATORY — before writing the proposal to disk)

Run these scans on the complete draft before writing the file.

### Scan 1 — Every number has provenance

Grep the draft for numbers (engineer-days, sprints, days, weeks, counts, percentages). For each:

- Can the reader trace it back to (a) an audit field, (b) a user-supplied input, or (c) a documented formula in `staffing-translation.md` / `critical-path.md`?
- If NO: remove the number and replace with "requires [input]" or cite the missing provenance.

No number appears in the proposal without a visible source.

### Scan 2 — No fabricated names or owners

Grep the draft for proper nouns that refer to people. For each:

- Did the user provide this name in their context?
- If NO: replace with the role ("shared component library maintainer", "product designer") and note in Section 10 that owner identification requires user input.

### Scan 3 — No scope overreach in compliance claims

Grep for phrases like "[product/feature] is WCAG 2.1 AA compliant", "the graph passes", "we are compliant".

- Is the scope of the claim ≤ the audited scope?
- If NO: rewrite to bound to audited scope. Add to Section 10: "Product-wide compliance claim cannot be made from file-level audit coverage."

### Scan 4 — Every "cannot answer" is named in Section 10

Grep the draft for "requires [input]" or "cannot calculate without". For each match:

- Is this gap listed in Section 10 (Explicit Gaps)?
- If NO: add it with a "how to close this gap" note.

Section 10 is complete when every "can't answer" in the body appears there with a closure path.

### Scan 5 — Editing artifacts

Same as the audit skill — grep for "Actually,", "Re-graded", "On reflection", "Wait —", "Reconsidering". Rewrite any affected section.

### Scan 6 — Default-qualifier repetition

Grep the draft for "recommended default", "adjust if", "override with", and similar hedging phrases. Count occurrences.

- If the same qualifier appears **more than once** for the same defaulted value (e.g., the 4-week return date appears 3+ times and each occurrence carries the "adjust if..." phrasing), collapse to one mention.
- The first mention carries the qualifier (footnote or inline parenthetical). Every subsequent mention uses the value assertively — no qualifier, no hedge.
- See the "Repetition rule" under "How to render defaults" for the full pattern.

### If any scan finds something

Fix it before writing the file.

---

After all scans pass, emit the calibration one-liner and then the full proposal.

## Ambiguity handling

| Dimension           | Ambiguous →                                                        |
| ------------------- | ------------------------------------------------------------------ |
| Team size           | "Team size not provided — cannot compute headcount × sprint"       |
| Velocity            | Default 50% focus-time with explicit caveat; flag Section 10       |
| Compliance deadline | "Q3 per user's note" — keep bounded; don't commit without velocity |
| Unaudited surface   | "Unknown" — never extrapolate issue count                          |
| Design-decision ETA | "Unknown until owner engaged" — name the unblocking action         |

Never fabricate. When you don't know, say so in the output, don't guess silently.

## Recommended defaults rule

Where the proposal needs a date, period, or numeric field that a reader would reasonably need filled in to use the document (e.g., "we will return with a commit-or-defer answer by [date]"), emit a recommended default as clean, readable prose — NOT as template syntax visible to the reader.

### How to render defaults

**Wrong** (template syntax visible to the reader):

> We will return by [default: today + 4 weeks (2026-05-15); override with user-supplied internal target date].

This makes the document un-shippable. The leader will not circulate a doc containing `[default: ...; override...]` brackets — they read as unresolved template syntax.

**Right** (default as clean prose with a footnoted override note):

> We will return by **2026-05-15**.¹
>
> ¹ Recommended default (four weeks from today). Adjust if the team has committed to a different internal target.

OR (inline, compact — only for a single occurrence):

> We will return by **2026-05-15** (recommended: four weeks out — adjust if the team has a different internal target).

### Repetition rule — establish once, then use assertively

A defaulted value (date, cadence, headcount) appears in the proposal multiple times — in the Executive Summary, in Section 7 decision deadlines, in Section 8 customer framing, in Section 9 scenarios. Establish the "this is a default, adjust if..." qualifier **exactly once** — at the first mention, via a footnote or parenthetical. Every subsequent reference uses the value assertively, with no qualifier.

**Wrong** (hedging phrase repeated at every occurrence — reads as indecision):

> Executive Summary: "We will return by **2026-05-15** (recommended default; adjust if leadership has a different internal target)."
>
> Section 7: "Decision deadline: **2026-05-15** (recommended default; adjust if leadership has a different internal target)."
>
> Section 8: "We will return to the customer by **2026-05-15** (recommended default; adjust if leadership has a different internal target)."

Six repetitions of the same escape-hatch phrasing make the document read like the author cannot pick a date. Readers lose confidence that anything is committed.

**Right** (qualifier attached once; subsequent mentions are assertive):

> Executive Summary: "We will return by **2026-05-15**.¹"
>
> Section 7: "Decision deadline: **2026-05-15**."
>
> Section 8: "We will return to the customer by **2026-05-15**."
>
> ¹ Recommended default (four weeks from today, 2026-04-17). Adjust if the team has committed to a different internal target date.

Or, if footnotes are not used in the document style, attach the qualifier to the first mention inline, then strip it everywhere else.

This rule applies to any value that is both (a) a default (not user-supplied) and (b) referenced more than once. Pick the first mention (usually Executive Summary or Section 1), qualify there, and nowhere else.

### When to use a default

Defaults are used for:

- Internal commit-or-defer return dates (default: today + 4 weeks).
- Sprint boundaries (default: team's usual cadence, if user provided it).
- Reasonable review cadences (default: weekly status).
- Internal meeting dates for decision-forwarding (default: schedule within 1 week).

### When NOT to use a default

Defaults are NOT used for:

- Numbers that depend on team velocity (no team context = no default).
- Owner names (never default a person to a role; always require input).
- Contract/legal commitments (never default; always require user confirmation).
- WCAG pass/fail claims beyond audited scope (never default; always refuse).

### Rule: no template-syntax placeholders in the final deliverable

Before finalizing, grep the draft for these patterns and resolve each one into clean prose:

- `[default: ...; override with ...]`
- `[requires input: ...]` in any user-facing field (headline, customer section, executive summary)
- `{placeholder}` or `<placeholder>` syntax of any kind

When a reader needs to know something is a default, use a footnote or a parenthetical note — never template-bracket syntax. When a field genuinely cannot be filled without user input AND has no reasonable default (e.g., owner names, contract clauses), emit "[not yet provided — see Section 10 for the input needed]" and list it in Section 10 with a closure path. That phrasing is readable; `[requires input]` alone is not.

Section 10 (Explicit Gaps) is the right place for unresolved inputs. Bracket notation inline in the body is not.

Defaults are NOT used for:

- Numbers that depend on team velocity (no team context = no default).
- Owner names (never default a person to a role; always require input).
- Contract/legal commitments (never default; always require user confirmation).
- WCAG pass/fail claims beyond audited scope (never default; always refuse).

Defaults ARE used for:

- Internal commit-or-defer return dates (default: 4 weeks out).
- Sprint boundaries (default: team's usual cadence, if user provided it).
- Reasonable review cadences (default: weekly status).
- Internal meeting dates for decision-forwarding (default: schedule within 1 week).

When emitting a default, name it as a default explicitly so the reader knows to accept-or-override.

## Hand-off from `/a11y-audit`

This skill expects audit outputs with the structure produced by `/a11y-audit` (Layer 1 Summary with scope boundary, plain-English status, fix confidence breakdown, WCAG criteria affected, issue groups, safely-shippable-now + design-blocked tables; Layer 2 issue table; Layer 3 detailed findings with Design Decision blocks).

If the audit is missing structured sections (e.g., produced by a predecessor tool), the proposal's extraction may be incomplete. Flag what's missing in Section 10.
