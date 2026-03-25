# StartReviewCommand PR Lookup Optimization Plan

## Problem Analysis

The `StartReviewCommand` uses the Launchpad system (`LaunchpadProvider.getCategorizedItems()`) as its **sole** mechanism for PR lookup in all use-cases. While this is appropriate for the **interactive picker** (where users need a categorized list), it is unnecessarily heavy for the **direct URL lookup** path.

### Current URL Lookup Flow (when `prUrl` is provided)

```
lookupLaunchpadItem(prUrl)
  → getCategorizedItems({ search: prUrl })
    → Promise.allSettled([
        isDiscoveringRepositories,          // Wait for repo discovery
        getEnrichedItems(),                 // API: enrichment service (pinned/snoozed state)
        getSearchedPullRequests(url)        // API: get the specific PR
      ])
    → Get current user accounts from ALL integrations
    → Filter PRs, compute actionable categories
    → Match open repositories, get suggested actions
    → Build full LaunchpadItem[]
  → return items[0]
```

### Unnecessary Work for Direct URL Lookup

1. **Fetches enriched items** — pinned/snoozed state from the enrichment service. Irrelevant when the user explicitly chose a PR URL.
2. **Fetches current user accounts from ALL integrations** — even when the URL identifies the exact provider.
3. **Runs full categorization pipeline** — actionable categories, code suggestion counts, suggested actions. None of this is used by `startReviewFromLaunchpadItem()`.
4. **Builds full `LaunchpadItem` structure** — only to extract `underlyingPullRequest`, `openRepository`, and basic metadata.

### What `startReviewFromLaunchpadItem` Actually Uses

Looking at `startReview.utils.ts`, the utility function only accesses:

- `item.underlyingPullRequest` — the raw `PullRequest` object
- `item.openRepository?.repo` — the matching local repository
- `item.openRepository?.localBranch` — to check if already checked out
- `item.url` — the PR URL (already known from `prUrl`)

It does **not** use: `actionableCategory`, `suggestedActions`, `codeSuggestionsCount`, `isNew`, `currentViewer`, `viewer`, or any enrichment data.

### Affected Use-Cases

| Entry Point                       | Has `prUrl`? | Needs full Launchpad?                          | Current behavior                           |
| --------------------------------- | ------------ | ---------------------------------------------- | ------------------------------------------ |
| Command Palette (interactive)     | No           | Yes — needs categorized list                   | Correct                                    |
| CLI/MCP (`prUrl` + `useDefaults`) | Yes          | No                                             | Wasteful                                   |
| Deep Link (`prUrl`)               | Yes          | No                                             | Wasteful                                   |
| Chat Action (`prUrl`)             | Yes          | No                                             | Wasteful                                   |
| Interactive search (URL paste)    | Yes (typed)  | No for the lookup, but shown in picker context | Acceptable — user is already in the picker |

## Proposed Solution

### Approach: Direct PR Lookup Bypassing Launchpad

Add a new method to `StartReviewCommand` that performs a lightweight, direct PR lookup when a `prUrl` is provided with `useDefaults: true`. This bypasses the entire Launchpad categorization pipeline.

### Changes Required

#### 1. Add `getMatchingOpenRepository` extraction to `LaunchpadProvider` (or utility)

The `LaunchpadProvider.getMatchingOpenRepository()` method (private) maps a PR to a local repository. We need this capability outside the full categorization pipeline. Two sub-options:

**Option A**: Make `getMatchingOpenRepository` (and its helper `getMatchingRemoteMap`) accessible as a standalone utility.

**Option B**: Add a focused method on `LaunchpadProvider` like `lookupPullRequestByUrl(url)` that does only the minimal work needed.

**Chosen: Option B** — Better encapsulation. The LaunchpadProvider already owns the relationship between integrations and PR lookup. A focused method keeps the API clean.

#### 2. New `LaunchpadProvider.lookupPullRequestByUrl(url)` method

This method will:

