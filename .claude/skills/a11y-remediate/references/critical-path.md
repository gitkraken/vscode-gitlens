# Critical Path — Design Decisions as Serial Blockers

**Why this file exists:** a remediation proposal that lists "5 P0s blocked on design decisions" without identifying what those decisions are, who makes them, and how to unblock them, leaves the leader with no action. The leader doesn't need to _make_ the decisions; they need to _schedule_ them. This file governs how the proposal surfaces the critical path: the specific decisions that gate the entire Q3 timeline.

**Hard rule:** the proposal cannot invent owners. Role names only, unless the user has provided a person-by-name mapping. The proposal cannot invent ETAs for decisions — those come from the decision owners themselves.

---

## What a critical path looks like for remediation

A remediation plan has two kinds of work:

1. **Implementation work** — engineering effort on a fix that's ready to code. Trackable by engineer-days, parallelizable across engineers, estimated via `staffing-translation.md`.

2. **Decision work** — design, product, or organizational calls that must be made before implementation can begin. Not parallelizable across people (one decision, one owner), often not time-predictable.

The **critical path** is the ordered chain of decision work that gates the implementation work. If any decision in the chain slips, the whole timeline slips. A remediation commitment (e.g., "Q3") is defensible only if every decision on the critical path has an owner and an ETA.

---

## How to extract the critical path from audit output

From each audit's `Design-blocked` table and `Issue Groups`, collect:

- **Every "Decision required" entry** from Low-confidence fixes.
- **Every Issue Group that includes a Design-blocked item** (the group cannot ship until the decision resolves).
- **Every typical owner role** cited.

Then group them:

1. **Shared decisions** — when multiple audit issues wait on the same decision (e.g., "all four P0 button fixes wait on the library-maintainer decision about button-reset utility"), collapse to one decision with N dependencies.
2. **Sequential decisions** — when one decision's answer constrains another (e.g., "which ARIA pattern to use for nested popovers" must resolve before "the keyboard-handling model for menu items" can be decided).
3. **Independent decisions** — can be made in parallel.

---

## The critical path template

```
### Critical path

**Decision 1 (blocks [N] issues across [M] audits):**
- **What:** [The specific decision, quoted or summarized from the Design Decision blocks it unblocks.]
- **Typical owner:** [Role. Person name only if user provided.]
- **Input needed to decide:** [Aggregated from the Design Decision blocks — what information the owner needs.]
- **Issues blocked:** [List of issue numbers, grouped by audit file.]
- **ETA for decision:** [User-provided, OR "unknown — requires owner engagement"]
- **Implementation effort once unblocked:** [engineer-days range from those issues' Effort fields]
- **Downstream decisions this unblocks:** [List, or "none" if independent]

[Repeat per decision.]

**Summary:**
- [N] decisions on the critical path.
- [M] are independent; [K] are sequential.
- If ALL decisions close by [aggregated deadline if inputs allow], implementation of the dependent work can begin [date].
- If any decision's ETA is "unknown", the timeline cannot be committed.

**The leader's action:** schedule each decision's owner to make the call and assign an ETA. Decisions without ETAs are the gating risk for [target milestone].
```

---

## When a decision cluster is shared across audits

If the same button-reset utility decision blocks issues in `DraggableGraphHeader.tsx` AND (hypothetically) `DraggableGraphRow.tsx`, the proposal should:

- Surface the decision ONCE in the critical path.
- List all dependent issues under it.
- Estimate the implementation effort as the sum across all dependent issues.
- Note that the decision scope expands with more audits — if additional files need the same utility, their issue counts add to this decision's dependency list when audited.

---

## When an audit reveals an unblock

Sometimes the audit has already done the design-decision legwork via Rule 9 wrapper analysis. For example:

> Issue #2's fix: `<span onClick>` → `<button>` inside `<OverlayTrigger>`. Per the audit's Rule 9 analysis (citing `Icon.tsx:59`), `Icon` wraps its child in a non-interactive `<span>` and forwards `aria-*` props — the swap does not create nested-interactive elements.

This is NOT a design decision on the critical path. It's resolved. The proposal should list it as "no blocker" and proceed to implementation sizing.

---

## How to present decisions to the leader

The leader's next action is almost always:

1. Identify the owner (check with team lead if not already known).
2. Forward the decision with the "Input needed" list attached.
3. Set an internal ETA for the decision.
4. Surface if the ETA slips.

The proposal should make these steps concrete by assembling a forwardable message for each decision. Template:

```markdown
---
**Subject:** Decision needed: [decision]

**Context:** An accessibility audit of [file(s)] identified [N] issues that cannot be remediated until this decision is made. These issues block [describe user impact in plain English].

**Decision:** [The specific question the owner needs to answer.]

**Options (from audit):**
- Option A — [name, tradeoff]
- Option B — [name, tradeoff]

**What we need from you:**
- Your call between the options, OR a third option with rationale.
- Any context about [specific input fields].

**Timeline:** we'd like a decision by [date] to keep [target milestone] on track.

**Audit references:** [links or file paths to the Design Decision blocks this aggregates].
---
```

This is optional — include it only if the user wants ready-to-send messaging.

---

## When the decision owner is outside the team

Library maintainers, design system leads, or product designers may report to different organizations. The proposal should:

- Flag that the decision is cross-team.
- Name the role in the other org.
- Note the coordination cost (lead time to get on someone else's calendar + time for them to decide).
- Recommend the leader engage their counterpart manager if the decision is more than "days" of latency.

Do NOT pretend a cross-team dependency is a team-internal one.

---

## The honest summary sentence

Every critical path section should end with:

> "[N] decisions gate [M] issues. Of those, [J] have owners and ETAs; [K] do not. Until all [N] have both, commitment to [target milestone] is not defensible."

If `K > 0`, the leader knows exactly what to do next: unblock those K decisions.
