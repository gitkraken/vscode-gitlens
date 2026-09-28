# Kepler git write-API parity

Decision record for the git WRITE-path gaps Kepler hit while routing every one of its git calls through
`@gitkraken/core-gitlens` (gitkraken/kepler, branch `kepler/migrate-raw-git-spawns`). It is the sibling of
[`kepler-read-api-parity.md`](./kepler-read-api-parity.md), which covers provider reads; this one covers the
`git` sub-providers and the raw-command escape hatch.

The shape of the problem: Kepler drives three libraries (`@gitkraken/sync-tools`, `conflict-tools`,
`compose-tools`) that take a `{ exec }` git port plus optional typed ops, and know nothing of core; the host
supplies a typed op only where a core call serves it exactly. Kepler also has its own worktree, branch and
sync services. After the migration every command runs through core's executor, so it already shares the queue, environment, binary
resolution and logging. What it could NOT do is use a typed sub-provider method for a set of commands core had
no method for, or had one whose contract did not fit. Each such site stayed on `provider.git.run` with a
comment naming the missing API. This document is the list of those APIs, what was added for each, and what was
deliberately left alone.

§1–§9 were the first round. §10–§19 are the second: the commands Kepler still ran raw once the first round
shipped, each because a typed method lacked one option or one behavior.

Verdict legend: **added** (a typed method now exists) · **extended** (an existing method gained the missing
option) · **deferred** (left on the raw escape hatch on purpose, with the reason).

## 1. Compare-and-swap ref updates — added

`refs.updateReference` ran `git update-ref <ref> <sha>` and swallowed every failure (logged, resolved
`undefined`), and there was no delete form. `@gitkraken/sync-tools` (0.4.0) publishes, applies and discards a
sync result itself (`applyPublishedSync`, `discardPublishedSync`), and every ref move in that flow is a
compare-and-swap: the real branch advances only if nothing else moved it since the library last read it. The
library asks its host for that through a typed `updateRef(ref, sha, { previousSha, mustNotExist, remove })`
op, and git's own `update-ref <ref> <new> <old>` is what makes it atomic. A writer that cannot refuse is a
clobber, so without this a host could only serve the op through the raw escape hatch.

- `updateReference(repoPath, ref, sha, options?: { expected?: string | 'absent' }, cancellation?)` now passes
  the old value to git when `expected` is a sha, and the empty old value when it is `'absent'` (create only if
  the ref does not exist yet). It THROWS a typed `ReferenceUpdateError` — reasons `conflict` (the ref moved,
  or exists when it must not), `invalidRef`, `invalidObject`, `notFound` — instead of swallowing.
- `deleteReference(repoPath, ref, options?: { expected?: string }, cancellation?)` runs
  `update-ref -d --no-deref <ref> [<expected>]` with the same error — `--no-deref` so a symbolic ref is itself
  deleted rather than the ref it points to — and refuses `HEAD` (`checkedOut`). `update-ref -d` has none of
  `git branch -d`'s guards or cleanup, so for a local branch (`refs/heads/<name>`) `deleteReference` supplies
  them: it refuses a branch checked out in any worktree (`checkedOut`, read from `git worktree list`, not the
  cached list), and removes the `branch.<name>` config section and GitLens's per-branch metadata with the ref.
  Only `git branch -d`'s merged check is left out, since a compare-and-swap caller has already decided.
- Both fire the cache and repository hooks a branch, remote-tracking, tag or `HEAD` move fires; a ref in another
  namespace (`refs/kepler/...`) announces nothing, since nothing core caches can observe it and an `unknown`
  change would make a host refresh everything.

The sync-tools op maps onto these one-to-one:

| `updateRef` option | core call                                                        |
| ------------------ | ---------------------------------------------------------------- |
| `previousSha`      | `updateReference(repoPath, ref, sha, { expected: previousSha })` |
| `mustNotExist`     | `updateReference(repoPath, ref, sha, { expected: 'absent' })`    |
| `remove`           | `deleteReference(repoPath, ref, { expected: previousSha })`      |
| none               | `updateReference(repoPath, ref, sha)`                            |

`'absent'` against an existing ref rejects as `conflict` and leaves the ref where it was. Deleting a ref that
is already gone rejects as `notFound` when `expected` is given (the caller named a value it expected to
remove), and resolves when it is not.

