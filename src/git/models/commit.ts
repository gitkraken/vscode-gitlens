/* eslint-disable @typescript-eslint/no-restricted-imports -- TODO need to deal with sharing rich class shapes to webviews */
import { Uri } from 'vscode';
import type { EnrichedAutolink } from '../../autolinks/models/autolinks';
import { getAvatarUri, getCachedAvatarUri } from '../../avatars';
import type { GravatarDefaultStyle } from '../../config';
import { GlyphChars } from '../../constants';
import type { Container } from '../../container';
import { ensureArray } from '../../system/array';
import { formatDate, fromNow } from '../../system/date';
import { gate } from '../../system/decorators/gate';
import { memoize } from '../../system/decorators/memoize';
import { Lazy } from '../../system/lazy';
import { getLoggableName } from '../../system/logger';
import { getSettledValue } from '../../system/promise';
import { pluralize } from '../../system/string';
import type { DiffRange, PreviousRangeComparisonUrisResult } from '../gitProvider';
import { GitUri } from '../gitUri';
import type { RemoteProvider } from '../remotes/remoteProvider';
import { getChangedFilesCount } from '../utils/commit.utils';
import {
	isSha,
	isUncommitted,
	isUncommittedStaged,
	isUncommittedStagedWithParentSuffix,
	isUncommittedWithParentSuffix,
} from '../utils/revision.utils';
import type { GitDiffFileStats } from './diff';
import type { GitFile } from './file';
import { GitFileChange } from './fileChange';
import type { PullRequest } from './pullRequest';
import type { GitRevisionReference, GitStashReference } from './reference';
import type { GitRemote } from './remote';
import type { Repository } from './repository';
import { uncommitted, uncommittedStaged } from './revision';

const stashNumberRegex = /stash@{(\d+)}/;

export function isCommit(commit: unknown): commit is GitCommit {
	return commit instanceof GitCommit;
}

export function isStash(commit: unknown): commit is GitStashCommit {
	return isCommit(commit) && commit.refType === 'stash' && Boolean(commit.stashName);
}

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

