# Deferral Risk — What Happens If We Don't Fix This

**Why this file exists:** leaders deciding whether to staff a11y remediation now or defer need a defensible answer to "what do we risk by waiting?" A quarter's delay has different costs depending on the customer, the contract, the user base, and the severity of the audit findings. This file governs how the proposal articulates deferral risk without exaggeration or minimization.

**Hard rule:** the proposal splits deferral risk into two categories that lead to different conversations — **user-harm risk** and **contract / legal / commercial risk**. Leaders have different action paths for each.

---

## The two categories

### User-harm risk

What breaks for real users if we ship as-is? This framing is internal (engineering, design, PM) and drives the moral / product case for fixing.

Sources of signal in the audit output:

- P0 issues — someone cannot complete a core workflow.
- Plain-English status — what real users experience.
- Per-P0 reproduction recipes — concrete failure scenarios.
- Issue groups tagged "shipping partial makes it worse" — the current state may actually be better than a naive partial fix.

The proposal's user-harm framing should:

- Name who is affected (keyboard-only users, screen-reader users, low-vision users, color-blind users — whichever is implicated).
- Name what they cannot do (specific workflows from the audit).
- Estimate _scope of impact_ where known (e.g., "this affects anyone who uses keyboard navigation — a small percentage of total users but 100% of a population who depends on AT").

**Never inflate.** If the audit says one file's column header has keyboard issues, the user-harm framing is "keyboard users cannot operate this header" — not "keyboard users cannot use the product."

### Contract / legal / commercial risk

What breaks for the business if we ship as-is? This framing is external (customer, legal, sales, compliance) and drives the commercial case for fixing.

Sources of signal:

- **User-provided context.** The proposal cannot know contract clauses, compliance obligations, or customer commitments unless the user supplies them.
- The audit's WCAG criteria affected — which criteria fail today.

The proposal's contract/legal framing should:

- Use the target the user named (e.g., "government contract requires WCAG 2.1 AA by Q3").
- Describe the gap the audit shows between current state and target.
- Describe what happens if the gap isn't closed by the deadline (specifically: what the user has told us the consequence is — not guesses).

**Never fabricate legal consequences.** If the user has not told us the contract language, the proposal cannot claim breach risk. Use language like "if the user has commitments tied to WCAG 2.1 AA compliance, the gap above is relevant; those commitments should be surfaced to this proposal for a full risk assessment."

---

## The deferral-cost template

Use this structure in the proposal:

```
### Risk of deferral

**User-harm risk (what breaks for users today, unfixed):**

The audit identifies [N] blockers affecting:
- [Affected user group 1]: [what they cannot do — quoted from audit plain-English status]
- [Affected user group 2]: [...]

Every day this ships as-is, [these users] [experience this failure] in [these workflows].

**Contract / legal / commercial risk (what breaks for the business):**

[If the user has provided compliance context:]
- Target: [compliance target, deadline, source — e.g., "government contract clause X, Q3 deadline"]
- Current audit coverage: [scope]
- Gap: [unaudited surface + unresolved design decisions + design-blocked P0s]
- If we defer and the gap is not closed by [deadline]: [consequence stated by the user]

[If the user has not provided compliance context:]
- The proposal does not have compliance-target input. If there are customer, contract, or legal obligations tied to WCAG 2.1 AA, they should be surfaced to this proposal for a full risk assessment.

**What changes if we defer by [specified period]:**
- User-harm risk: [unchanged — users continue to experience the failures above]
- Commercial risk: [escalates / remains / unknown] depending on deadline proximity and the above context.
- Engineering risk: codebase evolves — further audits may find more issues; affected files may be touched by other work, requiring rework.
- Scope risk: if audits of remaining surface are not running in parallel, the total scope estimate keeps growing.
```

---

## Deferral scenarios to analyze explicitly

The proposal should cover at least three scenarios when asked to support a deferral decision:

1. **Ship now** (all safely-shippable items next sprint). Describe what improves, what remains, and what it does NOT do (design-blocked items still blocked).
2. **Defer one quarter** (no work on this until Q+1). Describe user-harm accrual, audit-scope risk, and any commercial consequences the user has specified.
3. **Partial defer** (ship safely-shippable now, defer design decisions to Q+1). Describe the in-between state — is it better than the current state? Sometimes yes, sometimes no (see Issue Groups warning).

Let the reader pick. Do NOT recommend — recommendation is a leadership call informed by context the skill doesn't have.

---

## When the audit output suggests "partial ship is worse than no ship"

The audit's Issue Groups flag scenarios where shipping only part of a set of fixes leaves the product in a worse state (e.g., an empty `role="menu"` that screen readers announce as broken). The deferral analysis MUST surface this:

> **Warning:** the audit identifies [N] issue groups that must ship together. Shipping safely-shippable items ALONE would not alter the state of these groups — they remain failing exactly as today. Shipping safely-shippable items TOGETHER with partial fixes to a group would make the user experience worse than today. The "Partial defer" scenario above avoids this by leaving the groups alone.

This is the difference between a well-designed partial-defer and a naive one.

---

## What NOT to write

- **No "users will sue" predictions** unless the user has provided a specific threat.
- **No "our competitors will win deals" unless the user has surfaced commercial context.**
- **No moralizing.** The proposal is an artifact, not a manifesto. State facts; let leaders decide.
- **No "you should absolutely prioritize this."** The skill doesn't know the full backlog. Prioritization is a leadership call.

---

## The honest bottom-line sentence

When a leader has to defend a deferral decision, they need one bottom-line sentence for their VP. Help them construct it. Template:

> "Deferring a11y remediation on [scope] by [period] means [N] users continue to experience [concrete failure] in [workflow]; [commercial consequence if any], and our audit-coverage gap [stays / grows]. The pro of deferral is [the work we'd do instead, which is the user's call]."

If the user cannot fill in "the work we'd do instead," they do not have a credible deferral argument.
