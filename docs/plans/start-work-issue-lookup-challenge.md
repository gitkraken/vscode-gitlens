# Plan Challenge: Optimize StartWorkCommand Issue Lookup for Direct URL Access

## Assumptions (attack surface)

1. **`Integration.getIssue()` returns a type compatible with `StartWorkItem.issue`** — Verified: YES. `getIssue()` returns `Issue` which implements `IssueShape`. `StartWorkItem.issue` is typed as `IssueShape`. Structural compatibility holds. Evidence: `src/git/models/issue.ts:20` (`Issue implements IssueShape`), `src/plus/startWork/startWorkBase.ts:95-97` (`StartWorkItem { issue: IssueShape }`).

2. **`getIssue()` includes the `body` field needed for hover content** — Verified: YES. GitHub's `getProviderIssue()` passes `includeBody: true` (`src/plus/integrations/providers/github.ts:138`). The hover display at `startWorkBase.ts:462` uses `i.issue.body` which is optional, so even if a provider omits it, the UI degrades gracefully (no hover, no crash).

3. **Issue URLs follow predictable patterns per provider** — Verified: PARTIALLY. Cloud providers (github.com, gitlab.com, bitbucket.org, linear.app) have stable patterns. But:
   - **Jira**: URLs come from `organization.url` which is the _site URL_, not necessarily `{org}.atlassian.net`. Custom Jira domains exist via Atlassian's domain mapping. The plan assumes `{org}.atlassian.net` always.
   - **Azure DevOps**: Both `dev.azure.com` AND `*.visualstudio.com` (legacy VSTS) formats exist. Existing parsers in `src/plus/integrations/providers/azure/models.ts:378-406` handle both. Plan only mentions `dev.azure.com`.
   - **Self-hosted**: GHE, GitLab Self-Hosted, Azure DevOps Server, Bitbucket Server can use any domain.

4. **Resource descriptors can be constructed from URL components** — Verified: PARTIALLY.
   - **Git host providers** (GitHub, GitLab, Bitbucket): YES. Need `{ key, owner, name }` — all derivable from URL path segments.
   - **Azure DevOps**: YES. Need `{ key, owner, name }` where owner=org, name=project — derivable from URL.
   - **Jira**: NO, not directly. Needs `JiraOrganizationDescriptor` with `id` (UUID), `name`, `url`, `avatarUrl`. The UUID cannot be derived from the URL. Must call `getResourcesForUser()` first to map org domain → resource ID.
   - **Linear**: NO, not directly. Needs `IssueResourceDescriptor` with `id` (UUID), `key`, `name`. UUID cannot be derived from the URL. Must call `getResourcesForUser()` first.

5. **Self-hosted integration domains can be resolved** — Verified: YES, with limitations. `ConfiguredIntegrationService.getConfiguredLite()` returns configured domains. For GHE, if no domain is provided, `integrationService.get()` falls back to the first configured instance. For multiple self-hosted instances, domain matching is required.

6. **The fallback to `getMyIssues()` mitigates all parsing failures** — Verified: YES. The proposed code falls through to the original behavior if direct lookup returns `undefined`. This is safe.

