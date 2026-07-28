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
cross-boundary contract — the package never imports `vscode` and has no ambient globals. The full GitLens
extension host can continue to pass its `IntegrationServiceContext`; it is structurally compatible.

| Provider       | Required | What it must do                                                                                                                                                    |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `storage`      | yes      | Global + workspace key/value, plus a secret store (tokens land here).                                                                                              |
| `account`      | yes      | The GitKraken account and the GK-cloud connect/manage round-trips. Return `undefined` from `getAccount` if you don't use GK cloud (see below).                     |
| `config`       | yes      | `getRemoteConfigs()` (self-managed hosts, SSL/protocol overrides), launchpad knobs, a change event.                                                                |
| `http`         | yes      | `fetch` + `wrapForForcedInsecureSSL` + `isWeb` + a User-Agent string.                                                                                              |
| `cache`        | no       | Cross-call cache. Omit it for correct uncached reads. A long-lived consumer should implement `getCurrentAccount` caching to deduplicate provider identity lookups. |
| `repositories` | yes      | `getOpenRemotes()`; used only by the "across open repos" helpers. `async () => []` is fine.                                                                        |
| `hooks`        | no       | Auth strategy override, reauth/disconnect prompts, outbound behavioral events.                                                                                     |

A complete, type-checked, dependency-free example (including the optional-cache path) lives in
[`tests/fixtures/integrations-consumer/src/consumer.test.ts`](https://github.com/gitkraken/vscode-gitlens/blob/core/tests/fixtures/integrations-consumer/src/consumer.test.ts).
It runs against the packed artifact in CI, so it catches missing exports as well as source-level mistakes:
use that file's `buildRuntime()` as your starting point.

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
| `listIssuesPage`             | `IssueShape`              | Same split, for a **git host**'s issues.                                              |
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
- Sweeps drain internally and expose **no** cursor: `hasMore` is always `false`. Gate "this is the complete
  set" on `page.allPages === true`, which is false for _both_ truncation and failure — unlike
  `page.truncated`, which can be misread as a benign cap.

## 6. Failures: warnings, `fetchFailed`, `truncated`

A per-provider (or per-connection, or per-scope) failure degrades to a **warning attached to a partial
result** instead of rejecting the call. One provider's expired token never blanks the other providers' data.

`ProviderWarning.kind` (also exported as `ProviderWarningKind`) carries the classifications the facade can
prove from structured errors:

| `kind`          | Meaning                                                                                       | Reasonable response                                                                         |
| --------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `auth`          | Token rejected (401/403 that isn't a throttle).                                               | Prompt to reconnect that connection.                                                        |
| `rate-limit`    | Throttled (429, or a 403 whose body says so).                                                 | Back off and retry; keep the last snapshot.                                                 |
| `not-found`     | 404/410/422 on the requested scope.                                                           | Drop that scope; don't reconnect.                                                           |
| `no-connection` | The requested `connectionId`/`domain` doesn't resolve.                                        | Re-resolve the target or re-authenticate.                                                   |
| `other`         | Catch-all: unsupported input, truncation, upstream/network failure, or an unclassified error. | Preserve the warning and use the result flags; do not assume it is benign or non-retryable. |

`isAuth` is a convenience mirror of `kind === 'auth'`. **Collapsing `kind` into that boolean loses the
rate-limit and not-found distinctions**, which then have to be re-derived from raw provider prose.
Conversely, `other` is intentionally not a complete failure taxonomy. Treat `message` as display/diagnostic
text rather than a stable protocol; use `fetchFailed`, `page.truncated`, and `page.allPages` for completeness
and keep unknown failures conservative.

| Flag                | Says                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `fetchFailed`       | `items` is incomplete because something failed. Distinguishes failure from empty.                                         |
| `page.truncated`    | The read completed but couldn't confirm it had everything (provider cap, `maxPages` backstop, or a missing continuation). |
| `page.allPages`     | Sweeps only: `true` iff every page of every target drained cleanly.                                                       |
| `failedProviderIds` | Sweeps only: providers whose top-level read failed before any usable page.                                                |

`resolveRepository` reports through `resolution.status` instead: `resolved` · `not-found` · `unauthorized` ·
`unsupported-provider` · `invalid-remote-url` · `host-mismatch` · `undetermined`. A `resolved` identity
carries the provider's **canonical** owner/name plus `renamed: true` when the local remote is stale.

## 7. Filters are all-or-nothing

`filters` (`PullRequestFilter` / `IssueFilter`) narrows a repo-scoped read, or an account-wide issue read, to
the current user's relationship with the item. A set containing even **one** filter the provider can't
express server-side is **refused whole** —
empty `items` + warning + `fetchFailed` — because falling through unfiltered would return _every_ PR
instead of the user's.

So intersect against the capability table first:

```ts
const supported = manager.getSupportedFilters(providerId); // static, no connection needed
const capability = repos.length === 0 ? (supported.pullRequestsAccountWide ?? []) : supported.pullRequests;
const filters = wanted.filter(f => capability.includes(f));
```

- `pullRequests` — the repo-scoped PR read.
- `pullRequestsAccountWide` — the optional account-wide PR capability. Treat a missing field as empty. It is
  currently empty for every provider because those
  native "my PRs" queries expose provider-defined relationship unions rather than independently selectable
  axes. Passing account-wide `filters` is refused instead of returning a wider union.
- `issues` — the **repo-scoped** git-host read, **and** the issue-tracker read
  (`listIssueTrackerIssuesPage` validates against this field).
- `issuesAccountWide` — the account-wide git-host read only. Usually narrower (GitLab can express
  `Assignee` and `Author`, but not `Mention`), and empty for issue trackers.

It's a _capability_ table, not a recommendation: passing fewer filters than listed is fine, and on an
already-user-scoped read they add nothing.

On the account-wide issue read, `filters` **replaces** the provider's own definition of "my issues"
(GitHub authored ∪ assigned ∪ mentioned; Azure assigned ∪ authored; GitLab assigned-to-me), so
`[Assignee]` means `assignee:@me` wherever it's expressible. `includeAllAssignees`
does the opposite (drops the user scope); passing both on that account-wide read is refused as contradictory.

Bitbucket Cloud's expensive account-wide reviewer fan-out is a separate breadth option:
`includeReviewRequested: true`. It is not a narrowing `PullRequestFilter`.

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
| Issues, repo-scoped          |      ✓       |          ✓           |     ✗     |      ✗       |            ✓            |  —   |   —    |   —    |
| Issues, account-wide         |      ✓       |          ✓           |     ✗     |      ✗       |            ✓            |  —   |   —    |   —    |
| Issues by `org`/`project`    |      ✗       |          ✗           |     ✗     |      ✗       |            ✓            |  ✓   |   ✓    |   ✓    |
| `listIssueTrackerIssuesPage` |      —       |          —           |     —     |      —       |            —            |  ✓   |   ✓    |   ✓    |
| `broadenIssues`              |      ✓       |          ✓           |     ✗     |      ✗       |            ✓            |  ✗   |   ✗    |   ✗    |
| `resolveRepository`          |      ✓       |          ✓           |     ✓     |      ✓       |            ✓            |  ✗   |   ✗    |   ✗    |

Repo-scoped PR filters: GitHub/GHE `Author, Assignee, ReviewRequested, Mention` · GitLab `Author, Assignee,
ReviewRequested` · Bitbucket + Bitbucket DC `Author, ReviewRequested` · Azure `Author, Assignee,
ReviewRequested`.
Issue filters: GitHub/GHE + Azure + Jira `Author, Assignee, Mention` · GitLab `Author, Assignee` ·
Linear + Trello `Assignee` · Bitbucket family none.
Account-wide issue filters: GitHub/GHE `Author, Assignee, Mention` · Azure `Author, Assignee` · GitLab
`Assignee, Author` · everything else none.

> `supportedCloudIntegrationDescriptors.supports` (in `constants.ts`) describes what GitLens _advertises in
> its connect UI_, including enrichment-only capabilities. It is **not** the read-capability answer — use
> `getSupportedFilters` and this matrix.

## 9. Per-provider behavior worth designing around

- **GitHub / GHE** — cursor-only everywhere. The account-wide issue read is three searches (`author:@me`,
  `assignee:@me`, `mentions:@me`) behind one composite cursor; a state-filtered PR read is one search per
  state behind a per-state cursor bundle. Each search caps at GitHub's own result ceiling, surfaced as
  `page.truncated`. `includeAllAssignees` is refused account-wide (scope to repos instead).
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
  The project window is positional over the discovered project list, so a page whose project discovery came
  back partial (`fetchFailed`) shifts the following windows — restart the read rather than paging on from it.

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
