import { BranchSorting, DateStyle } from '../../config';
import { Container } from '../../container';
import { configuration } from '../../system/configuration';
import { formatDate, fromNow } from '../../system/date';
import { debug } from '../../system/decorators/log';
import { memoize } from '../../system/decorators/memoize';
import { getLoggableName } from '../../system/logger';
import { cancellable } from '../../system/promise';
import { sortCompare } from '../../system/string';
import type { RemoteProvider } from '../remotes/remoteProvider';
import type { RichRemoteProvider } from '../remotes/richRemoteProvider';
import type { PullRequest, PullRequestState } from './pullRequest';
import type { GitBranchReference, GitReference } from './reference';
import { shortenRevision } from './reference';
import type { GitRemote } from './remote';
import { getUpstreamStatus } from './status';

const whitespaceRegex = /\s/;
const detachedHEADRegex = /^(?=.*\bHEAD\b)?(?=.*\bdetached\b).*$/;

export interface GitTrackingState {
	ahead: number;
	behind: number;
}

export const enum GitBranchStatus {
	Ahead = 'ahead',
	Behind = 'behind',
	Diverged = 'diverged',
	Local = 'local',
	MissingUpstream = 'missingUpstream',
	Remote = 'remote',
	UpToDate = 'upToDate',
	Unpublished = 'unpublished',
}

export interface BranchSortOptions {
	current?: boolean;
	missingUpstream?: boolean;
	orderBy?: BranchSorting;
}

export function getBranchId(repoPath: string, remote: boolean, name: string): string {
	return `${repoPath}|${remote ? 'remotes/' : 'heads/'}${name}`;
}

export class GitBranch implements GitBranchReference {
	readonly refType = 'branch';
	readonly detached: boolean;
	readonly id: string;
	readonly upstream?: { name: string; missing: boolean };
	readonly state: GitTrackingState;

	constructor(
		public readonly repoPath: string,
		public readonly name: string,
		public readonly remote: boolean,
		public readonly current: boolean,
		public readonly date: Date | undefined,
		public readonly sha?: string,
		upstream?: { name: string; missing: boolean },
		ahead: number = 0,
		behind: number = 0,
		detached: boolean = false,
		public readonly rebasing: boolean = false,
	) {
		this.id = getBranchId(repoPath, remote, name);

		this.detached = detached || (this.current ? isDetachedHead(name) : false);
		if (this.detached) {
			this.name = formatDetachedHeadName(this.sha!);
		}

		this.upstream = upstream?.name == null || upstream.name.length === 0 ? undefined : upstream;
		this.state = {
			ahead: ahead,
			behind: behind,
		};
	}

	toString(): string {
		return `${getLoggableName(this)}(${this.id})`;
	}

	get formattedDate(): string {
		return Container.instance.BranchDateFormatting.dateStyle === DateStyle.Absolute
			? this.formatDate(Container.instance.BranchDateFormatting.dateFormat)
			: this.formatDateFromNow();
	}

	get ref() {
		return this.detached ? this.sha! : this.name;
	}

	@memoize<GitBranch['formatDate']>(format => format ?? 'MMMM Do, YYYY h:mma')
	formatDate(format?: string | null): string {
		return this.date != null ? formatDate(this.date, format ?? 'MMMM Do, YYYY h:mma') : '';
	}

	formatDateFromNow(): string {
		return this.date != null ? fromNow(this.date) : '';
	}

	private _pullRequest: Promise<PullRequest | undefined> | undefined;

	@debug()
	async getAssociatedPullRequest(options?: {
		avatarSize?: number;
		include?: PullRequestState[];
		limit?: number;
		timeout?: number;
	}): Promise<PullRequest | undefined> {
		if (this._pullRequest == null) {
			async function getCore(this: GitBranch): Promise<PullRequest | undefined> {
				const remote = await this.getRemoteWithProvider();
				if (remote == null) return undefined;

				const branch = this.getTrackingWithoutRemote() ?? this.getNameWithoutRemote();
				return Container.instance.git.getPullRequestForBranch(branch, remote, options);
			}
			this._pullRequest = getCore.call(this);
		}

		return cancellable(this._pullRequest, options?.timeout);
	}

	@memoize()
	getBasename(): string {
		const name = this.getNameWithoutRemote();
		const index = name.lastIndexOf('/');
		return index !== -1 ? name.substring(index + 1) : name;
	}

	@memoize()
	getNameWithoutRemote(): string {
		return this.remote ? this.name.substring(this.name.indexOf('/') + 1) : this.name;
	}

	@memoize()
	getTrackingWithoutRemote(): string | undefined {
		return this.upstream?.name.substring(this.upstream.name.indexOf('/') + 1);
	}

	@memoize()
	async getRemote(): Promise<GitRemote | undefined> {
		const remoteName = this.getRemoteName();
		if (remoteName == null) return undefined;

		const remotes = await Container.instance.git.getRemotes(this.repoPath);
		if (remotes.length === 0) return undefined;

		return remotes.find(r => r.name === remoteName);
	}

	@memoize()
	async getRemoteWithProvider(): Promise<GitRemote<RemoteProvider | RichRemoteProvider> | undefined> {
		const remoteName = this.getRemoteName();
		if (remoteName == null) return undefined;

		const remotes = await Container.instance.git.getRemotesWithProviders(this.repoPath);
		if (remotes.length === 0) return undefined;

		return remotes.find(r => r.name === remoteName);
	}

	@memoize()
	getRemoteName(): string | undefined {
		if (this.remote) return getRemoteNameFromBranchName(this.name);
		if (this.upstream != null) return getRemoteNameFromBranchName(this.upstream.name);

		return undefined;
	}

