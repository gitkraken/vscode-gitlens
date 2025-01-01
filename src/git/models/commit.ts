import { Uri } from 'vscode';
import type { EnrichedAutolink } from '../../autolinks';
import { getAvatarUri, getCachedAvatarUri } from '../../avatars';
import type { GravatarDefaultStyle } from '../../config';
import { GlyphChars } from '../../constants';
import type { Container } from '../../container';
import { formatDate, fromNow } from '../../system/date';
import { gate } from '../../system/decorators/gate';
import { memoize } from '../../system/decorators/memoize';
import { getLoggableName } from '../../system/logger';
import { getSettledValue } from '../../system/promise';
import { pluralize } from '../../system/string';
import type { PreviousLineComparisonUrisResult } from '../gitProvider';
import { GitUri } from '../gitUri';
import type { RemoteProvider } from '../remotes/remoteProvider';
import { getChangedFilesCount } from './commit.utils';
import type { GitFile } from './file';
import { GitFileChange, mapFilesWithStats } from './file';
import type { PullRequest } from './pullRequest';
import type { GitReference, GitRevisionReference, GitStashReference } from './reference';
import type { GitRemote } from './remote';
import type { Repository } from './repository';
import { uncommitted, uncommittedStaged } from './revision';
import { isSha, isUncommitted, isUncommittedParent, isUncommittedStaged } from './revision.utils';

const stashNumberRegex = /stash@{(\d+)}/;

export class GitCommit implements GitRevisionReference {
	private _stashUntrackedFilesLoaded = false;
	private _recomputeStats = false;

	readonly lines: GitCommitLine[];
	readonly ref: string;
	readonly refType: GitRevisionReference['refType'];
	readonly shortSha: string;
	readonly stashName: string | undefined;
	// TODO@eamodio rename to stashNumber
	readonly number: string | undefined;
	readonly stashOnRef: string | undefined;
	readonly tips: string[] | undefined;

