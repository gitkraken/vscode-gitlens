import { filter, some } from '@gitlens/utils/iterable.js';
import type { RepositoryChange } from '../models/repository.js';

/** The {@link RepositoryChange} kinds that describe ref movement, which an event can attribute to named refs */
export type RefChangeKind = 'heads' | 'remotes' | 'tags' | 'stash';

export interface WatcherRefChanges {
	/** Full ref names whose files changed (`refs/heads/main`), plus per-worktree pseudo-refs (`HEAD`, `ORIG_HEAD`). A name may be a ref directory and then covers every ref beneath it. */
	readonly names?: Iterable<string>;
	/** Ref kinds that changed without a name (packed-refs rewrite, config, shallow/replace, an injected change): any ref of that kind may have moved. */
	readonly unnamed?: Iterable<RefChangeKind>;
}

export function isRefChangeKind(change: RepositoryChange): change is RefChangeKind {
	return change === 'heads' || change === 'remotes' || change === 'tags' || change === 'stash';
}

/**
 * The kind of ref a full ref name (or ref directory) belongs to. A pseudo-ref (no `refs/` prefix, e.g. `HEAD`,
 * `ORIG_HEAD`) counts as `heads`; a ref outside the watched namespaces (e.g. `refs/notes/x`) has no kind.
 */
export function getRefChangeKind(ref: string): RefChangeKind | undefined {
	if (!ref.startsWith('refs/')) return 'heads';
	if (ref.startsWith('refs/heads/')) return 'heads';
	if (ref.startsWith('refs/remotes/')) return 'remotes';
	if (ref.startsWith('refs/tags/')) return 'tags';
	if (ref === 'refs/stash') return 'stash';

	return undefined;
}

/**
 * An event describing changes to a repository, produced by the watching pipeline.
 *
 * Changes are coalesced within a debounce window — a single event may represent
 * multiple filesystem changes. Use {@link changed} to test for specific change types,
 * and {@link mayHaveChangedRef} to test whether a specific ref may have moved.
 */
export class WatcherRepoChangeEvent {
	protected readonly _changes: Set<RepositoryChange>;
	private readonly _refs: Set<string>;
	private readonly _unnamedRefKinds: Set<RefChangeKind>;
	private readonly _announced: Set<RepositoryChange>;

	constructor(
		/** The repository path this event is for */
		public readonly repoPath: string,
		changes: RepositoryChange[],
		/** Which refs changed; when omitted, every ref kind in `changes` is unnamed (any ref of that kind may have moved) */
		refs?: WatcherRefChanges,
		/** The kinds of `changes` that come only from core's own announced writes (see {@link announced}) */
		announced?: Iterable<RepositoryChange>,
	) {
		this._changes = new Set(changes);
		if (refs == null) {
			this._refs = new Set();
			this._unnamedRefKinds = new Set(filter(changes, isRefChangeKind));
		} else {
			this._refs = new Set(refs.names);
			this._unnamedRefKinds = new Set(refs.unnamed);
		}
		this._announced = announced != null ? new Set(filter(announced, c => this._changes.has(c))) : new Set();
	}

	get changes(): ReadonlySet<RepositoryChange> {
		return this._changes;
	}

	/**
	 * The kinds in {@link changes} that come only from core's own writes, which core already announced through
	 * `hooks.repository.onChanged` after evicting their caches. A host that handled that announcement can skip them;
	 * a kind the watcher or an injected change also reported is not among them.
	 */
	get announced(): ReadonlySet<RepositoryChange> {
		return this._announced;
	}

	/** The kinds in {@link changes} that aren't {@link announced}: what a cache that core already evicted for its write still has to clear */
	getUnannouncedChanges(): RepositoryChange[] {
		return this._announced.size ? [...filter(this._changes, c => !this._announced.has(c))] : [...this._changes];
	}

	/** Full ref names (or ref directories, or pseudo-refs) known to have changed. See {@link WatcherRefChanges.names}. */
	get refs(): ReadonlySet<string> {
		return this._refs;
	}

	/** Ref kinds that changed without a name — any ref of these kinds may have moved */
	get unnamedRefKinds(): ReadonlySet<RefChangeKind> {
		return this._unnamedRefKinds;
	}

	toString(changesOnly: boolean = false): string {
		const changeList = [...this._changes].join(', ');
		const refCount = this._refs.size;
		if (changesOnly) return refCount ? `changes=${changeList}, refs=${refCount}` : `changes=${changeList}`;

		return refCount
			? `{ repoPath: ${this.repoPath}, changes: ${changeList}, refs: ${refCount} }`
			: `{ repoPath: ${this.repoPath}, changes: ${changeList} }`;
	}