	@memoize()
	async getStatus(): Promise<GitBranchStatus> {
		if (this.remote) return GitBranchStatus.Remote;

		if (this.upstream != null) {
			if (this.upstream.missing) return GitBranchStatus.MissingUpstream;
			if (this.state.ahead && this.state.behind) return GitBranchStatus.Diverged;
			if (this.state.ahead) return GitBranchStatus.Ahead;
			if (this.state.behind) return GitBranchStatus.Behind;
			return GitBranchStatus.UpToDate;
		}

		const remotes = await Container.instance.git.getRemotesWithProviders(this.repoPath);
		if (remotes.length > 0) return GitBranchStatus.Unpublished;

		return GitBranchStatus.Local;
	}

	getTrackingStatus(options?: {
		count?: boolean;
		empty?: string;
		expand?: boolean;
		icons?: boolean;
		prefix?: string;
		separator?: string;
		suffix?: string;
	}): string {
		return getUpstreamStatus(this.upstream, this.state, options);
	}

	get starred() {
		const starred = Container.instance.storage.getWorkspace('starred:branches');
		return starred !== undefined && starred[this.id] === true;
	}

	star() {
		return Container.instance.git.getRepository(this.repoPath)?.star(this);
	}

	unstar() {
		return Container.instance.git.getRepository(this.repoPath)?.unstar(this);
	}
}

export function formatDetachedHeadName(sha: string): string {
	return `(${shortenRevision(sha)}...)`;
}

export function getBranchNameWithoutRemote(name: string): string {
	return name.substring(name.indexOf('/') + 1);
}

export function getRemoteNameFromBranchName(name: string): string {
	return name.substring(0, name.indexOf('/'));
}

export function isBranch(branch: any): branch is GitBranch {
	return branch instanceof GitBranch;
}

export function isDetachedHead(name: string): boolean {
	// If there is whitespace in the name assume this is not a valid branch name
	// Deals with detached HEAD states
	return whitespaceRegex.test(name) || detachedHEADRegex.test(name);
}

export function isOfBranchRefType(branch: GitReference | undefined) {
	return branch?.refType === 'branch';
}

export function splitBranchNameAndRemote(name: string): [name: string, remote: string | undefined] {
	const index = name.indexOf('/');
	if (index === -1) return [name, undefined];

	return [name.substring(index + 1), name.substring(0, index)];
}

export function sortBranches(branches: GitBranch[], options?: BranchSortOptions) {
	options = { current: true, orderBy: configuration.get('sortBranchesBy'), ...options };

	switch (options.orderBy) {
		case BranchSorting.DateAsc:
			return branches.sort(
				(a, b) =>
					(options!.missingUpstream ? (a.upstream?.missing ? -1 : 1) - (b.upstream?.missing ? -1 : 1) : 0) ||
					(options!.current ? (a.current ? -1 : 1) - (b.current ? -1 : 1) : 0) ||
					(a.starred ? -1 : 1) - (b.starred ? -1 : 1) ||
					(b.remote ? -1 : 1) - (a.remote ? -1 : 1) ||
					(a.date == null ? -1 : a.date.getTime()) - (b.date == null ? -1 : b.date.getTime()),
			);
		case BranchSorting.NameAsc:
			return branches.sort(
				(a, b) =>
					(options!.missingUpstream ? (a.upstream?.missing ? -1 : 1) - (b.upstream?.missing ? -1 : 1) : 0) ||
					(options!.current ? (a.current ? -1 : 1) - (b.current ? -1 : 1) : 0) ||
					(a.starred ? -1 : 1) - (b.starred ? -1 : 1) ||
					(a.name === 'main' ? -1 : 1) - (b.name === 'main' ? -1 : 1) ||
					(a.name === 'master' ? -1 : 1) - (b.name === 'master' ? -1 : 1) ||
					(a.name === 'develop' ? -1 : 1) - (b.name === 'develop' ? -1 : 1) ||
					(b.remote ? -1 : 1) - (a.remote ? -1 : 1) ||
					sortCompare(a.name, b.name),
			);
		case BranchSorting.NameDesc:
			return branches.sort(
				(a, b) =>
					(options!.missingUpstream ? (a.upstream?.missing ? -1 : 1) - (b.upstream?.missing ? -1 : 1) : 0) ||
					(options!.current ? (a.current ? -1 : 1) - (b.current ? -1 : 1) : 0) ||
					(a.starred ? -1 : 1) - (b.starred ? -1 : 1) ||
					(a.name === 'main' ? -1 : 1) - (b.name === 'main' ? -1 : 1) ||
					(a.name === 'master' ? -1 : 1) - (b.name === 'master' ? -1 : 1) ||
					(a.name === 'develop' ? -1 : 1) - (b.name === 'develop' ? -1 : 1) ||
					(b.remote ? -1 : 1) - (a.remote ? -1 : 1) ||
					sortCompare(b.name, a.name),
			);
		case BranchSorting.DateDesc:
		default:
			return branches.sort(
				(a, b) =>
					(options!.missingUpstream ? (a.upstream?.missing ? -1 : 1) - (b.upstream?.missing ? -1 : 1) : 0) ||
					(options!.current ? (a.current ? -1 : 1) - (b.current ? -1 : 1) : 0) ||
					(a.starred ? -1 : 1) - (b.starred ? -1 : 1) ||
					(b.remote ? -1 : 1) - (a.remote ? -1 : 1) ||
					(b.date == null ? -1 : b.date.getTime()) - (a.date == null ? -1 : a.date.getTime()),
			);
	}
}
