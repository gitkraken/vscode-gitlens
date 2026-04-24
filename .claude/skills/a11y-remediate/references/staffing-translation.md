# Staffing Translation — Engineer-Days to a Team's Real Calendar

**Why this file exists:** the audit emits `S/M/L` per issue and a summed range of engineer-days. That's a planning signal, not a staffing ask. A leader can't take "3.5–13 engineer-days" into a VP meeting. This file translates engineer-days into terms the leader can actually commit to — _when the user has provided team-velocity context_.

**Hard rule:** if the user has NOT provided team size, velocity, and cadence, the skill refuses to emit calendar or sprint numbers. Say so plainly. Do not fabricate.

---

## What the skill needs from the user

Before emitting any staffing estimate, the skill must have:

| Input                    | Example                                                | If missing                                            |
| ------------------------ | ------------------------------------------------------ | ----------------------------------------------------- |
| **Team size**            | "3 engineers on the graph team"                        | Skill cannot give headcount x calendar                |
| **Focus-time fraction**  | "~60% focus time, rest on meetings/reviews/interrupts" | Skill defaults to 50% with explicit caveat            |
| **Sprint cadence**       | "2-week sprints, Tuesdays to Tuesdays"                 | Skill can emit engineer-days but not sprints          |
| **PR review cycle**      | "~2 days from open to merge"                           | Skill can emit eng-days but not total calendar        |
| **Existing commitments** | "team is 70% allocated to feature X through Q2"        | Skill refuses to claim availability; reader subtracts |

If any item is "not provided," the corresponding output field is emitted as `[not provided — cannot calculate]`, NOT as a guessed number.

---

## The translation formula (when context is available)

Given an audit's engineer-day estimate of `D` days and team focus-time fraction `F` (0 < F ≤ 1):

- **Calendar engineer-days** = `D / F` (a 0.5-day task at 60% focus = ~0.83 calendar days)
- **Calendar by one engineer** = `D / F` days, sequential
- **Parallel by N engineers** = `(D / F) / N` days, **if and only if the work can be parallelized** (see below)

### Parallelization rules

- **Safely Shippable Now items can be parallelized across engineers.** Each PR is independent.
- **Issue Group items cannot be parallelized.** The whole group lands as one PR.
- **Design-blocked items cannot be parallelized across engineers.** They are waiting on one decision; adding engineers doesn't help.
- **Coordination cost rises with engineers.** Three engineers on a 10-eng-day project usually takes >3.3 calendar days because of PR review queuing, merge conflicts on shared files, and context-switching.

### Convert to sprints

Given sprint length `S` working days (usually 10 for 2-week sprints) and a calendar-day estimate `C`:

- `Sprints needed = ceil(C / S)`
- Round up aggressively. "0.4 sprints" = "1 sprint with other work packed in." Never tell a leader "this will take half a sprint" — they'll book it for half.

---

## Output formats to use

Pick the most constrained one the user's input supports. Never emit a more confident format than the input allows.

### Format A — Full staffing ask (user provided all inputs)

> **Sprints needed:** 1 sprint for safely-shippable items (parallelizable across 2 engineers); 1 additional sprint for Issue Group A after the design decision lands.
>
> **Staffing ask:** 2 engineers × 1 sprint for now-shippable work; +1 engineer × 1 sprint for the design-blocked group once unblocked.
>
> **Caveats:** Assumes 60% focus time, 2-day PR review cycle, no surprise regressions. Design-blocked items do not progress without the blocking decision.

### Format B — Engineer-days, no sprint conversion (cadence not provided)

> **Engineer-days required:** 3.5–13 days across 8 issues (single engineer, sequential).
>
> **With parallelization:** Safely-shippable items (2.5–6 eng-days) can be split across 2 engineers for ~1.5–3 calendar days; Issue Group items must land as one PR.
>
> **Caveats:** Sprint conversion not provided — the skill has no cadence input.

### Format C — Engineer-days only (no team context at all)

> **Engineer-days required:** 3.5–13 days (single engineer, sequential, focused time).
>
> **Staffing translation not provided.** The skill does not have team size, velocity, or cadence input. If the reader wants a headcount/sprint ask, they must supply these and re-invoke.

---

## What NOT to claim

- **Never convert engineer-days to calendar weeks without a velocity figure.** A 5-day task is not "a week" without focus-time context.
- **Never sum across parallelizable AND non-parallelizable work into one number.** Keep them separate.
- **Never claim an engineer can context-switch between this work and another project.** If the team has existing commitments, reduce available capacity accordingly or flag that you can't.
- **Never say "Q3 is achievable" without at least: sprint count needed + team availability through Q3 + design-decision ETAs.** One of these missing → cannot commit.

## Cross-audit sizing-format asymmetry

When rolling up two or more audits, each audit's sizing appears in the format that audit emits — either a numeric engineer-day range (e.g., `DraggableGraphHeader.tsx`: 1.5–5 engineer-days) or `N/A` (e.g., `ScrollbarContainer.tsx`: N/A because Options span an order of magnitude). These formats are not interchangeable.

- **Cite each audit's sizing in the audit's own format.** Do not re-express a numeric range as N/A or coerce N/A into a number.
- **Never sum across incompatible sizing formats.** A Phase-2 total computed from `(1.5–5) + N/A` is fabricated; refuse it. Keep the ranges per-audit and state the N/A explicitly.
- **When producing a single sprint count or aggregate number**, state which audits contributed numerics and which are N/A, and bound the number to the numeric-contributing audits only. Example: `Phase 2 sprint count cannot be calculated: DraggableGraphHeader contributed 1.5–5 engineer-days; ScrollbarContainer is N/A pre-decision. An aggregate cannot be emitted until ScrollbarContainer's design decision narrows its Options.`

---

## Handling multi-product coordination costs

When an audit covers a shared library consumed by multiple products (e.g., `@gitkraken/gitkraken-components` used by `vscode-gitlens` and the desktop app):

- Every fix incurs coordination cost in each consuming product's regression testing.
- Add an overhead budget per consumer: rough guide is +20–40% engineer-days per additional consumer, depending on consumer's CI/testing depth.
- If the skill does not know the consumers, tag the fix as requiring additional coordination and note that the estimate does not include downstream product verification.

Example caveat to emit:

> The component audited ships in `@gitkraken/gitkraken-components` (consumed by `vscode-gitlens` and the GitKraken desktop app). The engineer-day estimate above is library-side work only. Downstream regression testing in consumer products adds approximately 20–40% per consumer and is owned by those product teams.
