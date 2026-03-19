import { formatDate, fromNow } from '@gitlens/utils/date.js';
import { loggable } from '@gitlens/utils/decorators/log.js';
import { memoize } from '@gitlens/utils/decorators/memoize.js';
import { serializable } from '@gitlens/utils/decorators/serializable.js';
import { Lazy } from '@gitlens/utils/lazy.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import type { Shape } from '@gitlens/utils/types.js';
import { getRepositoryService } from '../repositoryService.js';
import {
	getAbbreviatedShaLength,
	isSha,
	isUncommitted,
	isUncommittedStaged,
	isUncommittedStagedWithParentSuffix,
	isUncommittedWithParentSuffix,
} from '../utils/revision.utils.js';
import { getStatusFilePseudoFileChanges } from '../utils/statusFile.utils.js';
import type { GitDiffFileStats } from './diff.js';
import { GitFileChange } from './fileChange.js';
import type { GitRevisionReference, GitStashReference } from './reference.js';
import { uncommitted, uncommittedStaged } from './revision.js';

const stashNumberRegex = /stash@{(\d+)}/;

export type GitCommitShape = Shape<GitCommit>;

export interface GitCommitFileset {
	/** `undefined` if the full set of files hasn't been loaded */
	readonly files: readonly GitFileChange[] | undefined;
	readonly filtered?:
		| {
				readonly files: readonly GitFileChange[] | undefined;
				readonly pathspec: string;
		  }
		| undefined;
}

const pendingFullDetails = new WeakMap<GitCommit, Promise<void>>();

@loggable(i => `${i.repoPath}|${i.shortSha}`)
@serializable
export class GitCommit implements GitRevisionReference {
	static is(commit: unknown): commit is GitCommit {
		return commit instanceof GitCommit;
	}

	static isStash(commit: unknown): commit is GitStashCommit {
		return commit instanceof GitCommit && commit.refType === 'stash' && Boolean(commit.stashName);
	}

	static async getPreviousSha(commit: GitCommit): Promise<string | undefined> {
		// Short-circuit: use already-known previous SHA from file metadata
		if (commit.file != null) {
			if (commit.file.previousSha != null && isSha(commit.file.previousSha)) {
				return commit.file.previousSha;
			}
		} else {
			// Short-circuit: use first parent if it's a full SHA
			const parent = commit.parents[0];
			if (parent != null && isSha(parent)) {
				enrichCommit(commit, { resolvedPreviousSha: parent });
				return parent;
			}
		}

		// Resolve via sub-provider (cached by the Git Cache infrastructure)
		const repo = getRepositoryService(commit.repoPath);
		const ref = isUncommitted(commit.sha, true) ? 'HEAD' : `${commit.sha}^`;
		const path = commit.file != null ? (commit.file.originalPath ?? commit.file.path) : undefined;

		const sha = (await repo?.revision.resolveRevision(ref, path))?.sha;

		enrichCommit(commit, { resolvedPreviousSha: sha });
		return sha;
	}

	/**
	 * Ensures that the commit has full details loaded (message, fileset, stats).
	 * For uncommitted commits, loads the current working tree status.
	 * For stash/regular commits, fetches commit files and resolves the previous SHA.
	 *
	 * Uses WeakMap deduplication (replaces the `@gate()` decorator from the old instance method).
	 */
	static async ensureFullDetails(
		commit: GitCommit,
		options?: {
			allowFilteredFiles?: boolean;
			include?: { stats?: boolean; uncommittedFiles?: boolean };
		},
	): Promise<void> {
		if (commit.hasFullDetails(options)) return;

		// Deduplicate concurrent calls for the same commit
		const pending = pendingFullDetails.get(commit);
		if (pending != null) {
			await pending;
			if (commit.hasFullDetails(options)) return;
			// Fall through to load again with the specific options
		}

		const promise = GitCommit.ensureFullDetailsCore(commit, options).finally(() => {
			// Only delete if this promise is still the current one — a newer caller may have replaced it
			if (pendingFullDetails.get(commit) === promise) {
				pendingFullDetails.delete(commit);
			}
		});
		pendingFullDetails.set(commit, promise);
		return promise;
	}