export class GitCommit implements GitRevisionReference {
	private _stashUntrackedFilesLoaded = false;
	private _recomputeStats = false;

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
		private readonly container: Container,
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
	) {
		this.ref = sha;
		this.shortSha = sha.substring(0, this.container.CommitShaFormatting.length);
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
				this._summary = `${summary} ${GlyphChars.Ellipsis}`;
			} else {
				this._summary = summary;
			}
		} else if (isUncommitted(sha, true)) {
			this._summary = summary;
			this._message = 'Uncommitted Changes';
		} else {
			this._summary = `${summary} ${GlyphChars.Ellipsis}`;
		}

		// Keep this above files, because we check this in computing the stats
		if (stats != null) {
			this._stats = stats;
		}

		if (fileset != null) {
			this.fileset = fileset;

			this._recomputeStats = this._stats == null;
		}

		this.lines = ensureArray(lines) ?? [];
	}

	toString(): string {
		return `${getLoggableName(this)}(${this.repoPath}|${this.shortSha})`;
	}

	get date(): Date {
		return this.container.CommitDateFormatting.dateSource === 'committed' ? this.committer.date : this.author.date;
	}

	private _file: Lazy<GitFileChange | undefined> | undefined;
	get file(): GitFileChange | undefined {
		return this._file?.value;
	}

	/** Gets a list of any files in the commit, filtered or otherwise */
	get anyFiles(): readonly GitFileChange[] | undefined {
		return this.fileset?.files ?? this.fileset?.filtered?.files;
	}

	private _fileset: GitCommitFileset | undefined;
	get fileset(): GitCommitFileset | undefined {
		return this._fileset;
	}
	private set fileset(value: GitCommitFileset | undefined) {
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
				this.container,
				file.repoPath,
				file.path,
				file.status,
				file.originalPath ?? current?.originalPath,
				file.previousSha ?? current?.previousSha,
				file.stats ?? current?.stats,
				file.staged ?? current?.staged,
				file.range ?? current?.range,
			);
		});
	}

	get formattedDate(): string {
		return this.container.CommitDateFormatting.dateStyle === 'absolute'
			? this.formatDate(this.container.CommitDateFormatting.dateFormat)
			: this.formatDateFromNow();
	}

	@memoize()
	get isUncommitted(): boolean {
		return isUncommitted(this.sha);
	}

	@memoize()
	get isUncommittedStaged(): boolean {
		return isUncommittedStaged(this.sha);
	}

	private _message: string | undefined;
	get message(): string | undefined {
		return this._message;
	}

	get name(): string {
		return this.stashName ? this.stashName : this.shortSha;
	}

	private _stats: GitCommitStats | undefined;
	get stats(): GitCommitStats | undefined {
		if (this._recomputeStats) {
			this.computeFileStats();
		}

		return this._stats;
	}

	private _summary: string;
	get summary(): string {
		return this._summary;
	}

	private _resolvedPreviousSha: string | undefined;
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

	private _etagFileSystem: number | undefined;

	hasFullDetails(options?: {
		allowFilteredFiles?: boolean;
		include?: { stats?: boolean; uncommittedFiles?: boolean };
	}): this is GitCommitWithFullDetails {
		if (this.message == null || this.fileset == null) return false;
		if (
			this.fileset.files == null &&
			(!options?.allowFilteredFiles || (options?.allowFilteredFiles && this.fileset.filtered?.files == null))
		) {
			return false;
		}
		if (this.refType === 'stash' && !this._stashUntrackedFilesLoaded && !options?.allowFilteredFiles) {
			return false;
		}
		if (options?.include?.stats && this.anyFiles?.some(f => f.stats == null)) {
			return false;
		}
		// If this is an uncommitted commit, check if we need to load the working files (if we don't have a matching etag -- only works if we are currently watching the file system for this repository)
		if (
			this.isUncommitted &&
			(!this.parents.length ||
				this._etagFileSystem !== this.container.git.getRepository(this.repoPath)?.etagFileSystem)
		) {
			return false;
		}
		return true;
	}

	@gate()
	async ensureFullDetails(options?: {
		allowFilteredFiles?: boolean;
		include?: { stats?: boolean; uncommittedFiles?: boolean };
	}): Promise<void> {
		if (this.hasFullDetails(options)) return;

		// If the commit is "uncommitted", then have the files list be all uncommitted files
		if (this.isUncommitted) {
			const repo = this.container.git.getRepository(this.repoPath);
			this._etagFileSystem = repo?.etagFileSystem;

			if (this._etagFileSystem != null || options?.include?.uncommittedFiles) {
				const status = await repo?.git.status.getStatus();
				if (status != null) {
					let files = status.files.flatMap(f => f.getPseudoFileChanges());
					if (isUncommittedStaged(this.sha)) {
						files = files.filter(f => f.staged);
					}

					const pathspec = this.fileset?.filtered?.pathspec;
					this.fileset = pathspec
						? { files: undefined, filtered: { files: files, pathspec: pathspec } }
						: { files: files };
				}
				this._etagFileSystem = repo?.etagFileSystem;
			}

			if (options?.include?.stats) {
				this._recomputeStats = true;
				this.computeFileStats();

				const stats = await repo?.git.diff.getChangedFilesCount(
					this.isUncommittedStaged ? uncommitted : 'HEAD',
				);
				if (stats != null) {
					if (this._stats != null) {
						this._stats = {
							...this._stats,
							additions: stats.additions,
							deletions: stats.deletions,
						};
					} else {
						this._stats = stats;
					}
				}
				this._recomputeStats = false;
			} else {
				this._recomputeStats = true;
			}

			return;
		}

		const svc = this.container.git.getRepositoryService(this.repoPath);
		if (this.refType === 'stash') {
			const [stashFilesResult] = await Promise.allSettled([
				svc.stash?.getStashCommitFiles(this.sha),
				this.getPreviousSha(),
			]);

			const stashFiles = getSettledValue(stashFilesResult);
			if (stashFiles?.length) {
				this.fileset = { files: stashFiles, filtered: this.fileset?.filtered };
			}
			this._stashUntrackedFilesLoaded = true;
		} else {
			const [commitResult] = await Promise.allSettled([svc.commits.getCommit(this.sha), this.getPreviousSha()]);

			const commit = getSettledValue(commitResult);
			if (commit != null) {
				this.parents.push(...(commit.parents ?? []));
				this._summary = commit.summary;
				this._message = commit.message;
				this.fileset = { files: commit.fileset?.files ?? [], filtered: this.fileset?.filtered };
			}
		}

		this._recomputeStats = true;
	}

	private computeFileStats(): void {
		if (!this._recomputeStats || this.fileset == null) return;
		this._recomputeStats = false;

		const changedFiles = { added: 0, deleted: 0, changed: 0 };

		let additions = 0;
		let deletions = 0;

		const files = this.fileset.files ?? this.fileset.filtered?.files;
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

	async findFile(
		pathOrUri: string | Uri,
		staged?: boolean,
		options?: { allowFilteredFiles?: boolean; include?: { stats?: boolean } },
	): Promise<GitFileChange | undefined> {
		if (!this.hasFullDetails(options)) {
			await this.ensureFullDetails(options);
			if (this.fileset == null) return undefined;
		}

		const relativePath = this.container.git.getRelativePath(pathOrUri, this.repoPath);
		if (this.isUncommitted && staged != null) {
			return this.anyFiles?.find(f => f.path === relativePath && f.staged === staged);
		}
		return this.anyFiles?.find(f => f.path === relativePath);
	}

	formatDate(format?: string | null): string {
		return this.container.CommitDateFormatting.dateSource === 'committed'
			? this.committer.formatDate(format)
			: this.author.formatDate(format);
	}

	formatDateFromNow(short?: boolean): string {
		return this.container.CommitDateFormatting.dateSource === 'committed'
			? this.committer.fromNow(short)
			: this.author.fromNow(short);
	}

	formatStats(
		style: 'short' | 'stats' | 'expanded',
		options?: {
			addParenthesesToFileStats?: boolean;
			color?: boolean;
			empty?: string;
			separator?: string;
		},
	): string {
		const { stats } = this;
		if (stats == null) return options?.empty ?? '';

		const { files: changedFiles, additions, deletions } = stats;
		if (getChangedFilesCount(changedFiles) <= 0 && additions <= 0 && deletions <= 0) return options?.empty ?? '';

		const separator = options?.separator ?? ' ';

		function formatStat(type: 'added' | 'changed' | 'deleted', value: number) {
			if (style === 'expanded') {
				return `${pluralize('file', value)} ${type}`;
			}

			const label = `${type === 'added' ? '+' : type === 'deleted' ? '-' : '~'}${value}`;
			return style === 'stats' && options?.color
				? /*html*/ `<span style="color:${
						type === 'added'
							? 'var(--vscode-gitDecoration-addedResourceForeground)'
							: type === 'deleted'
								? 'var(--vscode-gitDecoration-deletedResourceForeground)'
								: 'var(--vscode-gitDecoration-modifiedResourceForeground)'
					};">${label}</span>`
				: label;
		}

		const fileStats = [];

		if (typeof changedFiles === 'number') {
			if (changedFiles) {
				fileStats.push(formatStat('changed', changedFiles));
			}
		} else {
			const { added, changed, deleted } = changedFiles;
			if (added) {
				fileStats.push(formatStat('added', added));
			} else if (style === 'stats') {
				fileStats.push(formatStat('added', 0));
			}

			if (changed) {
				fileStats.push(formatStat('changed', changed));
			} else if (style === 'stats') {
				fileStats.push(formatStat('changed', 0));
			}

			if (deleted) {
				fileStats.push(formatStat('deleted', deleted));
			} else if (style === 'stats') {
				fileStats.push(formatStat('deleted', 0));
			}
		}

		let result = fileStats.join(separator);
		if (style === 'stats' && options?.color) {
			result = /*html*/ `<span style="background-color:var(--vscode-textCodeBlock-background);border-radius:3px;">&nbsp;${result}&nbsp;&nbsp;</span> `;
		}
		if (options?.addParenthesesToFileStats) {
			result = `(${result})`;
		}

		if (style === 'expanded') {
			const lineStats = [];

			if (additions) {
				const additionsText = pluralize('addition', additions);
				if (options?.color) {
					lineStats.push(
						/*html*/ `<span style="color:var(--vscode-gitDecoration-addedResourceForeground);">${additionsText}</span>`,
					);
				} else {
					lineStats.push(additionsText);
				}
			}

			if (deletions) {
				const deletionsText = pluralize('deletion', deletions);
				if (options?.color) {
					lineStats.push(
						/*html*/ `<span style="color:var(--vscode-gitDecoration-deletedResourceForeground);">${deletionsText}</span>`,
					);
				} else {
					lineStats.push(deletionsText);
				}
			}

			if (lineStats.length) {
				result += `${
					fileStats.length ? (options?.addParenthesesToFileStats ? `${GlyphChars.Space} ` : `, `) : ''
				}${lineStats.join(separator)}`;
			}
		}

		return result;
	}

	async getAssociatedPullRequest(
		remote?: GitRemote<RemoteProvider>,
		options?: { expiryOverride?: boolean | number },
	): Promise<PullRequest | undefined> {
		if (this.isUncommitted) return undefined;

		remote ??= await this.container.git.getRepositoryService(this.repoPath).remotes.getBestRemoteWithIntegration();
		if (!remote?.supportsIntegration()) return undefined;

		const integration = await remote.getIntegration();
		return integration?.getPullRequestForCommit(remote.provider.repoDesc, this.sha, options);
	}

	async getEnrichedAutolinks(remote?: GitRemote<RemoteProvider>): Promise<Map<string, EnrichedAutolink> | undefined> {
		if (this.isUncommitted) return undefined;

		remote ??= await this.container.git.getRepositoryService(this.repoPath).remotes.getBestRemoteWithIntegration();

		// TODO@eamodio should we cache these? Seems like we would use more memory than it's worth
		// async function getCore(this: GitCommit): Promise<Map<string, EnrichedAutolink> | undefined> {
		if (this.message == null) {
			await this.ensureFullDetails();
		}

		return this.container.autolinks.getEnrichedAutolinks(this.message ?? this.summary, remote);
		// }

		// const enriched = this.container.cache.getEnrichedAutolinks(this.sha, remote, () => ({
		// 	value: getCore.call(this),
		// }));
		// return enriched;
	}

	getAvatarUri(options?: { defaultStyle?: GravatarDefaultStyle; size?: number }): Uri | Promise<Uri> {
		return this.author.getAvatarUri(this, options);
	}

	getCachedAvatarUri(options?: { size?: number }): Uri | undefined {
		return this.author.getCachedAvatarUri(options);
	}

	async getCommitForFile(file: string | GitFile, staged?: boolean): Promise<GitCommit | undefined> {
		const path = typeof file === 'string' ? this.container.git.getRelativePath(file, this.repoPath) : file.path;
		const foundFile = await this.findFile(path, staged);
		if (foundFile == null) return undefined;

		const commit = this.with({
			sha: foundFile.staged ? uncommittedStaged : this.sha,
			fileset: { ...this.fileset!, filtered: { files: [foundFile], pathspec: path } },
		});
		return commit;
	}

	async getCommitsForFiles(options?: {
		allowFilteredFiles?: boolean;
		include?: { stats?: boolean };
	}): Promise<GitCommit[]> {
		if (!this.hasFullDetails(options)) {
			await this.ensureFullDetails(options);
			if (this.fileset == null) return [];
		}

		// If we are "allowing" filtered files, prioritize them (allowing here really means "use" filtered files if they exist)
		const commits = (
			options?.allowFilteredFiles
				? (this.fileset?.filtered?.files ?? this.fileset?.files)
				: (this.fileset?.files ?? this.fileset?.filtered?.files)
		)?.map(f => this.with({ fileset: { ...this.fileset!, filtered: { files: [f], pathspec: f.path } } }));
		return commits ?? [];
	}

	@memoize()
	getGitUri(previous: boolean = false): GitUri {
		const uri = this.file?.uri ?? this.container.git.getAbsoluteUri(this.repoPath, this.repoPath);
		if (!previous) return new GitUri(uri, this);

		return new GitUri(this.file?.originalUri ?? uri, {
			repoPath: this.repoPath,
			sha: this.unresolvedPreviousSha,
		});
	}

	@memoize<GitCommit['getPreviousComparisonUrisForRange']>((r, rev) => `${r.startLine}-${r.endLine}|${rev ?? ''}`)
	getPreviousComparisonUrisForRange(
		range: DiffRange,
		rev?: string,
	): Promise<PreviousRangeComparisonUrisResult | undefined> {
		return this.file != null
			? this.container.git
					.getRepositoryService(this.repoPath)
					.diff.getPreviousComparisonUrisForRange(
						this.file.uri,
						rev ?? (this.sha === uncommitted ? undefined : this.sha),
						range,
					)
			: Promise.resolve(undefined);
	}

	private _previousShaPromise: Promise<string | undefined> | undefined;
	async getPreviousSha(): Promise<string | undefined> {
		if (this._previousShaPromise == null) {
			async function getCore(this: GitCommit) {
				const svc = this.container.git.getRepositoryService(this.repoPath);

				if (this.file != null) {
					if (this.file.previousSha != null && isSha(this.file.previousSha)) {
						return this.file.previousSha;
					}

					const sha = (
						await svc.revision.resolveRevision(
							isUncommitted(this.sha, true) ? 'HEAD' : `${this.sha}^`,
							this.file.originalPath ?? this.file.path,
						)
					).sha;

					this._resolvedPreviousSha = sha;
					return sha;
				}

				const parent = this.parents[0];
				if (parent != null && isSha(parent)) {
					this._resolvedPreviousSha = parent;
					return parent;
				}

				const sha = (
					await svc.revision.resolveRevision(isUncommitted(this.sha, true) ? 'HEAD' : `${this.sha}^`)
				).sha;

				this._resolvedPreviousSha = sha;
				return sha;
			}

			this._previousShaPromise = getCore.call(this);
		}

		return this._previousShaPromise;
	}

	getRepository(): Repository | undefined {
		return this.container.git.getRepository(this.repoPath);
	}

	@gate()
	isPushed(): Promise<boolean> {
		return this.container.git.getRepositoryService(this.repoPath).commits.hasCommitBeenPushed(this.ref);
	}

	with<T extends GitCommit>(changes: {
		sha?: string;
		parents?: string[] | null;
		fileset?: GitCommitFileset | null;
		lines?: GitCommitLine[] | null;
		stats?: GitCommitStats | null;
		parentTimestamps?: GitStashParentInfo[] | null;
	}): T {
		return new GitCommit(
			this.container,
			this.repoPath,
			changes.sha ?? this.sha,
			this.author,
			this.committer,
			this.summary,
			this.getChangedValue(changes.parents, this.parents) ?? [],
			this.message,
			this.getChangedValue(changes.fileset, this.fileset),
			this.getChangedValue(changes.stats, this.stats),
			this.getChangedValue(changes.lines, this.lines),
			this.tips,
			this.stashName,
			this.stashOnRef,
			this.getChangedValue(changes.parentTimestamps, this.parentTimestamps),
		) as T;
	}

	protected getChangedValue<T>(change: T | null | undefined, original: T | undefined): T | undefined {
		return change === undefined ? original : change === null ? undefined : change;
	}
}

