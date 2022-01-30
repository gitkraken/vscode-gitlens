import { Uri } from 'vscode';
import { getAvatarUri } from '../../avatars';
import { configuration, DateSource, DateStyle, GravatarDefaultStyle } from '../../configuration';
import { Container } from '../../container';
import { formatDate, fromNow } from '../../system/date';
import { memoize } from '../../system/decorators/memoize';
import { CommitFormatter } from '../formatters';
import { GitUri } from '../gitUri';
import {
	GitFileIndexStatus,
	GitFileStatus,
	GitReference,
	GitRevision,
	GitRevisionReference,
	PullRequest,
} from '../models';

export interface GitAuthor {
	name: string;
	lineCount: number;
}

export interface GitCommitLine {
	sha: string;
	previousSha?: string;
	line: number;
	originalLine: number;
	code?: string;
}

export const enum GitCommitType {
	Blame = 'blame',
	Log = 'log',
	LogFile = 'logFile',
	Stash = 'stash',
	StashFile = 'stashFile',
}

export const CommitDateFormatting = {
	dateFormat: undefined! as string | null,
	dateSource: undefined! as DateSource,
	dateStyle: undefined! as DateStyle,

	reset: () => {
		CommitDateFormatting.dateFormat = configuration.get('defaultDateFormat');
		CommitDateFormatting.dateSource = configuration.get('defaultDateSource');
		CommitDateFormatting.dateStyle = configuration.get('defaultDateStyle');
	},
};

export const CommitShaFormatting = {
	length: undefined! as number,

	reset: () => {
		// Don't allow shas to be shortened to less than 5 characters
		CommitShaFormatting.length = Math.max(5, Container.instance.config.advanced.abbreviatedShaLength);
	},
};

export class GitCommitIdentity {
	constructor(
		public readonly name: string,
		public readonly email: string | undefined,
		public readonly date: Date,
		private readonly avatarUrl?: string | undefined,
	) {}

	@memoize<GitCommitIdentity['formatDate']>(format => (format == null ? 'MMMM Do, YYYY h:mma' : format))
	formatDate(format?: string | null) {
		if (format == null) {
			format = 'MMMM Do, YYYY h:mma';
		}

		return formatDate(this.date, format);
	}

	fromNow(short?: boolean) {
		return fromNow(this.date, short);
	}

	getAvatarUri(
		commit: GitCommit2,
		options?: { defaultStyle?: GravatarDefaultStyle; size?: number },
	): Uri | Promise<Uri> {
		if (this.avatarUrl != null) Uri.parse(this.avatarUrl);

		return getAvatarUri(this.email, commit, options);
	}
}

export class GitFileChange {
	constructor(
		public readonly repoPath: string,
		public readonly path: string,
		public readonly status: GitFileStatus,
		public readonly originalPath?: string | undefined,
		public readonly previousSha?: string | undefined,
	) {}

	@memoize()
	get uri(): Uri {
		return Container.instance.git.getAbsoluteUri(this.path, this.repoPath);
	}

	@memoize()
	get originalUri(): Uri | undefined {
		return this.originalPath ? Container.instance.git.getAbsoluteUri(this.originalPath, this.repoPath) : undefined;
	}

	@memoize()
	get previousUri(): Uri {
		return Container.instance.git.getAbsoluteUri(this.originalPath || this.path, this.repoPath);
	}

	@memoize()
	getWorkingUri(): Promise<Uri | undefined> {
		return Container.instance.git.getWorkingUri(this.repoPath, this.uri);
	}
}

const stashNumberRegex = /stash@{(\d+)}/;

export class GitCommit2 implements GitRevisionReference {
	static is(commit: any): commit is GitCommit2 {
		return commit instanceof GitCommit2;
	}

	static hasFullDetails(commit: GitCommit2): commit is GitCommit2 & SomeNonNullable<GitCommit2, 'message' | 'files'> {
		return commit.message != null && commit.files != null && commit.parents.length !== 0;
	}

	static isOfRefType(commit: GitReference | undefined) {
		return commit?.refType === 'revision' || commit?.refType === 'stash';
	}