	private static async ensureFullDetailsCore(
		commit: GitCommit,
		options?: {
			allowFilteredFiles?: boolean;
			include?: { stats?: boolean; uncommittedFiles?: boolean };
		},
	): Promise<void> {
		const repo = getRepositoryService(commit.repoPath);

		// If the commit is "uncommitted", then have the files list be all uncommitted files
		if (commit.isUncommitted) {
			let etagWorkingTree = repo?.etagWorkingTree;
			enrichCommit(commit, { etagWorkingTree: etagWorkingTree });

			if (etagWorkingTree != null || options?.include?.uncommittedFiles) {
				const status = await repo?.status.getStatus();
				if (status != null) {
					let files = status.files.flatMap(f => getStatusFilePseudoFileChanges(f));
					if (isUncommittedStaged(commit.sha)) {
						files = files.filter(f => f.staged);
					}

					const pathspec = commit.fileset?.filtered?.pathspec;
					commit.applyFileset(
						pathspec
							? { files: undefined, filtered: { files: files, pathspec: pathspec } }
							: { files: files },
					);
				}
				etagWorkingTree = repo?.etagWorkingTree;
				enrichCommit(commit, { etagWorkingTree: etagWorkingTree });
			}

			if (options?.include?.stats) {
				enrichCommit(commit, { recomputeStats: true });
				// Force stat recomputation by accessing stats
				void commit.stats;

				const stats = await repo?.diff.getChangedFilesCount(commit.isUncommittedStaged ? uncommitted : 'HEAD');
				if (stats != null) {
					const currentStats = commit.stats;
					if (currentStats != null) {
						enrichCommit(commit, {
							stats: {
								...currentStats,
								additions: stats.additions,
								deletions: stats.deletions,
							},
							recomputeStats: false,
						});
					} else {
						enrichCommit(commit, { stats: stats, recomputeStats: false });
					}
				}
			} else {
				enrichCommit(commit, { recomputeStats: true });
			}

			return;
		}

		if (commit.refType === 'stash') {
			const [stashFilesResult] = await Promise.allSettled([
				repo?.stash?.getStashCommitFiles(commit.sha),
				GitCommit.getPreviousSha(commit),
			]);

			const stashFiles = getSettledValue(stashFilesResult);
			if (stashFiles?.length) {
				commit.applyFileset({
					files: stashFiles as readonly GitFileChange[],
					filtered: commit.fileset?.filtered,
				});
			}
			enrichCommit(commit, { stashUntrackedFilesLoaded: true });
		} else {
			const [commitResult] = await Promise.allSettled([
				repo?.commits.getCommit(commit.sha),
				GitCommit.getPreviousSha(commit),
			]);

			const loaded = getSettledValue(commitResult);
			if (loaded != null) {
				enrichCommit(commit, {
					parents: loaded.parents ?? commit.parents,
					summary: loaded.summary,
					message: loaded.message,
				});
				commit.applyFileset({
					files: loaded.fileset?.files ?? [],
					filtered: commit.fileset?.filtered,
				});
			}
		}

		enrichCommit(commit, { recomputeStats: true });
	}

	protected _etagWorkingTree: number | undefined;
	protected _stashUntrackedFilesLoaded = false;
	protected _recomputeStats = false;

	readonly lines: GitCommitLine[];
	readonly ref: string;
	readonly refType: GitRevisionReference['refType'];
	readonly shortSha: string;
	readonly stashName: string | undefined;
	readonly stashNumber: string | undefined;
	readonly stashOnRef: string | undefined;
	readonly tips: string[] | undefined;
	readonly parentTimestamps?: GitStashParentInfo[] | undefined;

	constructor(
		public readonly repoPath: string,
		public readonly sha: string,
		public readonly author: GitCommitIdentity,
		public readonly committer: GitCommitIdentity,
		summary: string,
		public readonly parents: string[],
		message?: string | undefined,
		fileset?: GitCommitFileset | undefined,
		stats?: GitCommitStats,
		lines?: GitCommitLine | GitCommitLine[] | undefined,
		tips?: string[],
		stashName?: string | undefined,
		stashOnRef?: string | undefined,
		parentTimestamps?: GitStashParentInfo[] | undefined,
		shaLength: number = getAbbreviatedShaLength(),
	) {
		this.ref = sha;
		this.shortSha = sha.substring(0, shaLength);
		this.tips = tips;
		this.parentTimestamps = parentTimestamps;

		if (stashName) {
			this.refType = 'stash';
			this.stashName = stashName || undefined;
			this.stashOnRef = stashOnRef || undefined;
			this.stashNumber = stashNumberRegex.exec(stashName)?.[1];
		} else {
			this.refType = 'revision';
		}

		// Add an ellipsis to the summary if there is or might be more message
		if (message != null) {
			this._message = message;
			if (summary !== message) {
				this._summary = `${summary} \u2026`; // ellipsis
			} else {
				this._summary = summary;
			}
		} else if (isUncommitted(sha, true)) {
			this._summary = summary;
			this._message = 'Uncommitted Changes';
		} else {
			this._summary = `${summary} \u2026`; // ellipsis
		}

		// Keep this above files, because we check this in computing the stats
		if (stats != null) {
			this._stats = stats;
		}

		if (fileset != null) {
			this.applyFileset(fileset);
			this._recomputeStats = this._stats == null;
		}

		this.lines = Array.isArray(lines) ? lines : lines != null ? [lines] : [];
	}

