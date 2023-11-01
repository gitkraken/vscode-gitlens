import { Uri } from 'vscode';
import type { EnrichedAutolink } from '../../annotations/autolinks';
import { getAvatarUri, getCachedAvatarUri } from '../../avatars';
import type { GravatarDefaultStyle } from '../../config';
import { GlyphChars } from '../../constants';
import type { Container } from '../../container';
import { formatDate, fromNow } from '../../system/date';
import { gate } from '../../system/decorators/gate';
import { memoize } from '../../system/decorators/memoize';
import { getLoggableName } from '../../system/logger';
import { pad, pluralize } from '../../system/string';
import type { PreviousLineComparisonUrisResult } from '../gitProvider';
import { GitUri } from '../gitUri';
import type { RemoteProvider } from '../remotes/remoteProvider';
import { uncommitted, uncommittedStaged } from './constants';
import type { GitFile } from './file';
import { GitFileChange, GitFileWorkingTreeStatus } from './file';
import type { PullRequest } from './pullRequest';
import type { GitReference, GitRevisionReference, GitStashReference } from './reference';
import { isSha, isUncommitted, isUncommittedParent, isUncommittedStaged } from './reference';
import type { GitRemote } from './remote';
import type { Repository } from './repository';

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
	get unresolvedPreviousSha(): string {
		const previousSha =
			this._resolvedPreviousSha ??
			(this.file != null ? this.file.previousSha : this.parents[0]) ??
			`${this.sha}^`;
		return isUncommittedParent(previousSha) ? 'HEAD' : previousSha;
	}

	private _etagFileSystem: number | undefined;

	hasFullDetails(): this is GitCommitWithFullDetails {
		return (
			this.message != null &&
			this.files != null &&
			((this.isUncommitted &&
				// If this is an uncommitted commit, check if we need to load the working files (if we don't have a matching etag -- only works if we are currently watching the file system for this repository)
				this._etagFileSystem === this.container.git.getRepository(this.repoPath)?.etagFileSystem) ||
				this.parents.length !== 0) &&
			(this.refType !== 'stash' || this._stashUntrackedFilesLoaded)
		);
	}

	@gate()
	async ensureFullDetails(): Promise<void> {
		if (this.hasFullDetails()) return;

		// If the commit is "uncommitted", then have the files list be all uncommitted files
		if (this.isUncommitted) {
			const repository = this.container.git.getRepository(this.repoPath);
			this._etagFileSystem = repository?.etagFileSystem;

			if (this._etagFileSystem != null) {
				const status = await this.container.git.getStatusForRepo(this.repoPath);
				if (status != null) {
					this._files = status.files.flatMap(f => f.getPseudoFileChanges());
				}
				this._etagFileSystem = repository?.etagFileSystem;
			}

			if (this._files == null) {
				this._files = this.file != null ? [this.file] : [];
			}

			return;
		}

		const [commitResult, untrackedResult] = await Promise.allSettled([
			this.refType !== 'stash' ? this.container.git.getCommit(this.repoPath, this.sha) : undefined,
			// Check for any untracked files -- since git doesn't return them via `git stash list` :(
			// See https://stackoverflow.com/questions/12681529/
			this.refType === 'stash' && !this._stashUntrackedFilesLoaded
				? this.container.git.getCommit(this.repoPath, `${this.stashName}^3`)
				: undefined,
			this.getPreviousSha(),
		]);

		let commit;

		if (commitResult.status === 'fulfilled' && commitResult.value != null) {
			commit = commitResult.value;
			this.parents.push(...(commit.parents ?? []));
			this._summary = commit.summary;
			this._message = commit.message;
			this._files = commit.files as GitFileChange[];

			if (this._file != null) {
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
		}

		if (untrackedResult.status === 'fulfilled' && untrackedResult.value != null) {
			this._stashUntrackedFilesLoaded = true;

			commit = untrackedResult.value;
			if (commit?.files != null && commit.files.length !== 0) {
				// Since these files are untracked -- make them look that way
				const files = commit.files.map(
					f => new GitFileChange(this.repoPath, f.path, GitFileWorkingTreeStatus.Untracked, f.originalPath),
				);

				if (this._files == null) {
					this._files = files;
				} else {
					this._files.push(...files);
				}
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

		this._stats = { ...this._stats, changedFiles: changedFiles, additions: additions, deletions: deletions };
	}

	async findFile(path: string, staged?: boolean): Promise<GitFileChange | undefined>;
	async findFile(uri: Uri, staged?: boolean): Promise<GitFileChange | undefined>;
	async findFile(pathOrUri: string | Uri, staged?: boolean): Promise<GitFileChange | undefined> {
		if (!this.hasFullDetails()) {
			await this.ensureFullDetails();
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

	formatStats(options?: {
		compact?: boolean;
		empty?: string;
		expand?: boolean;
		prefix?: string;
		sectionSeparator?: string;
		separator?: string;
		suffix?: string;
	}): string {
		const stats = this.stats;
		if (stats == null) return options?.empty ?? '';

		const { changedFiles, additions, deletions } = stats;
		if (getChangedFilesCount(changedFiles) <= 0 && additions <= 0 && deletions <= 0) return options?.empty ?? '';

		const {
			compact = false,
			expand = false,
			prefix = '',
			sectionSeparator = ` ${pad(GlyphChars.Dot, 1, 1, GlyphChars.Space)} `,
			separator = ' ',
			suffix = '',
		} = options ?? {};

		let status = prefix;

		if (typeof changedFiles === 'number') {
			if (changedFiles) {
				status += expand ? `${pluralize('file', changedFiles)} changed` : `~${changedFiles}`;
			}
		} else {
			const { added, changed, deleted } = changedFiles;
			if (added) {
				status += expand ? `${pluralize('file', added)} added` : `+${added}`;
			} else if (!expand && !compact) {
				status += '+0';
			}

			if (changed) {
				status += `${added ? separator : ''}${
					expand ? `${pluralize('file', changed)} changed` : `~${changed}`
				}`;
			} else if (!expand && !compact) {
				status += '~0';
			}

			if (deleted) {
				status += `${changed | additions ? separator : ''}${
					expand ? `${pluralize('file', deleted)} deleted` : `-${deleted}`
				}`;
			} else if (!expand && !compact) {
				status += '-0';
			}
		}

		if (expand) {
			if (additions) {
				status += `${changedFiles ? sectionSeparator : ''}${pluralize('addition', additions)}`;
			}

			if (deletions) {
				status += `${changedFiles || additions ? separator : ''}${pluralize('deletion', deletions)}`;
			}
		}

		status += suffix;

		return status;
	}

	async getAssociatedPullRequest(remote?: GitRemote<RemoteProvider>): Promise<PullRequest | undefined> {
		remote ??= await this.container.git.getBestRemoteWithRichProvider(this.repoPath);
		return remote?.hasRichIntegration() ? remote.provider.getPullRequestForCommit(this.ref) : undefined;
	}

	async getEnrichedAutolinks(remote?: GitRemote<RemoteProvider>): Promise<Map<string, EnrichedAutolink> | undefined> {
		if (this.isUncommitted) return undefined;

		remote ??= await this.container.git.getBestRemoteWithRichProvider(this.repoPath);
		if (!remote?.hasRichIntegration()) return undefined;

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

	async getCommitsForFiles(): Promise<GitCommit[]> {
		if (!this.hasFullDetails()) {
			await this.ensureFullDetails();
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
				if (parent != null && isSha(parent)) return parent;

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

	with(changes: {
		sha?: string;
		parents?: string[];
		files?: { file?: GitFileChange | null; files?: GitFileChange[] | null } | null;
		lines?: GitCommitLine[];
	}): GitCommit {
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
			this.stats,
			this.getChangedValue(changes.lines, this.lines),
			this.tips,
			this.stashName,
			this.stashOnRef,
		);
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

export interface GitCommitStats {
	readonly additions: number;
	readonly deletions: number;
	readonly changedFiles: number | { added: number; deleted: number; changed: number };
}

export function getChangedFilesCount(changedFiles: GitCommitStats['changedFiles'] | undefined): number {
	if (changedFiles == null) return 0;

	return typeof changedFiles === 'number'
		? changedFiles
		: changedFiles.added + changedFiles.changed + changedFiles.deleted;
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