	/**
	 * Test whether the given ref may have moved in this event.
	 *
	 * @param ref - A full ref name (`refs/heads/main`) or a pseudo-ref (`HEAD`).
	 * @returns `false` when the ref's kind didn't change (or the ref is outside the watched kinds); `true` when its kind
	 *   changed without a name, or when the ref itself or a ref directory above it changed. `HEAD` is usually a symref
	 *   to the checked-out branch, so it may have moved whenever any `heads` ref did.
	 */
	mayHaveChangedRef(ref: string): boolean {
		const kind = getRefChangeKind(ref);
		if (kind == null || !this._changes.has(kind)) return false;
		if (this._unnamedRefKinds.has(kind) || ref === 'HEAD') return true;

		return findCoveringRefName(this._refs, ref) != null;
	}

	/**
	 * Test whether any of the specified change types are present in the event.
	 *
	 * @param affected - Change types to test for.
	 * @returns `true` if any of the specified changes are present.
	 */
	changed(...affected: RepositoryChange[]): boolean {
		return some(this._changes, c => affected.includes(c));
	}

	/**
	 * Test whether the event contains ONLY the specified change types.
	 *
	 * `pausedOp` is treated as a union of `cherryPick`, `merge`, `rebase`,
	 * and `revert` for convenience.
	 *
	 * @param affected - Change types to test for.
	 * @returns `true` if the event contains only the specified changes.
	 */
	changedExclusive(...affected: RepositoryChange[]): boolean {
		let changes = this._changes;

		// When checking for specific paused operation types, also accept the union type
		if (
			affected.includes('cherryPick') ||
			affected.includes('merge') ||
			affected.includes('rebase') ||
			affected.includes('revert')
		) {
			if (!affected.includes('pausedOp')) {
				affected = [...affected, 'pausedOp'];
			}
		} else if (affected.includes('pausedOp')) {
			// When checking for the union type exclusively, ignore specific subtypes
			changes = new Set(changes);
			changes.delete('cherryPick');
			changes.delete('merge');
			changes.delete('rebase');
			changes.delete('revert');
		}

		const intersection = [...filter(changes, c => affected.includes(c))];
		return intersection.length === changes.size;
	}

	/**
	 * Coalesce: return a new event with all changes and refs from both this and the given set. When `refs` is omitted,
	 * every ref kind in `changes` counts as unnamed. A kind in `changes` is no longer {@link announced}.
	 */
	with(changes: RepositoryChange[], refs?: WatcherRefChanges): WatcherRepoChangeEvent {
		const names = [...this._refs];
		const unnamed = [...this._unnamedRefKinds];
		if (refs == null) {
			unnamed.push(...filter(changes, isRefChangeKind));
		} else {
			if (refs.names != null) {
				names.push(...refs.names);
			}
			if (refs.unnamed != null) {
				unnamed.push(...refs.unnamed);
			}
		}

		return new WatcherRepoChangeEvent(
			this.repoPath,
			[...this._changes, ...changes],
			{ names: names, unnamed: unnamed },
			filter(this._announced, c => !changes.includes(c)),
		);
	}
}

/**
 * Returns the name in `names` that covers `ref` — `ref` itself, or a ref directory above it (compared on `/`
 * boundaries, so `refs/heads/fe` doesn't cover `refs/heads/feature`) — or `undefined` if none does.
 */
export function findCoveringRefName(names: ReadonlySet<string>, ref: string): string | undefined {
	if (names.size === 0) return undefined;
	if (names.has(ref)) return ref;

	let index = ref.lastIndexOf('/');
	while (index > 0) {
		const dir = ref.substring(0, index);
		if (names.has(dir)) return dir;

		index = ref.lastIndexOf('/', index - 1);
	}
	return undefined;
}

/**
 * An event describing working tree file changes, produced by the working tree pipeline.
 *
 * Paths have already been filtered through the gitignore filter and noise filter.
 */
export interface WorkingTreeChangeEvent {
	readonly repoPath: string;
	/**
	 * Absolute paths of changed files or directories (post-gitignore filtering). A directory stands for everything
	 * beneath it. Partial when {@link incomplete}.
	 */
	readonly paths: ReadonlySet<string>;
	/**
	 * `true` when more paths changed than the accumulator retains, so {@link paths} is a partial set and a
	 * miss does NOT mean the file is unchanged. Consumers testing membership must treat this as a match.
	 */
	readonly incomplete: boolean;
}
