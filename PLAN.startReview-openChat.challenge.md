# Plan Challenge: Add `openChatOnComplete` Option to Start Review

## Assumptions (attack surface)

1. **The confirm step can be added between PR pick and execute without breaking the step controller flow** — Verified: yes. `StepsController` uses `isAtStep()`/`isAtStepOrUnset()` and `enterStep()` to navigate. Other commands (cherry-pick, push) successfully have multiple steps after selection. Adding a new step name to `Steps` and a corresponding `enterStep()` block works.

2. **`this.createConfirmStep()` (base class method) is the right API to use** — Verified: yes. `StartReviewCommand` already uses it in `confirmLocalIntegrationConnectStep` and `confirmCloudIntegrationsConnectStep`. The base class method auto-injects `{ title: this.title }`.

3. **`FlagsQuickPickItem` is appropriate for a binary choice** — Verified: partially. The pattern works (branch create uses it for 2-3 options), but `FlagsQuickPickItem` is designed for combinable flags (e.g., `['--force', '--remote']`). For a single boolean like "open chat or not," flags are slightly over-abstracted. However, it's the established pattern and keeps the door open for future options. Acceptable trade-off.

4. **The `useDefaults + prUrl` fast path already bypasses the PR picker, so the confirm step is also skipped** — Verified: yes. Lines 260-285 in `startReview.ts` return early when both conditions are true, completely bypassing any subsequent steps.

5. **When `openChatOnComplete` is explicitly set in args, the confirm step should be skipped** — Verified: this is a design decision, not a code claim. It's correct because programmatic callers (CLI/MCP, home webview) already know what they want.

6. **No other files need modification** — Verified: yes. `startReviewFromLaunchpadItem` and `startReviewFromPullRequest` already accept `openChatOnComplete` as a parameter. The change is purely in the command layer.

7. **Telemetry should follow `startReview/steps/confirm` naming** — Disputed: no `steps/confirm` pattern exists in the codebase. Existing patterns use `steps/connect`, `steps/pr`. The naming should be `startReview/steps/confirm` for consistency with the step-name convention, which is fine — it just needs to match the step name, not an existing "confirm" event.

## Pre-Mortem Scenarios

1. **"Open AI Chat" chosen but no AI provider configured**: User selects "Start Review & Open AI Chat," worktree opens in new window, `gitlens.openChatAction` fires but fails silently or shows an error because no AI chat provider is available. **Impact**: Confusing UX, user doesn't understand why chat didn't open. **Mitigation**: This is an existing issue with the `openChatOnComplete` path — it's not introduced by this change. The `openChatAction` command already handles this gracefully by prompting the user.

2. **User always wants chat but has to pick it every time**: No persistence of the choice. Every `Start Review` invocation requires the confirm step. **Impact**: Friction for power users. **Mitigation**: Acceptable for v1. A setting can be added later if user feedback demands it. The extra step is one click.

3. **Confirm step breaks back-navigation**: User goes through ConnectIntegrations → EnsureAccess → PickPR → ConfirmReview, presses back on ConfirmReview, and expects to return to PickPR. If the step controller doesn't handle this, the user gets stuck or the wizard exits. **Impact**: Broken navigation. **Mitigation**: The `StepsController`'s `goBack()` mechanism handles this naturally — verified by looking at how other steps handle `StepResultBreak` + `goBack()`. The confirm step just needs to follow the same pattern: if the user cancels, return `StepResultBreak`, and the outer loop's `goBack()` takes them back to PickPR.

4. **Confirm step shows for programmatic callers that don't set `openChatOnComplete` explicitly**: If a future caller invokes `gitlens.startReview` without `useDefaults` and without `openChatOnComplete`, they'd hit the confirm step unexpectedly. **Impact**: Minor — callers should set `useDefaults: true` if they want to skip interactive steps. This is already the established convention (CLI does it).

5. **Chat option shown but chat feature not available in web/browser**: In VS Code for Web, the AI chat might not be available. **Impact**: User selects "Open AI Chat" but nothing happens. **Mitigation**: Existing issue — not introduced by this change. The `openChatAction` command handles availability checks.

## Concerns

| #   | Category        | Severity    | Concern                                                                                                                                                                     | Evidence                                                                     | Fix                                                                                                                            |
| --- | --------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Correctness     | Minor       | Plan says `state.flags` but `StartReviewState` doesn't currently have `flags`. Need to add it and initialize it properly.                                                   | `startReview.ts:111-118`                                                     | Add `flags?: ReviewFlags[]` to `StartReviewState` and initialize in `initialState`                                             |
| 2   | Completeness    | Minor       | Plan doesn't specify how `flags` maps to `openChatOnComplete` for execution. Need explicit derivation: `state.flags?.includes('--open-chat') \|\| state.openChatOnComplete` | Plan design section                                                          | Add derivation logic before calling `startReviewFromLaunchpadItem`                                                             |
| 3   | Completeness    | Minor       | Plan lists the "Open AI Chat" option first. Should the default (no chat) be first since it's the simpler/safer option?                                                      | UX convention                                                                | Put "Start Review" first, "Start Review & Open AI Chat" second. Unless we want to encourage AI chat adoption. Design decision. |
| 4   | Maintainability | Minor       | Using `FlagsQuickPickItem` with a string literal type `'--open-chat'` for a single boolean is slightly over-abstracted but follows codebase convention                      | `src/commands/git/branch/create.ts` uses same pattern for 2 flags            | Accept — consistency > minimalism                                                                                              |
| 5   | Correctness     | Significant | The confirm step needs proper back-navigation handling. When user presses back on confirm step, `state.item` should be cleared so the PR picker shows again.                | Pattern in `steps()` at line 289-293 where `state.item = undefined` on break | Clear `state.item` when confirm step returns `StepResultBreak`, before calling `goBack()`                                      |

## Verdict

**Ready with minor revisions**

The plan is sound. All claims verified against actual code. The architecture supports the change cleanly. The only significant concern (#5) is about back-navigation — the confirm step must clear `state.item` when the user goes back, otherwise the loop will skip the PR picker on retry. This is a small code detail, not a design issue.

Revisions needed before implementation:

1. Ensure back-navigation clears `state.item` so PR picker re-shows
2. Derive `openChatOnComplete` from flags explicitly: `state.flags?.includes('--open-chat') || state.openChatOnComplete`
3. Consider putting the simpler "Start Review" option first (design decision)
