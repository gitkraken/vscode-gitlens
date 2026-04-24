# Compliance Rollup — WCAG State Across Multiple Audits

**Why this file exists:** leaders asked to commit to "WCAG 2.1 AA for the graph by Q3" need to know whether that commitment is realistic given the current audit coverage. File-level audits tell us whether an individual file fails; they do not, by themselves, tell us whether a product or surface is compliant. This file governs how the proposal aggregates file-level audit state into a claim (or, more often, a non-claim) about broader scope.

**Hard rule:** the proposal cannot claim compliance at a scope broader than the audited files. If the user asks "is the graph compliant?" and only the header file has been audited, the honest answer is "we don't know yet."

---

## The three honest statements the proposal can make

### Statement 1 — Per-file compliance after fixes (confident)

"File `X.tsx`, as audited, is not currently WCAG 2.1 AA compliant for these criteria: [list]. After the [N] fixes in the audit are implemented, these criteria would be addressed at the file level, subject to runtime verification of [list of runtime-tooling items]."

This statement is safe when:

- The file has been audited by `/a11y-audit`.
- The audit's "WCAG criteria affected" section listed criteria.
- The runtime verification items have been called out.

### Statement 2 — Cross-audit rollup (when multiple audits exist)

"Across the [N] files audited ([list]): [M] WCAG criteria currently fail, totaling [K] distinct failures. After proposed fixes across all audits land, [J] criteria would be addressed. [L] items remain runtime-dependent and require tooling verification."

This statement is safe when:

- Multiple audits have been consumed.
- The proposal has actually aggregated each audit's "WCAG criteria affected" sections.
- The statement is bounded to "the files audited," not broader scope.

### Statement 3 — Uncovered-scope hedge (always include)

"Files not included in any audit: [list or count, or 'unknown without further audits']. The statements above do not apply to these files."

This statement MUST accompany Statements 1 and 2 whenever there is unaudited surface.

---

## What the proposal CANNOT claim

### Never roll up to a scope larger than audited

❌ "The graph is WCAG 2.1 AA compliant after these fixes." (when only 1 of N files has been audited)
✅ "The graph's column header file is compliant for the listed criteria after fixes; the rest of the graph is unaudited."

### Never aggregate pass/fail across criteria the audit couldn't verify

❌ "After fixes, we pass 1.4.3, 1.4.11, 2.4.7." (if these are runtime-only criteria the audit flagged as "NOT covered")
✅ "After fixes, the criteria addressable at the code level are resolved. Runtime-dependent criteria (1.4.3 Contrast, 1.4.11 Non-text Contrast, 2.4.7 Focus Visible) require separate verification."

### Never extrapolate from sample to whole

❌ "Based on one file with 8 issues, the full graph likely has ~80 issues across 10 files."
✅ "Per-file issue counts vary significantly; the skill cannot extrapolate."

---

## The compliance scorecard template

When rolling up, emit this structure:

```
### WCAG 2.1 AA Criteria State — Audited Scope

**Audits in scope:** [list files]

**Criteria failing today (audited scope only):**
| Criterion | Plain-English impact | Audits reporting failure | # Issues |
|---|---|---|---|
| [1.1.1] | [blurb from wcag-criteria.md] | [audit files] | [N] |
| ... | | | |

**Criteria resolvable by proposed fixes (code level):**
[Same table, restricted to criteria where every failing issue has a High or Medium Fix Confidence fix proposed — not Low/design-blocked.]

**Criteria that remain failing until design decisions resolve:**
[List criteria where at least one failing issue is design-blocked.]

**Criteria requiring runtime verification (not answered by code audit):**
[List, with pointer to each audit's "Items Requiring Runtime Tooling" section.]

**Scope not covered:**
[Files or surfaces not included in any audit, explicit list or explicit "unknown".]
```

---

## How to phrase "compliance" in internal-stakeholder (VP/PM) language

Rather than "is X compliant?" the right framing is:

1. **What fails today?** (Statement 1/2 above)
2. **What would fixes resolve?** (scoped to audited files)
3. **What remains to verify?** (runtime tooling items)
4. **What hasn't been audited?** (unaudited surface)

Answering these four questions is the compliance rollup. There is no single yes/no answer to "compliant?" for anything broader than an audited file, and the proposal says so.

---

## When the user has a compliance target (contract, legal)

If the user specifies a target like "WCAG 2.1 AA for the graph by Q3 per government contract clause X":

1. State the target faithfully.
2. Apply the scorecard above to the AUDITED scope only.
3. Identify the gap between audited scope and target scope.
4. Emit a "to close the gap" list: [remaining audits to run + N design decisions to resolve + runtime-tooling verification to perform].
5. Provide a go/no-go timeline ONLY if the user has provided team capacity and estimated audit throughput. Otherwise say "timeline to complete the gap requires capacity input."

### Example — contract target, insufficient coverage

> **Contract target:** WCAG 2.1 AA for the graph by Q3.
>
> **What the audits currently tell us:** The graph column-header file fails 2.1.1, 4.1.2, 1.1.1, 4.1.1. Proposed fixes would resolve 4.1.2, 4.1.1, and 1.1.1 at the code level; 2.1.1 has design-blocked items that cannot resolve until a library-maintainer decision.
>
> **Gap between current audit coverage and contract target:** [N] files remain unaudited ([list]). The graph body, reference zone, scroll controls, and popover contents are not covered.
>
> **To close the gap:**
>
> 1. Commission audits of [remaining files].
> 2. Resolve [N] design decisions currently blocking fixes.
> 3. Verify runtime-dependent criteria (1.4.3, 1.4.11, 2.4.7) across all fixed files.
>
> **Q3 go/no-go:** Requires capacity input. The audit is a static analysis skill; calendar-time commitments depend on team velocity, design-decision ETA, and parallel workload — none of which are available here.
