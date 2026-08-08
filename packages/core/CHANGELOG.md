# Change Log

All notable changes to `@gitkraken/core-gitlens` will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/) and this project adheres to [Semantic Versioning](http://semver.org/).

## [Unreleased]

### Added

- Adds an optional `sort` (`field:direction`, e.g. `updated:desc`) to every issue read: `searchIssuesPage` takes it inside `criteria`, and `listIssuesPage` / `listIssueTrackerIssuesPage` take it as an option. Ordering was previously fixed and undocumentedly inconsistent — the filtered GitHub search hardcoded `sort:updated`, Azure ordered by created date, GitLab's account-wide read by created date, Linear by created date, Jira per project by nothing at all, and GitHub's account-wide "my issues" read by relevance. Three parts of the contract are load-bearing. **The key is validated, never downgraded**: `getSupportedFilters()` gains `issueSorts` (repo-scoped, and the only surface an issue tracker has) and `issueSortsAccountWide` (a different vocabulary, not a subset — GitLab's two reads are GraphQL and REST), plus `issueSearch.sorts`, and a key the provider can't express refuses the whole read with a warning + `fetchFailed`, because at a bounded result window another order is another subset and the cursor that comes with it describes that other subset. **A page assembled from several provider queries is ordered, not concatenated**: GitHub's per-relationship searches, GitLab across repositories, Azure and the trackers across projects all merged their results unordered before this, so the union was ordered only within each part; it is now ordered as a whole, and a key no normalized issue carries (`priority`, `dueDate`, `resolved`) is refused for such a page rather than served as concatenated per-scope runs — the same key still works for a single repository or project, where the provider does the ordering. **A cursor is bound to the order that produced it**: threading an issue-search cursor under a different key is refused with a warning + `fetchFailed` rather than resumed into a differently-ordered set, and rather than silently restarted — this read is cursor-only, so its reported position comes from the `page` supplied alongside the cursor, and a restart would publish page 1's rows as page N. Drop the cursor to change the order. A cursor persisted before this change carries no key, still resumes, and is sealed with the current one. The result-ceiling omission now carries `sort` and its message names the order, since which matches are reachable depends on it. One key's meaning is narrower than its name: `reactions` orders by THUMBS-UP, not by the total across every reaction type, because thumbs-up is the only reaction count a normalized issue carries — ordering by the total would rank a page by a number the consumer cannot see, and would disagree with the comparator that re-sorts a merged page. Requires an unreleased `@gitkraken/provider-apis` for every provider except GitHub (plus/integrations, git, plus/git-github)

### Changed

- Changes the default order of four issue reads, now that ordering is expressible: `listIssuesPage` and `listIssueTrackerIssuesPage` pass `updated:desc` explicitly rather than leaving each provider's own default, so **Azure DevOps** (was created descending), **GitLab account-wide** (was created descending), **Linear** (was created date) and **Jira per project** (was unordered, which over offset paging duplicated and dropped issues between pages) all change which issues a page contains. GitHub and GitLab repo-scoped already emitted that order, so they are unaffected. The default is applied only where the provider can express it, so a provider that cannot order is left exactly as it was. Pass an explicit `sort` to choose a different key. `GitHubApi.searchMyIssues` is deliberately NOT included: it has never requested an order, so an omitted `sort` there still emits no `sort:` qualifier and keeps GitHub's relevance order — the facade supplies the default above it
- Changes what `ProviderSweepTargetEvent.domain` reports, and therefore how a consumer buckets `onTargetSettled` events shipped in [0.5.108]. It used to come out of the per-target slice, which meant the domain the read resolved on the targets that got that far and the domain the caller asked for on the ones rejected earlier — a field whose meaning depended on which guard rejected the target. It is now resolved by one rule for every target however far it got (configured connection, explicit domain, then the provider's primary configured host), normalized to a host so a target addressed as `https://ghe.example.com/api/v3` and one addressed by its configured domain stop reading as two hosts, and **`undefined` for every cloud provider**, which has a single host and nothing to disambiguate — where the previous field sometimes carried that host, splitting one provider across two buckets on the shape of the selector alone. Group by `providerId` and treat `domain` as a label, not part of the key (plus/integrations)
- Changes `broadenIssues` in documentation only: it takes no `sort`, and its TSDoc now says so. One of its pages spans several orgs at independent provider positions in a cursor bundle, so honoring an order across them needs a k-way merge with a buffer per org rather than a sort of what arrived. `searchIssuesPage({ repos, criteria: { sort } })` is the ordered answer to the same question, and was already the recommended migration

## [0.5.108] - 2026-08-07

### Added

- Adds `onTargetSettled` to both pull-request sweeps (`sweepPullRequests`, `sweepClosedPullRequests`), reporting each target as it settles with its `providerId`, `domain`, `connectionId`, row `count`, `durationMs`, `queueWaitMs`, `truncated` and an `outcome` of `ok` / `fetch-failed` / `failed-provider` / `skipped`. A sweep makes one call and distributes its targets internally, so nothing per-target crossed the package boundary: a host could see that a sweep took eight seconds but not which provider spent them, and per-target counts were only derivable because a sweep accepts at most one target per provider. `outcome` is one value rather than the underlying booleans because "the whole target is unusable" and "the target returned a slice with a gap" are facts a consumer buckets differently, and `skipped` — a target that resolved to no reachable connection — is reported even though it is deliberately absent from the aggregate result, making the event the only place a consumer counting targets can see it. What is deliberately NOT in this: any ability to influence the sweep (the return value is ignored and a synchronous throw is swallowed rather than allowed to turn a fulfilled target into a rejected one), and any cost when omitted, where no reporting exists and no clock is read. One behaviour to know rather than infer: delivery does not stop when the sweep fails, because a rejection does not cancel the siblings already in flight, so their events arrive after the returned promise has rejected. See the `ProviderSweepTargetEvent` and `onTargetSettled` docs for the per-field contract (plus/integrations)

## [0.5.107] - 2026-08-07

### Changed

- Syncs cloud connections concurrently instead of one at a time, completing the pass that [0.5.105] started on reconciliation. `syncCloudIntegrations` awaited `syncCloudConnection` per provider in a serial loop, and a forced sync deletes each provider's stored session and refetches it from the cloud — so the loop cost the SUM of every provider's latency on a path that gates every provider read. Measured against a 7-connection account, the provider list settled in ~1.6 s versus ~2.3 s serial (medians of 8 interleaved cold starts), and the win grows with connection count and link latency. The fan-out needs no per-provider grouping because every shared mutable path was already serialized: `ensureProvider` is gated on `providerId`, so the two integrations a multi-host self-managed id yields share one in-flight construction; `ensureSession` is gated per integration instance; `addOrUpdateConfigured`/`removeConfigured` mutate the configured collection in a synchronous critical section behind a write queue; and secrets and `connected:` flags are keyed by integration id + domain (plus/integrations)

### Fixed

- `Integration.disconnect` now awaits the `deleteAllSessions` clear instead of leaving it floating, so a caller that awaits `disconnect()` can rely on the secrets and descriptors being gone when it resumes. Nothing but incidental scheduling slack ever made the clear land in time: the serial connection-sync loop happened to suspend on the next provider, which let the previous provider's delete finish. Syncing providers concurrently removed that slack and exposed a full-provider disconnect returning with a descriptor still stored (plus/integrations)
- `GitHubApi.searchMyPullRequestsPage` now orders by `sort:updated`, making ordering a contract the way `searchPullRequestsPage` already did. It sent no `sort:` qualifier at all, so GitHub answered in `best-match` (relevance) order — which meant any consumer that stopped short of draining every page kept an arbitrary sample rather than the N most recently updated, and the retained set could shift with GitHub's ranking with nothing changed upstream. This is the read behind both PR sweeps, so a sweep with a page budget now has a deterministic, time-bounded recency window: a consumer deriving a change signal from the sweep no longer sees phantom changes from re-ranking, and a terminal pull request cannot drop out of a bounded window and reappear later (plus/git-github)

## [0.5.106] - 2026-08-06

### Added

- Adds `IntegrationManager.searchPullRequestsPage`, a filtered pull-request search bounded by repository/organization or explicit current-user relationships. The structured criteria carry free text, an OR set of `PullRequestFilter` relationships, an OR set of states, and `includeArchived`; this expresses both `Author + Assignee + ReviewRequested` visibility and the complete `closed + merged` terminal set without relying on GitHub's mismatched `involves:@me`. `getSupportedFilters().pullRequestSearch` declares the exact relationship/state vocabularies plus text, archived, repository-scope, and organization-scope support. GitHub/GHE sanitize free text, alias every relationship × state facet into exactly one upstream request per cursor-threaded page, dedupe overlap, and order most recently updated first. The default page size is 30 because the full pull-request fragment can exceed GitHub's GraphQL resource budget at 100 on large repositories; callers can still request up to 100 explicitly. At GitHub's 1,000-result ceiling the read succeeds with a `provider-limit` omission carrying the provider's pre-ceiling `totalCount`, `limit`, and `recovery: 'none'`. Other providers declare empty/false capabilities and the facade refuses the read rather than silently ignoring criteria or scope ([#5665](https://github.com/gitkraken/vscode-gitlens/issues/5665)) (plus/integrations)

## [0.5.105] - 2026-08-04

### Changed

- Reconciles cloud connections concurrently instead of one at a time, so sign-in and every routine check-in cost roughly one connection's latency rather than the sum. Providers reconcile in parallel with each other, and within a provider each connection's token fetch and account-name lookup run together. What is deliberately NOT parallel is the writing: session persistence stays a sequential pass over the prepared results, because a storage implementation may update the shared configured-connections collection read-modify-write, and `ConfiguredIntegrationService` now serializes those writes through a queue for the same reason. Primary selection is unchanged — it is decided in that ordered pass, so which connection wins for a domain still follows the backend's order and does not depend on which request happened to resolve first (plus/integrations)

## [0.5.104] - 2026-08-04

### Added

- Adds `IntegrationService.searchIssuesPage`, a filtered issue search over a repository/org scope with no forced relationship to the current user. Until now every issue read was either bound to the user's own relationships (`searchMyIssues`, permanently `@me`) or routed through the SDK's repo-scoped read, whose over-limit recovery walk can spend up to 128 sequential requests and still return an incomplete set; this is one request per page and reads exactly what was asked for. Three parts of the contract are load-bearing: scope is mandatory (`repos`, `org`, or a user relationship — and repository IDs are refused, since a search names repositories by path and dropping them would silently search the whole org); ordering is always `sort:updated` rather than optional, because a consumer's "show the N most recent" policy at the result ceiling is only correct under a guaranteed order; and at that ceiling the read SUCCEEDS, reporting an omission with `recovery: 'none'` carrying `totalCount` and `limit`, so a consumer can say "19,240 matched, showing the 1,000 most recent" and knows not to offer a load-more that cannot deliver. Note `itemsPerPage` is per RELATIONSHIP — each is its own provider query, so an N-relationship search returns up to N × `itemsPerPage` before the url dedupe; `page.itemsPerPage` is what actually came back (plus/integrations)
- Adds `IntegrationService.countIssues`, a count-only probe reporting how many issues match each scope without fetching any of them — what a "this will fetch ~N issues" preview and a live count beside an unapplied filter chip both need. GitHub reports `issueCount` on a zero-node selection, so this transfers no issues at all (measured: 30 aliased counts are one rate-limit point). A separate method rather than a `countOnly` flag, since a flag would return a paged result whose `items`, `cursor` and `hasMore` are all meaningless. `key` is caller-owned and echoed back so a batch needs no positional matching; a duplicate key refuses the whole call rather than being deduped. `count: undefined` means the provider did not report one and is NOT zero — rendering unknown as 0 would tell the user a filter matches nothing when it may match thousands. Per-scope and per-batch isolation: a refused or failed scope drops only itself, sets `fetchFailed`, and every other count still comes back (plus/integrations)
- Adds the criteria model these two reads share — `IssueSearchCriteria`, `IssueSearchRelationship` and the `IssueSearchCapabilities` table now on `getSupportedFilters().issueSearch`. Structured rather than a provider query string, so a consumer can render filter chips and hide the ones a provider cannot express. `IssueSearchRelationship` is a superset of `IssueFilter`: it adds `any-assignee` (`assignee:*`) and `unassigned` (`no:assignee`), which are user-INDEPENDENT and so cannot be `IssueFilter` members; they partition the scope between them, so asking for both is refused rather than silently reduced to one, and "all visible issues" is the OMITTED case, not `any-assignee`. Criteria validate all-or-nothing: a dropped criterion would serve a wider result than was asked for. The capability table is always present — a provider with no filtered issue search reports empty relationships and all-false flags, so a consumer reads it uniformly and treats empty relationships as "hide the surface". Only GitHub and GitHub Enterprise declare one (plus/integrations)

### Fixed

- Fixes a control character in a search term fusing the words it separated. The sanitizer deleted control characters outright, which is right for a quote (it separates nothing) and wrong for a newline or tab: `graph\nperformance` collapsed to the single token `graphperformance`, and a search that had results silently returned none (measured against the live API: 2 results before the fusion, 0 after). Worse with the injection guard, where `crash\norg:evil` fused into `crashorg:evil` and the `:` filter then dropped it WHOLE, losing the user's real term along with the smuggled qualifier. Control characters now become a space and runs of whitespace collapse (a doubled space inside `label:"a  b"` would not match the label `a b`); quotes are still deleted outright (plus/git-github)
- Corrects the `assignee:*` scoping claim behind the GitHub issue search, which was the standing argument for refusing a multi-repo "assigned to anyone" read. GitHub does honor it across repositories — measured, the per-repo decomposition sums exactly. What actually needs a scope is the qualifier itself: unscoped, `assignee:*` matches millions. Both existing guards already refuse precisely that unscoped case, so their conditions are unchanged; only the reasoning they cite was wrong (plus/integrations)

### Changed

- Unifies the flat-page walk the account-wide `listIssuesPage` branch and `searchIssuesPage` had each implemented, including four separate correctness rules that had already drifted — a provider that stops advancing its cursor set `truncated` in one and not the other, so the same behavior was reported two ways depending on the read. Both now share `drainFlatPagesToRequestedPage`, with the one thing they genuinely differ on as a callback rather than a branch (plus/integrations)

## [0.5.103] - 2026-08-03

### Fixed

- Fixes `listOrgs`/`listProjects` reporting one truncation twice, with two verdicts that disagreed on the remedy. A hierarchy read cut short by an expired credential emitted a bare `kind: 'other'` "listing was truncated" warning AND the typed `auth` warning for the identical cause, so a consumer routing on classification lit a reconnect prompt from one and a "this provider failed to load" banner from the other — the second offering a remedy that does not exist. Nothing on the wire distinguished that generic warning from a network error, so the fix is at the producer: both reads now assess the SDK metadata first and state the truncation themselves only when the metadata reported nothing, which is the rule `assessCollectionMetadata` already applied to its own generic fallback one layer up. A truncation nothing else explained still warns, and still marks the read non-authoritative — a flattened hierarchy result has no page object to carry incompleteness, so `fetchFailed` remains the only signal that the list is short (plus/integrations)

## [0.5.102] - 2026-08-02

### Added

- Adds `ProviderWarning.omission`, present only when a read SUCCEEDED and withheld results — a provider cap, an exhausted recovery budget, a page budget, or a sub-scope left undrained. `kind` stays `'other'` for these (adding a member would silently change what `'other'` means for every existing build), so this is the field that separates "incomplete but valid" from a genuine failure without parsing `message`, which is English prose. It carries the SDK's `kind` plus `limit` / `totalCount` / `scope` where reported; `totalCount` is normalized to `number | undefined`, never `null`. Its absence proves nothing: it is never set on a failure, but also absent whenever incompleteness was reported without naming what was left out (plus/integrations)
- Adds `omission.recovery` (`'none' | 'page-budget'`), the question `kind` cannot answer: would anything actually fetch the rest? A sweep that spent its own `maxPages` with a usable cursor in hand and a provider that advertised another page without one are both `kind: 'pagination-incomplete'`, but only the first can be fetched — gate a "load more" affordance on `recovery`, never on `kind`. Required rather than optional, so an absent value can't be read as "not recoverable" when it means "this producer didn't say". Deliberately conservative: `none` means "not known to be recoverable", and every omission derived from SDK metadata reports it, because the SDK emits one shape both for a scope it merely sampled and for one whose cursor stalled (plus/integrations)

### Changed

- Every incompleteness warning the facade raises on its own terms now routes through one builder, so a read that FAILED can no longer emit a warning asserting it succeeded. A drain that was cut short leaves an unread tail like a capped one, but sets `fetchFailed` and carries no omission — a retry is the right move there, and an omission says the opposite. An omission raised while a read was still going is retracted if it later fails, in the drains and the paged reads alike (plus/integrations)

### Fixed

- Fixes a drain claiming its page budget was what stopped it when the provider had handed back no usable cursor — the budget was checked before the cursor was resolved, so raising it would have re-read the identical set. A provider that cycles its cursors (`A→B→A`) is likewise no longer walked until the budget runs out; followed cursors are now tracked as a set, matching the SDK's own `followCursors` (plus/integrations)
- Fixes a page the provider had capped being reported as merely out of page budget, which would invite a consumer to raise a budget that cannot un-cap it. A cap now outranks a budget stop whichever way it arrives — `paging.truncated` or an SDK omission — and one drain raises one incompleteness warning rather than two that disagree about the remedy (plus/integrations)

## [0.5.101] - 2026-08-02

### Added

- Adds structured detail to the warnings raised from provider collection metadata — requires `@gitkraken/provider-apis` 0.55.0. A GitHub search that hits the 1,000-result cap now warns with the figures it was given (`Search (repository acme/web) matched 1393 results, but the provider exposes at most 1000`) instead of the fixed `Some results were omitted; the read is incomplete`, and the SDK's other two omission kinds (`recovery-budget`, `pagination-incomplete`) each get their own message, scoped to the repository/project the SDK attributes them to. An omission never sets `fetchFailed`: the request succeeded, so retrying returns the same truncated set — only a structured failure means the read broke. Note 0.55.0 also RECOVERS past the cap (it partitions an over-limit multi-repo search by repository, then bisects `updated:` windows), so the common over-cap read now returns complete and raises no warning at all (plus/integrations)

### Changed

- Collapses repeated collection omissions per kind and scope, keeping the highest reported total, mirroring the SDK's own dedupe. GitHub recomputes its match total on every request, so a repository drained over several pages reports the same cap with a drifting count; without this the consumer got a near-identical warning per page that message-level dedupe could not collapse (plus/integrations)
- Truncation is now derived from one predicate, `isIncompleteCollection`, shared by the facade assessment and `getPagedResult`. Both computed it independently before, so a single metadata object could be reported as truncated by one and complete by the other (plus/integrations)

### Fixed

- Fixes a GitHub pull-request search dropping the pages it had already collected when a later page came back empty — the drain returned `[]` instead of the accumulated results (plus/git-github)
- Fixes `GitHubPullRequestLite.body` being typed as non-nullable when GitHub's schema returns `null` for it; the mapped `PullRequest.body` now degrades to `undefined` rather than carrying a `null` typed as `string` (plus/git-github)
- Fixes Trello's project-scoped issue read dropping the SDK collection metadata it had already computed, so a partial Trello search reached the facade with its truncation signal but no structured detail (plus/integrations)

## [0.5.100] - 2026-07-31

### Changed

- **Breaking (git)** — `GitGraphRowHead.worktreeId` is removed; `worktree` now carries `isDefault` instead. Consumers asking "is this branch checked out somewhere other than here?" must test `worktree != null && !worktree.isDefault` rather than reading `worktreeId`. `GitGraphRowType` is renamed to `GitGraphRowKind`, and the row field carrying it from `type` to `kind`, adopting the commit-graph engine's own vocabulary — `'commit' | 'merge' | 'stash' | 'workdir'`, replacing `'commit-node' | 'merge-node' | 'stash-node' | 'work-dir-changes'` — and drops the never-produced `merge-conflict-node` and `unsupported-rebase-warning-node` members; `GitGraphRowContexts` drops eight slots no producer wrote (`ref`, `graph`, `avatar`, `message`, `author`, `date`, `sha`, `stats`) (git)
- **Breaking (git)** — `graphSessionSnapshotVersion` is now `7`; snapshots written by earlier versions are discarded on restore, because the persisted row shape changed with `worktree.isDefault`, again with the row-kind rename, and again when the per-ref `context` slots were removed (git)
- **Breaking (git)** — `GitGraphRowHead`, `GitGraphRowRemoteHead` and `GitGraphRowTag` drop their `context?: string | object` slot. The graph no longer ships a serialized webview-item context per ref per row; consumers that read those strings must build their own from the structured fields. An `id` marks a ref as identifiable and actionable — it does NOT promise complete enrichment, since the CLI settles branch/remote/worktree lookups independently and still stamps ids (git)
- **Breaking (git)** — graph rows now OMIT `heads`/`remotes`/`tags` when empty instead of shipping empty arrays; consumers must treat all three as optional (git)

### Added

- Adds structured branch and stash state to graph rows — `GitGraphRowHead.starred` and `GitGraphRowRemoteHead.starred`, `upstream.missing` and `upstream.state { ahead, behind }` on a head's upstream, and `GitGraphRow.stashNumber` (the `{n}` of `stash@{n}`). All optional and populated only by the CLI provider; absent means the producer did not compute it, not a negative value (git)
- Adds an account-wide issue read for GitLab and exposes `includeAllAssignees` on the account-wide seam &amp;mdash; `GitHostIntegration.searchMyIssuesWithTruncationResult`/`IntegrationService.listIssuesPage` now serve GitLab (previously reported as unsupported, since GitLab's issue reads were repo-scoped only) via a new `getIssuesForCurrentUser` REST read (`GET /issues`, open issues only), and honor an `includeAllAssignees` toggle across GitHub (`assignee:@me` → `assignee:*`), GitLab (`scope=all`, no assignee), and Azure DevOps (a single unfiltered per-project drain); requires `@gitkraken/provider-apis` 0.53.0 ([#5535](https://github.com/gitkraken/vscode-gitlens/issues/5535)) (plus/integrations)
- Adds multiple simultaneous connections (multi-account) per provider integration — `ConfiguredIntegrationDescriptor` now carries a stable per-connection `id` (backend `tokenId`) plus `primary`, `type`, and `accountName`; `IntegrationService` gains `setPrimaryConnection`, `deleteConnection`, and `refreshConnections`; cloud sync fans out over every backend connection (primary + secondaries) and resolves account names with a backend → cache → provider-API precedence. Existing single-connection sessions keep working with zero secret migration ([#5430](https://github.com/gitkraken/vscode-gitlens/issues/5430)) (plus/integrations)
- Adds per-connection reads for multi-account integrations — issue/PR search and issue-tracker resource reads (`searchMyIssues`, `searchMyPullRequests`, `searchPullRequests`, `getIssuesForProject`, `getAccountForResource`, `getResourcesForUser`, `getProjectsForResources`) accept an optional `connectionId` that reads with that specific connection's token instead of the provider's primary (mirrors the `gk` CLI's `--connection`); omitting it preserves the existing primary behavior ([#5430](https://github.com/gitkraken/vscode-gitlens/issues/5430)) (plus/integrations)
- Adds a lightweight, token-scoped entry point `createTokenScopedGitHostIntegration` at `plus/integrations/lite.js` — fetches `RepositoryMetadata` and `DefaultBranch` for GitHub, GitLab, Bitbucket, and Azure DevOps from just an access token + a `fetch`, without constructing an `IntegrationServiceContext` or running any session/OAuth lifecycle (plus/integrations)
- Adds `getRepositoryMetadata` and `getDefaultBranch` to the Bitbucket and Azure DevOps API clients (plus/integrations)
- Adds a neutral pagination + warning result model to the public API — `ProviderResult`, `ProviderPagedResult`, `ProviderSweepResult`, `ProviderBroadenResult`, `ProviderPageInfo`, `ProviderWarning`, and the repository-resolution types (`RepositoryResolution`, `RepositoryIdentity`, `ResolveRepositoryResult`) — carrying no `@gitkraken/provider-apis` types so consumers depend only on `@gitkraken/core-gitlens`. Git-host read cores now recover thrown errors into a result wrapper (`getMyIssuesForReposResult`/`getMyPullRequestsForReposResult`/`getOrganizationsForUserResult`/`getRepositoriesForOrgResult`) so callers can surface per-provider warnings instead of silently getting `undefined` ([#5438](https://github.com/gitkraken/vscode-gitlens/issues/5438)) (plus/integrations)
- Adds generic discovery + page-oriented reads on `IntegrationService` — `listOrgs`, `listProjects`, `listRepos`, `listPullRequestsPage`, and `listIssuesPage` return the neutral paginated/warning wrapper, translate a 1-based `page` to the provider's opaque cursor (surfacing a raw `cursor` only for cursor-only hosts), and capture per-provider read failures as `ProviderWarning`s instead of throwing ([#5438](https://github.com/gitkraken/vscode-gitlens/issues/5438)) (plus/integrations)
- Adds `IntegrationService.sweepPullRequests` (all-pages drain across providers, with `truncated`/`fetchFailed` signals) plus a `sweepClosedPullRequests` convenience (closed + merged), and `broadenIssues` (per-org issue fan-out that isolates a failing org into a warning and reports `broadenedProviderIds` + `fanOutCount`); adds an `includeAllAssignees` option that broadens issue reads past assigned-to-me and a `forceSync` option that forces a session refresh before a primary-connection read ([#5438](https://github.com/gitkraken/vscode-gitlens/issues/5438)) (plus/integrations)
- Adds per-provider `targets` to pull-request sweeps so multi-provider reads can select each provider's `connectionId` independently and supply a fallback `domain` for self-managed hosts backed by external/manual authentication; paged pull-request reads accept the same self-managed domain fallback (plus/integrations)
- Adds `IntegrationService.resolveRepository`, which resolves a remote URL to its provider repository identity across every git host (`getRepoInfo` is now implemented for GitHub/GitHub Enterprise/GitLab self-hosted/Bitbucket Cloud, alongside the existing GitLab/Bitbucket Server/Azure); it returns a neutral resolution status (`resolved`/`not-found`/`unauthorized`/`unsupported-provider`/`invalid-remote-url`/`host-mismatch`/`undetermined`) and never throws ([#5438](https://github.com/gitkraken/vscode-gitlens/issues/5438)) (plus/integrations)
- Adds Trello as a real issue integration — a `TrelloIntegration` (boards as resources/projects, board issues mapped to the shared issue shape), the Trello provider-API client wiring, cloud auth via the shared provider (the app key from the token exchange is carried on the session), the `gl-provider-trello` glyph, and Trello in the supported cloud-integration descriptors/lists ([#5438](https://github.com/gitkraken/vscode-gitlens/issues/5438)) (plus/integrations)

### Fixed

- Fixes aggregate GitHub pull-request sweeps timing out on large closed histories by using the lightweight list
  shape (while retaining body and branch refs), and replaces upstream HTML error pages with bounded,
  status-bearing provider warnings (plus/integrations, plus/git-github)
- Adds `incompleteProviderIds` to provider sweep results so consumers can distinguish a wholly failed provider
  from a provider whose returned slice has a mid-read gap or truncation (plus/integrations)
- Fixes account-wide pull-request relationship filtering so every supported provider returns the exact requested
  OR union, with per-target sweep overrides and resumable composite cursors where needed; filtered Bitbucket Data
  Center reads now fail closed if the current account cannot be identified (plus/integrations)
- Fixes provider issue mapping violating its public string-id contract when an upstream issue number is numeric,
  which could crash consumers while broadening issue lists (plus/integrations)
- Fixes incomplete provider reads being reported inconsistently across hosts: GitLab relationship fan-out now
  preserves successful slices when another slice fails, Azure issue deduplication is scoped by organization and
  project, self-managed broaden cursors include the provider domain, page-only repository reads advance opaque
  cursors, and SDK truncation/error metadata survives normalization (plus/integrations)
- Fixes the provider fetch adapter discarding non-success response bodies, which prevented throttled `403`
  responses and partial collection failures from retaining their structured warning kind; issue mapping now also
  preserves repository identity and provider issue type consistently across both public mappers (plus/integrations)
- Fixes bundled source maps pointing at nonexistent `dist/src/*` paths when emitted files were nested more than
  one directory deep; the bundle now rewrites every source depth to the shipped `src/*` tree and fails if a target
  source is absent (core)
- Fixes `resolveRepository` reporting every Azure DevOps Server remote as unsupported even though
  `provider-apis` supports project-scoped repository lookup with a self-managed `baseUrl`; server resolution
  now uses the same Azure route as cloud and preserves the configured host/protocol (plus/integrations)
- Fixes public integration connection management hiding an authoritative refresh failure and accepting a
  `connectionId` owned by another provider for primary/delete mutations; foreground refresh now rejects while
  preserving the last known configuration, and mutations validate provider ownership before reaching the token
  backend (plus/integrations)
- Fixes provider model serialization dropping public fields across IPC/deep-link boundaries: pull requests now
  preserve `number` and `authoredByMe`, and issues preserve `issueType` (git)
- Fixes Bitbucket Data Center reporting issue reads differently from every other host without an issue tracker &mdash; it left `GitHostIntegration.supportsIssues` at its default `true` while registering no issue client, so `listIssuesPage` surfaced the SDK-internal `does not support function: getIssuesForReposFn` as an opaque `kind: 'other'` warning (instead of the `Issues are not supported by …` warning Bitbucket Cloud gives for the same missing capability) and `broadenIssues` drained every repository of an org before failing that way. Both now report the capability as unsupported up front, matching the provider metadata, which already declared no issue filters for it (plus/integrations)
- Fixes `ProviderBroadenOrg` being unreachable for consumers &mdash; `broadenIssues`' `orgs` argument had no nameable type on the public facade (`manager.js` is not a published subpath), forcing a consumer to re-declare the shape and drift from it; it is now re-exported from `plus/integrations/index.js` alongside the other option types (plus/integrations)
- Fixes the ProviderBackend abstraction dropping provider-native pull request/issue fields needed by Kepler (`number`, `authoredByMe`, issue type, repository, and labels), and fixes account-wide numbered-page reads so they advance opaque cursors without losing warnings or collection metadata from earlier pages (git, plus/integrations)
- Fixes `IntegrationService.resolveRepository` misclassifying a nonexistent GitHub/GitLab repository as a generic `error` instead of `not-found` &mdash; those providers' `getRepo` clients are GraphQL, so a missing repo returns HTTP 200 with a null node and the SDK throws an error with no `response.status` (a `GraphQLErrors` for GitHub, a bare `Error` for GitLab) that `ProvidersApi.handleProviderError`'s status-based mapping never recognized. `ProvidersApi.getRepo` now detects the SDK's not-found shapes (GitHub's `NOT_FOUND`-typed GraphQL error, GitLab's `Repository … not found` message) and rethrows them as `RequestNotFoundError` so the resolution reports `not-found` ([#5559](https://github.com/gitkraken/vscode-gitlens/issues/5559)) (plus/integrations)
- Fixes a single failed `ProvidersApi` load permanently disabling every provider-API read &mdash; `IntegrationService` cached the rejected promise, so one failure (a module-resolution error, a transient construction failure) turned all subsequent reads into instant empty results with warnings until the service was recreated; the failed attempt is now discarded so the next caller retries (plus/integrations)
- Fixes `providerOnConnect` rejections escaping as process-level unhandled rejections &mdash; the post-connect hook is fired detached in a microtask with no caller left to catch it, so any provider hiccup during a connection refresh surfaced as an unhandled rejection in the host; it is now caught and logged as a warning (plus/integrations)
- Fixes GitLab self-hosted repo-scoped reads (issues and pull requests) 404ing &mdash; `getSelfManagedApiBaseUrl` was producing a URL with a redundant `/api` segment, which then caused the provider SDK to double-append its own path; it now correctly strips these segments so the final request URL is correct ([#5526](https://github.com/gitkraken/vscode-gitlens/issues/5526)) (plus/integrations)

### Changed

- Adds a consumer-specific `IntegrationManagerContext` whose cache is optional, exports the shared domain
  normalizer from the integrations facade, and removes internal authentication/configuration services from
  the custom-auth hook contract; expands the consumer guide with the exact warning and self-managed Azure
  semantics (plus/integrations, core)
- Separates repo-scoped and account-wide pull-request filter capabilities: repo-scoped filters remain provider
  query constraints, while account-wide filters describe exact independently selectable relationship unions;
  Bitbucket's expensive reviewer expansion remains available through `includeReviewRequested`, and the
  integration consumer guide and parity record now ship in the package tarball under `docs/`
  (plus/integrations, core)
- Normalizes the pull-request and repository item types on the ProviderBackend surface so consumers no longer depend on `@gitkraken/provider-apis` types (matching how issues already surface `IssueShape`): `IntegrationService.listPullRequestsPage`/`sweepPullRequests`/`sweepClosedPullRequests` now return the GitLens-owned `PullRequestShape` and `listRepos` returns the new GitLens-owned `ProviderRepositoryShape`; the raw provider-apis PR/repo/account/issue types are no longer re-exported from the `@gitlens/integrations` facade ([#5533](https://github.com/gitkraken/vscode-gitlens/issues/5533)) (plus/integrations)
- Decouples the `GitLabApi`, `BitbucketApi`, and `AzureDevOpsApi` clients from `IntegrationServiceContext`, taking a narrow `ProviderApiConfig` instead (mirroring `GitHubApiConfig`); the manager wires them via new `createGitLabApi`/`createBitbucketApi`/`createAzureDevOpsApi` factories (plus/integrations)

## [0.4.0] - 2026-06-30

### Added

- Adds the `@gitlens/integrations` package to the bundle under `plus/integrations/*` — rich Git host & issue-tracker integration primitives (GitHub, GitLab, Bitbucket, Bitbucket Server, Azure) plus `authentication`, `models`, `providers`, and `utils` subpaths (plus/integrations)

## [0.3.1] - 2026-06-19

### Fixed

- Fixes `push`, `fetch`, `pull`, `reset`, `checkout`, and `restore` resolving as success when the git command actually failed with output matching a `GitWarnings` pattern (e.g. a non-fast-forward `tipBehind` push rejection, an unreachable remote, or an invalid ref/revision) — the rejection was swallowed by the default handler and the typed-error mapping was unreachable; these now reject with the correct error (`PushError`/`FetchError`/`PullError`/`ResetError`/`CheckoutError`) (git-cli)

## [0.3.0] - 2026-05-27

### Added

- Adds the `@gitlens/ipc` package to the bundle under `ipc/*` — shared IPC service consolidating CLI and agent IPC (ipc)
- Adds the `@gitlens/agents` package to the bundle under `plus/agents/*` (plus/agents)

## [0.2.0] - 2026-05-01

### Added

- Adds sub-provider methods: `commit`, `getParsedDiff`, `createStash`, `stageAll`, `unstageAll`, `validateRepo`; SHA + index-restore on `applyStash`; `untracked` option on existence and diff queries (git, plus/git-github)
- Adds a `'lastFetched'` change type, `onCurrentBranchAgentActivity`, `BranchMetadata.agentLastActivityAt`, and `branch.<name>.gk-agent-last-activity` config (git)
- Adds `LruMap`, `compareByVersion`/`compareByVersionDescending`, and a `quiet` option on `exec` (utils)
- Adds `AbortSignal` cancellation in the git-cli command queue and signing-error handling — `classifySigningError`, `SigningError`, `hooks.commits.onSigningFailed`, `source?` — on `commit`/`merge`/`pull`/`rebase`/`revert`/`cherryPick` (git, git-cli)

### Changed

- `merge`/`rebase`/`cherryPick`/`revert` return structured results with affected files; diff queries parse `--numstat` + `--summary` via `parseDiffNumStatAndSummary` (git)
- Improves caching: tiered TTLs (~5 min SHAs / ~60 s refs), lazy stash parent-timestamp cache, tiered branch-overview cache, parallel merge-base / contributor fetches, soft-invalidation + aggregate `AbortSignal` in `PromiseCache` (git, git-cli, utils, plus/git-github)
- Coalesces working-tree change events on `Repository`; expands graph reachability to local + remote branches + tags (git)
- Tightens filtering: stash reachability via git's branch metadata, untracked excluded from non-HEAD diffs, merge-base skipped when local matches upstream SHA (git-cli)

### Fixed

- Fixes corrupted output in async `Formatter` calls (utils)

## [0.1.0]

### Added

- Initial release. Bundles `@gitlens/utils`, `@gitlens/git`, `@gitlens/git-cli`, `@gitlens/ai`, and `@gitlens/git-github` into a single core npm package with subpath exports.

[unreleased]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.5.108...HEAD
[0.5.108]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.5.107...gitkraken:releases/core/v0.5.108
[0.5.107]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.5.106...gitkraken:releases/core/v0.5.107
[0.5.106]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.5.105...gitkraken:releases/core/v0.5.106
[0.5.105]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.5.104...gitkraken:releases/core/v0.5.105
[0.5.104]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.5.103...gitkraken:releases/core/v0.5.104
[0.5.103]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.5.102...gitkraken:releases/core/v0.5.103
[0.5.102]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.5.101...gitkraken:releases/core/v0.5.102
[0.5.101]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.5.100...gitkraken:releases/core/v0.5.101
[0.5.100]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.5.0...gitkraken:releases/core/v0.5.100
[0.4.0]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.3.1...gitkraken:releases/core/v0.4.0
[0.3.1]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.3.0...gitkraken:releases/core/v0.3.1
[0.3.0]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.2.0...gitkraken:releases/core/v0.3.0
[0.2.0]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.1.0...gitkraken:releases/core/v0.2.0
[0.1.0]: https://github.com/gitkraken/vscode-gitlens/releases/tag/releases/core/v0.1.0
