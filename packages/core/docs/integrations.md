# Consuming `@gitkraken/core-gitlens` integrations

How to read provider data (pull requests, issues, orgs, projects, repos, repository identity) from
`@gitkraken/core-gitlens` as an external consumer — the surface Kepler migrates onto in
[kepler#1322](https://github.com/gitkraken/kepler/issues/1322).

Scope: the **provider-neutral facade** (`plus/integrations/index.js`). It hands back GitLens-owned shapes and
never leaks `@gitkraken/provider-apis` types, so a consumer depends on this package alone.

- Read-API parity decisions and the provider-apis-level contract: [`kepler-read-api-parity.md`](./kepler-read-api-parity.md)
- `@gitlens/git` service wiring (a separate boundary):
  [`library-architecture.md`](https://github.com/gitkraken/vscode-gitlens/blob/core/docs/library-architecture.md)

---

## 1. Entry points

| Subpath                                              | Use it for                                                                         |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `@gitkraken/core-gitlens/plus/integrations/index.js` | The session-managed facade: manager factory, public types, and connection helpers. |
| `@gitkraken/core-gitlens/plus/integrations/lite.js`  | Stateless, token-scoped single reads (no storage/auth lifecycle). See §10.         |
| `@gitkraken/core-gitlens/git/models/*.js`            | The returned models (`PullRequestShape`, `IssueShape`, …).                         |

Everything else under `plus/integrations/**` is internal. `IntegrationService`, the `GitHostIntegration`
models, and the provider clients are deliberately **not** on the facade: they change without a semver bump.
`manager.js` / `results.js` are not published subpaths either — their types are re-exported through
`index.js`, so import them from there.

> If a type you need to name isn't exported from `index.js`, that's a bug in this package — file it rather
> than re-declaring the shape downstream, which silently drifts.

## 2. Building the runtime

`createIntegrationManager(ctx)` takes one argument: an `IntegrationManagerContext`. It is the **single**
cross-boundary contract — the package never imports `vscode` and has no ambient globals. The extension host's
broader `IntegrationServiceContext` is internal and is not part of the published facade.

| Provider       | Required | What it must do                                                                                                                                                                                  |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `storage`      | yes      | Global + workspace key/value, plus a secret store (tokens land here).                                                                                                                            |
| `account`      | yes      | The GitKraken account and the GK-cloud connect/manage round-trips. Return `undefined` from `getAccount` if you don't use GK cloud (see below).                                                   |
| `config`       | yes      | `getRemoteConfigs()` (self-managed hosts, SSL/protocol overrides), launchpad knobs, a change event.                                                                                              |
| `http`         | yes      | `fetch` + `wrapForForcedInsecureSSL` + `isWeb` + a User-Agent string.                                                                                                                            |
| `cache`        | no       | `IntegrationManagerCacheProvider`, whose only method is `getCurrentAccount`. Omit it for correct uncached reads; implement it for a long-lived manager to deduplicate provider identity lookups. |
| `repositories` | yes      | `getOpenRemotes()`; used only by the "across open repos" helpers. `async () => []` is fine.                                                                                                      |
| `hooks`        | no       | Auth strategy override, reauth/disconnect prompts, outbound behavioral events.                                                                                                                   |

A complete, type-checked, dependency-free example (including the optional-cache path) lives in
[`tests/fixtures/integrations-consumer/src/consumer.test.ts`](https://github.com/gitkraken/vscode-gitlens/blob/core/tests/fixtures/integrations-consumer/src/consumer.test.ts).
It runs against the packed artifact in CI, so it catches missing exports as well as source-level mistakes:
use that file's `buildRuntime()` as your starting point.

The cache callback receives only `{ id, domain }`, a loader, and cache controls (`connectionId`, `etag`,
expiry). It never exposes GitLens' internal `IntegrationBase` / `GitHostIntegration` classes or requires
stubs for unrelated repository, pull-request, or issue caches. The fixture uses the package's public
`PromiseCache` utility, but any cache with the same behavior is valid.

### Authentication

Two strategies, both through the same context:

1. **GK cloud (what GitLens does).** Implement `account.connect` / `openManagement` / `fetchGkApi`; the
   package syncs connections, stores per-connection sessions, tracks primaries, and reconciles multi-account
   state on check-in. `refreshConnections()` forces that sync on demand.
2. **Your own tokens.** Return a provider from the `hooks.createAuthenticationProvider` hook.
   `createManualTokenAuthProvider({ id, token, account, domain? })` wraps a static token; for refreshable
   tokens implement `IntegrationAuthenticationProvider` directly. A manual-token session never expires and
   returns `undefined` on `forceNewSession`, so a reauth-on-failure loop terminates.

### Lifecycle

```ts
const manager = createIntegrationManager(runtime);
try {
	/* reads */
} finally {
	manager.dispose(); // tears down cached integrations, auth providers, and every host subscription
}
```

`onDidChange` fires when the configured-connection set changes; `onDidChangeConnectionState` when a
provider connects/disconnects. Both are safe to drive cache invalidation from.

`refreshConnections()` is an authoritative foreground refresh: it rejects if the GK backend connection list
cannot be read and leaves the last known configuration intact. Background check-in remains best-effort.

## 3. Multi-account and self-managed hosts

Three knobs, in precedence order, select **which account and which host** a read runs against:

| Option         | Meaning                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `connectionId` | A specific connection from `getConfigured()`. Wins over everything. An unresolvable one is a `no-connection` warning + `fetchFailed`, never an empty result. |
| `domain`       | Fallback host for a self-managed provider with no configured connection (manual-token/external auth).                                                        |
| neither        | The provider's primary connection; for a self-managed provider, the primary configured host.                                                                 |

An explicitly supplied `connectionId` or `domain` must be non-empty; whitespace does not fall back to the
primary account. For `listOrgs` and `listProjects`, either selector also requires `providerId` because it
cannot be applied unambiguously to a cross-provider fan-out.

`domain` **must** come from your trusted authentication configuration, never from repository or remote data:
it selects which credentials a read uses, and `resolveRepository` deliberately refuses to resolve a
self-managed remote against a host the user hasn't authenticated (`host-mismatch`).
Use the facade's `hostFromDomain()` when comparing a stored URL-shaped domain with a remote host; this is the
same normalization used internally for connection selection.

Use `getConfigured(id?, { cloud?, domain? })` to enumerate connections, `setPrimaryConnection` /
`deleteConnection` to manage them. Both mutations validate that `connectionId` belongs to the requested
provider before calling the token backend; never reuse an id discovered under a different provider.

## 4. The reads

Every read returns `ProviderResult<T>` (`items` + `warnings` + `fetchFailed?`), and every paged read extends
it with `page` + `hasMore` + `cursor?`. **No read throws for a provider-side failure** — see §6.

| Method                       | Returns                   | Scope                                                                                 |
| ---------------------------- | ------------------------- | ------------------------------------------------------------------------------------- |
| `listOrgs`                   | `ProviderOrganization`    | Orgs / workspaces / groups; issue-tracker resources (Jira sites, …).                  |
| `listProjects`               | `ProviderOrganization`    | The project tier: Azure DevOps, and issue-tracker projects.                           |
| `listRepos`                  | `ProviderRepositoryShape` | Repos of an `org`, or account-wide user-affiliated repos when `org` is omitted.       |
| `listPullRequestsPage`       | `PullRequestShape`        | With `repos`: those repos' PRs. Without: the user's PRs account-wide.                 |
| `searchPullRequestsPage`     | `PullRequestShape`        | PRs involving the user that match structured criteria, optionally repo/org-scoped.    |
| `listIssuesPage`             | `IssueShape`              | Same split, for a **git host**'s issues.                                              |
| `searchIssuesPage`           | `IssueShape`              | Issues matching structured criteria over a repo/org scope — **no** `@me` binding.     |
| `countIssues`                | `IssueCountResult`        | How many match each scope, fetching none of them. See §5.1.                           |
| `listIssueTrackerIssuesPage` | `IssueShape`              | Jira / Linear / Trello (issues live under resource → project).                        |
| `sweepPullRequests`          | `ProviderSweepResult`     | Drains **every** page across providers (`maxPages`, default 100).                     |
| `sweepClosedPullRequests`    | `ProviderSweepResult`     | Same, pinned to `['closed','merged']`.                                                |
| `broadenIssues`              | `ProviderBroadenResult`   | Per-org fan-out: list the org's repos, then read their issues unfiltered by assignee. |
| `resolveRepository`          | `ResolveRepositoryResult` | Remote URL → canonical provider identity (the `gk repo resolve` equivalent).          |
| `getSupportedFilters`        | filter capability table   | Static, connection-free. See §7.                                                      |

A provider that cannot serve a surface says so explicitly — a warning explaining that the operation is
unsupported plus `fetchFailed`, never a silent empty page. That distinction is the whole point of the result
shape: an empty `items` with no warning means "this account genuinely has nothing".

## 5. Paging

Two mechanisms live behind one shape, and they are **not** interchangeable:

- **`cursor`** — an opaque continuation. Threading it back guarantees **one upstream request per scope**.
- **`page`** (1-based) — a position. On a cursor-driven read (GitHub's searches and the broaden fan-out,
  plus provider account-wide reads that return continuations), asking for page N _without_ a cursor makes the
  facade drain pages 1..N internally and
  return only page N: correct, but **O(N) upstream requests**. That drain is the supported fallback for a
  consumer that persisted only a page number (e.g. the first read after a restart).

Pass **both**: `page` labels the position in `page.currentPage`, the cursor is what actually advances.

```ts
let cursor: string | undefined;
for (let page = 1; ; page++) {
	const result = await manager.listPullRequestsPage({ providerId, page, cursor });
	consume(result.items, result.warnings);
	if (!result.hasMore) break; // `hasMore` is never true without a usable `cursor`
	cursor = result.cursor;
}
```

Invariants worth relying on:

- `hasMore: true` **always** comes with a `cursor` you can act on. A provider that claims another page but
  hands back no continuation is reported as terminal-but-incomplete: `hasMore: false` + `page.truncated`.
  So `while (hasMore)` cannot spin.
- `page.currentPage` is **positional**, uniform across every paged read. Continue from `cursor`, not from
  `currentPage + 1` — a cursor-only host can't be addressed by number.
- A page past the provider's last one is an **empty page N**, never page N−1 relabeled.
- `page.itemsPerPage` describes the page that came back; don't infer totals or "last page" from it.
- Composite fan-out cursors retain each scope's exact continuation or retry position. Round-trip the cursor
  even after a partial result: healthy scopes advance while a failed scope retries the page it missed.
- Sweeps drain internally and expose **no** cursor: `hasMore` is always `false`. Gate "this is the complete
  set" on `page.allPages === true`, which is false for _both_ truncation and failure — unlike
  `page.truncated`, which can be misread as a benign cap.

### The filtered pull request search

`searchPullRequestsPage` pushes free text to the provider instead of filtering the already-loaded PR page. It is
bounded by repository/organization or by explicit current-user relationships. Relationship and state arrays are
OR sets, so the same read expresses both Kepler's visible scope and its terminal `closed + merged` scope. Inputs
are structured and checked all-or-nothing against the provider's capability table:

```ts
const caps = manager.getSupportedFilters(providerId).pullRequestSearch;
if (caps.relationships.length === 0) return loadedRowsOnlyFallback();

const result = await manager.searchPullRequestsPage({
	providerId: providerId,
	repos: [{ namespace: 'gitkraken', name: 'vscode-gitlens' }],
	criteria: {
		text: 'graph performance',
		relationships: [PullRequestFilter.Author, PullRequestFilter.Assignee, PullRequestFilter.ReviewRequested],
		states: ['closed', 'merged'],
		includeArchived: false,
	},
	page: page,
	cursor: cursor,
});
```

Omit `relationships` to search every PR in the supplied repo/org scope; without such a scope at least one
relationship is mandatory. This is deliberately not `involves:@me`: that GitHub shortcut excludes
`review-requested` but includes `commenter`, so it cannot match the adjacent visible-PR list.

The provider always orders this read most-recently-updated-first. A threaded `cursor` is exactly one upstream
request; GitHub puts every active relationship × state facet into aliases in that one GraphQL document. A page
number without a cursor walks from page 1. At GitHub's 1,000-result-per-facet ceiling, `page.truncated` is true and
the warning's `omission` carries `totalCount`, `limit`, and `recovery: 'none'`. `totalCount` is the largest
provider-reported pre-ceiling facet count, matching the per-search ceiling's unit; it is not the returned or
still-reachable row count. Free text is sanitized so qualifier-shaped tokens such as `org:other` are removed
rather than allowed to change the structured scope.

### 5.1 The filtered issue search and its count probe

`searchIssuesPage` answers "every issue in this scope matching X", which no other issue read can: the
account-wide `listIssuesPage` is bound to the user's own relationships, and its repo-scoped path goes through
the SDK read whose over-limit recovery walk can spend up to 128 sequential requests and still return an
incomplete set. This one is a single request per page.

```ts
const caps = manager.getSupportedFilters(providerId).issueSearch;
if (caps.relationships.length === 0) return; // provider has no filtered issue search — hide the surface

const result = await manager.searchIssuesPage({
	providerId: providerId,
	repos: [{ namespace: 'gitkraken', name: 'vscode-gitlens' }],
	criteria: {
		relationships: ['unassigned'],
		...(caps.updatedAfter ? { updatedAfter: '2026-05-05' } : {}),
	},
});
```

Three parts of the contract that are decisions, not incidentals:

- **Scope is mandatory.** Pass `repos`, `org`, or a user relationship (`authored` / `assigned` / `mentioned`).
  `any-assignee` and `unassigned` do **not** scope anything — they describe the issue, not the caller, so
  either one alone matches every such issue on the host. A call carrying only those is refused (warning +
  `fetchFailed`), as is one scoping by repository **id**: a search names repositories by path, so ids would
  silently widen the read to the whole org.
- **Ordering is always most-recently-updated-first.** Not an option: a "show the N most recent" policy at the
  result ceiling is only correct under a guaranteed order.
- **`itemsPerPage` is per RELATIONSHIP**, since each becomes its own provider query: a page of an
  N-relationship search returns up to `N × itemsPerPage` items before deduplication, and fewer where they
  overlap. Read `page.itemsPerPage` for what actually came back.
- **At the result ceiling the read SUCCEEDS.** More matches than the provider will serve is an _omission_, not
  a failure: `fetchFailed` stays absent, and the warning carries `omission.totalCount` (how many matched),
  `omission.limit` (how many are reachable) and `recovery: 'none'` — the rest is unreachable however you page,
  so never offer a "load more" here. Narrowing the criteria is the only way through.

`criteria` is validated all-or-nothing against the capability table before the read runs, exactly like
`filters` (§7). Free-form values (`text`, `labels`, `milestone`) are sanitized so user input cannot inject a
qualifier and re-scope the search; `text` additionally drops tokens containing `:`, since the structured
criteria are the qualifier channel.

**`countIssues`** answers "how many match" without fetching any — what a "this will fetch ~N issues" preview
needs, and what a live count beside an unapplied filter chip needs. Measured against GitHub, 30 counts are a
single rate-limit point, but each batch is still a network request: debounce and cache it if it's driven from
UI state.

```ts
const counts = await manager.countIssues({
	providerId: providerId,
	scopes: [
		{ key: 'unassigned', repos: repos, criteria: { relationships: ['unassigned'] } },
		{ key: 'recent', repos: repos, criteria: { updatedAfter: '2026-05-05' } },
	],
});
```

- Results are echoed under your own `key`, so no positional matching. A **duplicate key refuses the whole
  call** — two results under one key make matching ambiguous for every scope.
- **`count: undefined` means "not reported", never zero.** Render the difference: showing an unknown count as
  0 tells the user a filter matches nothing when it may match thousands. A provider that can't count at all
  refuses rather than fabricating.
- `exceedsProviderLimit` is the signal to warn before starting an expensive fetch.
- Isolation is per scope and per batch: a refused scope (unscoped, id-based repos, inexpressible criteria)
  costs no request and drops only itself, and a failed batch drops only its own scopes — `fetchFailed` is set
  and every other count still comes back.
- One relationship per scope. A relationship set is OR-ed, which a single count can neither sum (it would
  double-count overlaps) nor max (it would under-report), so such a scope is refused. Give each relationship
  its own `key`.

## 6. Failures: warnings, `fetchFailed`, `truncated`

A per-provider (or per-connection, or per-scope) failure degrades to a **warning attached to a partial
result** instead of rejecting the call. One provider's expired token never blanks the other providers' data.

`ProviderWarning.kind` (also exported as `ProviderWarningKind`) carries the classifications the facade can
prove from structured errors:

| `kind`          | Meaning                                                                                                                                         | Reasonable response                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `auth`          | Token rejected (401/403 that isn't a throttle).                                                                                                 | Prompt to reconnect that connection.                                                        |
| `rate-limit`    | Throttled (429, or a 403 whose body says so).                                                                                                   | Back off and retry; keep the last snapshot.                                                 |
| `not-found`     | 404/410/422 on the requested scope.                                                                                                             | Drop that scope; don't reconnect.                                                           |
| `no-connection` | The requested `connectionId`/`domain` doesn't resolve.                                                                                          | Re-resolve the target or re-authenticate.                                                   |
| `other`         | Catch-all: unsupported input, truncation, upstream/network failure, or an unclassified error. Read `omission` before treating one as a failure. | Preserve the warning and use the result flags; do not assume it is benign or non-retryable. |

`isAuth` is a convenience mirror of `kind === 'auth'`. **Collapsing `kind` into that boolean loses the
rate-limit and not-found distinctions**, which then have to be re-derived from raw provider prose.
Conversely, `other` is intentionally not a complete failure taxonomy. Treat `message` as display/diagnostic
text rather than a stable protocol; use `fetchFailed`, `page.truncated`, and `page.allPages` for completeness
and keep unknown failures conservative.

### `omission` — succeeded, but withheld results

`other` covers two facts with **opposite remedies**: a request that failed, and a request that succeeded while
part of the answer was withheld. `ProviderWarning.omission` is set only for the second, so a consumer can act
on it without parsing `message`:

```ts
if (warning.omission != null) {
	// The read SUCCEEDED — message it as incompleteness, not failure.
	// Whether anything would fetch the rest is a separate question; see `recovery` below.
	if (warning.omission.recovery !== 'none') offerLoadMore(warning.omission);
}
```

`kind` stays `'other'` for these on purpose: it is the discriminant derived from a caught exception's type, and
adding a member would silently change what `'other'` means for every existing build.

**Its absence proves nothing.** It is never set on a failure — an exception or a structured scope failure —
where it would be a lie. But it is also absent whenever incompleteness was reported without naming what was
left out, so treat a bare `kind: 'other'` warning as unclassified rather than as a proven failure.

The line that matters is whether the request **succeeded**, not whether a tail was left unread. A drain that
stopped on its own accounting succeeded and is capped, so it carries the omission; a drain that was interrupted
mid-read left an unread tail too, but a retry may complete it — that one carries no omission and sets
`fetchFailed`.

`kind` says **why** results are missing:

| `omission.kind`         | What happened                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `provider-limit`        | The provider refuses to serve past a cap (GitHub search's 1,000, Trello's `cards_limit`).                                          |
| `recovery-budget`       | The internal partitioned recovery stopped before visiting every partition.                                                         |
| `pagination-incomplete` | Pages were left unread: an undrained sub-scope, a page budget, or a provider that advertised another page without a usable cursor. |

#### `recovery` — what, if anything, would fetch the rest

**`kind` does not answer that**, and `pagination-incomplete` is why: a drain that stopped at a page budget and
a provider that gave no usable cursor are the same kind, but only the first can be fetched. Gate a "load more"
affordance on `recovery`, never on `kind`:

| `omission.recovery` | Means                                                          | What a consumer does                                                       |
| ------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `none`              | Nothing you can call returns the missing items.                | Say the results are capped. Do not offer to fetch more.                    |
| `page-budget`       | Re-run the same read with a higher `maxPages` (sweep options). | Offer it — but note it re-reads from the start, so make it user-initiated. |

`recovery` is **required** — unlike `limit`, `totalCount` and `scope`, it is never absent. An absent value
would be indistinguishable from `none` while actually meaning "this producer didn't say", which is the
ambiguity `omission` exists to remove.

It is also **conservative**: it names only what a producer can prove, so `none` means "not known to be
recoverable", not "proven unrecoverable". Today only a sweep that spent its own page budget reports
`page-budget`; everything else — every provider cap, every exhausted internal budget, and every omission
derived from SDK metadata — is `none`. A `scope` does not change that. It attributes where results were
withheld, and the SDK reports the same scoped shape both for a scope it merely sampled and for one whose
cursor stalled, so re-reading it is not something this layer can promise.

`limit`, `totalCount` and `scope` are forwarded only when reported; **most omissions carry none of the three**,
so render correctly without them. Two traps: `totalCount` is `number | undefined` and never `null` (the SDK's
`null` is normalized to absent at the boundary), and `limit` on `recovery-budget` is a **request** budget — do
not show it to a user as a number of results.

Warnings dedup on their structure, `omission` included, so two omissions that differ only in kind, recovery or
scope stay two warnings even if their messages ever converge.

| Flag                    | Says                                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetchFailed`           | `items` is incomplete because a scope failed, or because a flat hierarchy read was truncated. Distinguishes this from a genuine empty result. |
| `page.truncated`        | The read completed but couldn't confirm it had everything (provider cap, `maxPages` backstop, or a missing continuation).                     |
| `page.allPages`         | Sweeps only: `true` iff every page of every target drained cleanly.                                                                           |
| `failedProviderIds`     | Sweeps/broadens: providers whose requested scopes produced no usable result.                                                                  |
| `incompleteProviderIds` | Sweeps/broadens: providers with a usable result plus a failed, partial, or truncated sibling scope.                                           |

An omission pairs with `page.truncated: true` — results are missing — and typically with `fetchFailed: false`,
since nothing failed. But the flags are **per result** and `omission` is **per warning**, so the two can differ
on a fan-out: a sweep where provider A was capped and provider B failed outright reports `fetchFailed: true`
while A's omission stays true for A. Read `omission` on the warning that carries it — its `providerId`,
`domain` and `connectionId` say who it is about — rather than inferring it from the aggregate.

What is guaranteed is the narrower thing: a warning never claims its own read succeeded when it didn't. A drain
that dies mid-read publishes its unread tail with no omission, even if an earlier page had already reported
one.

`resolveRepository` reports through `resolution.status` instead: `resolved` · `not-found` · `unauthorized` ·
`unsupported-provider` · `invalid-remote-url` · `host-mismatch` · `undetermined`. A `resolved` identity
carries the provider's **canonical** owner/name plus `renamed: true` when the local remote is stale.

## 7. Filters are all-or-nothing

`filters` (`PullRequestFilter` / `IssueFilter`) narrows repo-scoped reads and account-wide PR/issue reads to
the current user's relationship with the item. A set containing even **one** filter the provider can't
express is **refused whole** —
empty `items` + warning + `fetchFailed` — because falling through unfiltered would return _every_ PR
instead of the user's.

So intersect against the capability table first:

```ts
const supported = manager.getSupportedFilters(providerId); // static, no connection needed
const capability = repos.length === 0 ? (supported.pullRequestsAccountWide ?? []) : supported.pullRequests;
const filters = wanted.filter(f => capability.includes(f));
```

- `pullRequests` — the repo-scoped PR read.
- `pullRequestsAccountWide` — the optional account-wide PR capability. Treat a missing field as empty.
- `pullRequestSearch` — the filtered PR search (`searchPullRequestsPage`). Always present; empty `relationships`
  means the provider has no such search. It declares the exact `relationships` and `states`, plus `text`,
  `updatedAfter`, `createdAfter`, `includeArchived`, `draft`, `repositoryScope`, `organizationScope`, and `sorts`
  — the ordering vocabulary, as `field:direction` keys. A key not in `sorts` refuses the whole read, exactly like
  an inexpressible filter; `updated:desc` is always in it when the search exists at all, so omitting
  `criteria.sort` never refuses.
- `issues` — the **repo-scoped** git-host read, **and** the issue-tracker read
  (`listIssueTrackerIssuesPage` validates against this field).
- `issuesAccountWide` — the account-wide git-host read only. Usually narrower (GitLab can express
  `Assignee` and `Author`, but not `Mention`), and empty for issue trackers.
- `issueSearch` — the **filtered issue search** (`searchIssuesPage`, and `countIssues` over the same
  criteria). A third, wider surface: not bound to the user at all, so it takes relationships the other two
  can't name. Reported as per-criterion flags rather than a list, and **always present** — a provider with no
  filtered issue search reports empty `relationships` and all-false flags, which is the signal to hide the
  surface rather than individual chips.

It's a _capability_ table, not a recommendation: passing fewer filters than listed is fine.

PR filter composition depends on the read:

- **Repo-scoped** members are combined as provider query constraints (normally an intersection). To build
  `Author ∪ Assignee ∪ ReviewRequested`, issue one paged read per facet and union the results.
- **Account-wide** members are an exact OR union. The facade fans out or post-filters provider-native
  relationship slices as required, preserving one composite cursor where the provider pages. A sweep target's
  `filters` overrides the sweep-level set, which lets a cross-provider caller request each provider's exact
  supported subset without leaking provider query syntax.

On the account-wide issue read, `filters` **replaces** the provider's own definition of "my issues"
(GitHub authored ∪ assigned ∪ mentioned; Azure assigned ∪ authored; GitLab assigned-to-me), so
`[Assignee]` means `assignee:@me` wherever it's expressible. `includeAllAssignees`
does the opposite (drops the user scope); passing both on that account-wide read is refused as contradictory.

`searchIssuesPage`'s `criteria.relationships` follows the same all-or-nothing rule and the same OR semantics
(one provider query per member, unioned and deduped), with two additions that are **not** about the user:
`any-assignee` (assigned to anyone) and `unassigned` (assigned to nobody). They partition the scope between
them, so requesting both is refused. Note that "all visible issues" is the **omitted** relationship set, not
`any-assignee` — which excludes unassigned issues.

`includeReviewRequested` is a legacy account-wide breadth option used only when no explicit `filters` are
supplied. It remains useful for Bitbucket Cloud, where the reviewer slice requires an expensive
O(workspaces × repos) fan-out; prefer `filters: [ReviewRequested]` when an exact relationship is required.

Aggregate account-wide PR reads use a lightweight list shape. Stable list fields, body, and branch refs are
preserved; optional enrichments such as reviews, checks, and stats may be absent.

## 8. Provider capability matrix

Derived from the provider models and `providersMetadata`. ✓ supported · ✗ reported unsupported
(warning + `fetchFailed`) · — not applicable. Self-managed variants inherit their cloud family's hooks.

| Surface                      | GitHub / GHE | GitLab / self-hosted | Bitbucket | Bitbucket DC | Azure DevOps (+ Server) | Jira | Linear | Trello |
| ---------------------------- | :----------: | :------------------: | :-------: | :----------: | :---------------------: | :--: | :----: | :----: |
| `listOrgs`                   |      ✓       |          ✓           |     ✓     |      ✗       |            ✓            |  ✓   |   ✓    |   ✓    |
| `listProjects`               |      —       |          —           |     —     |      —       |            ✓            |  ✓   |   ✓    |   ✓    |
| `listRepos` (`org`)          |      ✓       |          ✓           |     ✓     |      ✗       |            ✓            |  ✗   |   ✗    |   ✗    |
| `listRepos` (account-wide)   |      ✓       |          ✓           |     ✗     |      ✗       |            ✗            |  ✗   |   ✗    |   ✗    |
| PRs, repo-scoped             |      ✓       |          ✓           |     ✓     |      ✓       |            ✓            |  ✗   |   ✗    |   ✗    |
| PRs, account-wide            |      ✓       |          ✓           |     ✓     |      ✓       |            ✓            |  ✗   |   ✗    |   ✗    |
| PR `states` account-wide     |      ✓       |          ✓           |     ✓     |      ✓       |            ✓            |  —   |   —    |   —    |
| `searchPullRequestsPage`     |      ✓       |          ✗           |     ✗     |      ✗       |            ✗            |  ✗   |   ✗    |   ✗    |
| Issues, repo-scoped          |      ✓       |          ✓           |     ✗     |      ✗       |            ✓            |  —   |   —    |   —    |
| Issues, account-wide         |      ✓       |          ✓           |     ✗     |      ✗       |            ✓            |  —   |   —    |   —    |
| `searchIssuesPage`           |      ✓       |          ✗           |     ✗     |      ✗       |            ✗            |  ✗   |   ✗    |   ✗    |
| `countIssues`                |      ✓       |          ✗           |     ✗     |      ✗       |            ✗            |  ✗   |   ✗    |   ✗    |
| Issues by `org`/`project`    |      ✗       |          ✗           |     ✗     |      ✗       |            ✓            |  ✓   |   ✓    |   ✓    |
| `listIssueTrackerIssuesPage` |      —       |          —           |     —     |      —       |            —            |  ✓   |   ✓    |   ✓    |
| `broadenIssues`              |      ✓       |          ✓           |     ✗     |      ✗       |            ✓            |  ✗   |   ✗    |   ✗    |
| `resolveRepository`          |      ✓       |          ✓           |     ✓     |      ✓       |            ✓            |  ✗   |   ✗    |   ✗    |

Repo-scoped PR filters: GitHub/GHE `Author, Assignee, ReviewRequested, Mention` · GitLab `Author, Assignee,
ReviewRequested` · Bitbucket + Bitbucket DC `Author, ReviewRequested` · Azure `Author, Assignee,
ReviewRequested`.
Account-wide PR filters: GitHub/GHE `Author, Assignee, ReviewRequested, Mention` · GitLab
`Author, Assignee, ReviewRequested` · Bitbucket + Bitbucket DC `Author, ReviewRequested` · Azure
`Author, Assignee, ReviewRequested`.
PR **search** capabilities (`getSupportedFilters().pullRequestSearch`): GitHub/GHE express relationships
`Author, Assignee, ReviewRequested, Mention`, states `open, closed, merged, all`, `text`, `updatedAfter`,
`createdAfter`, `includeArchived`, `draft`, repository/organization scopes, and sorts
`updated:desc|asc, created:desc|asc`. Every other provider declares empty lists and false flags, so the read is
refused rather than returning a page that did not apply a requested criterion or scope. `updatedAfter` /
`createdAfter` are ISO `YYYY-MM-DD` and are the most effective narrowing on a large scope — the way to bound a broad
closed-PR read, rather than capping page iterations. `draft` is tri-state: `true` returns only drafts, `false` only
ready-for-review PRs, and omitting it places no constraint — so a consumer sending `draft: false` must not treat it
as "unset". The sort vocabulary is narrower than the issue search's on purpose: a merged page can only be re-ordered
by a field a normalized pull request carries, and GitHub PRs have neither a priority nor a relevance that ranks
stably under the result ceiling.
Issue filters: GitHub/GHE + Azure + Jira `Author, Assignee, Mention` · GitLab `Author, Assignee` ·
Linear + Trello `Assignee` · Bitbucket family none.
Account-wide issue filters: GitHub/GHE `Author, Assignee, Mention` · Azure `Author, Assignee` · GitLab
`Assignee, Author` · everything else none.
Issue **search** criteria (`getSupportedFilters().issueSearch`): GitHub/GHE express all of them —
relationships `authored, assigned, mentioned, any-assignee, unassigned`, plus `text`, `labels`, `milestone`,
`updatedAfter`, `createdAfter`, `withoutLinkedPullRequest`, `state` — and every other provider declares none,
so the read is refused there rather than serving a list that was never narrowed. GitLab and Azure could
express most of it (GitLab: `search`, `updated_after`, `labels`, `milestone`, one relationship per REST call;
Azure: WIQL per project), so the gap is unimplemented rather than impossible; `withoutLinkedPullRequest` and
free text have no equivalent on either.

> `supportedCloudIntegrationDescriptors.supports` (in `constants.ts`) describes what GitLens _advertises in
> its connect UI_, including enrichment-only capabilities. It is **not** the read-capability answer — use
> `getSupportedFilters` and this matrix.

## 9. Per-provider behavior worth designing around

- **GitHub / GHE** — cursor-only everywhere. The filtered PR search aliases each requested relationship × state
  facet into one GraphQL request per page, dedupes facet overlap, and sorts the page most-recently-updated-first.
  With no relationships it searches every PR in the required repo/org scope. The
  account-wide issue read is three searches (`author:@me`, `assignee:@me`, `mentions:@me`) behind one composite
  cursor; the filtered account-wide `listPullRequestsPage` read is one search per state × relationship facet
  behind a composite cursor that resumes only active facets. Each search caps
  at GitHub's own 1,000-result ceiling, surfaced as `page.truncated` — and on the filtered searches additionally
  as an omission carrying the total match count (§5.1). The only provider with a filtered issue search today.
  `includeAllAssignees` is refused on the **account-wide** issue read: it becomes `assignee:*`, which needs a
  scope to mean anything (unscoped it matches millions of issues across all of GitHub) and that read has none
  to offer. Any scope works, though — one repository, several, or an org — so "assigned to anyone over these
  repos" is `searchIssuesPage` with `relationships: ['any-assignee']`.
- **GitLab / self-hosted** — numbered per-repo cursors for repo-scoped reads. Account-wide PR state selection
  is forwarded to each relationship query. Account-wide issues can independently narrow to assignee or author;
  the unfiltered read unions both.
- **Bitbucket Cloud** — no issues at all on this surface (tracker deprecated; use Jira). No account-wide
  repo walk (list per workspace). The account-wide PR read drains every workspace and returns **one
  aggregate page** (no cross-workspace cursor), so `itemsPerPage` doesn't apply. The review-requested slice
  is opt-in via `includeReviewRequested: true`, because it costs an O(workspaces × repos) fan-out.
- **Bitbucket Data Center** — no org discovery, no repo discovery, no issues. `provider-apis` converts the
  public 1-based page number to the REST `start` offset and normalizes `nextPageStart` back to a page number;
  the facade carries that number inside its opaque cursor.
- **Azure DevOps** — org + project scoped. Repo-scoped reads accept one org per call. Account-wide reads
  drain every project of every org and return one aggregate page; a failed project becomes a scoped warning
  while its siblings survive. Only Azure can narrow an account-wide issue read by `org`/`project`.
  `resolveRepository` needs a project in the remote URL. Azure DevOps Server uses the trusted connection's
  domain/protocol as `baseUrl`; the remote host must match that configured connection.
- **Jira / Linear / Trello** — paged by **project**, not by issue: `itemsPerPage` counts projects (default
  20), each drained in full. Passing none of `page`/`cursor`/`itemsPerPage` aggregates every matched project
  in one page. A single project exceeding its internal drain backstop shows up as `page.truncated`.
  Trello's issue `id` is the card's `idShort` — unique per board only, so correlate across boards by
  `nodeId`. For Trello, boards are both the resource and the project, so `listOrgs` and `listProjects`
  return the same set; Linear's resource is the organization and its projects are teams.
  Thread the returned cursor verbatim: it can combine the next untouched project window with discovery/project
  retries, preserve a caller's aggregate-all mode, and suppress projects already emitted before discovery
  recovered. `hasMore` reports only untouched forward progress. A cursor can therefore remain with
  `hasMore: false`; reusing it is an explicit manual retry of failed work, not a normal paging loop.

**`broadenIssues` vs `searchIssuesPage`.** If you already know your repository set, prefer
`searchIssuesPage({ repos })`: `broadenIssues` has to discover each org's repositories first (a paged drain)
and then reads their issues through the SDK path with the recovery walk, so it costs strictly more for the
same answer. It remains the read for "fan out across these orgs, whatever repos they turn out to contain",
with per-provider attribution (`broadenedProviderIds` / `failedProviderIds` / `incompleteProviderIds`) that
the single-provider search doesn't produce.

If you do migrate: broaden means **all visible** — it drops the assignee constraint entirely, so unassigned
issues are included. The equivalent is therefore an **omitted** `relationships`, **not**
`['any-assignee']` — `assignee:*` means "has some assignee" and would silently exclude every unassigned issue.

The same warning holds for `IssueShape.id` generally: it's the provider's **display** number/key (rendered
as `#{id}`, used for branch names). `nodeId` is the stable provider-native id, but its uniqueness scope is
provider-specific (Azure work-item ids are organization-scoped). For cross-scope correlation, key by
provider/domain plus repository or project identity and `nodeId`; `url` is also unique for the provider reads
that require one.

## 10. Token-scoped reads (`lite.js`)

For a consumer that already holds a provider token and wants one stateless read — no storage, no session
lifecycle, no OAuth:

```ts
import { createTokenScopedGitHostIntegration } from '@gitkraken/core-gitlens/plus/integrations/lite.js';

const api = createTokenScopedGitHostIntegration(
	GitCloudHostIntegrationId.GitHub,
	{ accessToken: token },
	{ fetch: fetch },
);
const metadata = await api.getRepositoryMetadata('gitkraken', 'vscode-gitlens');
```

Supports `getRepositoryMetadata` + `getDefaultBranch` for GitHub/GHE, GitLab/self-hosted, Bitbucket Cloud,
and Azure DevOps (+ Server). **Not** Bitbucket Data Center. A self-managed id requires `token.domain`
(it throws otherwise, rather than building a malformed base URL). Azure encodes the repo as
`"{project}/_git/{repoName}"`.

## 11. Checklist for a new consumer

1. Start from `buildRuntime()` in the consumer fixture; implement `storage` for real. Add
   `cache.getCurrentAccount` when the manager is long-lived or provider identity reads are frequent.
2. Pick an auth strategy (§2) and verify `getConfigured()` reflects your connections.
3. Thread `connectionId` through every read if you support multiple accounts per provider.
4. Persist the **opaque `cursor`**, not just a page number (§5).
5. Branch on specific `warning.kind` values, handle `other` conservatively, and gate caching on
   `fetchFailed` / `page.allPages` (§6).
6. Intersect repo-scoped and account-wide `filters` against their distinct `getSupportedFilters` fields (§7).
7. Treat "unsupported" as a first-class outcome per provider (§8) — don't render it as an error.
8. `dispose()` the manager with the owning scope.

## 12. Development and publication prerequisite

The current `core` branch depends on the provider fixes used by this facade: GitLab author filtering and PR
state forwarding, GitHub search-completeness metadata, Bitbucket Data Center page normalization, and
self-managed Azure project-scoped repository lookup. During coordinated development, a local
`provider-apis` worktree/link may temporarily supply those fixes; that link is a test setup, not a publishable
dependency contract.

Before publication, replace any local link with the released `@gitkraken/provider-apis` version containing
the verified fixes and regenerate the workspace catalog/lockfile. Do not publish or bump
`@gitkraken/core-gitlens` until that dependency is released and the Kepler migration has been verified end to
end against the packed artifact.
