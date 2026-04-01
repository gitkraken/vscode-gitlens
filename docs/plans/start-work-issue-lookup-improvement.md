# Plan: Optimize StartWorkCommand Issue Lookup for Direct URL Access

## Problem Statement

When `StartWorkCommand` receives an `issueUrl` (via MCP/CLI or programmatic callers), it currently:

1. Fetches ALL issues from ALL connected integrations via `getMyIssues()` (potentially hundreds of API calls across GitHub, GitLab, Jira, Linear, Azure DevOps, Bitbucket)
2. Then does a linear search through the results for a matching URL: `item.issue.url === state.issueUrl`
3. If not found, shows an error message

This is wasteful because:

- **Performance**: The MCP/CLI path (`mcp/issue/start`) always provides an `issueUrl`. Fetching all issues across all providers just to find one by URL is O(n) API calls when O(1) is possible.
- **Reliability**: If the issue exists on a provider but isn't returned by `searchMyIssues()` (e.g., it's not authored/assigned/mentioned by the user, or pagination limits were hit), the lookup silently fails even though a direct fetch would succeed.
- **Latency**: GitHub alone makes 3 GraphQL queries (authored/assigned/mentioned, 100 each). Jira paginates up to 10 pages per resource. All of this runs before the URL match happens.

## Existing Infrastructure

The codebase already has a direct issue fetch capability:

- `Integration.getIssue(resource, id)` - fetches a single issue by ID with caching via `container.cache.getIssue()`
- Each provider implements `getProviderIssue(session, resource, id)` - GitHub, GitLab, Jira, Linear, Azure DevOps, Bitbucket all support this
- Provider domains are well-defined: `github.com`, `gitlab.com`, `atlassian.net`, `linear.app`, `dev.azure.com`, `bitbucket.org`

What's missing is a way to:

1. Parse an issue URL into (provider, owner/repo, issue ID)
2. Route that to the correct integration's `getIssue()` method

## Proposed Solution

Add a new method `getIssueByUrl(url)` to `IntegrationService` that:

1. Parses the URL to determine the provider domain and extract owner/repo/issue-id
2. Resolves the correct integration via domain matching
3. Calls `integration.getIssue(resource, id)` directly (single API call, cached)

Then update `StartWorkBaseCommand` to use this fast path when `issueUrl` is provided, falling back to `getMyIssues()` only if the direct lookup fails or when no URL is provided.

### URL Parsing Strategy

Issue URLs follow predictable patterns per provider:

| Provider           | URL Pattern                                                  | Extract                   |
| ------------------ | ------------------------------------------------------------ | ------------------------- |
| GitHub             | `https://github.com/{owner}/{repo}/issues/{id}`              | owner, repo, id           |
| GitHub Enterprise  | `https://{domain}/{owner}/{repo}/issues/{id}`                | domain, owner, repo, id   |
| GitLab             | `https://gitlab.com/{owner}/{repo}/-/issues/{id}`            | owner, repo, id           |
| GitLab Self-Hosted | `https://{domain}/{owner}/{repo}/-/issues/{id}`              | domain, owner, repo, id   |
| Jira               | `https://{org}.atlassian.net/browse/{KEY-123}`               | org (resource), issue key |
| Linear             | `https://linear.app/team/{team}/issue/{KEY-123}`             | team, issue key           |
| Azure DevOps       | `https://dev.azure.com/{org}/{project}/_workitems/edit/{id}` | org, project, id          |
| Bitbucket          | `https://bitbucket.org/{owner}/{repo}/issues/{id}`           | owner, repo, id           |

### Implementation Steps

#### Step 1: Add URL parsing utility

Create `src/plus/integrations/providers/issueUrl.utils.ts` with:

- `parseIssueUrl(url: string)` - returns `{ integrationId, domain?, owner, repo, issueId }` or `undefined`
- Handles all supported provider URL patterns

#### Step 2: Add `getIssueByUrl()` to IntegrationService

In `src/plus/integrations/integrationService.ts`:

- New method: `async getIssueByUrl(url: string): Promise<IssueShape | undefined>`
- Uses `parseIssueUrl()` to determine provider
- Gets the integration via `this.get(integrationId, domain)`
- Calls `integration.getIssue(resource, issueId)`
- Returns the issue or `undefined`

#### Step 3: Update StartWorkBaseCommand to use fast path

In `src/plus/startWork/startWorkBase.ts`, modify the `issueUrl` handling (lines 261-272):

**Before:**

```typescript
if (state.issueUrl) {
	if (context.result == null) {
		await updateContextItems(this.container, context);
	}
	preSelecteditem = context.result?.items.find(item => item.issue.url === state.issueUrl);
	if (preSelecteditem == null) {
		void window.showErrorMessage(`Issue not found: ${state.issueUrl}. Please select an issue manually.`);
	}
}
```

**After:**

```typescript
if (state.issueUrl) {
	// Fast path: direct lookup by URL (single API call)
	const issue = await this.container.integrations.getIssueByUrl(state.issueUrl);
	if (issue != null) {
		preSelecteditem = { issue: issue };
	} else {
		// Fallback: search through all issues (existing behavior)
		if (context.result == null) {
			await updateContextItems(this.container, context);
		}
		preSelecteditem = context.result?.items.find(item => item.issue.url === state.issueUrl);
		if (preSelecteditem == null) {
			void window.showErrorMessage(`Issue not found: ${state.issueUrl}. Please select an issue manually.`);
		}
	}
}
```

## Trade-offs

### Pros

- **10-100x faster** for the `issueUrl` path (1 API call vs potentially dozens)
- **More reliable** - finds issues even if they're not in the user's authored/assigned/mentioned lists
- **Cached** - uses existing `container.cache.getIssue()` infrastructure
- **Backward compatible** - falls back to existing behavior if direct lookup fails
- **No breaking changes** - same public API, same behavior for non-URL paths

### Cons

- **New URL parsing code** - needs maintenance as provider URL formats evolve (low risk, these are stable)
- **Self-managed instances** - GitHub Enterprise and GitLab Self-Hosted URLs need domain matching against configured integrations
- **Jira/Linear resource resolution** - these providers need a resource descriptor to fetch an issue, which requires mapping from the URL's org/team to the provider's resource model

### Risks

- URL parsing could fail for edge cases (custom Jira domains, etc.) - mitigated by fallback
- Self-hosted integration domain matching may not cover all configured instances - mitigated by fallback

## Out of Scope

- Changing the `getMyIssues()` flow for the interactive picker (no `issueUrl`) - that path works correctly
- Adding new caching for the bulk issue list
- Changing provider API implementations