The library reads any rejection as the ref's answer, so the host must tell a cancellation apart from a
refusal. A cancelled call rejects with core's `CancellationError` (`name === 'CancellationError'`), never a
`ReferenceUpdateError`, and that includes a signal already aborted when the call is made; a host adapting to
a library that expects `AbortError` maps it by name. A cancel that lands while git is running says nothing
about whether the ref moved, so re-read it before acting on the outcome.

**Breaking:** a caller that relied on a failed `updateReference` resolving silently now gets a rejection. No
caller in this repository did.

## 2. Who clears after a write, and telling core about a raw one — changed / added

A typed mutator announces its write through `hooks.cache.onReset`, and core used to clear nothing itself on
that path: each host's handler was expected to forward to `Cache.clearCaches`. Two things followed. A host
with no handler kept serving pre-write reads after every typed write. And `clearCaches` only soft-invalidates
a shared entry that is still in flight, so even a wired host could hand a caller that arrived after the write
a read that started before it; GitLens also dropped the executor's pending commands on every reset, Kepler did
not.

A consumer that mutates through `provider.git.run` (a rebase driven by a library, a `clean`, a ref bookkeeping
write) had nothing to call at all, and typed reads served the pre-mutation answer until a file watcher caught
up, or forever with no watcher. Kepler classified verbs itself and called `clearCaches` after each one. The
sharpest case: it fetches PR heads through a raw `fetch` (it needs a per-process credential environment the
typed fetch cannot carry), and a typed `refs.validateReference` right after it served the pre-fetch tip for up
to 60s. `clearCaches` fixed that read but fired none of the host's hooks, so nothing else in the host learned
the refs moved.

- The provider wraps `onReset` when it is constructed. On every reset it hard-evicts its own caches for those
  types (`Cache.evictCaches`, so a later caller never joins pre-write work), drops the written repository's
  pending commands (its registered worktrees' included, no other repository's), then calls the host's handler.
  Clears driven by a file watcher reach `clearCaches` directly and keep sharing in-flight reads, which is what
  stops a burst of file events from spawning duplicate reads. A host's handler now only has host-side state to
  update; forwarding to `clearCaches` as well is redundant but harmless.
- `provider.notifyChanged(repoPath, changes: RepositoryChange[], options?: { cache?: CachedGitTypes[] | 'all' })`
  fires the same `cache.onReset` and `repository.onChanged` a typed write would, so a raw mutation gets the
  same treatment, host listeners included. Without `cache` it resets what `changes` map to, the same caches a
  file watcher's change of those kinds clears; an empty `changes`, or one naming `unknown`, resets everything,
  and `cache: 'all'` always does. A consumer naming its own changes must name every kind the write can touch
  (a `commit` that concludes a merge is `pausedOp` too), or those caches keep their pre-write answer.

## 3. Worktree administration — added / extended

- `worktrees.pruneWorktrees(repoPath, options?: { expire? })` — `git worktree prune`. Kepler prunes
  after a directory it removed by hand, and before reusing a path git still lists. Like `deleteWorktree`, it
  unregisters each worktree it removed from the cache.
- `worktrees.lockWorktree(repoPath, path, options?: { reason? })` — `git worktree lock --reason`. The reason
  is how Kepler marks a worktree as task-owned; only `unlockWorktree` existed.
- `worktrees.createWorktree(repoPath, path, options?, runOptions?)` and
  `deleteWorktree(repoPath, path, options?, runOptions?)` — gained run options. A large worktree's checkout or
  removal legitimately outlasts the default per-command timeout, and a caller may need to cancel either. A
  cancelled call rejects as `CancellationError`, not a worktree error. The thrown `WorktreeDeleteError` keeps git's
  raw output reachable on `original`, which is what a platform-specific retry classifier needs.

## 4. `git clean`, and the staging sub-provider's missing hooks — added / fixed

- `staging.clean(repoPath, options?: { paths?, directories?, force?, ignored? })` — the only way to
  discard untracked files; `ops.restore` cannot.
- Every staging mutation (`stageFile(s)`, `stageDirectory`, `stageAll`, `unstage*`, `removeFile(s)`, `clean`)
  now fires `onReset('status', 'diff', 'tracking')` and the index change, except when it targets a temporary
  index, which is not the repository's. Before this, a consumer that staged a conflict resolution through the
  typed API and then read `getConflictingFiles()` could be answered from the index as it stood before the
  stage.

