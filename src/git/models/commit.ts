'use strict';
import { Uri } from 'vscode';
import { configuration, DateSource, DateStyle, GravatarDefaultStyle } from '../../configuration';
import { Container } from '../../container';
import { Dates, memoize } from '../../system';
import { CommitFormatter } from '../formatters/formatters';
import { GitUri } from '../gitUri';
import { getAvatarUri } from '../../avatars';
import { GitReference, GitRevision, GitRevisionReference } from './models';

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

export enum GitCommitType {
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

export abstract class GitCommit implements GitRevisionReference {
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
		public readonly author: string,
		public readonly email: string | undefined,
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
		return this.originalFileName ? GitUri.resolveToUri(this.originalFileName, this.repoPath) : this.uri;
	}

	get previousFileSha(): string {
		return `${this.sha}^`;
	}

	get previousShortSha() {
		return this.previousSha && GitRevision.shorten(this.previousSha);
	}

	get previousUri(): Uri {
		return this.previousFileName ? GitUri.resolveToUri(this.previousFileName, this.repoPath) : this.uri;
	}

	@memoize()
	get uri(): Uri {
		return GitUri.resolveToUri(this.fileName, this.repoPath);
	}

	@memoize<GitCommit['getPreviousLineDiffUris']>(
		(uri, editorLine, ref) => `${uri.toString(true)}|${editorLine ?? ''}|${ref ?? ''}`,
	)
	getPreviousLineDiffUris(uri: Uri, editorLine: number, ref: string | undefined) {
		if (!this.isFile) return Promise.resolve(undefined);

		return Container.git.getPreviousLineDiffUris(this.repoPath, uri, editorLine, ref);
	}

	@memoize()
	getWorkingUri(): Promise<Uri | undefined> {
		if (!this.isFile) return Promise.resolve(undefined);

		return Container.git.getWorkingUri(this.repoPath, this.uri);
	}

	@memoize()
	private get authorDateFormatter(): Dates.DateFormatter {
		return Dates.getFormatter(this.authorDate);
	}

	@memoize()
	private get committerDateFormatter(): Dates.DateFormatter {
		return Dates.getFormatter(this.committerDate);
	}

	private get dateFormatter(): Dates.DateFormatter {
		return CommitDateFormatting.dateSource === DateSource.Committed
			? this.committerDateFormatter
			: this.authorDateFormatter;
	}

	@memoize<GitCommit['formatAuthorDate']>(format => (format == null ? 'MMMM Do, YYYY h:mma' : format))
	formatAuthorDate(format?: string | null) {
		if (format == null) {
			format = 'MMMM Do, YYYY h:mma';
		}

		return this.authorDateFormatter.format(format);
	}

	formatAuthorDateFromNow() {
		return this.authorDateFormatter.fromNow();
	}

	@memoize<GitCommit['formatCommitterDate']>(format => (format == null ? 'MMMM Do, YYYY h:mma' : format))
	formatCommitterDate(format?: string | null) {
		if (format == null) {
			format = 'MMMM Do, YYYY h:mma';
		}

		return this.committerDateFormatter.format(format);
	}

	formatCommitterDateFromNow() {
		return this.committerDateFormatter.fromNow();
	}

	@memoize<GitCommit['formatDate']>(format => (format == null ? 'MMMM Do, YYYY h:mma' : format))
	formatDate(format?: string | null) {
		if (format == null) {
			format = 'MMMM Do, YYYY h:mma';
		}

		return this.dateFormatter.format(format);
	}

	formatDateFromNow() {
		return this.dateFormatter.fromNow();
	}

	getFormattedPath(options: { relativeTo?: string; suffix?: string; truncateTo?: number } = {}): string {
		return GitUri.getFormattedPath(this.fileName, options);
	}

	getAvatarUri(fallback: GravatarDefaultStyle, size: number = 16): Uri {
		return getAvatarUri(this.email, fallback, size);
	}

	@memoize()
	getShortMessage() {
		// eslint-disable-next-line no-template-curly-in-string
		return CommitFormatter.fromTemplate('${message}', this, { messageTruncateAtNewLine: true });
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
