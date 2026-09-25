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

| Method                       | Returns                   | Scope                                                                                                           |
| ---------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `listOrgs`                   | `ProviderOrganization`    | Orgs / workspaces / groups / Bitbucket DC projects; issue-tracker resources (Jira sites, …).                    |
| `listProjects`               | `ProviderOrganization`    | The project tier: Azure DevOps, and issue-tracker projects.                                                     |
| `listRepos`                  | `ProviderRepositoryShape` | Repos of an `org`, or account-wide user-affiliated repos when `org` is omitted.                                 |
| `listPullRequestsPage`       | `PullRequestShape`        | With `repos`: those repos' PRs. Without: the user's PRs account-wide.                                           |
| `searchPullRequestsPage`     | `PullRequestShape`        | PRs involving the user that match structured criteria, optionally repo/org-scoped.                              |
| `countPullRequests`          | `PullRequestCountResult`  | How many PRs match each scope, fetching none where the provider can count. See §5.1.                            |
| `listIssuesPage`             | `IssueShape`              | Same split, for a **git host**'s issues.                                                                        |
| `searchIssuesPage`           | `IssueShape`              | Issues matching structured criteria over a repo/org scope — **no** `@me` binding.                               |
| `countIssues`                | `IssueCountResult`        | How many match each scope, fetching none of them. See §5.1.                                                     |
| `getIssuesBatch`             | `IssueBatchResult`        | Resolves N `(owner, repo, number)` coordinates in one request; an absence is proven.                            |
| `getTrackerIssue`            | `TrackerIssueResult`      | Resolves ONE tracker issue by key within a resource; an absence is proven. Jira (Cloud + Data Center) / Linear. |
| `listIssueTrackerIssuesPage` | `IssueShape`              | Jira (Cloud + Data Center) / Linear / Trello (issues live under resource → project).                            |
| `sweepPullRequests`          | `ProviderSweepResult`     | Drains **every** page across providers (`maxPages`, default 100).                                               |
| `sweepClosedPullRequests`    | `ProviderSweepResult`     | Same, pinned to `['closed','merged']`.                                                                          |
| `broadenIssues`              | `ProviderBroadenResult`   | Per-org fan-out for every visible issue, unfiltered by assignee.                                                |
| `resolveRepository`          | `ResolveRepositoryResult` | Remote URL → canonical provider identity (the `gk repo resolve` equivalent).                                    |
| `getSupportedFilters`        | filter capability table   | Static, connection-free. See §7.                                                                                |

A provider that cannot serve a surface says so explicitly — a warning explaining that the operation is
unsupported plus `fetchFailed`, never a silent empty page. That distinction is the whole point of the result
shape: an empty `items` with no warning means "this account genuinely has nothing".

`getTrackerIssue` takes `resourceId` for every supported tracker. Jira Cloud also takes `resourceUrl`, the site URL
returned by `listOrgs`; the REST response only supplies an API `self` link, so the caller provides the already-known
site identity rather than making this point read perform resource discovery. Linear does not need it, and neither
does Jira Data Center, whose browser link is built from the connection's own base URL.

For Jira Data Center `resourceId` is the host — the instance's single resource, as `listOrgs` reports it — and the
read takes the `domain` its siblings take to select the instance. Unlike them it never falls back to the primary
connection: a self-managed tracker requires a `domain` or a `connectionId` with a configured host, and is refused
(warning + `fetchFailed`) otherwise. Two self-hosted instances routinely share project and issue keys, and this
read's `issue: undefined` is a proven absence a caller may cache, so an answer from whichever host happens to be
primary would be cached under a key that names a different instance. For the same reason a `resourceId` that names
a different host than the one the read resolves to is refused rather than read.

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

The read is ordered by `criteria.sort`, most-recently-updated-first when omitted; the keys a provider accepts are
`getSupportedFilters().pullRequestSearch.sorts`. On GitHub/GHE a threaded `cursor` is exactly one upstream request,
since every active relationship × state facet travels as an alias in one GraphQL document; Bitbucket Data Center
has no such batching and spends one request per repository × relationship facet still being read. A page number
without a cursor walks from page 1. At GitHub's 1,000-result-per-facet ceiling, `page.truncated` is true and
the warning's `omission` carries `totalCount`, `limit`, and `recovery: 'none'`. `totalCount` is the largest
provider-reported pre-ceiling facet count, matching the per-search ceiling's unit; it is not the returned or
still-reachable row count. Free text is sanitized so qualifier-shaped tokens such as `org:other` are removed
rather than allowed to change the structured scope.

The `repos`/`org` scope is held to a stricter rule than that free text, and the same one §5.1 documents: a
scope name carrying a quote, an inner space or a control character is **refused** (warning + `fetchFailed`),
not sanitized, and the refusal names the value; edge whitespace and control characters are stripped and
accepted. `countPullRequests` validates each scope through the same rule, so a count never previews a query
the read would refuse.

