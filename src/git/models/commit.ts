import { Uri } from 'vscode';
import { getAvatarUri } from '../../avatars';
import { DateSource, DateStyle, GravatarDefaultStyle } from '../../configuration';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { formatDate, fromNow } from '../../system/date';
import { gate } from '../../system/decorators/gate';
import { memoize } from '../../system/decorators/memoize';
import { cancellable } from '../../system/promise';
import { pad, pluralize } from '../../system/string';
import { PreviousLineComparisionUrisResult } from '../gitProvider';
import { GitUri } from '../gitUri';
import { GitFile, GitFileChange, GitFileWorkingTreeStatus } from './file';
import { PullRequest } from './pullRequest';
import { GitReference, GitRevision, GitRevisionReference, GitStashReference } from './reference';
import { Repository } from './repository';

const stashNumberRegex = /stash@{(\d+)}/;

export class GitCommit implements GitRevisionReference {
	static is(commit: any): commit is GitCommit {
		return commit instanceof GitCommit;
	}

	static isStash(commit: any): commit is GitStashCommit {
		return commit instanceof GitCommit && commit.refType === 'stash' && Boolean(commit.stashName);
	}

	static isOfRefType(commit: GitReference | undefined): boolean {
		return commit?.refType === 'revision' || commit?.refType === 'stash';
	}

	static hasFullDetails(commit: GitCommit): commit is GitCommit & SomeNonNullable<GitCommit, 'message' | 'files'> {
		return (
			commit.message != null &&
			commit.files != null &&
			commit.parents.length !== 0 &&
			(!commit.stashName || commit._stashUntrackedFilesLoaded)
		);
	}

	private _stashUntrackedFilesLoaded = false;
	private _recomputeStats = false;

