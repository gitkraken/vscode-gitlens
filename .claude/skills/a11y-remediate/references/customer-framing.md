# Customer-Framing — Bounded, Honest, No-Jargon

**Why this file exists:** leaders facing enterprise or government customer accountability need pre-written status and commitment language they can paste into emails, release notes, or contractual updates. Audit findings are evidence for this language — they are not the language itself. This file governs how the remediation proposal produces customer-facing copy without overselling, underselling, or fabricating certainty.

**Hard rule:** every customer-facing sentence must be bounded by what the audits actually cover. The proposal cannot claim product-wide status from file-level audits.

---

## Three templates, picked based on current state

### Template 1 — "We have a partial audit and known work"

**When to use:** some audits exist, some part of the surface is unaudited, and safely-shippable fixes are available.

> To date we have audited [N] files in [product/feature]. In those files we identified [plain-English description of what's broken] — for example, [one concrete user scenario]. We have [N] fixes safely shippable now and will land them in [sprint/quarter]; [M] additional issues require a design decision from [role/team] before they can be scoped. [Remaining surface] has not yet been audited; we will audit and report on those in [timeframe if known, or "as a follow-up"].

Concrete example (using our test audit):

> To date we have audited one file in the graph column header. In that file we found that keyboard-only users cannot operate the hide-refs, filter, or column-settings buttons, and that the hidden-refs menu items cannot be activated with the keyboard. We have two fixes safely shippable now (loading status announcement, region role on changes column) and will land them in the next sprint; six additional issues require a design decision from the shared component library maintainer before they can be scoped. The rest of the graph surface (commit rows, reference zone, scroll controls) has not yet been audited; we will scope those audits in the next two weeks.

### Template 2 — "We are not yet able to make a Q3 commitment"

**When to use:** the customer has asked about a specific compliance milestone and the audit coverage is not sufficient to commit.

> Our current audit covers [scope]. A commitment to [compliance target] by [date] requires audits of [remaining surface], plus resolution of [N] design decisions currently blocking fixes. We are prioritizing these two gaps. We will have a defensible commit-or-defer answer by [specific date the team can hit — user must provide].

### Template 3 — "We have a clean pass on the audited scope"

**When to use:** rarely. Only when the audit reports no confirmed issues AND runtime-tooling items have been separately verified.

> We have audited [scope] against WCAG 2.1 AA. The audited scope shows no confirmed non-compliance. [Remaining surface] has not yet been audited. This statement applies to [scope only] and does not make a broader product claim.

---

## What customer-facing copy MUST NOT do

### Never claim product-wide compliance from file-level audits

❌ "The graph is WCAG 2.1 AA compliant." (from a 1-file audit)
✅ "The audited file is WCAG 2.1 AA compliant. The rest of the graph has not yet been audited."

### Never commit to a date without velocity + scope confidence

❌ "We will be fully compliant by Q3." (no velocity data, scope still unknown)
✅ "We will have a defensible commit-or-defer answer on Q3 by {specific date user has committed to}."

### Never use ARIA/WCAG jargon

❌ "2.1.1 Keyboard violations in the `role="menu"` implementation."
✅ "Keyboard-only users cannot activate items in the hidden-refs menu."

### Never predict what external auditors or tools will say

❌ "We expect axe DevTools to report a clean audit after these fixes."
✅ "After these fixes land, we will re-run axe DevTools and verify."

### Never imply scope-of-audit-not-performed

❌ "Our accessibility audit found 10 issues." (implies full audit)
✅ "Our audit of [specific files] found 10 issues. [Remaining] is pending."

---

## When the customer's ask exceeds the audit's scope

Sometimes a customer has contractual language about whole-product compliance. An audit of one file cannot satisfy this. The proposal's customer-facing section must:

1. Acknowledge the ask.
2. State what we CAN say today (bounded by audit scope).
3. Name the specific gap between what we can say and what the contract requires.
4. Propose the next concrete step that closes that gap (usually: a broader audit + a design-decision resolution plan).
5. Give a date when we'll have a complete answer — **only if the user provides a realistic internal commitment. Otherwise say "date TBD pending internal capacity review."**

Example:

> Your contract specifies WCAG 2.1 AA compliance for the graph by Q3. Based on our current one-file audit, we can tell you that the column header will be compliant in those specific criteria after our next sprint. We have not yet audited the remaining surface of the graph, so we cannot yet commit to a graph-wide Q3 date. Our plan to close that gap: finish auditing [remaining files] by [date], resolve [N] design decisions, and return to you with a full commit-or-defer answer by [date]. If Q3 proves infeasible, we will surface that no later than [date] so you can plan accordingly.

---

## Internal stakeholder language (PM, VP)

Different from customer-facing. Use these templates when the reader is internal.

### PM: "what's shippable"

> **Shippable this sprint:** [list by issue number and description]. Each is an independent PR; total estimated effort [eng-days from staffing-translation.md].
>
> **Blocked on design decisions:** [list of issues + blocking decision + typical owner]. PM action: help schedule those decisions with [roles].
>
> **Not yet scoped:** [unaudited surface]. PM action: decide whether to commission those audits in parallel with current remediation work.

### VP: "where we are and where we're going"

> **Current status:** [plain-English status sentence, same as customer-facing but internal-framed].
>
> **Confidence on [compliance date]:** [high / medium / low / cannot yet commit]. Reason: [one sentence].
>
> **What I need from you:** [specific asks — e.g., "prioritization of the library-maintainer decision on button-reset strategy", "approval to staff 2 engineers for 2 sprints", "agreement to push [other work] to Q4"].

---

## The rule about emitting internal-provided names

If the user has provided design-decision owners by name (not just roles), the proposal CAN reference them internally (PM/VP facing). It must NOT reference them in customer-facing copy unless the user explicitly authorizes customer-facing names.

If the user has NOT provided names, the proposal uses roles only ("shared component library maintainer," "product designer") and includes a note: "Owner identification requires input from the proposal requester."

---

## REQUIRED customer-facing content beyond the status template

The templates above describe what's broken and when it will be fixed. They are INSUFFICIENT for a real customer call — customers also want to know what works today, what to do in the meantime, and whether we have a formal accessibility statement. The customer-facing section of the proposal MUST address each of the six items below.

### Required item 1 — "What works today" paragraph

Customer calls that focus only on what's broken make the company look like it hasn't started. The proposal must include a paragraph describing what IS accessible in the audited scope (or honestly state if nothing is).

Sources:

- Audit output's `Safely Shippable Now` table — these are known, minor issues; the rest of the audited file is presumed functioning unless the audit identified otherwise.
- Audit's `Notable Clean Implementations` section if present.
- Explicit absence: "outside the audited scope, accessibility state is not yet assessed."

Template:

> **What works in the audited scope today:** [One sentence naming the accessible surfaces — e.g., "Basic text content is readable by screen readers; the visual focus indicator is present on Tab navigation; commit SHAs and author names are exposed as plain text."] The specific failures we've identified are in [X controls] — the rest of the audited file does not exhibit additional known issues.

If the audit identified broad failures (e.g., "whole component unreachable by keyboard"), the honest statement is:

> In the audited scope, the identified issues block the primary interaction path. We cannot cite individual components as "working today" within this scope; remediation is required to reach a functional baseline.

### Required item 2 — Interim workarounds for affected users

Customers will ask "what should our users do right now?" The proposal must name any alternative paths.

Sources:

- Product knowledge (user must provide — the skill cannot know product affordances).
- Common fallbacks: command palette, CLI, keyboard shortcuts to bypass the broken control.

Template:

> **Interim workarounds while fixes ship:** [Per issue or per affected workflow — e.g., "Keyboard users can reach the same functionality via [command palette / keyboard shortcut / alternate menu]. Screen-reader users can [alternate navigation path]."]

If NO workarounds are known:

> **Interim workarounds:** Not currently documented. [Requires input: product-team confirmation of alternative paths for affected workflows. Default recommendation: engage PM to draft workarounds before the customer call.]

### Required item 3 — VPAT / ACR awareness

Government and enterprise customers frequently request a VPAT (Voluntary Product Accessibility Template) or ACR (Accessibility Conformance Report). The proposal must state whether one exists, whether it should be updated, and what the audit's findings imply for it.

Template:

> **VPAT / ACR status:** [If user has provided: "Current VPAT last updated [date]. This audit's findings affect criteria [list]. Recommended: update VPAT to reflect current state AND the remediation roadmap before the customer call." If user has not provided: "Requires input: current VPAT status unknown to this proposal. Default recommendation: check with product/legal for the most recent VPAT; confirm whether to update it before the customer call."]

### Required item 4 — Good-faith-effort / remediation-period framing

Most contracts with WCAG requirements accept a roadmap of known issues + active remediation as compliant-in-good-faith, rather than demanding zero open issues on the compliance date. The proposal should frame progress that way when possible.

Template for the customer section:

> **Good-faith remediation stance:** We are actively remediating identified issues, shipping [N] fixes in the next sprint and coordinating design decisions on [N] architectural items. We will provide updates at [cadence] through [target date]. This roadmap is intended to satisfy the contract's good-faith-effort expectation; we will surface any concern about that interpretation immediately if it arises.

This reframes "we're not compliant" as "we have an active, transparent remediation plan" — which is usually the contract's actual bar.

### Required item 5 — Positive reframe of design decisions

Raw "blocked on design decision" reads to a customer as "we haven't figured it out yet." The customer-facing version should reframe as an investment in getting it right.

Translation rules:

- ❌ "Blocked on shared-library design decision."
- ✅ "We're coordinating an architectural change to ensure the fix holds consistently across both [products]; this adds short-term latency but avoids shipping a fix that would fragment the experience."

- ❌ "5 of 8 P0s are design-blocked."
- ✅ "5 of 8 critical fixes require a small cross-team architectural decision before implementation, which we're scheduling now."

The engineering-facing Section 7 (Critical Path) stays honest with "blocked" language. The customer-facing Section 8 reframes without distorting — never claim the decision is "made" when it isn't.

### Required item 6 — Curated public gap list (NOT Section 10 in full)

Section 10 of the proposal enumerates every input the internal team needs to close. That list is correct but brutal for customer-facing use — it reads as "we don't know anything yet." The customer section needs a curated, honest version.

Rules for curation:

- Keep: gaps the customer might learn about anyway (unaudited surface, pending design decisions, upcoming commit date).
- Compress: engineering-internal gaps (velocity input, owner names, PR cycle) into a single "we are finalizing internal scheduling" line.
- Never: pretend there are no unknowns.

Template:

> **What we're still working out (for transparency):** We are completing audits of [N] remaining files, resolving [N] architectural decisions, and finalizing our internal scheduling. We expect to return to you with a firm commit-or-defer answer by [default: today + 4 weeks OR user-provided internal target date].

---

## Using these items together — the customer-call narrative flow

A PM reading the customer section in order should be able to have a conversation in this shape:

1. **Open:** "What works today" (set a positive baseline — we haven't started from zero).
2. **Acknowledge the gap:** "What isn't working" (Template 1 / 2 content).
3. **Provide interim path:** "Here's what your users can do right now" (workarounds).
4. **Explain the plan:** "Here's what we're shipping when" (Section 6 sprint plan content).
5. **Address compliance formally:** "Here's our VPAT / good-faith stance" (VPAT item + remediation-period framing).
6. **Be honest about open questions:** "Here's what we're still working out" (curated gap list).
7. **Commit to a return date:** "We'll come back to you by [date]" with a specific next touchpoint.

If any of items 1-7 cannot be answered from the proposal, the customer section is incomplete — flag the gap explicitly.