`itemsPerPage` is **per relationship × state facet**, not per page — one axis more than §5.1's
per-relationship fan-out, since each facet is its own aliased provider query. A page of a 3-relationship,
2-state search returns up to `6 × itemsPerPage` items before deduplication, and fewer where the facets
overlap; deduplication does **not** bring the page back to the requested size, since it removes only the rows
the facets share. As in §5.1: size the list off `page.itemsPerPage`, not off the value you sent; a provider
may cap the `itemsPerPage` it honors below what you asked for.

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

Parts of the contract that are decisions, not incidentals:

- **Scope is mandatory.** Pass `repos`, `org`, or a user relationship (`authored` / `assigned` / `mentioned`).
  `any-assignee` and `unassigned` do **not** scope anything — they describe the issue, not the caller, so
  either one alone matches every such issue on the host. A call carrying only those is refused (warning +
  `fetchFailed`), as is one scoping by repository **id**: a search names repositories by path, so ids would
  silently widen the read to the whole org.
- **A scope name must name the same scope after sanitizing.** Unlike the free-form values below, a scope
  carrying a quote, an inner space or a control character is **refused** (warning + `fetchFailed`) rather than
  sanitized, and the refusal names the offending value. Sanitizing answers "what can I still send?", which for
  a scope is the wrong question — the sanitized value may name a real but **different** scope. Leading and
  trailing whitespace and control characters are the exception and are accepted: stripping them does not
  change which scope the query names, so refusing them would reject a name the provider resolves correctly. A
  repository descriptor is checked as its JOINED `namespace/name` path, which is what a `repo:` qualifier
  names — an edge character on a half is an interior character of the path, and both halves must be
  non-empty. `org: ''` still means "no org supplied" and falls through to the remaining scopes. A provider with no
  filtered search at all is reported as such first, so an unusable scope never masks it.
- **Ordering is always most-recently-updated-first.** Not an option: a "show the N most recent" policy at the
  result ceiling is only correct under a guaranteed order.
- **`itemsPerPage` is per RELATIONSHIP**, since each becomes its own provider query: a page of an
  N-relationship search returns up to `N × itemsPerPage` items before deduplication, and fewer where they
  overlap. Read `page.itemsPerPage` for what actually came back and size the list off that, not off the value
  you sent; a provider may also cap the `itemsPerPage` it honors below what you asked for.
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

**`countPullRequests`** is the PR twin of `countIssues` — same `key`-echo contract, per-scope/per-batch
isolation, `count: undefined` ≠ zero rule, `exceedsProviderLimit`, and one-relationship-per-scope refusal. It
takes the same `criteria` as `searchPullRequestsPage` and is validated against the same capability table.

```ts
const counts = await manager.countPullRequests({
	providerId: providerId,
	scopes: [{ key: 'mine-open', repos: repos, criteria: { relationships: [PullRequestFilter.Author] } }],
});
```

The one difference is inherent to pull requests: on GitHub/GHE a scope's `states` (open/closed/merged) are
counted as independent searches, so the reported `count` is the **largest** of them — the same total
`searchPullRequestsPage` surfaces — not their sum. Because the result ceiling applies per search, that max is
what `exceedsProviderLimit` compares against. Several states in one scope are therefore fine (they are
disjoint); only several relationships are refused, except on Bitbucket Data Center (below). Azure DevOps Server
reads every state in one drain, so its count is their union (the sum, since states are disjoint), again the total
its search pages through.

Bitbucket Data Center has no count query, no total on its pages and no result ceiling, so it counts by reading
each facet's first page of up to 1,000 pull requests through the same predicates the search applies. Its `count`
is therefore the exact **union** of the requested states — the number of rows the search returns — and when a
facet has more than one page it comes back with `lowerBound: true`: a floor, to be shown as "N+" and treated as
at least that expensive. Absent `lowerBound` means the count is exact, though computed from the rows read rather
than reported by the server. Because it reads the
rows, it also counts several relationships in one scope as their exact union, the same OR the search applies, so
the one-relationship-per-scope refusal does not apply there. Each scope is its own set of requests, so a Bitbucket
Data Center count is not free the way a GitHub one is; debounce and cache it.

## 6. Failures: warnings, `fetchFailed`, `truncated`

A per-provider (or per-connection, or per-scope) failure degrades to a **warning attached to a partial
result** instead of rejecting the call. One provider's expired token never blanks the other providers' data.

`ProviderWarning.kind` (also exported as `ProviderWarningKind`) carries the classifications the facade can
prove from structured errors:

