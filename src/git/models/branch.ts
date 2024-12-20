import type { EnrichedAutolink } from '../../autolinks';
import type { Container } from '../../container';
import { formatDate, fromNow } from '../../system/date';
import { debug } from '../../system/decorators/log';
import { memoize } from '../../system/decorators/memoize';
import { getLoggableName } from '../../system/logger';
import {
	formatDetachedHeadName,
	getBranchId,
	getBranchTrackingWithoutRemote,
	getRemoteNameFromBranchName,
	getRemoteNameSlashIndex,
	isDetachedHead,
} from './branch.utils';
import type { PullRequest, PullRequestState } from './pullRequest';
import type { GitBranchReference } from './reference';
import type { GitRemote } from './remote';
import { getUpstreamStatus } from './status';

export interface GitTrackingState {
	ahead: number;
	behind: number;
}

export type GitBranchStatus =
	| 'local'
	| 'detached'
	| 'ahead'
	| 'behind'
	| 'diverged'
	| 'upToDate'
	| 'missingUpstream'
	| 'remote';

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
		return this.container.BranchDateFormatting.dateStyle === 'absolute'
			? this.formatDate(this.container.BranchDateFormatting.dateFormat)
			: this.formatDateFromNow();
	}

	get ref() {
		return this.detached ? this.sha! : this.name;
	}

	get status(): GitBranchStatus {
		if (this.remote) return 'remote';
		if (this.upstream == null) return this.detached ? 'detached' : 'local';

		if (this.upstream.missing) return 'missingUpstream';
		if (this.state.ahead && this.state.behind) return 'diverged';
		if (this.state.ahead) return 'ahead';
		if (this.state.behind) return 'behind';
		return 'upToDate';
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
		expiryOverride?: boolean | number;
	}): Promise<PullRequest | undefined> {
		const remote = await this.getRemote();
		if (remote?.provider == null) return undefined;

		const integration = await this.container.integrations.getByRemote(remote);
		if (integration == null) return undefined;

		if (this.upstream?.missing) {
			if (!this.sha) return undefined;

			return integration?.getPullRequestForCommit(remote.provider.repoDesc, this.sha);
		}

		return integration?.getPullRequestForBranch(
			remote.provider.repoDesc,
			this.getTrackingWithoutRemote() ?? this.getNameWithoutRemote(),
			options,
		);
	}

	@memoize()
	async getEnrichedAutolinks(): Promise<Map<string, EnrichedAutolink> | undefined> {
		const remote = await this.container.git.getBestRemoteWithProvider(this.repoPath);
		const branchAutolinks = await this.container.autolinks.getBranchAutolinks(this.name, remote);
		return this.container.autolinks.getEnrichedAutolinks(branchAutolinks, remote);
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

export function isBranch(branch: any): branch is GitBranch {
	return branch instanceof GitBranch;
}