## 5. Upstream and hooks config keys — added

Kepler writes `branch.<name>.remote` / `branch.<name>.merge` (to set an upstream whose remote ref does not
exist yet, which `--set-upstream-to` refuses) and reads `core.hooksPath`. All three are now documented members
of `GitConfigKeys`, so `config.getConfig` / `setConfig` serve them with the usual cache. Writing either
upstream key also resets the cached branch list, which reports the upstream.

## 6. `git pull --ff-only` — extended

`ops.pull` gained `fastForward: 'only'`, spelled as `ops.merge` spells it. Kepler advances a local base branch
before forking a task worktree from it, and must not create a merge commit or start a rebase in a checkout it
does not own. A refused fast-forward is a `PullError` with the new `noFastForward` reason (the name
`FetchError` already uses); before this it fell through to `other`. A base branch checked out nowhere has no
working tree to pull into, so it is advanced by fetching `<upstream>:<branch>`, which git refuses unless it
fast-forwards; without the option that path only fetches. That fetch runs without `--update-head-ok`: "checked
out nowhere" comes from the cached worktree list, so git's own refusal is what keeps a branch that is in fact
checked out from moving. A branch with no upstream is `PullError` reason `noUpstream`, on this path and for a
checked-out pull alike. `merge`'s `true` / `false` are not offered: a pull configured to rebase ignores `--ff`
/ `--no-ff`.

## 7. A commit from a tree with several parents and an author — added

A compose or stack engine writes merge commits and replays commits with their original author, which the
single-parent, identity-less `commits.createUnreachableCommitFromTree` could not.

- `commits.createCommitFromTree(repoPath, tree, { parents, message, author?, committer?, sign?, source? })` runs
  `commit-tree` with the message on stdin and the identity in the per-call environment, returning the sha.
  With `sign` it reports a signing failure as `SigningError` and fires the signing hooks.
- It is the only path that writes a commit object. `createUnreachableCommitFromTree` is removed, and the patch
  sub-provider's commits (`createUnreachableCommitForPatch`, `createUnreachableCommitsFromPatches`,
  `createEmptyInitialCommit`) go through it with unchanged results.

## 8. `git init` — added

`GitProvider.clone` existed; `init(path, options?: { defaultBranch?, bare? })` did not. Kepler creates a
repository for a folder the user adds.

## 9. Forced ref reads — added

After a change core neither made nor was told about (another process moving a branch, a raw `fetch` the
consumer has not reported yet), an ordinary read can answer from cache until its TTL runs out. `notifyChanged`
is the fix when the consumer made the change; `force` is for a read that must be current regardless.

