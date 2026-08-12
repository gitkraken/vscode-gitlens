# Kepler read-API parity

Authoritative decision record for the read-API parity gaps tracked in
[#5435](https://github.com/gitkraken/vscode-gitlens/issues/5435) (follow-up to #5430), so Kepler
([gitkraken/kepler#1325](https://github.com/gitkraken/kepler/issues/1325), epic
[#1322](https://github.com/gitkraken/kepler/issues/1322)) can migrate its provider reads off the `gk` CLI
onto `@gitkraken/core-gitlens` with a clear contract.

The baseline provider-side prerequisites landed in `@gitkraken/provider-apis` **0.50.0** (GKDEV-3535,
GKDEV-3536, GKDEV-3537, GKDEV-3538). The current `core` branch additionally requires the unreleased
provider changes described in [`integrations.md` §12](./integrations.md#12-development-and-publication-prerequisite).

Verdict legend: **first-class** (honored) · **best-effort** (honored where the provider exposes it cheaply,
otherwise `undefined`) · **n/a** (provider has no such concept).

For how to actually consume the resulting facade — runtime wiring, the paging/warning contracts, and the
per-provider capability matrix — see [`integrations.md`](./integrations.md). This
document stays the decision record for the parity gaps themselves.

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

**Multi-repo caveat:** the repo-mode providers (GitLab, Bitbucket, Bitbucket Server, Azure) fan a
`getMy*ForRepos` call out across repos and aggregate the results under a single composite cursor. There the
numbered metadata (`currentPage`/`totalPages`/`totalCount`) is not aggregated — pagination continues via
that composite cursor plus `hasMore`. An explicit `page` applies only to the first request per repo; on
continuation the per-repo cursor takes over (it is not clobbered). The numbered metadata is surfaced on the
direct single-call read path.

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

## 7. Filtered issue search + count probe

Gap raised by [kepler#1745](https://github.com/gitkraken/kepler/issues/1745) Part 2 (the "All visible" issue
explorer). Kepler needed three things no existing read provided, and the reason is one asymmetry: the PR side
had a free-text, repo-scoped, relationship-optional search primitive (`searchPullRequests` /
`searchMyPullRequestsPage`) and the issue side had none. Every issue read was either bound to `@me` or routed
through `getIssuesForRepos`, which is the 128-request `recoverOverLimitSearch` path — the source of the
reported 116 s / 88 omissions.

**`searchIssuesPage`** (`IssueShape`, one request per page) is the issue counterpart. Structured
`IssueSearchCriteria` rather than a raw query string: a raw string is exactly why `searchPullRequests` is
GitHub-only in practice and why its capability is undeclarable, and Kepler has to render filter chips and hide
the unsupported ones, which needs a typed model plus `getSupportedFilters().issueSearch`.

**`countIssues`** answers "how many match" with zero issues transferred, which is what makes the cost dialog
and the live count label affordable. Verified against the live GitHub API: 30 aliased counts cost **1**
rate-limit point.

Decisions worth recording, because each closes off a plausible-looking alternative:

- **A separate method, not `countOnly` on the read.** Transferring zero issues is the whole value; a flag
  would return a `ProviderPagedResult` whose `items`, `cursor` and `hasMore` are all meaningless.
- **A sibling read, not a mode of `listIssuesPage`.** That read is already two divergent branches around a
  contract where `filters` replaces the provider's definition of "my issues"; `any-assignee` / `unassigned`
  aren't "my issues" at all. Same reasoning as `broaden.ts` / `sweeps.ts` being separate files.
- **`sort:updated` is a contract, not an option.** Kepler's cap policy ("the 1.000 most recent") is only
  correct under a guaranteed order; an option invites picking relevance order and then truncating to an
  arbitrary subset.
- **The result ceiling is an omission, not a failure.** `fetchFailed` absent, `recovery: 'none'`, and
  `omission.totalCount` populated — which is the number in Kepler's "This will fetch ~19.240 issues". The
  `ProviderWarningOmission.totalCount` field already existed and was documented as "Only GitHub's search cap
  does today"; it simply had never been populated on this path, because `searchMyIssues` computed
  `issueCount > 1000` into a boolean and discarded the number.
- **Scope is mandatory, and `any-assignee` / `unassigned` do not count as one.** They describe the issue, not
  the caller (measured: unscoped `no:assignee` is tens of millions of results).

**Corrected along the way:** the source claimed GitHub honors `assignee:*` only for a single repository, which
was the standing argument for refusing a multi-repo "assigned to anyone" read. Measured
(`is:issue is:open archived:false`): kepler 111 + vscode-gitlens 133 = **244** for both repos together, and
`org:gitkraken` 315. Any scope works; only the unscoped form is meaningless (6.7 M), which is what the guards
actually refuse.

**Provider coverage:** GitHub/GHE only. GitLab and Azure declare no `issueSearch` capability, so the read is
refused there rather than serving an unnarrowed list — unimplemented, not impossible: GitLab maps to `search` /
`updated_after` / `labels` / `milestone` with one relationship per REST call (its `assignee_username` +
`author_username` compose with AND, so relationships must stay separate drains), and Azure to per-project WIQL.
`withoutLinkedPullRequest` and free text have no equivalent on either.

**`countPullRequests`** is the PR twin, closing the asymmetry the audit flagged: the PR side had
`searchPullRequestsPage` but no count probe, so an explicit "search everywhere" on PRs ran blind while the same
action on issues showed a number. It reuses GitHub's `issueCount`-on-a-zero-node `search` — the same primitive
`countIssues` uses — over `PullRequestSearchCriteria`, with the same `key`-echo, per-scope isolation, and
one-relationship-per-scope rules. The one PR-specific decision: a scope's `states` are counted as independent
searches, so the reported count is the **largest** of them (the total `searchPullRequestsPage` itself surfaces
via `Math.max` over facets), not their sum, and `exceedsProviderLimit` compares that max against the per-search
ceiling. GitHub/GHE only, matching `searchPullRequestsPage`.

**Not done, deliberately:** `broadenIssues` was left as-is rather than reimplemented on top of this. It is a
multi-provider, multi-org fan-out with its own result type and per-org cursor bundle, so only its inner
per-org read could be swapped; and its "all visible" breadth maps to an OMITTED relationship set, not to
`any-assignee`, which excludes unassigned issues. See the note in `reads/broaden.ts` and
[`integrations.md` §9](./integrations.md#9-per-provider-behavior-worth-designing-around).

**Kepler-side follow-up:** `ProviderScopeFilter` carries a single `repo?: string` today and needs the criteria
set; the `provider-data` adapter then routes "All visible" to `searchIssuesPage` + `countIssues`.