	/** Gets the authored date */
	get authorDate(): Date {
		return this.author.date;
	}

	/** Gets the committed date */
	get committedDate(): Date {
		return this.committer.date;
	}

	/** Gets a list of any files in the commit, filtered or otherwise */
	get anyFiles(): readonly GitFileChange[] | undefined {
		return this._fileset?.files ?? this._fileset?.filtered?.files;
	}

	private _file: Lazy<GitFileChange | undefined> | undefined;
	/** Gets the primary file associated with this commit (from a filtered fileset) */
	get file(): GitFileChange | undefined {
		return this._file?.value;
	}

	protected _fileset: GitCommitFileset | undefined;
	get fileset(): GitCommitFileset | undefined {
		return this._fileset;
	}

	/** Updates the fileset and recomputes the lazy `file` getter */
	applyFileset(value: GitCommitFileset | undefined): void {
		if (value == null) {
			this._fileset = undefined;
			this._file = undefined;
			return;
		}

		// Handle folder "globs" (e.g. `src/*`)
		if (value.filtered?.pathspec?.endsWith('*')) {
			value = { ...value, filtered: { ...value.filtered, pathspec: value.filtered.pathspec.slice(0, -1) } };
		}
		this._fileset = value;

		const current = this._file?.value;
		this._file = new Lazy(() => {
			let file;
			if (value.filtered?.pathspec) {
				if (value.filtered.files?.length === 1) {
					[file] = value.filtered.files;
				} else {
					let files = value.filtered.files?.filter(f => f.path === value.filtered!.pathspec) ?? [];
					// If we found multiple files with the same path and is uncommitted, then use the existing file if we have one, otherwise use the first
					if (files.length > 1) {
						if (this.isUncommitted) {
							file = current ?? files[0];
						}
					} else if (files.length === 1) {
						[file] = files;
					} else {
						files = value.filtered.files?.filter(f => f.path.startsWith(value.filtered!.pathspec)) ?? [];
						file = files.length === 1 ? files[0] : undefined;
					}
				}
			}

			if (file == null) return undefined;

			return new GitFileChange(
				file.repoPath,
				file.path,
				file.status,
				file.uri,
				file.originalPath ?? current?.originalPath,
				file.originalUri ?? current?.originalUri,
				file.previousSha ?? current?.previousSha,
				file.stats ?? current?.stats,
				file.staged ?? current?.staged,
				file.range ?? current?.range,
				file.mode ?? current?.mode,
				file.submodule ?? current?.submodule,
			);
		});
	}

	@memoize()
	get isUncommitted(): boolean {
		return isUncommitted(this.sha);
	}

	@memoize()
	get isUncommittedStaged(): boolean {
		return isUncommittedStaged(this.sha);
	}

	get isMergeCommit(): boolean {
		return this.parents.length > 1;
	}

	protected _message: string | undefined;
	get message(): string | undefined {
		return this._message;
	}

	get name(): string {
		return this.stashName ? this.stashName : this.shortSha;
	}

	protected _stats: GitCommitStats | undefined;
	get stats(): GitCommitStats | undefined {
		if (this._recomputeStats) {
			this.computeFileStats();
		}

		return this._stats;
	}

	protected _summary: string;
	get summary(): string {
		return this._summary;
	}

	protected _resolvedPreviousSha: string | undefined;
	get resolvedPreviousSha(): string | undefined {
		return this._resolvedPreviousSha;
	}