	constructor(
		private readonly container: Container,
		public readonly repoPath: string,
		public readonly sha: string,
		public readonly author: GitCommitIdentity,
		public readonly committer: GitCommitIdentity,
		summary: string,
		public readonly parents: string[],
		message?: string | undefined,
		files?: GitFileChange | GitFileChange[] | { file?: GitFileChange; files?: GitFileChange[] } | undefined,
		stats?: GitCommitStats,
		lines?: GitCommitLine | GitCommitLine[] | undefined,
		tips?: string[],
		stashName?: string | undefined,
		stashOnRef?: string | undefined,
	) {
		this.ref = sha;
		this.shortSha = sha.substring(0, this.container.CommitShaFormatting.length);
		this.tips = tips;

		if (stashName) {
			this.refType = 'stash';
			this.stashName = stashName || undefined;
			this.stashOnRef = stashOnRef || undefined;
			this.number = stashNumberRegex.exec(stashName)?.[1];
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

		if (files != null) {
			if (Array.isArray(files)) {
				this._files = files;
			} else if (files instanceof GitFileChange) {
				this._file = files;
			} else {
				if (files.file != null) {
					this._file = files.file;
				}

				if (files.files != null) {
					this._files = files.files;
				}
			}

			this._recomputeStats = true;
		}

		if (lines != null) {
			if (Array.isArray(lines)) {
				this.lines = lines;
			} else {
				this.lines = [lines];
			}
		} else {
			this.lines = [];
		}
	}

	toString(): string {
		return `${getLoggableName(this)}(${this.repoPath}|${this.shortSha})`;
	}

	get date(): Date {
		return this.container.CommitDateFormatting.dateSource === 'committed' ? this.committer.date : this.author.date;
	}

	private _file: GitFileChange | undefined;
	get file(): GitFileChange | undefined {
		return this._file;
	}

	private _files: GitFileChange[] | undefined;
	get files(): readonly GitFileChange[] | undefined {
		return this._files;
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
		return isUncommittedParent(previousSha) ? 'HEAD' : previousSha;
	}

	private _etagFileSystem: number | undefined;

	hasFullDetails(options?: { include?: { stats?: boolean } }): this is GitCommitWithFullDetails {
		return (
			this.message != null &&
			this.files != null &&
			(!options?.include?.stats || this.files.some(f => f.stats != null)) &&
			((this.isUncommitted &&
				// If this is an uncommitted commit, check if we need to load the working files (if we don't have a matching etag -- only works if we are currently watching the file system for this repository)
				this._etagFileSystem === this.container.git.getRepository(this.repoPath)?.etagFileSystem) ||
				this.parents.length !== 0) &&
			(this.refType !== 'stash' || this._stashUntrackedFilesLoaded)
		);
	}

	@gate()
	async ensureFullDetails(options?: { include?: { stats?: boolean } }): Promise<void> {
		if (this.hasFullDetails(options)) return;

		// If the commit is "uncommitted", then have the files list be all uncommitted files
		if (this.isUncommitted) {
			const repository = this.container.git.getRepository(this.repoPath);
			this._etagFileSystem = repository?.etagFileSystem;

			if (this._etagFileSystem != null) {
				const status = await this.container.git.getStatus(this.repoPath);
				if (status != null) {
					this._files = status.files.flatMap(f => f.getPseudoFileChanges());
				}
				this._etagFileSystem = repository?.etagFileSystem;
			}

			if (this._files == null) {
				this._files = this.file != null ? [this.file] : [];
			}

			this._recomputeStats = true;

			return;
		}

		if (this.refType === 'stash') {
			const [stashFilesResult] = await Promise.allSettled([
				this.container.git.getStashCommitFiles(this.repoPath, this.sha, options),
				this.getPreviousSha(),
			]);

			const stashFiles = getSettledValue(stashFilesResult);
			if (stashFiles?.length) {
				this._files = stashFiles;
			}
			this._stashUntrackedFilesLoaded = true;
		} else {
			const [commitResult, commitFilesStatsResult] = await Promise.allSettled([
				this.container.git.getCommit(this.repoPath, this.sha),
				options?.include?.stats ? this.container.git.getCommitFileStats(this.repoPath, this.sha) : undefined,
				this.getPreviousSha(),
			]);

			const commit = getSettledValue(commitResult);
			if (commit != null) {
				this.parents.push(...(commit.parents ?? []));
				this._summary = commit.summary;
				this._message = commit.message;
				this._files = (commit.files ?? []) as Mutable<typeof commit.files>;
			}

			const commitFilesStats = getSettledValue(commitFilesStatsResult);
			if (commitFilesStats?.length && this._files?.length) {
				this._files = mapFilesWithStats(this._files, commitFilesStats);
			}
		}

		if (this._files != null && this._file != null) {
			const file = this._files.find(f => f.path === this._file!.path);
			if (file != null) {
				this._file = new GitFileChange(
					file.repoPath,
					file.path,
					file.status,
					file.originalPath ?? this._file.originalPath,
					file.previousSha ?? this._file.previousSha,
					file.stats ?? this._file.stats,
				);
			}
		}

		this._recomputeStats = true;
	}

	private computeFileStats(): void {
		if (!this._recomputeStats || this._files == null) return;
		this._recomputeStats = false;

		const changedFiles = {
			added: 0,
			deleted: 0,
			changed: 0,
		};

		let additions = 0;
		let deletions = 0;
		for (const file of this._files) {
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
		path: string,
		staged?: boolean,
		options?: { include?: { stats?: boolean } },
	): Promise<GitFileChange | undefined>;
	async findFile(
		uri: Uri,
		staged?: boolean,
		options?: { include?: { stats?: boolean } },
	): Promise<GitFileChange | undefined>;
	async findFile(
		pathOrUri: string | Uri,
		staged?: boolean,
		options?: { include?: { stats?: boolean } },
	): Promise<GitFileChange | undefined> {
		if (!this.hasFullDetails(options)) {
			await this.ensureFullDetails(options);
			if (this._files == null) return undefined;
		}

		const relativePath = this.container.git.getRelativePath(pathOrUri, this.repoPath);
		if (this.isUncommitted && staged != null) {
			return this._files?.find(f => f.path === relativePath && f.staged === staged);
		}
		return this._files?.find(f => f.path === relativePath);
	}

	formatDate(format?: string | null) {
		return this.container.CommitDateFormatting.dateSource === 'committed'
			? this.committer.formatDate(format)
			: this.author.formatDate(format);
	}

	formatDateFromNow(short?: boolean) {
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
			result = /*html*/ `<span style="background-color:var(--vscode-textCodeBlock-background);border-radius:3px;">&nbsp;${result}&nbsp;&nbsp;</span>`;
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
		remote ??= await this.container.git.getBestRemoteWithIntegration(this.repoPath);
		if (!remote?.hasIntegration()) return undefined;

		return (await this.container.integrations.getByRemote(remote))?.getPullRequestForCommit(
			remote.provider.repoDesc,
			this.ref,
			options,
		);
	}

	async getEnrichedAutolinks(remote?: GitRemote<RemoteProvider>): Promise<Map<string, EnrichedAutolink> | undefined> {
		if (this.isUncommitted) return undefined;

		remote ??= await this.container.git.getBestRemoteWithIntegration(this.repoPath);
		if (remote?.provider == null) return undefined;

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

		const commit = this.with({ sha: foundFile.staged ? uncommittedStaged : this.sha, files: { file: foundFile } });
		return commit;
	}

	async getCommitsForFiles(options?: { include?: { stats?: boolean } }): Promise<GitCommit[]> {
		if (!this.hasFullDetails(options)) {
			await this.ensureFullDetails(options);
			if (this._files == null) return [];
		}

		const commits = this._files?.map(f => this.with({ files: { file: f } }));
		return commits ?? [];
	}

	@memoize()
	getGitUri(previous: boolean = false): GitUri {
		const uri = this._file?.uri ?? this.container.git.getAbsoluteUri(this.repoPath, this.repoPath);
		if (!previous) return new GitUri(uri, this);

		return new GitUri(this._file?.originalUri ?? uri, {
			repoPath: this.repoPath,
			sha: this.unresolvedPreviousSha,
		});
	}

	@memoize<GitCommit['getPreviousComparisonUrisForLine']>((el, ref) => `${el}|${ref ?? ''}`)
	getPreviousComparisonUrisForLine(
		editorLine: number,
		ref?: string,
	): Promise<PreviousLineComparisonUrisResult | undefined> {
		return this.file != null
			? this.container.git.getPreviousComparisonUrisForLine(
					this.repoPath,
					this.file.uri,
					editorLine,
					ref ?? (this.sha === uncommitted ? undefined : this.sha),
			  )
			: Promise.resolve(undefined);
	}

	private _previousShaPromise: Promise<string | undefined> | undefined;
	async getPreviousSha(): Promise<string | undefined> {
		if (this._previousShaPromise == null) {
			async function getCore(this: GitCommit) {
				if (this.file != null) {
					if (this.file.previousSha != null && isSha(this.file.previousSha)) {
						return this.file.previousSha;
					}

					const sha = await this.container.git.resolveReference(
						this.repoPath,
						isUncommitted(this.sha, true) ? 'HEAD' : `${this.sha}^`,
						this.file.originalPath ?? this.file.path,
					);

					this._resolvedPreviousSha = sha;
					return sha;
				}

				const parent = this.parents[0];
				if (parent != null && isSha(parent)) {
					this._resolvedPreviousSha = parent;
					return parent;
				}

				const sha = await this.container.git.resolveReference(
					this.repoPath,
					isUncommitted(this.sha, true) ? 'HEAD' : `${this.sha}^`,
				);

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
	async isPushed(): Promise<boolean> {
		return this.container.git.hasCommitBeenPushed(this.repoPath, this.ref);
	}

	with<T extends GitCommit>(changes: {
		sha?: string;
		parents?: string[];
		files?: { file?: GitFileChange | null; files?: GitFileChange[] | null } | null;
		lines?: GitCommitLine[];
		stats?: GitCommitStats;
	}): T {
		let files;
		if (changes.files != null) {
			files = { file: this._file, files: this._files };

			if (changes.files.file != null) {
				files.file = changes.files.file;
			} else if (changes.files.file === null) {
				files.file = undefined;
			}

			if (changes.files.files != null) {
				files.files = changes.files.files;
			} else if (changes.files.files === null) {
				files.files = undefined;
			}
		} else if (changes.files === null) {
			files = undefined;
		}

		return new GitCommit(
			this.container,
			this.repoPath,
			changes.sha ?? this.sha,
			this.author,
			this.committer,
			this.summary,
			this.getChangedValue(changes.parents, this.parents) ?? [],
			this.message,
			files,
			this.getChangedValue(changes.stats, this.stats),
			this.getChangedValue(changes.lines, this.lines),
			this.tips,
			this.stashName,
			this.stashOnRef,
		) as T;
	}

	protected getChangedValue<T>(change: T | null | undefined, original: T | undefined): T | undefined {
		if (change === undefined) return original;
		return change !== null ? change : undefined;
	}
}

export function isCommit(commit: any): commit is GitCommit {
	return commit instanceof GitCommit;
}

export function isStash(commit: any): commit is GitStashCommit {
	return commit instanceof GitCommit && commit.refType === 'stash' && Boolean(commit.stashName);
}

export function isOfCommitOrStashRefType(commit: GitReference | undefined): boolean {
	return commit?.refType === 'revision' || commit?.refType === 'stash';
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

export interface GitCommitStats<
	Files extends number | { added: number; deleted: number; changed: number } =
		| number
		| { added: number; deleted: number; changed: number },
> {
	readonly files: Files;
	readonly additions: number;
	readonly deletions: number;
}

export interface GitStashCommit extends GitCommit {
	readonly refType: GitStashReference['refType'];
	readonly stashName: string;
	readonly number: string;
}

type GitCommitWithFullDetails = GitCommit & SomeNonNullable<GitCommit, 'message' | 'files'>;

export function assertsCommitHasFullDetails(commit: GitCommit): asserts commit is GitCommitWithFullDetails {
	if (!commit.hasFullDetails()) {
		throw new Error(`GitCommit(${commit.sha}) is not fully loaded`);
	}
}