| `kind`          | Meaning                                                                                                                                         | Reasonable response                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `auth`          | Token rejected (401/403 that isn't a throttle).                                                                                                 | Prompt to reconnect that connection. A scoped one is narrower: see `scope` below.           |
| `rate-limit`    | Throttled (429, or a 403 whose body says so).                                                                                                   | Back off and retry; keep the last snapshot.                                                 |
| `not-found`     | 404/410/422 on the requested scope.                                                                                                             | Drop that scope; don't reconnect.                                                           |
| `no-connection` | The requested `connectionId`/`domain` doesn't resolve.                                                                                          | Re-resolve the target or re-authenticate.                                                   |
| `other`         | Catch-all: unsupported input, truncation, upstream/network failure, or an unclassified error. Read `omission` before treating one as a failure. | Preserve the warning and use the result flags; do not assume it is benign or non-retryable. |

`isAuth` is a convenience mirror of `kind === 'auth'`. **Collapsing `kind` into that boolean loses the
rate-limit and not-found distinctions**, which then have to be re-derived from raw provider prose.
Conversely, `other` is intentionally not a complete failure taxonomy. Treat `message` as display/diagnostic
text rather than a stable protocol; use `fetchFailed`, `page.truncated`, and `page.allPages` for completeness
and keep unknown failures conservative.

### `scope` — which part of the read failed

A fan-out read records a failure against the organization, project or repository it happened in.
`ProviderWarning.scope` forwards that attribution (`resourceId`, `projectId`, `repositoryId`, whichever the
provider reported), so a consumer can tell "one organization refused this token" from "the connection's token
is dead" without parsing `message`:

```ts
if (warning.kind === 'auth' && warning.scope == null) {
	promptToReconnect(warning.providerId, warning.connectionId);
} else if (warning.kind === 'auth') {
	// One organization/project/repository refused the credential, e.g. an Azure DevOps organization with
	// third-party OAuth access disabled, one in another Entra tenant, or a Conditional Access policy.
	// Reconnecting cannot fix that, so mark only that scope unavailable and keep the others.
	markScopeUnavailable(warning.providerId, warning.connectionId, warning.scope);
}
```

`kind` and `isAuth` do not change with it: a scoped 401 is still an authentication failure, and `scope` says
how far it reaches. **Its absence means account-wide or unattributed**, so a consumer that ignores the field
keeps its existing behavior. It is set only on warnings derived from a structured scope failure, and names at
least one ID when present; a failure attributed to nothing below the provider carries none. A warning built
from a caught exception never carries one, even when that call targeted a single organization, and an omission
keeps its attribution in `omission.scope` instead.

A scoped `auth` failure also means **the credential itself was accepted**. A dead token can come back as
nothing but scoped refusals wherever a read reaches its scopes without an uncached request to the connection
first: discovery served from a per-token cache (Azure DevOps, Bitbucket and Jira Cloud cache the account, its
organizations, workspaces or sites, and their projects), or an SDK fan-out across the requested repositories
(Bitbucket Data Center). So when a read's only auth failures are scoped, those providers confirm the credential
with one uncached check before reporting them. A refused credential fails the whole read instead: an
unscoped `auth` warning, `fetchFailed`, no results served from the cache, and the usual connection recovery.
A refusal the provider pins on the credential itself, like Bitbucket's or Jira Cloud's for a token missing the
OAuth scopes the read needs, is published unscoped too, once for the connection, because a reconnect
(consenting to them again) is what fixes it; the scopes that answered keep their results.

The promise holds for a read that carries no unscoped `auth` warning of its own: one that does already asks for a
reconnect, and its other scoped refusals are not checked. Two cases stay scoped even then. A check that could not
complete or was denied (a network error, a throttle, a `403`, Bitbucket Data Center refusing a credential it
authenticated, or a Bitbucket Data Center project access token, whose user the check cannot find) proves nothing,
so the warnings are published unconfirmed and carry no `cause`, and the next read checks again. And a credential
confirmed within the last minute is not checked again, so a scope that keeps refusing a sound credential costs at
most one extra check a minute, and a revocation can take up to a minute to surface as a connection failure.

`scope.resourceId` is the resource as the read addressed it: its id on most reads, its name on the few that
address it by name (Azure DevOps' repo-scoped reads, Bitbucket's workspace reads). Match it against both
`ProviderOrganization.id` and `name`.

Warnings also dedup on `scope` and `cause`, so failures of two scopes stay two warnings.

### `cause` — why a sound credential was refused

A scoped `auth` warning can also say **why** the scope refused, so a consumer recommends the fix instead of a
reconnect. `ProviderWarning.cause` carries a closed `reason` to switch on (also exported as
`ProviderWarningCauseReason`), the provider's own `code` when it reports one, and a `remedyUrl` when this layer
can address the setting behind the refusal. `message` says the same in prose.

```ts
switch (warning.cause?.reason) {
	case 'oauth-app-not-allowed':
		// An admin enables the org's third-party OAuth policy at `remedyUrl`, or the user connects with a PAT.
		suggestAllowingOAuthApps(warning.scope, warning.cause.remedyUrl);
		break;
	case 'access-denied':
		suggestRequestingAccess(warning.scope);
		break;
	case 'conditional-access':
		suggestAskingTheTenantAdmin(warning.scope);
		break;
}
```

| `cause.reason`          | Means                                                                                    | Fixed by                                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oauth-app-not-allowed` | The organization does not let third-party OAuth apps in.                                 | An organization admin enabling **Third-party application access via OAuth** (Azure DevOps; off by default for new organizations), or a PAT, which the policy does not govern. |
| `access-denied`         | The account has no access to that organization or project (not a member, no permission). | Someone who administers it granting access.                                                                                                                                   |
| `conditional-access`    | A Microsoft Entra Conditional Access policy blocked the request (`VS403463`).            | The tenant admin exempting the request.                                                                                                                                       |

It is set **only on a scoped `auth` warning whose credential was confirmed** (see `scope` above), because until
then these refusals look exactly like a dead credential: Azure DevOps answers a third-party OAuth app its
organization disallows with the same bare `401` it gives an expired token. Only Azure DevOps names causes today,
from answers captured against the live service. **Its absence proves nothing**: a refusal this layer cannot name
still carries the provider's own explanation, when it gave one, in `message`, e.g. an organization that only
allowlists global personal access tokens.

### `omission` — succeeded, but withheld results

`other` covers two facts with **opposite remedies**: a request that failed, and a request that succeeded while
part of the answer was withheld. `ProviderWarning.omission` is set only for the second, so a consumer can act
on it without parsing `message`:

```ts
if (warning.omission != null) {
	// The read SUCCEEDED — message it as incompleteness, not failure.
	// Whether anything would fetch the rest is a separate question; see `recovery` below.
	// Switch on the VALUE. `!== 'none'` is not "fetchable": `narrow-scope` is not.
	if (warning.omission.recovery === 'page-budget') offerLoadMore(warning.omission);
	else if (warning.omission.recovery === 'narrow-scope') suggestNarrowingTheScope(warning.omission);
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

| `omission.recovery` | Means                                                                                    | What a consumer does                                                       |
| ------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `none`              | Nothing you can call returns the missing items.                                          | Say the results are capped. Do not offer to fetch more.                    |
| `page-budget`       | Re-run the same read with a higher `maxPages` (sweep options).                           | Offer it — but note it re-reads from the start, so make it user-initiated. |
| `narrow-scope`      | A smaller server-side scope can avoid the backstop; no budget or retry reaches the rest. | Suggest narrowing the scope. Do **not** offer to fetch more.               |

`recovery` is **required** — unlike `limit`, `totalCount` and `scope`, it is never absent. An absent value
would be indistinguishable from `none` while actually meaning "this producer didn't say", which is the
ambiguity `omission` exists to remove.

It is also **conservative**: it names only what a producer can prove, so `none` means "not known to be
recoverable", not "proven unrecoverable". Only a sweep that spent its own page budget reports `page-budget`, and
only a broad Jira project query that provably stopped at its own page backstop reports `narrow-scope`.
Already-scoped Jira reads and Linear reads use `none` when they emit an omission because changing the public
scope cannot make those provider requests narrower. Other caps and exhausted budgets also use `none`; a stalled
cursor or failed page may instead be a failure with no omission. A `scope` does not change that. It attributes where results were
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
const capability = repos.length === 0 ? supported.pullRequestsAccountWide : supported.pullRequests;
const filters = wanted.filter(f => capability.includes(f));
```

- `pullRequests` — the repo-scoped PR read.
- `pullRequestsAccountWide` — the account-wide PR capability. Always reported, empty at worst. Usually
  the narrower of the two, but **not** a subset of `pullRequests`: `Reviewed` (GitHub `reviewed-by:@me`) is
  account-wide only, because the repo-scoped read has no reviewed-by axis to constrain. So pick the field by
  the read you are about to issue rather than intersecting the two.
- `pullRequestSearch` — the filtered PR search (`searchPullRequestsPage`, and `countPullRequests` over the same
  criteria). Always present; empty `relationships` means the provider has no such search. It declares the exact
  `relationships` and `states`, plus `text`, `updatedAfter`, `createdAfter`, `includeArchived`, `draft`,
  `repositoryScope`, `organizationScope`, and `sorts` — the ordering vocabulary, as `field:direction` keys. A key
  not in `sorts` refuses the whole read, exactly like an inexpressible filter; `updated:desc` is always in it when
  the search exists at all, so omitting `criteria.sort` never refuses.
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

`ReviewRequested` and `Reviewed` are different questions: the first is a request still waiting on you, the
second is a PR you have already reviewed (so it is waiting on the author). A "needs my review" surface wants
both, as separate reads. The review row itself rides along only where the full projection does — the
filtered search, or a sweep with `includeReviews` — not from `Reviewed` on its own.

`includeReviewRequested` is a legacy account-wide breadth option used only when no explicit `filters` are
supplied. It remains useful for Bitbucket Cloud, where the reviewer slice requires an expensive
O(workspaces × repos) fan-out; prefer `filters: [ReviewRequested]` when an exact relationship is required.

Aggregate account-wide PR reads use a lightweight list shape. Stable list fields, body, and branch refs are
preserved; optional enrichments such as reviews, checks, and stats may be absent.

`includeReviews: true` on an account-wide **sweep** opts back into the full projection (review decision,
review requests, and `latestReviews` — each with the `commitOid` it was submitted against, so a consumer can
tell a review still at the tip from one the PR has moved past). GitHub/GHE only: no other provider's
account-wide read has a projection switch, so those targets return their native shape and the option is a
breadth request rather than a guarantee — it never refuses. It costs a heavier GraphQL selection, so the read
drops to the reduced 30-node page and pages for the rest; budget `maxPages` accordingly. That cost is per
**sweep**, not per relationship: every state × relationship facet uses the heavy selection and each facet is
its own request per page, and the selection dominates the smaller page. So ask for it on a narrow sweep — the
relationships that need the review, typically `Reviewed` (plus `ReviewRequested` when the reviewed commit of a
pending request matters) — and read the rest as a separate lightweight sweep.

It does not change WHICH pull requests come back: every GitHub account-wide read takes the same route
regardless of the option (the Launchpad ignored-repository and included/ignored-organization qualifiers apply
either way), so the option is purely projection plus its page cost. What it does scale with is the relationship
count, since one document holds every facet: five relationships × four states is 20 full-projection selections.

`listPullRequestsPage` has no projection switch. Scoped to `repos` it goes through the provider's repo-scoped
read, and GitHub's carries `latestReviews` natively; account-wide (no `repos`) it is always the lite shape and
no option opts it back in. `commitOid` is absent from both: only the full projection populates it.

The paginated read that does carry the full projection is `searchPullRequestsPage` with
`criteria.relationships` on GitHub/GHE (Bitbucket Data Center also exposes the search, with its native row shape):
its results always include the review projection with `commitOid`, it honors `itemsPerPage`, and one threaded
cursor page is exactly one upstream request — every relationship × state facet travels in the same query,
unlike the account-wide read, which spends one request per facet per page. So a surface that pages
incrementally should ask the search read for `Reviewed` (and `ReviewRequested` as its own read) rather than
reach for `includeReviews`, which only exists on the all-at-once sweep.

## 8. Provider capability matrix

Derived from the provider models and `providersMetadata`. ✓ supported · ✗ reported unsupported
(warning + `fetchFailed`) · — not applicable. Self-managed variants inherit their cloud family's hooks.

| Surface                      | GitHub / GHE | GitLab / self-hosted | Bitbucket | Bitbucket DC | Azure DevOps (+ Server) | Jira (+ DC) | Linear | Trello |
| ---------------------------- | :----------: | :------------------: | :-------: | :----------: | :---------------------: | :---------: | :----: | :----: |
| `listOrgs`                   |      ✓       |          ✓           |     ✓     |      ✓       |            ✓            |      ✓      |   ✓    |   ✓    |
| `listProjects`               |      —       |          —           |     —     |      —       |            ✓            |      ✓      |   ✓    |   ✓    |
| `listRepos` (`org`)          |      ✓       |          ✓           |     ✓     |      ✓       |            ✓            |      ✗      |   ✗    |   ✗    |
| `listRepos` (account-wide)   |      ✓       |          ✓           |     ✗     |      ✓       |            ✗            |      ✗      |   ✗    |   ✗    |
| PRs, repo-scoped             |      ✓       |          ✓           |     ✓     |      ✓       |            ✓            |      ✗      |   ✗    |   ✗    |
| PRs, account-wide            |      ✓       |          ✓           |     ✓     |      ✓       |            ✓            |      ✗      |   ✗    |   ✗    |
| PR `states` account-wide     |      ✓       |          ✓           |     ✓     |      ✓       |            ✓            |      —      |   —    |   —    |
| `searchPullRequestsPage`     |      ✓       |          ✗           |     ✗     |      ✓       |            ✗            |      ✗      |   ✗    |   ✗    |
| `countPullRequests`          |      ✓       |          ✗           |     ✗     |      ✓       |            ✗            |      ✗      |   ✗    |   ✗    |
| Issues, repo-scoped          |      ✓       |          ✓           |     ✗     |      ✗       |            ✓            |      —      |   —    |   —    |
| Issues, account-wide         |      ✓       |          ✓           |     ✗     |      ✗       |            ✓            |      —      |   —    |   —    |
| `searchIssuesPage`           |      ✓       |          ✓           |     ✗     |      ✗       |            ✗            |      ✗      |   ✗    |   ✗    |
| `countIssues`                |      ✓       |          ✓           |     ✗     |      ✗       |            ✗            |      ✗      |   ✗    |   ✗    |
| `getIssuesBatch`             |      ✓       |          ✓           |     ✗     |      ✗       |            ✗            |      ✗      |   ✗    |   ✗    |
| `getTrackerIssue`            |      ✗       |          ✗           |     ✗     |      ✗       |            ✗            |      ✓      |   ✓    |   ✗    |
| Issues by `org`/`project`    |      ✗       |          ✗           |     ✗     |      ✗       |            ✓            |      ✓      |   ✓    |   ✓    |
| `listIssueTrackerIssuesPage` |      —       |          —           |     —     |      —       |            —            |      ✓      |   ✓    |   ✓    |
| `broadenIssues`              |      ✓       |          ✓           |     ✗     |      ✗       |            ✓            |      ✗      |   ✗    |   ✗    |
| `resolveRepository`          |      ✓       |          ✓           |     ✓     |      ✓       |            ✓            |      ✗      |   ✗    |   ✗    |

Bitbucket Data Center exposes its projects through `listOrgs`: both `id` and `name` are the project key.
Pass that key as `org` to `listRepos` to select a project, or omit `org` to enumerate all accessible repositories,
including personal repositories. It has no additional project tier, so `listProjects` is not applicable.
Project discovery drains up to 20 pages and reports `fetchFailed` with warnings if incomplete. Repository
discovery returns one page with an opaque continuation cursor; reuse it with the same connection and `org`.
Both reads deduplicate results across pages and retain the configured installation URL, including its context path.
A link the server returns is kept only when it names that entry on the configured installation; otherwise the web and
HTTPS links are rebuilt from the configured URL and an SSH link, whose host and port cannot be derived, is omitted.

Jira Data Center inherits Jira Cloud's row. Its reads are addressed per host, so `domain` selects the instance and
every read below is scoped to that one connection; a paged read that omits it gets the primary configured host,
while `getTrackerIssue` refuses instead (see §4). `listOrgs` returns exactly one resource — the
instance itself, synthesized from the configured host rather than fetched — and its projects carry the display name
as `key`, because `/rest/api/2/project` reports no project key; reads address the project by id regardless. No
autolinks are registered for the same reason: an autolink prefix has to be the project key.

Repo-scoped PR filters: GitHub/GHE `Author, Assignee, ReviewRequested, Mention` · GitLab `Author, Assignee,
ReviewRequested` · Bitbucket + Bitbucket DC `Author, ReviewRequested` · Azure `Author, Assignee,
ReviewRequested`.
Account-wide PR filters: GitHub/GHE `Author, Assignee, ReviewRequested, Reviewed, Mention` · GitLab
`Author, Assignee, ReviewRequested` · Bitbucket + Bitbucket DC `Author, ReviewRequested` · Azure
`Author, Assignee, ReviewRequested`. `Reviewed` is the one member that is account-wide only — no provider
exposes a reviewed-by axis on the repo-scoped read, so it is absent from the repo-scoped list above.
PR **search** capabilities (`getSupportedFilters().pullRequestSearch`): GitHub/GHE express relationships
`Author, Assignee, ReviewRequested, Reviewed, Mention`, states `open, closed, merged, all`, `text`, `updatedAfter`,
`createdAfter`, `includeArchived`, `draft`, repository/organization scopes, and sorts
`updated:desc|asc, created:desc|asc`. Bitbucket Data Center expresses relationships `Author, ReviewRequested,
Reviewed`, states `open, closed, merged, all`, `text` (title or description), `includeArchived`, `draft`, the
repository scope, and sorts `updated:desc|asc` — no assignee or mention (its pull requests have neither), no date
filters, no `created` order, and no organization scope, since it has no project-wide pull-request list. Azure DevOps
Server expresses relationships `Author, Assignee, ReviewRequested` (the last two both read Azure's reviewers, since
it has no separate assignee), the same four states, `text` (title or description), `updatedAfter`, `createdAfter`,
`draft`, repository/organization scopes and `updated:desc|asc, created:desc|asc`; not `Reviewed`, `Mention` or
`includeArchived`. Every other provider — including Azure DevOps Services — declares empty lists and false flags,
so the read is refused rather than returning a page that did not
apply a requested criterion or scope. `updatedAfter` /
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
`updatedAfter`, `createdAfter`, `withoutLinkedPullRequest`, `state`. Azure DevOps Server expresses relationships
`authored, assigned, any-assignee, unassigned`, `text` (a title substring), `labels` (whole tags), `updatedAfter`,
`createdAfter` and `state`, and sorts `updated`, `created`, `closed`, `comments` and `title` in both directions —
not `mentioned` (`@RecentMentions` only reaches back 30 days), `milestone` or `withoutLinkedPullRequest`, and not
`priority`/`resolved`, whose process-template fields an on-premises collection may not define. Every other provider
declares none, so the read is refused there rather than serving a list that was never narrowed. GitLab and Azure
DevOps Services could express most of it, so the gap is unimplemented rather than impossible.

> `supportedCloudIntegrationDescriptors.supports` (in `constants.ts`) describes what GitLens _advertises in
> its connect UI_, including enrichment-only capabilities. It is **not** the read-capability answer — use
> `getSupportedFilters` and this matrix.

## 9. Per-provider behavior worth designing around

### Tracker issue state

`IssueShape.state` remains the normalized `'opened' | 'closed'` value used by existing consumers. Tracker issues also
carry the provider's own workflow state in the optional `providerState` field; it is display data and is not added to
`IssueOrPullRequest`, because pull requests' normalized `'opened' | 'closed' | 'merged'` state is complete.

The field mirrors what `provider-apis` provides. `name` is the provider's untranslated display name, `color` is
omitted when the provider returns `null`, and `category` is only present where the provider supplies it:

| Provider     | `name`              | `color` | `category`                               |
| ------------ | ------------------- | ------- | ---------------------------------------- |
| Jira Cloud   | Status name         | Yes     | Yes, from the stable status-category key |
| Jira DC      | Status name         | Yes     | No — see below                           |
| Linear       | Workflow state name | Yes     | Yes, mapped from the Linear state type   |
| Trello       | Card list name      | No      | No                                       |
| Azure DevOps | Work-item state     | No      | No                                       |
| GitHub       | `open` / `closed`   | No      | No                                       |
| GitLab       | `opened` / `closed` | No      | No                                       |

For Jira, legacy reads may omit `category` when `provider-apis` only has a localized status name to classify; the
direct issue-by-key read supplies the stable category. `name` and `color` are preserved in both cases. Jira Data
Center has no read that supplies the stable key — every one of its issue reads goes through the SDK's
localized-name classification, which defaults an unrecognized name to `DONE` — so its `category` is always omitted
and `closed` is decided by `closedDate` alone. A done issue with no resolution date therefore reads as open; that
direction is deliberate, since trusting a name-matched `DONE` would report every open issue on a non-English
instance as closed.

The normalized `state` and `closed` fields keep their existing derivation; `providerState` is additive.

### Sprints and iterations

`IssueShape.iterations` carries the sprints or iteration an issue belongs to. It is additive and optional, and an
absent value means **this read could not report one**, not that the issue has no sprint — coverage varies per read,
not just per provider:

| Provider     | Read                              | `iterations`                                    |
| ------------ | --------------------------------- | ----------------------------------------------- |
| Jira         | Project-scoped issue reads        | Yes, every sprint the issue belongs to          |
| Jira         | Point, account-wide, issue-by-key | No — none of those field lists requests sprints |
| Azure DevOps | Direct and SDK-backed reads       | Yes, one iteration                              |
| Others       | —                                 | No                                              |

Jira's sprint field is a per-instance custom field that `provider-apis` resolves by its display name, so a site that
renames or localizes it reports no sprints even on the reads that ask for it.

The metadata each provider supplies differs, and nothing is invented to even it out. Jira reports `isActive` and the
sprint dates; Azure reports only a path, so its iterations carry `id` and `name` alone. An absent `isActive`
therefore means **unknown**, not inactive — don't filter iterations out with it.

`id` is a sprint id on Jira and the verbatim iteration path on Azure, so it is only meaningful within one provider's
project — don't correlate on it across providers, and don't persist it: Azure rewrites the path when an iteration
node is renamed or re-parented. Both Azure routes produce the identical `id` for the same work item, because the
direct read mirrors `provider-apis`' own normalization.

### Issue body format

`IssueShape.body` is not normalized to one markup language. Jira descriptions come from REST v2 as wiki markup,
while GitHub, GitLab, and Linear descriptions are Markdown. Jira issues therefore set
`bodyFormat: 'jira-wiki'`; an omitted `bodyFormat` means consumers should preserve the existing behavior and treat
`body` as Markdown. The `'markdown'` value is reserved for providers that need to make that format explicit.

Rendering and conversion remain consumer concerns. In particular, the Jira body is neither ADF nor converted to
Markdown by this package.

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
- **Bitbucket Data Center** — projects are the org tier; repositories can be listed by project or account-wide.
  Discovery follows exact `nextPageStart` offsets, with cursors bound to the connection and scope. It has no
  issues. Pull-request reads use the SDK's 1-based page numbers, carried inside their own opaque cursors.
  The filtered PR search reads each requested repository × relationship as its own request (a relationship
  without repositories reads the user's dashboard; `Reviewed` there is two requests, the reviewer and the
  participant lists, because the dashboard only filters by review status together with a role), follows each
  facet's own `nextPageStart`, and binds its
  cursor to the connection, the configured installation URL and the query. Every criterion is re-checked on the
  rows returned, so a server that ignores one (`draft` before 8.18) narrows instead of widening. A repository that
  fails becomes a scoped warning with `fetchFailed` while the others still answer, and is retried once, at the
  page it missed, on the next page; if the retry fails too it is dropped and reported on every later page, so one
  that never answers can't hold `hasMore` open. A 401, or a 403 on the dashboard, is the credential and fails the
  read; a 403 on one repository is that repository refusing the token, reported for it alone. Several states
  (and `closed`, which is `DECLINED` plus `SUPERSEDED`) are read as every state and filtered, rather than costing
  a request each.
- **Azure DevOps** — org + project scoped. Repo-scoped reads accept one org per call. Account-wide reads
  drain every project of every org and return one aggregate page; a failed project becomes a scoped warning
  while its siblings survive. Only Azure can narrow an account-wide issue read by `org`/`project`.
  `resolveRepository` needs a project in the remote URL. Azure DevOps Server uses the trusted connection's
  `baseUrl`, including its installation path. A repository's virtual directory must match that path and is
  applied once; a connection addressed at the host root takes the repository's own virtual directory. An address
  that also names a collection (`https://server/tfs/DefaultCollection`) reads that collection without repeating it:
  discovery reports it as the one collection visible there, since Azure only lists collections at the server level,
  and another collection's repositories need an address without the collection. Installation paths match case-insensitively, as IIS serves them. An SSH remote
  that names no virtual directory is read against the whole address, since it can't tell a virtual directory from
  another collection named there.

  Azure DevOps Server also has the filtered searches and their counts, with the collection applied exactly once
  whichever way the address is written. Scope names are encoded as URL segments (collections, projects,
  repositories) or escaped as WIQL string literals (a repository's project in the work-item query), never spliced
  into a qualifier syntax, so names with spaces or quotes are accepted there.
  - **Work items** (`searchIssuesPage` / `countIssues`) run ONE WIQL query per page over ONE collection, with every
    relationship OR-ed in it, so an item matching two relationships is one row and the count is the exact size of
    the same match set. `org` names the collection; without it the repositories' collection is used, and without
    either the only collection the account can see. A search across several collections is refused (pass `org`),
    as is one whose repositories name a project the collection doesn't have. Repositories bound the query by
    their project, since work items belong to projects. The page reads the first 20,000 matches (Azure's documented
    query result limit), bounded with `$top`; past that it is `truncated` with a `provider-limit` omission carrying
    `limit` and `sort` but no `totalCount`, and the count reports `exceedsProviderLimit: true` with no `count` rather
    than the limit. Verified against Azure DevOps Server 2020 with 20,014 matches. A server that refuses the match set
    even with `$top` (`VS402337`) fails the page (warning + `fetchFailed`, "narrow the search"), since no bounded query
    could serve that order's first window; its count still reports `exceedsProviderLimit`.
    A pagination pages through the ids its first page queried, kept while it keeps reading (5 minutes after the last
    page, 30 at most, among the 50 most recently read paginations); every first page queries its own, so a pagination of the same query started later never
    replaces it. A continuation whose snapshot is gone is refused (warning + `fetchFailed`) rather than resumed
    against a fresh query, where an item moved by the `updated` order could be skipped. Restart without the cursor.
    A cursor is bound to its query and refused under another one. `page` without a cursor walks from page 1 against
    a fresh query. Requests use REST `api-version=5.0`, so Azure DevOps Server 2019 or later is required.
  - **Pull requests** (`searchPullRequestsPage` / `countPullRequests`) drain every facet — each repository, or each
    project of the `org` (every visible project when only relationships bound the search), times each
    relationship — reading up to 1,000 pull requests per facet, then apply text, draft and dates, union by repository
    identity (so pull request #1 in two projects stays two rows) and order the result. A pagination pages through
    the drain its own first page read while it keeps reading (5 minutes after the last page, 30 at most, among the 50
    most recently read paginations), from a
    keyset cursor; a later first page of the same query drains anew without replacing it. A continuation whose drain
    is gone, or handed to another connection, is refused like an expired work-item snapshot, since a re-drain could
    move a pull request whose close date changed past the position already served. The count reuses the drain a
    first page of the same query read within the last minute, and drains afresh otherwise, so a polled count stays
    live. A facet that exceeds the drain bound makes the result `truncated` with no total, and its count `undefined`.
    Dates that aren't `YYYY-MM-DD` are refused before anything is read, and in a count only for their own scope. A facet whose
    read fails fails the whole search rather than serving a union with a hole in its order. Text matches the title
    or the first 400 characters of the description (all a pull request list returns), and `updatedAfter` compares
    Azure's close date (or creation date while open), since Azure reports no last-activity date. `itemsPerPage`
    is per page here, not per facet. A repository name of `.` or `..` is refused rather than resolved as a path.

- **Jira (Cloud + Data Center) / Linear / Trello** — paged by **project**, not by issue: `itemsPerPage` counts projects (default
  20), each drained in full. Passing none of `page`/`cursor`/`itemsPerPage` aggregates every matched project
  in one page. A single project exceeding its internal drain backstop shows up as `page.truncated`.
  Trello's issue `id` is the card's `idShort` — unique per board only, so correlate across boards by
  `nodeId`. For Trello, boards are both the resource and the project, so `listOrgs` and `listProjects`
  return the same set; Linear's resource is the organization and its projects are teams.
  Thread the returned cursor verbatim: it can combine the next untouched project window with discovery/project
  retries, preserve a caller's aggregate-all mode, and suppress projects already emitted before discovery
  recovered. `hasMore` reports only untouched forward progress. A cursor can therefore remain with
  `hasMore: false`; reusing it is an explicit manual retry of failed work, not a normal paging loop.

Self-managed descriptors keep `domain` as the normalized host and expose the configured installation address
in `baseUrl`. Provider requests use the selected connection's address, including during account discovery.
HTTPS repository resolution requires the configured host, web port, and installation path; the installation
prefix is removed before parsing the repository identity. Without a `connectionId`, the connection whose
installation path is the longest prefix of the remote resolves it (the primary on a tie); a remote under an
installation that an unpinned read can't reach through its own session resolves as `host-mismatch` rather
than through another installation's session. SSH resolution uses the configured web address and
port, since the SSH endpoint can use a different port and omit the web installation path. If several configured
web authorities share an SSH hostname, select one with `connectionId` or a trusted `domain`.

**`broadenIssues` vs `searchIssuesPage`.** `broadenIssues` now reads each org through the org-scoped
filtered search where the provider declares one (GitHub/GHE, Azure DevOps Server), so it no longer discovers
repositories first and no longer routes through the SDK read's recovery walk — one request per page, per org. A
provider with no filtered search (Azure DevOps Services, GitLab) still takes the repository drain, since refusing
the org would be worse. It remains the read for "fan out across these orgs, whatever repos they turn out to contain", with
per-provider attribution (`broadenedProviderIds` / `failedProviderIds` / `incompleteProviderIds`) that the
single-provider search doesn't produce; reach for `searchIssuesPage` when you want ONE scope with an order
you control.

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
