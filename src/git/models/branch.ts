import { BranchSorting, DateStyle } from '../../config';
import type { Container } from '../../container';
import { configuration } from '../../system/configuration';
import { formatDate, fromNow } from '../../system/date';
import { debug } from '../../system/decorators/log';
import { memoize } from '../../system/decorators/memoize';
import { getLoggableName } from '../../system/logger';
import { sortCompare } from '../../system/string';
import type { PullRequest, PullRequestState } from './pullRequest';
import type { GitBranchReference, GitReference } from './reference';
import { getBranchTrackingWithoutRemote, shortenRevision } from './reference';
import type { GitRemote } from './remote';
import type { Repository } from './repository';
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
		private readonly container: Container,
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
		return this.container.BranchDateFormatting.dateStyle === DateStyle.Absolute
			? this.formatDate(this.container.BranchDateFormatting.dateFormat)
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

	@debug()
	async getAssociatedPullRequest(options?: {
		avatarSize?: number;
		include?: PullRequestState[];
	}): Promise<PullRequest | undefined> {
		const remote = await this.getRemote();
		return remote?.hasRichIntegration()
			? remote.provider.getPullRequestForBranch(
					this.getTrackingWithoutRemote() ?? this.getNameWithoutRemote(),
					options,
			  )
			: undefined;
	}

	@memoize()
	getBasename(): string {
		const name = this.getNameWithoutRemote();
		const index = name.lastIndexOf('/');
		return index !== -1 ? name.substring(index + 1) : name;
	}

	@memoize()
	getNameWithoutRemote(): string {
		return this.remote ? this.name.substring(getRemoteNameSlashIndex(this.name) + 1) : this.name;
	}

	@memoize()
	getTrackingWithoutRemote(): string | undefined {
		return getBranchTrackingWithoutRemote(this);
	}

	@memoize()
	async getRemote(): Promise<GitRemote | undefined> {
		const remoteName = this.getRemoteName();
		if (remoteName == null) return undefined;

		const remotes = await this.container.git.getRemotes(this.repoPath);
		return remotes.length ? remotes.find(r => r.name === remoteName) : undefined;
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

		// If there are any remotes then say this is unpublished, otherwise local
		const remotes = await this.container.git.getRemotes(this.repoPath);
		return remotes.length ? GitBranchStatus.Unpublished : GitBranchStatus.Local;
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
		const starred = this.container.storage.getWorkspace('starred:branches');
		return starred !== undefined && starred[this.id] === true;
	}

	star() {
		return this.container.git.getRepository(this.repoPath)?.star(this);
	}

	unstar() {
		return this.container.git.getRepository(this.repoPath)?.unstar(this);
	}
}

export function formatDetachedHeadName(sha: string): string {
	return `(${shortenRevision(sha)}...)`;
}

export function getRemoteNameSlashIndex(name: string): number {
	return name.startsWith('remotes/') ? name.indexOf('/', 8) : name.indexOf('/');
}

export function getBranchNameAndRemote(ref: GitBranchReference): [name: string, remote: string | undefined] {
	if (ref.remote) {
		const index = getRemoteNameSlashIndex(ref.name);
		if (index === -1) return [ref.name, undefined];

		return [ref.name.substring(index + 1), ref.name.substring(0, index)];
	}

	if (ref.upstream?.name != null) {
		const index = getRemoteNameSlashIndex(ref.upstream.name);
		if (index === -1) return [ref.name, undefined];

		return [ref.name, ref.upstream.name.substring(0, index)];
	}

	return [ref.name, undefined];
}

export function getBranchNameWithoutRemote(name: string): string {
	return name.substring(getRemoteNameSlashIndex(name) + 1);
}

export function getRemoteNameFromBranchName(name: string): string {
	return name.substring(0, getRemoteNameSlashIndex(name));
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

export async function getLocalBranchByUpstream(
	repo: Repository,
	remoteBranchName: string,
): Promise<GitBranch | undefined> {
	let qualifiedRemoteBranchName;
	if (remoteBranchName.startsWith('remotes/')) {
		qualifiedRemoteBranchName = remoteBranchName;
		remoteBranchName = remoteBranchName.substring(8);
	} else {
		qualifiedRemoteBranchName = `remotes/${remoteBranchName}`;
	}

	let branches;
	do {
		branches = await repo.getBranches(branches != null ? { paging: branches.paging } : undefined);
		for (const branch of branches.values) {
			if (
				!branch.remote &&
				branch.upstream?.name != null &&
				(branch.upstream.name === remoteBranchName || branch.upstream.name === qualifiedRemoteBranchName)
			) {
				return branch;
			}
		}
	} while (branches.paging?.more);

	return undefined;
}