	readonly lines: GitCommitLine[];
	readonly ref: string;
	readonly refType: GitRevisionReference['refType'];
	readonly shortSha: string;
	readonly stashName: string | undefined;
	readonly stashNumber: number | undefined;

	constructor(
		public readonly repoPath: string,
		public readonly sha: string,
		public readonly author: GitCommitIdentity,
		public readonly committer: GitCommitIdentity,
		public readonly summary: string,
		public readonly parents: string[],
		message?: string | undefined,
		files?: GitFileChange | GitFileChange[] | undefined,
		lines?: GitCommitLine | GitCommitLine[] | undefined,
		stashName?: string | undefined,
	) {
		this.ref = this.sha;
		this.refType = 'revision';
		this.shortSha = this.sha.substring(0, CommitShaFormatting.length);

		if (message != null) {
			this._message = message;
		}

		if (files != null) {
			if (Array.isArray(files)) {
				this._files = files;
			} else {
				this._file = files;
			}
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
			this.stashNumber = Number(stashNumberRegex.exec(stashName)?.[1]);
		}
	}

	get date(): Date {
		return CommitDateFormatting.dateSource === DateSource.Committed ? this.committer.date : this.author.date;
	}

	private _file: GitFileChange | undefined;
	get file(): GitFileChange | undefined {
		return this._file;
	}

	private _files: GitFileChange[] | undefined;
	get files(): GitFileChange[] | undefined {
		return this._files;
	}

	get formattedDate(): string {
		return CommitDateFormatting.dateStyle === DateStyle.Absolute
			? this.formatDate(CommitDateFormatting.dateFormat)
			: this.formatDateFromNow();
	}

	get hasConflicts(): boolean | undefined {
		return undefined;
		// return this._files?.some(f => f.conflictStatus != null);
	}

	private _message: string | undefined;
	get message(): string | undefined {
		return this._message;
	}

	get name() {
		return this.stashName ? this.stashName : this.shortSha;
	}

	@memoize()
	get isUncommitted(): boolean {
		return GitRevision.isUncommitted(this.sha);
	}

	@memoize()
	get isUncommittedStaged(): boolean {
		return GitRevision.isUncommittedStaged(this.sha);
	}

	/** @deprecated use `file.uri` */
	get uri(): Uri /*| undefined*/ {
		return this.file?.uri ?? Container.instance.git.getAbsoluteUri(this.repoPath, this.repoPath);
	}

	/** @deprecated use `file.originalUri` */
	get originalUri(): Uri | undefined {
		return this.file?.originalUri;
	}

	/** @deprecated use `file.getWorkingUri` */
	getWorkingUri(): Promise<Uri | undefined> {
		return Promise.resolve(this.file?.getWorkingUri());
	}

	/** @deprecated use `file.previousUri` */
	get previousUri(): Uri /*| undefined*/ {
		return this.file?.previousUri ?? Container.instance.git.getAbsoluteUri(this.repoPath, this.repoPath);
	}

	/** @deprecated use `file.previousSha` */
	get previousSha(): string | undefined {
		return this.file?.previousSha;
	}

	async ensureFullDetails(): Promise<void> {
		if (this.isUncommitted || GitCommit2.hasFullDetails(this)) return;

		const commit = await Container.instance.git.getCommit(this.repoPath, this.sha);
		if (commit == null) return;

		this.parents.push(...(commit.parentShas ?? []));
		this._message = commit.message;
		this._files = commit.files.map(f => new GitFileChange(this.repoPath, f.fileName, f.status, f.originalFileName));
	}

	formatDate(format?: string | null) {
		return CommitDateFormatting.dateSource === DateSource.Committed
			? this.committer.formatDate(format)
			: this.author.formatDate(format);
	}

	formatDateFromNow(short?: boolean) {
		return CommitDateFormatting.dateSource === DateSource.Committed
			? this.committer.fromNow(short)
			: this.author.fromNow(short);
	}

	// TODO@eamodio deal with memoization, since we don't want the timeout to apply
	@memoize()
	async getAssociatedPullRequest(options?: { timeout?: number }): Promise<PullRequest | undefined> {
		const remote = await Container.instance.git.getRichRemoteProvider(this.repoPath);
		if (remote?.provider == null) return undefined;

		return Container.instance.git.getPullRequestForCommit(this.ref, remote, options);
	}

