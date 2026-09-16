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
  types (`Cache.evictCaches`, so a later caller never joins pre-write work), drops pending commands, then calls
  the host's handler. Clears driven by a file watcher reach `clearCaches` directly and keep sharing in-flight
  reads, which is what stops a burst of file events from spawning duplicate reads. A host's handler now only
  has host-side state to update; forwarding to `clearCaches` as well is redundant but harmless.
- `provider.notifyChanged(repoPath, changes: RepositoryChange[], options?: { cache?: CachedGitTypes[] | 'all' })`
  fires the same `cache.onReset` (all types by default) and `repository.onChanged` a typed write would, so a
  raw mutation gets exactly the same treatment, host listeners included.

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

## Deferred, deliberately

- **Index and object plumbing** (`read-tree`, `write-tree`, `update-index --index-info`, `mktree`,
  `hash-object -w --stdin`, `cat-file -p`). The libraries drive these through `exec` with a scratch
  `GIT_INDEX_FILE` and parse the results themselves; a typed surface would re-encode the same argv with more
  room to drift. Revisit when a second consumer needs them.
- **A reflog read filtered by message.** Kepler reads `git reflog <branch> --grep-reflog='branch: Created from'`
  to recover a branch's creation point. `getIncomingActivity` walks `HEAD`'s reflog for a different purpose;
  bolting a grep onto it would change its paging. Worth its own method on `branches` once the base-branch
  inference core already does privately is unified with it.
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
- `notifyChanged` on the provider rather than an option on `git.run`. The executor has no context and no
  hooks; the provider does. A consumer that runs a raw mutation knows what it changed.
- Staging hooks skip the temporary-index case rather than firing unconditionally. A scratch index is not the
  repository's; announcing an index change for it would invalidate status for nothing.

**Kepler-side follow-up**, once a core release carries these: serve sync-tools' `updateRef` op through
`updateReference` / `deleteReference` (mapping in §1), delete the review ref with `deleteReference`, drop the
verb classifier in `core-git-port.ts` in favour of `notifyChanged`, and retire the remaining
`TODO(core-gitlens)` residuals.