- `refs.validateReference(repoPath, ref, { relativePath?, force? }, cancellation?)`,
  `refs.getReference(repoPath, ref, { force? }, cancellation?)`,
  `branches.getBranch(repoPath, name?, { force? }, cancellation?)` and
  `revision.resolveRevision(repoPath, ref, pathOrUri?, { force? })`. A forced read drops its cache entry before
  reading, so it neither returns the cached answer nor joins a read already in flight (a fresh entry gets a
  fresh cancellation aggregate, whose id is part of the executor's dedup key), and it stores the fresh answer
  for later unforced reads. `getStatus({ force })` and `getPausedOperationStatus({ force })` are the precedent.
- `getBranch({ force })` evicts the whole branch cascade first: branch lists, ref tips, merge bases, commit
  counts and resolved revisions, the set a branch move clears, since each can be derived from a ref that moved.
  `getReference({ force })` forces its validation and branch lookup; tags are not forced.
- `validateReference`'s `relativePath` moved into the options object, and `getBranch` / `getReference` take
  options before `cancellation`, matching `getStatus`.

## 10. An inherited git environment — fixed

A host launched by git (a hook, a `rebase -x` step, an editor opened as `GIT_EDITOR`) inherits that
repository's `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` and friends, and git lets them override the working
directory, so every command core ran targeted the launching repository. The base environment now drops
`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY`,
`GIT_ALTERNATE_OBJECT_DIRECTORIES` and `GIT_NAMESPACE` from the inherited `process.env`, plus the state git
hands a child about its own command: `GIT_CONFIG_PARAMETERS` (its `-c` options), `GIT_EXEC_PATH`, `GIT_PREFIX`
and `GIT_REFLOG_ACTION`. None is worth keeping when set deliberately: a `GIT_DIR` would point every repository
the host opens at one. `GIT_AUTHOR_*` / `GIT_COMMITTER_*` are different, since a deliberate identity (direnv,
say) breaks nothing, so they are dropped only when git launched the host, which it always marks by exporting
`GIT_EXEC_PATH`: an editor opened for `commit --amend` inherits that commit's author and date. `GIT_CONFIG_COUNT` /
`GIT_CONFIG_KEY_<n>` / `GIT_CONFIG_VALUE_<n>` are kept: git never sets them itself, so inherited ones are the
user's deliberate configuration. Only the inherited environment is scrubbed; a host's `env`, `getEnvironment()`
and a per-call `env` can still set any of these, as temporary-index staging does with `GIT_INDEX_FILE`.

## 11. Run options on stash and clean — extended

`stash.applyStash`, `stash.saveStash` and `staging.clean` take the trailing `runOptions` (`env`,
`cancellation`, `timeout`) every other long-running operation already did. No typed default changed: see the
timeout decision below.

## 12. A raw run that announces its own change — added

`git.run({ notify })` calls the provider's `notifyChanged` once the run settles, succeeded or failed (a
command that fails partway may still have moved something). An explicit `RepositoryChange[]` announces exactly
that. `'infer'` classifies the argv: read-only and object-store-only commands announce nothing, a write
announces its verb's changes for the repository it ran in (the `-C` target when given). Run under `-C`, a
write also announces to the caller's own tree the kinds every worktree sharing that `.git` sees (`heads`,
`tags`, `stash`, `remotes`, `worktrees`, `config`), since the target may be a worktree the cache never
registered; its HEAD, index, paused operation and FETCH_HEAD are the target's alone. A write it can't
classify resets both trees in full. Unset, nothing is classified and the run takes the same path as before.

## 13. Fetch with explicit refspecs, and without FETCH_HEAD — extended

- `ops.fetch(repoPath, { remote, refspecs, prune? })` passes the refspecs verbatim after the remote
  (`+refs/heads/x:refs/remotes/o/x`, `upstream:local`). It never adds `-u`, so git keeps refusing to write
  into a checked-out branch, which a caller fast-forwarding a branch checked out nowhere relies on. A refspec
  whose destination is a local branch or tag also announces `heads` or `tags`. The type refuses `refspecs`
  beside `branch`, `all` or `pull`.
- `preserveFetchHead` passes `--no-write-fetch-head`, on every form of fetch. A checkout has one
  `FETCH_HEAD`, and a user's own `git pull` reads it back right after its fetch, so a background fetch landing
  in between breaks that pull. Git older than 2.29 has no such flag; there the option is ignored rather than
  failing the fetch.

## 14. Clone into an exact folder — extended

`clone(url, parentPath, { folderName }, runOptions)`, on both core's `GitProvider` and GitLens's
`GlGitProvider`. `folderName` is used as given, with no numbering past a taken name, so git's own refusal of a
non-empty folder surfaces. Without it the folder is derived from the URL and numbered as before. `runOptions`
carries the clone's credentials, cancellation and timeout.

## 15. Status without untracked detail or branch state — extended

`status.getStatus(repoPath, { untracked: 'no' | 'normal' | 'all', branch: false })`. `untracked` picks git's
`-u` mode (default `all`, as before). `branch: false` skips `--branch`, whose ahead/behind against the upstream
is the slow part on a large divergence; the result's `branch`, `sha`, `upstream` and `detached` are then unset
and mean nothing. A narrower read gets its own dedup key, so a full-status caller never joins it and loses
files. `GIT_OPTIONAL_LOCKS=0` was already set on every status read, so there is no lock option.

## 16. A reflog read filtered by message — added

`refs.getReflogEntries(repoPath, ref, { grep? })` returns `{ sha, message }` per entry, newest first, where
`grep` is git's `--grep-reflog` pattern. It resolves `[]` when nothing matches or the ref has no reflog, and
rejects when the read fails, so a caller can tell "no answer" from "never read". It runs `reflog show <ref> --`,
not `reflog <ref>`: a branch named `delete`, `expire` or `exists` would otherwise run that subcommand, and one
named like a tracked file would fail as ambiguous. Core's own base-branch inference moved onto it, which
fixed both cases there.

## 17. Commit counts that exclude other refs — extended