	getAvatarUri(options?: { defaultStyle?: GravatarDefaultStyle; size?: number }): Uri | Promise<Uri> {
		return this.author.getAvatarUri(this, options);
	}

	@memoize<GitCommit['getPreviousLineDiffUris']>((u, e, r) => `${u.toString()}|${e}|${r ?? ''}`)
	getPreviousLineDiffUris(uri: Uri, editorLine: number, ref: string | undefined) {
		return this.file?.path
			? Container.instance.git.getPreviousLineDiffUris(this.repoPath, uri, editorLine, ref)
			: Promise.resolve(undefined);
	}

	@memoize()
	toGitUri(previous: boolean = false): GitUri {
		return GitUri.fromCommit(this, previous);
	}

	with(changes: {
		sha?: string;
		parents?: string[];
		files?: GitFileChange | GitFileChange[] | null;
		lines?: GitCommitLine[];
	}): GitCommit2 {
		return new GitCommit2(
			this.repoPath,
			changes.sha ?? this.sha,
			this.author,
			this.committer,
			this.summary,
			this.getChangedValue(changes.parents, this.parents) ?? [],
			this.message,
			this.getChangedValue(changes.files, this.files),
			this.getChangedValue(changes.lines, this.lines),
			this.stashName,
		);
	}

	protected getChangedValue<T>(change: T | null | undefined, original: T | undefined): T | undefined {
		if (change === undefined) return original;
		return change !== null ? change : undefined;
	}
}

export abstract class GitCommit implements GitRevisionReference {
	get file() {
		return this.fileName
			? new GitFileChange(this.repoPath, this.fileName, GitFileIndexStatus.Modified, this.originalFileName)
			: undefined;
	}

	get parents(): string[] {
		return this.previousSha ? [this.previousSha] : [];
	}

	get summary(): string {
		return this.message.split('\n', 1)[0];
	}

	get author(): GitCommitIdentity {
		return new GitCommitIdentity(this.authorName, this.authorEmail, this.authorDate);
	}

	get committer(): GitCommitIdentity {
		return new GitCommitIdentity('', '', this.committerDate);
	}

	static is(commit: any): commit is GitCommit {
		return commit instanceof GitCommit;
	}

	static isOfRefType(commit: GitReference | undefined) {
		return commit?.refType === 'revision' || commit?.refType === 'stash';
	}

	readonly refType: GitRevisionReference['refType'] = 'revision';

	constructor(
		public readonly type: GitCommitType,
		public readonly repoPath: string,
		public readonly sha: string,
		public readonly authorName: string,
		public readonly authorEmail: string | undefined,
		public readonly authorDate: Date,
		public readonly committerDate: Date,
		public readonly message: string,
		fileName: string,
		public readonly originalFileName: string | undefined,
		public previousSha: string | undefined,
		public previousFileName: string | undefined,
	) {
		this._fileName = fileName || '';
	}

	get hasConflicts(): boolean {
		return false;
	}

	get ref() {
		return this.sha;
	}

	get name() {
		return this.shortSha;
	}

	private readonly _fileName: string;
	get fileName() {
		// If we aren't a single-file commit, return an empty file name (makes it default to the repoPath)
		return this.isFile ? this._fileName : '';
	}

	get date(): Date {
		return CommitDateFormatting.dateSource === DateSource.Committed ? this.committerDate : this.authorDate;
	}

	get formattedDate(): string {
		return CommitDateFormatting.dateStyle === DateStyle.Absolute
			? this.formatDate(CommitDateFormatting.dateFormat)
			: this.formatDateFromNow();
	}

	@memoize()
	get shortSha() {
		return GitRevision.shorten(this.sha);
	}

	get isFile() {
		return (
			this.type === GitCommitType.Blame ||
			this.type === GitCommitType.LogFile ||
			this.type === GitCommitType.StashFile
		);
	}

	get isStash() {
		return this.type === GitCommitType.Stash || this.type === GitCommitType.StashFile;
	}

	@memoize()
	get isUncommitted(): boolean {
		return GitRevision.isUncommitted(this.sha);
	}

