# Plan: Add `openChatOnComplete` Option to Start Review Command

## Problem

When users invoke `gitlens.startReview` from the command palette, there is no way to choose whether to open an AI chat after the review setup completes. Currently, `openChatOnComplete` is only set programmatically (CLI/MCP hardcodes it to `true`). Interactive users get no choice.

## Current Flow

1. **ConnectIntegrations** - Ensure user is connected to GitHub/etc.
2. **EnsureAccess** - Verify authentication/subscription
3. **PickPullRequest** - User selects a PR from the list (or pastes URL)
4. **Execute** - Creates worktree/checks out branch, optionally opens chat

Step 4 always runs with `openChatOnComplete` as whatever was passed in args (undefined for command palette = no chat).

## Proposed Flow

1. ConnectIntegrations (unchanged)
2. EnsureAccess (unchanged)
3. PickPullRequest (unchanged)
4. **ConfirmReview (NEW)** - User chooses how to start the review
5. Execute (uses the user's choice)

## Approach: Confirm Step with FlagsQuickPickItem

### Why This Approach

This follows the **established codebase pattern** used by:

- **Branch Create** (`src/commands/git/branch/create.ts`): "Create", "Create & Switch", "Create in New Worktree"
- **Branch Delete** (`src/commands/git/branch/delete.ts`): "Delete", "Force Delete", "Delete Local & Remote"
- **Worktree Create** (`src/commands/git/worktree/create.ts`): Multiple path/option confirmations

All use `FlagsQuickPickItem<Flags>` + `createConfirmStep()` to present mutually exclusive options to the user before executing.

### Alternatives Considered

1. **VS Code Setting** (`gitlens.startReview.openChatOnComplete: boolean`):
   - Pro: No extra UI step, persistent preference
   - Con: Not discoverable, can't vary per review, requires settings UI changes
   - Verdict: Could complement the confirm step as a default, but alone is insufficient

2. **Toggle Button on PR Picker**:
   - Pro: No extra step
   - Con: VS Code quick pick buttons don't have toggle state indicators; poor UX for a binary choice
   - Verdict: Not suitable for this interaction

3. **Multi-select Quick Pick**:
   - Pro: Could show multiple toggleable options
   - Con: Over-engineered for a single boolean; not how GitLens handles this pattern
   - Verdict: Not appropriate for one option

### Design Details

#### New Type and State Changes

```typescript
// In startReview.ts
type ReviewFlags = '--open-chat';

// Add to StartReviewState:
interface StartReviewState {
	// ... existing fields
	flags: ReviewFlags[]; // NEW
}
```

#### Confirm Step Implementation

After PR selection and before execution, yield a confirm step:

```typescript
// Two options:
// 1. "Start Review" - opens worktree only
// 2. "Start Review & Open AI Chat" - opens worktree + launches AI chat

const confirmations: FlagsQuickPickItem<ReviewFlags>[] = [
	createFlagsQuickPickItem<ReviewFlags>(state.flags, ['--open-chat'], {
		label: 'Start Review & Open AI Chat',
		detail: 'Will open a worktree and start an AI-assisted review chat',
	}),
	createFlagsQuickPickItem<ReviewFlags>(state.flags, [], {
		label: 'Start Review',
		detail: 'Will open a worktree for the pull request',
	}),
];
```

#### Skip Conditions

The confirm step is **skipped** when:

- `state.useDefaults === true` (programmatic invocation from CLI/MCP)
- `state.openChatOnComplete` is already explicitly set in args (programmatic callers already decided)

This preserves backward compatibility for all existing callers.

#### Telemetry

Add telemetry event: `startReview/steps/confirm` with the chosen flags.

### Files to Modify

1. **`src/plus/launchpad/startReview.ts`**:
   - Add `ReviewFlags` type
   - Add `flags` to `StartReviewState`
   - Add `Steps.ConfirmReview` step name
   - Add `confirmReviewStep()` generator method
   - Wire confirm step into `steps()` between PR pick and execute
   - Derive `openChatOnComplete` from flags when executing

2. No other files need modification. The downstream `startReviewFromLaunchpadItem` and `startReviewFromPullRequest` already accept `openChatOnComplete` as a parameter.

### Execution Flow (Updated)

```
Command Palette invocation:
  ConnectIntegrations → EnsureAccess → PickPR → ConfirmReview → Execute

CLI/MCP invocation (useDefaults=true, openChatOnComplete=true):
  PickPR (auto-lookup by URL) → Execute (skips confirm, uses args directly)

Programmatic with explicit openChatOnComplete:
  ConnectIntegrations → EnsureAccess → PickPR → Execute (skips confirm, uses args)
```

### Risk Assessment

- **Low risk**: Only adds a new step; no existing behavior changes
- **Backward compatible**: All programmatic callers skip the new step
- **Consistent**: Uses the same pattern as 3+ other commands in the codebase
- **Minimal scope**: Single file change, ~40 lines of new code