export interface GitCommitIdentityShape {
	readonly name: string;
	readonly email: string | undefined;
	readonly date: Date;
}

export class GitCommitIdentity implements GitCommitIdentityShape {
	constructor(
		public readonly name: string,
		public readonly email: string | undefined,
		public readonly date: Date,
		private readonly avatarUrl?: string | undefined,
	) {}

	@memoize<GitCommitIdentity['formatDate']>(format => format ?? 'MMMM Do, YYYY h:mma')
	formatDate(format?: string | null): string {
		return formatDate(this.date, format ?? 'MMMM Do, YYYY h:mma');
	}

	fromNow(short?: boolean): string {
		return fromNow(this.date, short);
	}

	getAvatarUri(
		commit: GitCommit,
		options?: { defaultStyle?: GravatarDefaultStyle; size?: number },
	): Uri | Promise<Uri> {
		return this.avatarUrl != null ? Uri.parse(this.avatarUrl) : getAvatarUri(this.email, commit, options);
	}

	getCachedAvatarUri(options?: { size?: number }): Uri | undefined {
		return this.avatarUrl != null ? Uri.parse(this.avatarUrl) : getCachedAvatarUri(this.email, options);
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

export type GitCommitWithFullDetails = GitCommit & RequireSomeNonNullable<GitCommit, 'message' | 'fileset'>;