`commits.getCommitCount(repoPath, rev, { excluding: { branches?, remotes?, tags?, refs?, except? } },
cancellation?)` counts what `rev` has that other refs don't, such as what deleting a branch would orphan.
`branches` / `remotes` / `tags` exclude a whole namespace, `refs` adds revisions verbatim, and `except` takes
full ref names back out of an excluded namespace. Core rewrites each `except` entry to the short form and
places it right before its own `--branches` / `--remotes` / `--tags`, because git matches `--exclude` against
the short name and applies it only to the next pseudo-ref option. The spelling that reads naturally,
`--exclude=refs/heads/x --branches`, excludes nothing. The GitHub provider returns `undefined` for an excluding
count, which its API cannot answer. A count is cached until a branch, remote-tracking branch or tag changes,
so a `refs` entry outside those namespaces (a tool's own `refs/<tool>/…`) can move without refreshing it;
pass its SHA instead, which keys a new read.

`commits.getLogShas` takes the same `excluding`, listing the SHAs instead of counting them; an omitted `rev` is
anchored to `HEAD` (a bare `--not` lists nothing), and the GitHub provider returns no SHAs.

**Breaking:** `getCommitCount` takes `options` before `cancellation`.

## 18. The empty tree in the repository's object format — added / fixed

The empty tree's id differs between SHA-1 and SHA-256 repositories, and core hardcoded the SHA-1 one as
`rootSha`, so every diff against a root commit's missing parent failed in a SHA-256 repository.
`revision.getEmptyTreeSha(repoPath)` computes it with `hash-object -t tree --stdin` (no `-w`; git knows the
empty tree without storing it), once per repository and shared across its worktrees. Every `rootSha` use now
goes through it, and `rootSha` is removed. GitHub repositories are always SHA-1.

**Breaking:** `rootSha` is removed from `@gitlens/git/models/revision`.

## 19. A link's clone of a large repository — fixed (GitLens)

Not a Kepler gap, found alongside §14: GitLens's deep-link clone ran under `gitlens.advanced.git.timeout` and
died partway through a large repository. It now runs uncapped, from a cancellable progress notification.

## Overlaps with existing APIs, and how each was settled

- **Refs containing a sha.** `branches.getBranchesWithCommits(repoPath, [sha], undefined, { all, mode })` and
  `tags.getTagsWithCommit` already answer it, so `getRefTips` did not gain `--contains` / `--points-at`
  filters. Kepler's one use (is a sha on any other local or remote branch) is `getBranchesWithCommits`.
- **Config keys.** Added to the documented union rather than served by a separate untyped
  `getConfigValue` / `setConfigValue`, which would have been a second way to read every key.
- **Commit objects.** `createCommitFromTree` replaced `createUnreachableCommitFromTree` and the patch
  sub-provider's own `commit-tree` calls, rather than sitting beside them.
- **Deleting refs.** `deleteReference` stays beside `branches.deleteLocalBranch` and `tags.deleteTag` on
  purpose. `deleteLocalBranch` keeps `git branch -d`'s merged check, which the delete flow's force-retry relies
  on, and takes several names; `deleteTag` reports a `TagError` the UI renders. `deleteReference` is the
  compare-and-swap form for any namespace, and shares the branch cleanup with `deleteLocalBranch`.
- **Clearing caches.** `evictCaches` stays beside `clearCaches`: a write hard-evicts, a watcher clear keeps
  sharing in-flight reads (see the decisions below).
- **Reflog reads.** `getReflogEntries` stays beside `commits.getIncomingActivity`, which walks `HEAD`'s reflog
  for merges and pulls, pages, and aggregates; a message grep on it would change its paging. Core's private
  reflog greps were folded into `getReflogEntries` rather than kept.
- **Dirty checks.** `getStatus({ untracked, branch: false })` stays beside `status.hasWorkingChanges`, which
  answers yes/no with early exits; a caller counting files needs the list.
- **Unpushed commits.** `getCommitCount({ excluding })` stays beside `hasUnpublishedCommits` /
  `filterUnpublishedShas`, which are early-exit probes against remotes alone and count nothing.

## Deferred, deliberately

- **Index and object plumbing** (`read-tree`, `write-tree`, `update-index --index-info`, `mktree`,
  `hash-object -w --stdin`, `cat-file -p`). The libraries drive these through `exec` with a scratch
  `GIT_INDEX_FILE` and parse the results themselves; a typed surface would re-encode the same argv with more
  room to drift. Revisit when a second consumer needs them.
- **Generic `for-each-ref` with a caller-supplied format.** The `RefRecord` shape is private on purpose.
- **A typed `worktree remove` for every consumer.** Kept the raw form where a consumer classifies platform
  failures from stderr; §3's `original` makes the typed form usable for that too.

## Bridging core into the tools libraries

The libraries take their own port and know nothing of core, so a host serving one through core reshapes what
core rejects with:

- **Cancellation.** Core rejects with `CancellationError` (`name === 'CancellationError'`); a library that
  expects `AbortError` gets it mapped by name.
- **"Git answered no" versus a structural failure.** sync-tools tells them apart by whether `err.code` is a
  number, and compose-tools reads `err.stderr`: the shape of Node's `execFile` error. Core's `GitError`
  carries `stderr` but reports the exit as `exitCode`, which is a number or numeric string for a real exit and
  an errno string (`'ENOENT'`) when git never started. A typed method's own error, such as
  `ReferenceUpdateError`, keeps that `GitError` on `original`.

## Decisions worth recording, because each closes off a plausible-looking alternative

- `updateReference` throws rather than gaining an `errors: 'throw'` option. A ref writer whose failures are
  invisible by default is the bug, not a mode.
- `'absent'` rather than `expected: ''`. The empty old value is git's encoding of "must not exist"; a caller
  spelling it as an empty string reads like a mistake, and an argv filter that drops empty strings would turn
  a create into an unconditional overwrite.
- New config keys join `GitConfigKeys` rather than widening it to `string` or adding an untyped read. The
  union's value is that every listed key is documented; an escape hatch would keep the autocomplete and lose
  the guarantee.
- `deleteReference` gives a branch `git branch -d`'s guard and cleanup rather than refusing branches. A
  compare-and-swap delete of a branch is legitimate (sync-tools' port contract exercises one), and refusing it
  would push the caller back to a raw `update-ref -d` that orphans the same state.
- A write hard-evicts while a watcher clear keeps sharing in-flight reads, rather than one policy for both. A
  write is a known point after which an older read is wrong; a watcher tick has no such ordering, and sharing
  the in-flight read is what keeps a burst of file events from multiplying git processes.
- `notifyChanged` on the provider, and `git.run({ notify })` bound to it rather than a second invalidation
  path. The executor has no cache and no hooks, so the provider binds itself to its `Git` and a `notify` run
  calls the same `notifyChanged`. `'infer'` classifies the argv (read-only and object-store-only commands
  announce nothing; a `-C` write also announces to the caller's tree what every worktree sees), for a
  consumer whose raw runs are too varied to name the changes by hand.
- Timeouts stay the caller's. No typed operation's default was lifted to "no timeout" for this round, even
  for fetch or clone: GitLens passes its `gitlens.advanced.git.timeout` setting as core's default, and an
  uncapped background fetch would hang with nothing to stop it. A caller that knows an operation is long
  passes `timeout: 0` with a cancellation, as GitLens's deep-link clone now does.
- `except` takes full ref names and core converts them, rather than exposing git's short-form `--exclude`. The
  short form is what every caller gets wrong, silently.
- Staging hooks skip the temporary-index case rather than firing unconditionally. A scratch index is not the
  repository's; announcing an index change for it would invalidate status for nothing.

**Kepler-side follow-up**, once a core release carries these: serve sync-tools' `updateRef` op through
`updateReference` / `deleteReference` (mapping in §1), delete the review ref with `deleteReference`, drop the
verb classifier in `core-git-port.ts` in favour of `git.run({ notify: 'infer' })`, and drop its interim
environment scrub (§10). Then move the second round's raw sites onto their typed forms: credential fetches onto
`fetch({ remote, refspecs, preserveFetchHead: true })` (§13), the clone onto `clone(..., { folderName }, { env,
timeout: 0 })` (§14), the porcelain count onto `getStatus({ untracked: 'normal', branch: false, force: true })`
(§15), the creation probe onto `getReflogEntries` (§16), the unpushed count onto `getCommitCount({ excluding })`
(§17, which also fixes its always-zero `--exclude`), and the object-format probe onto `getEmptyTreeSha` (§18).
Then retire the remaining `TODO(core-gitlens)` residuals.
