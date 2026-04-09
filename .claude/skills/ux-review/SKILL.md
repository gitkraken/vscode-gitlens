---
name: ux-review
description: Use when reviewing a change set for user experience quality — traces user flows instead of code paths, validates that the implementation delivers the right experience against the goals doc's UX spec
---

# /ux-review - User Experience Review

Traces user flows end-to-end against the goals doc. Validates that the implementation delivers the right experience — not just that the code is correct, but that the user gets the outcome they expect in a way that feels right.

**Use `/deep-review` for code path correctness. Use `/ux-review` for user flow validation. Different lenses.**

## Usage

```
/ux-review [target] --scope .work/dev/{id}/
```

- **`--scope <path>`** (required): Path to the dev folder containing `goals.md`. The goals doc is not optional for UX review — without it, there's no authoritative description of intended user experience to review against. If no goals doc exists, **stop and tell the user** to run `/dev-scope` first or provide the UX intent inline.
- No argument: review staged changes (`git diff --cached`)
- `all`: all uncommitted changes
- `branch`: changes vs base branch (`git diff main...HEAD`)
- `pr`: current PR changes (`gh pr diff`)
- `commit:SHA`: specific commit

## When to Use /ux-review vs /deep-review

| Skill          | Traces     | Finds                                                        |
| -------------- | ---------- | ------------------------------------------------------------ |
| `/deep-review` | Code paths | Bugs, regressions, performance issues, design problems       |
| `/ux-review`   | User flows | Dead ends, missing feedback, discoverability gaps, UX breaks |

Use both together for user-facing changes: `/deep-review` catches code-level issues, `/ux-review` catches experience-level issues.

## When to Skip

Not every change needs a UX review. Skip when:

- The change is purely internal (refactor, performance optimization, test infrastructure) with no user-facing surface
- The change is a one-line bug fix where the UX impact is obvious and contained
- There is no goals.md and the user confirms the change has no UX dimension

When in doubt, run it — a quick "no UX findings" is cheap, a shipped UX bug is not.

## Step 1: Gather Context

1. **Read the goals doc** at `{scope}/goals.md` — focus on the **User Experience** and **Success Criteria** sections. These are the spec you're reviewing against.
2. **Get the diff** using the target argument (same as `/deep-review`):
   - No argument: `git diff --cached`
   - `all`: `git diff HEAD`
   - `branch`: `git diff main...HEAD`
   - `pr`: `gh pr diff`
   - `commit:SHA`: `git show SHA`
3. **Read all modified files in full** — not just the diff hunks. Understand surrounding context for user-facing behavior.

## Step 2: Identify User-Facing Changes

For each change in the diff, determine:

- **What surface it appears on**: editor, tree view, webview, quick pick, status bar, notification, command palette, context menu, terminal
- **What triggers it**: user action (click, command, keybinding), automatic (on file open, on repo change), event-driven (timer, external)
- **What the user sees**: before, during, and after the change takes effect

Filter out changes with no user-facing surface — note them as "no UX impact" and move on.

## Step 3: Trace User Flows

Unlike `/deep-review` which traces code paths from the diff, trace **user paths**:

1. **Start from the goals doc's UX section** — this is the spec. The review checks the diff against it.
2. **Walk each flow end-to-end** — starting from the trigger described in goals.md through to completion. Note every point where the implementation diverges from the described experience.
3. **Check what's NOT in the diff** — missing implementations are UX bugs. If goals.md describes an error state and the diff doesn't handle it, that's a finding.

## Step 4: Evaluate Against Seven Lenses

Not every lens applies to every change — skip lenses that don't apply and say so.

### 1. Flow Delivery

Does the implementation actually deliver the user flow described in `goals.md`?

- **Happy path**: Walk through the expected flow step by step. Does each step in the goals doc have a corresponding implementation? Are there gaps where the user would hit a dead end?
- **Error paths**: What does the user see when things go wrong? Is the error actionable ("couldn't find remote -- check your network connection") or opaque ("operation failed")? Does the error leave the user in a recoverable state?
- **Edge cases**: What happens with empty states, first-time use, missing data, concurrent operations, large inputs? Check the edge cases listed in goals.md -- are they handled?
- **Entry/exit**: Does the flow start from the right place (command palette, context menu, button, automatic trigger)? When it ends, does the user land somewhere sensible?

### 2. Feedback & Responsiveness

Does the UI communicate what's happening at every stage?

- **Loading states**: Operations that take time (git commands, API calls, file parsing) -- does the user see progress, a spinner, or at minimum that something is happening? Silence longer than ~200ms needs feedback.
- **Success confirmation**: When an action completes, does the user know it worked? Not every action needs a toast -- sometimes the UI updating is confirmation enough. But destructive or irreversible actions need explicit confirmation.
- **Failure communication**: When something fails, is the failure visible where the user is looking? A logged error the user never sees is not feedback.
- **State transitions**: When the UI changes state (loading -> loaded, editing -> saved, collapsed -> expanded), are transitions smooth or jarring?

### 3. Discoverability

Can users find and understand this feature?

- **Location**: Is the feature accessible from the right surface? (command palette, context menu, view action, editor gutter, status bar -- wherever the user would naturally look for it)
- **Naming**: Do command names, menu labels, and tooltips use language the user thinks in? Avoid internal jargon. A user searching the command palette should find this with the words they'd naturally type.
- **First encounter**: If this is a new feature, how does a user learn it exists? Is there a walkthrough step, a what's new entry, a contextual hint?
- **Affordances**: Do interactive elements look interactive? Do disabled elements explain why they're disabled (via tooltip or contextual message)?

