import type { Uri } from '@gitlens/utils/uri.js';
import type { GitBranch } from '../models/branch.js';
import type { GitReference, GitRefTip } from '../models/reference.js';
import type { GitReflogEntry } from '../models/reflog.js';
import type { GitTag } from '../models/tag.js';
import type { GitCommandPriority } from '../run.types.js';

export interface GitRefsSubProvider {
	checkIfCouldBeValidBranchOrTagName(repoPath: string, ref: string): Promise<boolean>;
	getMergeBase(
		repoPath: string,
		ref1: string,
		ref2: string,
		options?: { forkPoint?: boolean | undefined; priority?: GitCommandPriority },
		cancellation?: AbortSignal,
	): Promise<string | undefined>;
	getReference(
		repoPath: string,
		ref: string,
		/** `force`: skips the cached answer and any in-flight read that started before this call, and stores the fresh answer. */
		options?: { force?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitReference | undefined>;
	/**
	 * Reads `ref`'s reflog, newest first, optionally keeping only entries whose message matches `grep` (git's
	 * `--grep-reflog` pattern). Resolves `[]` when nothing matches or `ref` has no reflog, and rejects when the
	 * read fails (e.g. `ref` doesn't exist), so "no answer" is distinguishable from "never read".
	 */
	getReflogEntries?(
		repoPath: string,
		ref: string,
		options?: { grep?: string; priority?: GitCommandPriority },
		cancellation?: AbortSignal,
	): Promise<GitReflogEntry[]>;
	/**
	 * Lightweight enumeration of ref tips (heads/remotes/tags) — no enrichment.
	 * Use this when you need a SHA-to-refs map; use `getBranches`/`getTags` for full models.
	 */
	getRefTips(
		repoPath: string,
		options?: { include?: ReadonlyArray<'heads' | 'remotes' | 'tags'> },
		cancellation?: AbortSignal,
	): Promise<GitRefTip[]>;
	/**
	 * Batch reachability — for each input SHA, the refs whose tips contain it.
	 *
	 * One bounded `git rev-list --topo-order --parents --all ^<oldestSha>^@` walk; ref-set
	 * propagation runs in memory. Cost is O(walked subgraph), not O(N × refs) like the per-sha
	 * `getBranchesWithCommits([sha])` pattern. Pass the oldest SHA in your dataset to bound the walk.
	 */
	getRefsContainingShas(
		repoPath: string,
		shas: ReadonlySet<string> | readonly string[],
		oldestSha: string,
		options?: { include?: ReadonlyArray<'heads' | 'remotes' | 'tags'> },
		cancellation?: AbortSignal,
	): Promise<Map<string, GitRefTip[]>>;
	getSymbolicReferenceName?(
		repoPath: string,
		ref: string,
		options?: { priority?: GitCommandPriority },
		cancellation?: AbortSignal,
	): Promise<string | undefined>;
	hasBranchOrTag(
		repoPath: string | undefined,
		options?: {
			filter?:
				| { branches?: ((b: GitBranch) => boolean) | undefined; tags?: ((t: GitTag) => boolean) | undefined }
				| undefined;
		},
		cancellation?: AbortSignal,
	): Promise<boolean>;
	isValidReference(
		repoPath: string,
		ref: string,
		pathOrUri?: string | Uri,
		cancellation?: AbortSignal,
	): Promise<boolean>;
	validateReference(
		repoPath: string,
		ref: string,
		options?: {
			relativePath?: string;
			/** Skips the cached answer and any in-flight read that started before this call, and stores the fresh answer. */
			force?: boolean;
		},
		cancellation?: AbortSignal,
	): Promise<string | undefined>;
	/**
	 * Deletes `ref` — a symbolic ref itself, never the ref it points to; `HEAD` is refused. `expected` makes
	 * it a compare-and-swap: the delete is refused unless the ref is at that sha. Without `expected`,
	 * deleting a ref that doesn't exist succeeds — git treats it as already-done rather than an error.
	 *
	 * A local branch (`refs/heads/<name>`) is deleted the way `git branch -d` would leave things, minus its
	 * merged check: refused while checked out in any worktree, and its `branch.<name>` config section and
	 * GitLens's per-branch metadata go with it. Prefer `branches.deleteLocalBranch` unless you need the
	 * compare-and-swap.
	 *
	 * Optional because only a real git host can offer it.
	 *
	 * @throws {ReferenceUpdateError} `'conflict'` when the ref is elsewhere, `'notFound'` when
	 * `expected` was given and the ref doesn't exist, `'checkedOut'` for a branch checked out in a worktree.
	 */
	deleteReference?(
		repoPath: string,
		ref: string,
		options?: { expected?: string },
		cancellation?: AbortSignal,
	): Promise<void>;
	/**
	 * Points `ref` at `sha`. `expected` makes it a compare-and-swap: a sha requires the ref to be there
	 * already, `'absent'` requires it not to exist at all (create-only).
	 *
	 * @throws {ReferenceUpdateError} `'conflict'` when the compare-and-swap lost, `'invalidRef'` for a
	 * malformed name, `'invalidObject'` when `sha` is unknown.
	 */
	updateReference(
		repoPath: string,
		ref: string,
		sha: string,
		options?: { expected?: string | 'absent' },
		cancellation?: AbortSignal,
	): Promise<void>;
}