1. Parse the URL to extract provider, owner, repo, and PR number (reusing `getPullRequestIdentityFromSearch`)
2. Get just the matching connected integration (not all of them)
3. Call `integration.getPullRequest(descriptor, prNumber)` directly — this is cached
4. Find the matching open repository (reusing internal logic)
5. Return a minimal result: `{ pr: PullRequest, openRepository?: { repo, localBranch } }`

#### 3. New `startReviewFromPullRequest` utility function

Refactor `startReviewFromLaunchpadItem` to accept a `PullRequest` directly (with optional open repository info), since that's all it actually needs. The existing `startReviewFromLaunchpadItem` can delegate to this.

#### 4. Update `StartReviewCommand.lookupLaunchpadItem` → use direct lookup

When `prUrl` is provided with `useDefaults: true`, use the new direct lookup path instead of `getCategorizedItems`.

### Detailed Implementation

#### File: `src/plus/launchpad/launchpadProvider.ts`

Add new public method:

```typescript
async lookupPullRequestByUrl(
    url: string,
): Promise<{ pr: PullRequest; openRepository?: LaunchpadItemOpenRepository } | undefined>
```

Implementation:

1. Call `getPullRequestIdentityFromSearch(url, connectedIntegrations)`
2. If identity found with `prNumber` and `ownerAndRepo`: call `integration.getPullRequest(descriptor, prNumber)`
3. If no identity: fall back to `integration.searchPullRequests(url)` and take first result
4. If PR found: call `getMatchingOpenRepository()` to find local repo
5. Return result

This reuses the existing `getMatchingOpenRepository` and `getMatchingRemoteMap` private methods.

#### File: `src/plus/launchpad/utils/-webview/startReview.utils.ts`

Add new function:

```typescript
export async function startReviewFromPullRequest(
	container: Container,
	pr: PullRequest,
	openRepository?: { repo: Repository; localBranch?: GitBranch },
	instructions?: string,
	openChatOnComplete?: boolean,
	useDefaults?: boolean,
): Promise<StartReviewResult>;
```

Refactor `startReviewFromLaunchpadItem` to delegate to this function, extracting the PR and open repository info from the LaunchpadItem.

#### File: `src/plus/launchpad/startReview.ts`

Update the `prUrl` + `useDefaults` fast path (lines 259-284):

```typescript
if (state.prUrl && state.useDefaults) {
	try {
		const result = await this.container.launchpad.lookupPullRequestByUrl(state.prUrl);
		if (result == null) {
			throw new Error(`No PR found matching '${state.prUrl}'`);
		}

		const reviewResult = await startReviewFromPullRequest(
			this.container,
			result.pr,
			result.openRepository
				? { repo: result.openRepository.repo, localBranch: result.openRepository.localBranch }
				: undefined,
			state.instructions,
			state.openChatOnComplete,
			state.useDefaults,
		);
		state.result?.fulfill(reviewResult);
		steps.markStepsComplete();
		return;
	} catch (ex) {
		state.result?.cancel(ex instanceof Error ? ex : new Error(String(ex)));
		void window.showErrorMessage(`Failed to start review: ${ex instanceof Error ? ex.message : String(ex)}`);
		return StepResultBreak;
	}
}
```

### Performance Impact

| Path                   | Before                                                                | After                                   |
| ---------------------- | --------------------------------------------------------------------- | --------------------------------------- |
| URL + useDefaults      | 3+ API calls (PR + enrichments + user accounts) + full categorization | 1 API call (PR, cached) + repo matching |
| Interactive picker     | Unchanged                                                             | Unchanged                               |
| Interactive URL search | Unchanged                                                             | Unchanged                               |

### Risk Assessment

- **Low risk**: The interactive path is completely unchanged
- **Low risk**: The `getPullRequest` API call is already cached
- **Low risk**: `getMatchingOpenRepository` is already battle-tested internal logic
- **Medium attention**: Need to ensure the `openRepository` matching works correctly outside the full categorization context (it receives a single PR rather than a batch)

### Non-Goals

- Not changing the interactive picker flow
- Not changing how the interactive URL search works (pasting URL in the picker)
- Not refactoring the Launchpad categorization pipeline itself