### 4. Consistency

Does it feel like GitLens?

- **Interaction patterns**: Does this feature follow the same patterns as similar existing features? If GitLens already has a way to do something analogous, this should work the same way unless there's a clear reason not to.
- **Terminology**: Does it use the same words GitLens uses elsewhere for the same concepts? (e.g., "repository" vs "repo", "stash" vs "shelf")
- **Visual language**: Icons, tree item structures, webview layouts, quick pick formats -- do they match existing GitLens conventions?
- **Behavior expectations**: If the user has learned how one GitLens feature works, does that knowledge transfer to this one?

### 5. Workflow Integration

Does it fit into how people actually work in VS Code?

- **Flow preservation**: Does the feature keep the user in their flow, or does it yank them out of context? A modal dialog when a notification would do, or a full view switch when an inline indicator would suffice -- these are flow breaks.
- **Reversibility**: Can the user undo or back out? Destructive actions need confirmation. Multi-step flows need a way to go back or cancel.
- **Composability**: Does the feature work well alongside other VS Code features and other GitLens features? Does it conflict with common keybindings, monopolize panels, or break expected multi-repo behavior?
- **Interruption cost**: If the user is in the middle of something else (editing, reviewing, rebasing), does this feature interrupt them? Does it steal focus?

### 6. Information Design

Is the right information presented at the right time?

- **Progressive disclosure**: Does the UI show the essential information first and let the user drill into details? Or does it dump everything at once?
- **Information hierarchy**: Is the most important information the most visually prominent? In tree views, hover details, webview panels -- does the eye go to what matters?
- **Density**: Is the information density appropriate for the context? Tree views should be scannable. Detail panels can be richer. Quick picks should be concise.
- **Empty states**: When there's no data to show, does the user see a helpful message, or a blank void? Empty states are opportunities to guide ("No stashes yet -- use `git stash` to save work in progress").

### 7. Accessibility

Can all users use this feature effectively?

- **Keyboard**: Can every interaction be performed via keyboard? Tab order logical? Custom interactive elements have keyboard handlers?
- **Screen reader**: Do elements have appropriate ARIA labels, roles, and states? Do dynamic updates use live regions?
- **Focus management**: After actions that change the UI (open/close panels, navigate lists), is focus placed somewhere sensible? Modals trap focus?
- **Contrast and theming**: Does the feature respect VS Code's theme? No hardcoded colors? Works in high contrast themes?

## Review Rules

- The goals doc's UX section is the spec — review against it, not your own UX preferences
- If the goals doc's UX section is incomplete, flag that as a finding, don't invent requirements
- Missing implementations of described user flows are UX bugs, not "future work"
- A technically correct feature that's undiscoverable is still a failure
- Do not evaluate code quality, performance internals, or test coverage — that's `/deep-review` and `/review`
- Do not evaluate visual design of webview CSS (layout, spacing, color) beyond theming compliance — that requires visual inspection of a running extension
- Do not run the extension or interact with it — this is a code-level review of user-facing behavior, not a manual QA pass

## Output Format

### Findings (ordered by severity)

For each finding include:

| Field          | Values                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| **lens**       | flow delivery / feedback / discoverability / consistency / workflow / information design / accessibility |
| **severity**   | critical (blocks merge) / high (should fix) / medium (fix soon) / low (note)                             |
| **confidence** | confirmed / likely / low-confidence                                                                      |
| **location**   | file:line or user-facing surface (e.g., "Commit Graph context menu")                                     |

Then: **what the user experiences**, **what they should experience instead**, **suggested fix**.

### Example Finding

> **lens**: feedback | **severity**: high | **confidence**: confirmed
> **location**: `src/commands/git/push.ts:142` -> push command error path
>
> **Issue**: When push fails due to no upstream branch, the error is caught and logged but the user sees nothing -- no notification, no status bar update, no output channel message. The operation silently fails.
>
> **Expected**: The user should see an actionable notification: "No upstream branch set for {branch}. Set upstream?" with a button to run `git push --set-upstream`.
>
> **Fix**: Add a `window.showWarningMessage` in the `PushError.is(ex, 'noUpstream')` branch with an action button that runs the set-upstream command.

### Required Sections

1. **Findings** — ordered by severity, using the format above
2. **Flow walkthrough** — the end-to-end user flow as implemented, annotated with where it matches and diverges from goals.md
3. **Workflow impact summary** — which existing user workflows this change touches and how they're affected. A change doesn't exist in isolation — identify the broader workflows that pass through the modified surfaces (e.g., a push behavior change affects commit->push->PR, stash->branch->push, etc.). For each impacted workflow: name it, describe what changed from the user's perspective, and flag whether the change is neutral, improved, or degraded.
4. **What works well** — UX strengths worth calling out
5. **Open questions** — things that need manual testing (interactions you can't fully evaluate from code alone)
6. **Verdict** — one of:
   - **UX approved** — the experience matches the intent
   - **UX approved with follow-ups** — minor issues that don't block merge
   - **UX needs work before merge** — the experience diverges from goals.md in ways that matter

If no issues found, say so explicitly, then list **residual risks** and **open questions for manual testing**.