7. **`getIssue()` returns the same data shape as items from `searchMyIssues()`** — Verified: MOSTLY. Both return objects satisfying `IssueShape`. However, `searchMyIssues()` returns lighter objects (e.g., GitHub's `toQueryResult` maps from `GitHubIssue`) while `getIssue()` returns full `Issue` class instances. The `Issue` class has extra fields like `nodeId`, `closedDate`, `commentsCount`, `thumbsUpCount`, `number` that `IssueShape` doesn't require. All are structurally compatible.

## Pre-Mortem Scenarios

1. **Jira custom domain fails**: A user has Jira with a custom domain (e.g., `jira.company.com` instead of `company.atlassian.net`). The URL parser doesn't recognize the domain, returns `undefined`. Fallback kicks in — fetches all issues, finds nothing (because the URL format may also differ from what `searchMyIssues` returns). **Impact**: Same as today (no regression), but opportunity missed. **Mitigation**: The fallback makes this non-critical.

2. **Multiple GHE instances**: User has two GitHub Enterprise instances configured (e.g., `github.internal.com` and `github.acme.com`). A URL from the second instance is passed. The parser extracts the domain, but `integrationService.get(CloudGitHubEnterprise)` without a domain returns only the first configured instance. **Impact**: Wrong integration queried, returns `undefined`, falls back to bulk fetch. **Mitigation**: Pass the extracted domain to `integrationService.get(id, domain)`.

3. **Linear workspace URL mismatch**: Linear's `getResourcesForUser()` returns organizations with `url` field. The issue URL contains a workspace slug (e.g., `linear.app/myteam/issue/TEAM-123`). If the workspace slug doesn't map cleanly to a resource, the lookup fails. **Impact**: Falls back to bulk fetch. **Mitigation**: Match by issue key prefix to team, not by workspace slug.

4. **Race condition with integration connection**: MCP sends `issueUrl` before integrations are fully connected. `getIssueByUrl()` calls `integration.getIssue()` which checks `this.maybeConnected`. If the integration isn't connected yet, it returns `undefined`. The fallback also fails because `getMyIssues()` checks the same connection state. **Impact**: Same as today — no regression. The `steps()` method already handles the connection flow before reaching the issue lookup.

5. **Azure DevOps work item URL for non-issue types**: Azure DevOps `_workitems/edit/{id}` can be bugs, tasks, epics, or user stories — not just issues. The `getIssue()` call may return an item that doesn't map to `IssueShape` correctly. **Impact**: Possible unexpected behavior. **Mitigation**: Azure's `getProviderIssue` already handles this mapping; the existing code works the same way for `searchMyIssues`.

## Concerns

| #   | Category        | Severity        | Concern                                                                                                                                                       | Evidence                                                                                                                                                                      | Fix                                                                                                                                                        |
| --- | --------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Correctness     | **Significant** | Jira/Linear need resource UUIDs that can't be derived from URLs. Plan doesn't detail how to resolve org URL → resource descriptor.                            | Jira `getProviderIssue` requires `JiraOrganizationDescriptor` with `id` (UUID) at `jira.ts:295`. Linear's `isIssueResourceDescriptor` check requires `id` at `linear.ts:244`. | Call `getResourcesForUser()` (cached via `@gate()` + instance vars) first, then match by URL/domain substring. Both Jira and Linear cache their resources. |
| 2   | Completeness    | **Significant** | Plan's URL table omits Azure DevOps legacy VSTS format (`*.visualstudio.com`).                                                                                | Existing parsers at `azure/models.ts:378` handle both `dev.azure.com` and `visualstudio.com`.                                                                                 | Reuse existing `parseAzureHttpsUrl()` for Azure URLs instead of writing new parser.                                                                        |
| 3   | Completeness    | Minor           | Plan's `parseIssueUrl` return type is flat (`{ integrationId, domain?, owner, repo, issueId }`) but Jira/Linear need different fields (resourceId, issueKey). | Jira uses `resourceId` + `number` (key), not owner/repo.                                                                                                                      | Use a discriminated union return type per provider kind.                                                                                                   |
| 4   | Correctness     | Minor           | Plan proposes file at `src/plus/integrations/providers/issueUrl.utils.ts` but per codebase conventions, utility files should be in a `utils/` subdirectory.   | Codebase pattern: `src/plus/integrations/utils/`, `src/git/utils/`.                                                                                                           | Place in `src/plus/integrations/utils/issueUrl.utils.ts` or similar.                                                                                       |
| 5   | Performance     | Minor           | For Jira/Linear, `getResourcesForUser()` adds an extra API call before `getIssue()`.                                                                          | `getResourcesForUser()` uses `@gate()` (deduplication) and Jira/Linear cache results in instance variables.                                                                   | Already mitigated by caching. First call adds latency, subsequent calls are instant. Still far better than bulk fetch.                                     |
| 6   | Maintainability | Minor           | New URL parsing duplicates some logic that exists in remote provider detection (`remoteProviders.ts`).                                                        | Domain detection via `isGitHubDotCom()`, `isGitLabDotCom()`, etc. at `models.ts:1123-1129`.                                                                                   | Reuse existing domain detection helpers rather than reimplementing.                                                                                        |

## Verdict

**Ready with revisions.**

The plan's direction is sound — the core insight that `issueUrl` should bypass bulk fetching is correct and the fallback ensures safety. The two significant concerns are addressable:

1. **Jira/Linear resource resolution**: Add a step that calls `getResourcesForUser()` (already cached) to map the URL domain/org to a resource descriptor before calling `getIssue()`. This is still dramatically faster than the current approach.

2. **Azure DevOps VSTS URLs**: Reuse the existing `parseAzureHttpsUrl()` function rather than writing a new parser. This also handles the `visualstudio.com` legacy format.

No blocking concerns were found. The fallback mechanism ensures that any parsing failures degrade to existing behavior rather than breaking.