	readonly lines: GitCommitLine[];
	readonly ref: string;
	readonly refType: GitRevisionReference['refType'];
	readonly shortSha: string;
	readonly stashName: string | undefined;
	// TODO@eamodio rename to stashNumber
	readonly number: string | undefined;

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
		stashName?: string | undefined,
	) {
		this.ref = this.sha;
		this.refType = stashName ? 'stash' : 'revision';
		this.shortSha = this.sha.substring(0, this.container.CommitShaFormatting.length);

		// Add an ellipsis to the summary if there is or might be more message
		if (message != null) {
			this._message = message;
			if (this.summary !== message) {
				this._summary = `${summary} ${GlyphChars.Ellipsis}`;
			} else {
				this._summary = summary;
			}
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
				if (GitRevision.isUncommitted(sha, true)) {
					this._files = [files];
				}
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

		if (stashName) {
			this.stashName = stashName || undefined;
			this.number = stashNumberRegex.exec(stashName)?.[1];
		}
	}

	get date(): Date {
		return this.container.CommitDateFormatting.dateSource === DateSource.Committed
			? this.committer.date
			: this.author.date;
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
		return this.container.CommitDateFormatting.dateStyle === DateStyle.Absolute
			? this.formatDate(this.container.CommitDateFormatting.dateFormat)
			: this.formatDateFromNow();
	}

	@memoize()
	get isUncommitted(): boolean {
		return GitRevision.isUncommitted(this.sha);
	}

	@memoize()
	get isUncommittedStaged(): boolean {
		return GitRevision.isUncommittedStaged(this.sha);
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
		if (this._resolvedPreviousSha != null) return this._resolvedPreviousSha;
		if (this.file != null) return this.file.previousSha ?? `${this.sha}^`;
		return this.parents[0] ?? `${this.sha}^`;
	}

	@gate()
	async ensureFullDetails(): Promise<void> {
		if (this.isUncommitted || GitCommit.hasFullDetails(this)) return;

		const [commitResult, untrackedResult] = await Promise.allSettled([
			this.container.git.getCommit(this.repoPath, this.sha),
			// Check for any untracked files -- since git doesn't return them via `git stash list` :(
			// See https://stackoverflow.com/questions/12681529/
			this.stashName ? this.container.git.getCommit(this.repoPath, `${this.stashName}^3`) : undefined,
			this.getPreviousSha(),
		]);
		if (commitResult.status !== 'fulfilled' || commitResult.value == null) return;

		let commit = commitResult.value;
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

	async findFile(path: string): Promise<GitFileChange | undefined>;
	async findFile(uri: Uri): Promise<GitFileChange | undefined>;
	async findFile(pathOrUri: string | Uri): Promise<GitFileChange | undefined> {
		if (this._files == null) {
			await this.ensureFullDetails();
			if (this._files == null) return undefined;
		}

		const relativePath = this.container.git.getRelativePath(pathOrUri, this.repoPath);
		return this._files.find(f => f.path === relativePath);
	}

	formatDate(format?: string | null) {
		return this.container.CommitDateFormatting.dateSource === DateSource.Committed
			? this.committer.formatDate(format)
			: this.author.formatDate(format);
	}

	formatDateFromNow(short?: boolean) {
		return this.container.CommitDateFormatting.dateSource === DateSource.Committed
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
		if (changedFiles <= 0 && additions <= 0 && deletions <= 0) return options?.empty ?? '';

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
				// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
				status += `${changedFiles ? sectionSeparator : ''}${pluralize('addition', additions)}`;
			}

			if (deletions) {
				// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
				status += `${changedFiles || additions ? separator : ''}${pluralize('deletion', deletions)}`;
			}
		}

		status += suffix;

		return status;
	}

	private _pullRequest: Promise<PullRequest | undefined> | undefined;
	async getAssociatedPullRequest(options?: { timeout?: number }): Promise<PullRequest | undefined> {
		if (this._pullRequest == null) {
			async function getCore(this: GitCommit): Promise<PullRequest | undefined> {
				const remote = await this.container.git.getRichRemoteProvider(this.repoPath);
				if (remote?.provider == null) return undefined;

				return this.container.git.getPullRequestForCommit(this.ref, remote, options);
			}
			this._pullRequest = getCore.call(this);
		}

		return cancellable(this._pullRequest, options?.timeout);
	}

	getAvatarUri(options?: { defaultStyle?: GravatarDefaultStyle; size?: number }): Uri | Promise<Uri> {
		return this.author.getAvatarUri(this, options);
	}

	async getCommitForFile(file: string | GitFile): Promise<GitCommit | undefined> {
		const path = typeof file === 'string' ? this.container.git.getRelativePath(file, this.repoPath) : file.path;
		const foundFile = await this.findFile(path);
		if (foundFile == null) return undefined;

		const commit = this.with({ files: { file: foundFile } });
		return commit;
	}

	async getCommitsForFiles(): Promise<GitCommit[]> {
		if (this._files == null) {
			await this.ensureFullDetails();
			if (this._files == null) return [];
		}

		const commits = this._files.map(f => this.with({ files: { file: f } }));
		return commits;
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
	): Promise<PreviousLineComparisionUrisResult | undefined> {
		return this.file != null
			? this.container.git.getPreviousComparisonUrisForLine(
					this.repoPath,
					this.file.uri,
					editorLine,
					ref ?? (this.sha === GitRevision.uncommitted ? undefined : this.sha),
			  )
			: Promise.resolve(undefined);
	}

	private _previousShaPromise: Promise<string | undefined> | undefined;
	async getPreviousSha(): Promise<string | undefined> {
		if (this._previousShaPromise == null) {
			async function getCore(this: GitCommit) {
				if (this.file != null) {
					if (this.file.previousSha != null && GitRevision.isSha(this.file.previousSha)) {
						return this.file.previousSha;
					}

					const sha = await this.container.git.resolveReference(
						this.repoPath,
						GitRevision.isUncommitted(this.sha, true) ? 'HEAD' : `${this.sha}^`,
						this.file.originalPath ?? this.file.path,
					);
					return sha;
				}

				const parent = this.parents[0];
				if (parent != null && GitRevision.isSha(parent)) return parent;

				const sha = await this.container.git.resolveReference(
					this.repoPath,
					GitRevision.isUncommitted(this.sha, true) ? 'HEAD' : `${this.sha}^`,
				);
				return sha;
			}

			this._previousShaPromise = getCore.call(this).then(sha => (this._resolvedPreviousSha = sha));
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
			this.stashName,
		);
	}

	protected getChangedValue<T>(change: T | null | undefined, original: T | undefined): T | undefined {
		if (change === undefined) return original;
		return change !== null ? change : undefined;
	}
}

export class GitCommitIdentity {
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
		if (this.avatarUrl != null) return Uri.parse(this.avatarUrl);

		return getAvatarUri(this.email, commit, options);
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

export interface GitStashCommit extends GitCommit {
	readonly refType: GitStashReference['refType'];
	readonly stashName: string;
	readonly number: string;
}
