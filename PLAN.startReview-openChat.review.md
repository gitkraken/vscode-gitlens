# Deep Review: Start Review with Review Mode Selection

**Target**: All uncommitted changes (`git diff`)
**Files changed**: 6 files — `startReview.ts`, `startReview.utils.ts`, `chatActions.ts`, `deepLink.ts`, `deepLinkService.ts`, `constants.telemetry.ts`

---

## Findings (ordered by severity)

### Finding 1: Manual review deep link stored AFTER worktree create command opens new window

**classification**: correctness | **severity**: high | **confidence**: likely
**location**: `src/plus/launchpad/utils/-webview/startReview.utils.ts:250-253`

**Issue**: In `createPullRequestWorktree`, the manual review deep link is stored _after_ the worktree is created and returned. But the worktree create command (`gitlens.git.worktree`) opens the new VS Code window as part of its execution. The `storeManualReviewDeepLink` call happens after `await worktreeResult.promise` resolves, which means the new window may have already started activating before the deep link is stored.

Compare with the `chatAction` path: the chat action is passed _into_ the worktree create command state (line 239), and the worktree create command stores it synchronously before opening the new window.

**Impact**: Race condition — the new window's `DeepLinkService` may check for pending deep links before the manual review deep link is stored, causing the Inspect view to not open.

**Fix**: Pass `manualReview` as a flag into the worktree create command state (similar to `chatAction`), or store the deep link before invoking the worktree create command. The simplest fix is to store the deep link before `executeCommand` is called, using the expected worktree path.

### Finding 2: Unused `_context` parameter in `confirmReviewStep`

**classification**: design | **severity**: low | **confidence**: confirmed
**location**: `src/plus/launchpad/startReview.ts:676`

**Issue**: The `_context` parameter is accepted but unused. The underscore prefix correctly signals it's unused, and it matches the signature pattern of sibling step methods.

**Fix**: Acceptable as-is. Follows convention of other step methods in the class.

---

## What is Good

1. **Clean `ReviewMode` type**: The `'chat' | 'manual'` union type cleanly replaces the boolean `openChatOnComplete` in utility functions. The derivation logic in `startReview.ts` (lines 348-358) is clear and handles all four cases: confirm step chosen, programmatic chat, interactive AI-disabled, and programmatic useDefaults.

2. **AI-enabled gate**: `this.container.ai.enabled` check (line 321) correctly skips the confirm step when AI is disabled, defaulting to manual review. The `else if (!state.useDefaults)` branch (line 356) ensures interactive users without AI still get manual review mode.

3. **All three worktree scenarios handled**: Branch already checked out (direct action), new worktree (deep link stored for new window), existing worktree (deep link stored + workspace opened) — all correctly handle both `'chat'` and `'manual'` modes.

4. **Deep link infrastructure is clean**: `ManualReview` state/action/command type properly added to all required locations in `deepLink.ts` (enum, transitions, progress) and `deepLinkService.ts` (handler, pending context, command dispatch).

5. **Backward compatibility**: CLI/MCP callers that pass `openChatOnComplete: true` get `reviewMode: 'chat'` via the `state.openChatOnComplete ? 'chat' : undefined` conversion (line 280). No existing behavior changes.

6. **`executeManualReviewAction`**: Clean separation — for the "already checked out" case, opens Inspect view directly with `inReview: true`, which triggers the WIP state to auto-discover and show the PR in the PR view.

## Open Questions

1. **Worktree create timing**: Finding 1 needs verification — does `worktreeResult.promise` resolve before or after the new window opens? If before (worktree is created on disk, then window opens separately), the deep link storage timing may be fine. If the window opens as part of the command, it's a race.

2. **`inReview` flag effect**: The `inReview: true` in `ShowWipArgs` is used — confirmed in `commitDetailsWebview.ts` — but its exact behavioral effect beyond the existing `OpenInspect` deep link usage should be verified by manual testing.

## Verdict

**Should fix Finding 1 before merge**

Finding 1 is the only significant concern. The manual review deep link is stored after the worktree result resolves, which may be too late if the new window has already started. The fix is to store the deep link _before_ the worktree create command is executed, mirroring how the existing worktree-already-exists path works (store deep link, then open workspace).
