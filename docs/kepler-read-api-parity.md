# Kepler read-API parity

Authoritative decision record for the read-API parity gaps tracked in
[#5435](https://github.com/gitkraken/vscode-gitlens/issues/5435) (follow-up to #5430), so Kepler
([gitkraken/kepler#1325](https://github.com/gitkraken/kepler/issues/1325), epic
[#1322](https://github.com/gitkraken/kepler/issues/1322)) can migrate its provider reads off the `gk` CLI
onto `@gitkraken/core-gitlens` with a clear contract.

The provider-side prerequisites landed in `@gitkraken/provider-apis` **0.50.0** (GKDEV-3535, GKDEV-3536,
GKDEV-3537, GKDEV-3538); core-gitlens consumes them from that version on.

Verdict legend: **first-class** (honored) · **best-effort** (honored where the provider exposes it cheaply,
otherwise `undefined`) · **n/a** (provider has no such concept).

## 1. Per-connection reads

`getMyIssuesForRepos` / `getMyPullRequestsForRepos` accept an optional trailing `connectionId` and read with
that connection's token (mirroring the `connectionId` added to the session-based `searchMy*` reads in #5430).
Omitting it preserves the provider's primary-connection behavior. The `providersApi` token path
(`TokenOptInfo` → `getProviderToken` → `getSession`) resolves the requested connection's cloud session; an
unresolvable or locally-disconnected connection degrades to "no results" without calling the provider.

## 2. Pagination

`PagedResult.paging` now carries `page` / `pageSize` / `nextPage` / `totalPages` / `totalCount` alongside the
existing `cursor` / `more`. Reads accept `page` / `pageSize`.

| Provider         | Paging   | `hasMore`   | `currentPage` / `totalPages` / `totalCount` | `pageSize` honored  |
| ---------------- | -------- | ----------- | ------------------------------------------- | ------------------- |
| GitHub           | cursor   | first-class | `undefined` (cursor)                        | yes (`maxPageSize`) |
| GitLab           | cursor   | first-class | `undefined` (cursor)                        | yes (`first`)       |
| Jira             | cursor   | first-class | `undefined` (cursor)                        | yes (`maxResults`)  |
| Bitbucket        | numbered | first-class | first-class                                 | yes                 |
| Bitbucket Server | numbered | first-class | first-class                                 | yes                 |
| Azure DevOps     | numbered | first-class | first-class                                 | yes                 |

**Kepler mapping:** cursor providers can't report a page number; consume `hasMore` for "next page exists" and
carry the opaque `cursor` forward. For numbered providers, `currentPage` + `totalPages`/`totalCount` map
directly to Kepler's `{ currentPage, itemsPerPage }`.

## 3. PR state selector (open / closed / merged)

`getMyPullRequestsForRepos` and `searchMyPullRequests` accept a `PullRequestStateFilter`
(`open`|`closed`|`merged`|`all`); issue reads accept an `IssueStateFilter` (`open`|`closed`|`all`). Omitted =
open-only (unchanged). All providers honor it (providers that can't express an arbitrary combination in one
query filter the normalized results).

| Provider         | Paginated (`getMy*ForRepos`) | Search (`searchMyPullRequests`)                                          |
| ---------------- | ---------------------------- | ------------------------------------------------------------------------ |
| GitHub           | first-class (SDK `states`)   | first-class (search query `is:open`/`is:closed is:unmerged`/`is:merged`) |
| GitLab           | first-class                  | first-class (SDK `states`)                                               |
| Bitbucket        | first-class                  | first-class (BBQL state clause + authored `states`)                      |
| Bitbucket Server | first-class                  | first-class (SDK `states`)                                               |
| Azure DevOps     | first-class                  | first-class (SDK `states`)                                               |
| Jira (issues)    | first-class                  | n/a (Jira has no PRs)                                                    |

## 4. Assignee / reviewer filters

- **`includeAllAssignees` (issues):** `getMyIssuesForRepos` option; when `true` it drops the current-user
  assignee constraint (returns all-assignee issues). First-class for all issue providers (it is an omission).
- **Reviewer inclusion (PRs):** the `ReviewRequested` filter routes to the field each provider reads.

| Provider         | Reviewer filter                                      | Keyed by   |
| ---------------- | ---------------------------------------------------- | ---------- |
| GitHub           | `reviewRequestedLogin`                               | login      |
| GitLab           | `reviewRequestedLogin` (multi-assignee also honored) | login      |
| Bitbucket        | `reviewerId`                                         | account id |
| Bitbucket Server | `reviewerLogin`                                      | login      |
| Azure DevOps     | `reviewerId`                                         | account id |

**Caveat:** the reviewer key differs (login vs account id); `getMyPullRequestsForRepos` picks the right one
per provider from the resolved current user, so callers don't special-case it.

## 5. Clone URLs + fork / cross-repository

`PullRequestRef` carries optional `cloneHttps` / `cloneSsh` / `isFork`; `PullRequest.refs.isCrossRepository`
is always present.

| Provider         | Clone URLs                               | `isCrossRepository` | `isFork`                   |
| ---------------- | ---------------------------------------- | ------------------- | -------------------------- |
| GitHub           | first-class                              | first-class         | best-effort                |
| GitLab           | first-class                              | first-class         | `undefined`                |
| Bitbucket        | first-class                              | first-class         | `undefined`                |
| Bitbucket Server | first-class                              | first-class         | `undefined`                |
| Azure DevOps     | first-class **with `includeRemoteInfo`** | first-class         | best-effort (`forkSource`) |

**Caveats:** Azure clone URLs require an opt-in extra lookup; `getMyPullRequestsForRepos` requests
`includeRemoteInfo` for Azure automatically. Where clone URLs are unavailable the fields are `undefined`;
reconstruct from the repository `webUrl`. Prefer `isCrossRepository` (always present) over `isFork`
(best-effort, provider-dependent).

## 6. Org / project scoping

`ProviderScope { org?, project?, resourceId?, repos? }` is a single normalized scope. `resolveProviderScope`
dispatches on the provider's `PagingMode` to the provider-appropriate inputs (project inputs for
Azure-issues/Jira; repo inputs for the rest). The underlying `ProviderReposInput` / `PagingMode` are
unchanged.

**Caveat:** Azure DevOps is scoped within a single organization; multi-org scoping remains unsupported (the
existing single-org guard stands).