	@memoize()
	get isUncommittedStaged(): boolean {
		return GitRevision.isUncommittedStaged(this.sha);
	}

	@memoize()
	get originalUri(): Uri {
		return this.originalFileName
			? Container.instance.git.getAbsoluteUri(this.originalFileName, this.repoPath)
			: this.uri;
	}

	get previousFileSha(): string {
		return `${this.sha}^`;
	}

	get previousShortSha() {
		return this.previousSha && GitRevision.shorten(this.previousSha);
	}

	get previousUri(): Uri {
		return this.previousFileName
			? Container.instance.git.getAbsoluteUri(this.previousFileName, this.repoPath)
			: this.uri;
	}

	@memoize()
	get uri(): Uri {
		return Container.instance.git.getAbsoluteUri(this.fileName, this.repoPath);
	}

	@memoize()
	async getAssociatedPullRequest(options?: { timeout?: number }): Promise<PullRequest | undefined> {
		const remote = await Container.instance.git.getRichRemoteProvider(this.repoPath);
		if (remote?.provider == null) return undefined;

		return Container.instance.git.getPullRequestForCommit(this.ref, remote, options);
	}

	@memoize<GitCommit['getPreviousLineDiffUris']>(
		(uri, editorLine, ref) => `${uri.toString(true)}|${editorLine ?? ''}|${ref ?? ''}`,
	)
	getPreviousLineDiffUris(uri: Uri, editorLine: number, ref: string | undefined) {
		if (!this.isFile) return Promise.resolve(undefined);

		return Container.instance.git.getPreviousLineDiffUris(this.repoPath, uri, editorLine, ref);
	}

	@memoize()
	getWorkingUri(): Promise<Uri | undefined> {
		if (!this.isFile) return Promise.resolve(undefined);

		return Container.instance.git.getWorkingUri(this.repoPath, this.uri);
	}

	@memoize<GitCommit['formatAuthorDate']>(format => (format == null ? 'MMMM Do, YYYY h:mma' : format))
	formatAuthorDate(format?: string | null) {
		return formatDate(this.authorDate, format ?? 'MMMM Do, YYYY h:mma');
	}

	formatAuthorDateFromNow(short?: boolean) {
		return fromNow(this.authorDate, short);
	}

	@memoize<GitCommit['formatCommitterDate']>(format => (format == null ? 'MMMM Do, YYYY h:mma' : format))
	formatCommitterDate(format?: string | null) {
		return formatDate(this.committerDate, format ?? 'MMMM Do, YYYY h:mma');
	}

	formatCommitterDateFromNow(short?: boolean) {
		return fromNow(this.committerDate, short);
	}

	formatDate(format?: string | null) {
		return CommitDateFormatting.dateSource === DateSource.Committed
			? this.formatCommitterDate(format)
			: this.formatAuthorDate(format);
	}

	formatDateFromNow(short?: boolean) {
		return CommitDateFormatting.dateSource === DateSource.Committed
			? this.formatCommitterDateFromNow(short)
			: this.formatAuthorDateFromNow(short);
	}

	getFormattedPath(options: { relativeTo?: string; suffix?: string; truncateTo?: number } = {}): string {
		return GitUri.getFormattedPath(this.fileName, options);
	}

	getAvatarUri(options?: { defaultStyle?: GravatarDefaultStyle; size?: number }): Uri | Promise<Uri> {
		return getAvatarUri(this.authorEmail, this, options);
	}

	@memoize()
	getShortMessage() {
		return CommitFormatter.fromTemplate(`\${message}`, this, { messageTruncateAtNewLine: true });
	}

	@memoize()
	toGitUri(previous: boolean = false): GitUri {
		return GitUri.fromCommit(this, previous);
	}

	abstract with(changes: {
		type?: GitCommitType;
		sha?: string;
		fileName?: string;
		originalFileName?: string | null;
		previousFileName?: string | null;
		previousSha?: string | null;
	}): GitCommit;

	protected getChangedValue<T>(change: T | null | undefined, original: T | undefined): T | undefined {
		if (change === undefined) return original;
		return change !== null ? change : undefined;
	}
}