	get unresolvedPreviousSha(): string {
		const previousSha =
			this._resolvedPreviousSha ??
			(this.file != null ? this.file.previousSha : this.parents[0]) ??
			`${this.sha}^`;
		return isUncommittedWithParentSuffix(previousSha)
			? isUncommittedStagedWithParentSuffix(previousSha)
				? 'HEAD'
				: uncommittedStaged
			: previousSha;
	}

	get stashUntrackedFilesLoaded(): boolean {
		return this._stashUntrackedFilesLoaded;
	}

	hasFullDetails(options?: {
		allowFilteredFiles?: boolean;
		include?: { stats?: boolean; uncommittedFiles?: boolean };
	}): this is GitCommitWithFullDetails {
		if (this.message == null || this._fileset == null) return false;
		if (
			this._fileset.files == null &&
			(!options?.allowFilteredFiles || (options?.allowFilteredFiles && this._fileset.filtered?.files == null))
		) {
			return false;
		}
		if (this.refType === 'stash' && !this._stashUntrackedFilesLoaded && !options?.allowFilteredFiles) {
			return false;
		}
		if (options?.include?.stats && this.anyFiles?.some(f => f.stats == null)) {
			return false;
		}
		// For uncommitted commits, check working tree staleness via etag
		if (this.isUncommitted) {
			if (
				!this.parents.length ||
				this._etagWorkingTree !== getRepositoryService(this.repoPath)?.etagWorkingTree
			) {
				return false;
			}
		}
		return true;
	}

	/** Returns an enriched copy with additional details */
	with<T extends GitCommit = GitCommit>(changes: {
		sha?: string;
		parents?: string[] | null;
		message?: string;
		fileset?: GitCommitFileset | null;
		lines?: GitCommitLine[] | null;
		stats?: GitCommitStats | null;
		stashUntrackedFilesLoaded?: boolean;
		resolvedPreviousSha?: string;
		parentTimestamps?: GitStashParentInfo[] | null;
	}): T {
		const commit = new GitCommit(
			this.repoPath,
			changes.sha ?? this.sha,
			this.author,
			this.committer,
			this._summary,
			this.getChangedValue(changes.parents, this.parents) ?? [],
			changes.message ?? this._message,
			this.getChangedValue(changes.fileset, this._fileset),
			this.getChangedValue(changes.stats, this._stats),
			this.getChangedValue(changes.lines, this.lines),
			this.tips,
			this.stashName,
			this.stashOnRef,
			this.getChangedValue(changes.parentTimestamps, this.parentTimestamps),
			this.shortSha.length,
		);
		commit._etagWorkingTree = this._etagWorkingTree;
		if (changes.stashUntrackedFilesLoaded != null) {
			commit._stashUntrackedFilesLoaded = changes.stashUntrackedFilesLoaded;
		}
		if (changes.resolvedPreviousSha != null) {
			commit._resolvedPreviousSha = changes.resolvedPreviousSha;
		}
		return commit as T;
	}

	protected getChangedValue<T>(change: T | null | undefined, original: T | undefined): T | undefined {
		return change === undefined ? original : change === null ? undefined : change;
	}

	@memoize({ resolver: (...args) => `${args[0]}|${args[1]}` })
	formatDate(dateSource: 'authored' | 'committed', format?: string | null): string {
		const date = dateSource === 'committed' ? this.committer.date : this.author.date;
		return formatDate(date, format ?? 'MMMM Do, YYYY h:mma');
	}

	formatDateFromNow(dateSource: 'authored' | 'committed', short?: boolean): string {
		const date = dateSource === 'committed' ? this.committer.date : this.author.date;
		return fromNow(date, short);
	}

	/**
	 * Creates a copy of this commit with a different repoPath.
	 * Used for worktree-aware caching where shared data needs per-worktree IDs.
	 */
	withRepoPath<T extends GitCommit>(repoPath: string): T {
		if (repoPath === this.repoPath) return this as unknown as T;

		const commit = new GitCommit(
			repoPath,
			this.sha,
			this.author,
			this.committer,
			this.summary,
			this.parents,
			this.message,
			this._fileset,
			this._stats ?? undefined,
			this.lines,
			this.tips,
			this.stashName,
			this.stashOnRef,
			this.parentTimestamps,
		);
		commit._etagWorkingTree = this._etagWorkingTree;
		return commit as T;
	}

	protected computeFileStats(): void {
		if (!this._recomputeStats || this._fileset == null) return;
		this._recomputeStats = false;

		const changedFiles = { added: 0, deleted: 0, changed: 0 };

		let additions = 0;
		let deletions = 0;

		const files = this._fileset.files ?? this._fileset.filtered?.files;
		if (files?.length) {
			for (const file of files) {
				if (file.stats != null) {
					additions += file.stats.additions;
					deletions += file.stats.deletions;
				}

				switch (file.status) {
					case 'A':
					case '?':
						changedFiles.added++;
						break;
					case 'D':
						changedFiles.deleted++;
						break;
					default:
						changedFiles.changed++;
						break;
				}
			}
		}

		if (this._stats != null) {
			if (additions === 0 && this._stats.additions !== 0) {
				additions = this._stats.additions;
			}
			if (deletions === 0 && this._stats.deletions !== 0) {
				deletions = this._stats.deletions;
			}
		}

		this._stats = { ...this._stats, files: changedFiles, additions: additions, deletions: deletions };
	}
}

/** @internal */
interface GitCommitMutable {
	_etagWorkingTree: number | undefined;
	_message: string | undefined;
	_summary: string;
	_stats: GitCommitStats | undefined;
	_stashUntrackedFilesLoaded: boolean;
	_recomputeStats: boolean;
	_resolvedPreviousSha: string | undefined;
	parents: string[];
}

/** @internal Used by sub-providers and service functions for in-place enrichment */
export function enrichCommit(
	commit: GitCommit,
	details: {
		etagWorkingTree?: number;
		message?: string;
		summary?: string;
		fileset?: GitCommitFileset;
		stats?: GitCommitStats;
		stashUntrackedFilesLoaded?: boolean;
		resolvedPreviousSha?: string;
		recomputeStats?: boolean;
		parents?: string[];
	},
): void {
	const mutable = commit as unknown as GitCommitMutable;
	if (details.etagWorkingTree !== undefined) {
		mutable._etagWorkingTree = details.etagWorkingTree;
	}
	if (details.message !== undefined) {
		mutable._message = details.message;
	}
	if (details.summary !== undefined) {
		mutable._summary = details.summary;
	}
	if (details.fileset !== undefined) {
		commit.applyFileset(details.fileset);
	}
	if (details.stats !== undefined) {
		mutable._stats = details.stats;
	}
	if (details.stashUntrackedFilesLoaded !== undefined) {
		mutable._stashUntrackedFilesLoaded = details.stashUntrackedFilesLoaded;
	}
	if (details.resolvedPreviousSha !== undefined) {
		mutable._resolvedPreviousSha = details.resolvedPreviousSha;
	}
	if (details.recomputeStats !== undefined) {
		mutable._recomputeStats = details.recomputeStats;
	}
	if (details.parents !== undefined) {
		mutable.parents = details.parents;
	}
}

export interface GitCommitIdentityShape {
	readonly name: string;
	readonly email: string | undefined;
	readonly date: Date;
}

@loggable(i => i.name)
export class GitCommitIdentity implements GitCommitIdentityShape {
	constructor(
		public readonly name: string,
		public readonly email: string | undefined,
		public readonly date: Date,
		public readonly avatarUrl?: string | undefined,
	) {}

	@memoize({ resolver: format => format ?? 'MMMM Do, YYYY h:mma' })
	formatDate(format?: string | null): string {
		return formatDate(this.date, format ?? 'MMMM Do, YYYY h:mma');
	}

	fromNow(short?: boolean): string {
		return fromNow(this.date, short);
	}
}

export interface GitCommitLine {
	sha: string;
	previousSha?: string | undefined;
	/** The original (previous) line number prior to this commit; 1-based */
	originalLine: number;
	/** The current line number in this commit; 1-based */
	line: number;
}

export interface GitCommitStats<Files extends number | GitDiffFileStats = number | GitDiffFileStats> {
	readonly files: Files;
	readonly additions: number;
	readonly deletions: number;
}

export interface GitStashParentInfo {
	readonly sha: string;
	readonly authorDate?: number;
	readonly committerDate?: number;
}

export interface GitStashCommit extends GitCommit {
	readonly refType: GitStashReference['refType'];
	readonly stashName: string;
	readonly stashNumber: string;
	readonly parentTimestamps?: GitStashParentInfo[];
}

export type GitCommitWithFullDetails = GitCommit & { message: string; fileset: GitCommitFileset };
