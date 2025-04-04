/* eslint-disable @typescript-eslint/no-restricted-imports */ /* TODO need to deal with sharing rich class shapes to webviews */
import type { EnrichedAutolink } from '../../autolinks/models/autolinks';
import type { Container } from '../../container';
import { formatDate, fromNow } from '../../system/date';
import { memoize } from '../../system/decorators/-webview/memoize';
import { debug } from '../../system/decorators/log';
import { getLoggableName } from '../../system/logger';
import type { MaybePausedResult } from '../../system/promise';
import {
	formatDetachedHeadName,
	getBranchId,
	getBranchTrackingWithoutRemote,
	getRemoteNameFromBranchName,
	getRemoteNameSlashIndex,
	isDetachedHead,
	parseRefName,
} from '../utils/branch.utils';
import { getUpstreamStatus } from '../utils/status.utils';
import type { PullRequest, PullRequestState } from './pullRequest';
import type { GitBranchReference } from './reference';
import type { GitRemote } from './remote';
import type { GitWorktree } from './worktree';

export function isBranch(branch: unknown): branch is GitBranch {
	return branch instanceof GitBranch;
}

export class GitBranch implements GitBranchReference {
	readonly refType = 'branch';
	readonly detached: boolean;
	readonly id: string;

	private readonly _name: string;
	get name(): string {
		return this._name;
	}

	private readonly _remote: boolean;
	get remote(): boolean {
		return this._remote;
	}

	constructor(
		private readonly container: Container,
		public readonly repoPath: string,
		public readonly refName: string,
		public readonly current: boolean,
		public readonly date: Date | undefined,
		public readonly sha?: string,
		public readonly upstream?: GitTrackingUpstream,
		public readonly worktree?: { path: string; isDefault: boolean } | false,
		detached: boolean = false,
		public readonly rebasing: boolean = false,
	) {
		({ name: this._name, remote: this._remote } = parseRefName(refName));

		this.detached = detached || (this.current ? isDetachedHead(this._name) : false);
		if (this.detached) {
			this.id = getBranchId(repoPath, this._remote, this.sha!);
			this._name = formatDetachedHeadName(this.sha!);
		} else {
			this.id = getBranchId(repoPath, this._remote, this._name);
		}

		this.upstream = upstream?.name ? upstream : undefined;
	}

	toString(): string {
		return `${getLoggableName(this)}(${this.id})`;
	}

	get formattedDate(): string {
		return this.container.BranchDateFormatting.dateStyle === 'absolute'
			? this.formatDate(this.container.BranchDateFormatting.dateFormat)
			: this.formatDateFromNow();
	}

	get ref(): string {
		return this.detached ? this.sha! : this.name;
	}

	get status(): GitBranchStatus {
		if (this.remote) return 'remote';
		if (this.upstream == null) return this.detached ? 'detached' : 'local';

		if (this.upstream.missing) return 'missingUpstream';
		if (this.upstream.state.ahead && this.upstream.state.behind) return 'diverged';
		if (this.upstream.state.ahead) return 'ahead';
		if (this.upstream.state.behind) return 'behind';
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
		const remote = await this.container.git.remotes(this.repoPath).getBestRemoteWithProvider();
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

		return this.container.git.remotes(this.repoPath).getRemote(remoteName);
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
		return getUpstreamStatus(this.upstream, options);
	}

	@debug()
	async getWorktree(): Promise<GitWorktree | undefined> {
		if (this.worktree === false) return undefined;
		if (this.worktree == null) {
			const { id } = this;
			return this.container.git.worktrees(this.repoPath)?.getWorktree(wt => wt.branch?.id === id);
		}

		const { path } = this.worktree;
		return this.container.git.worktrees(this.repoPath)?.getWorktree(wt => wt.path === path);
	}

	get starred(): boolean {
		const starred = this.container.storage.getWorkspace('starred:branches');
		return starred !== undefined && starred[this.id] === true;
	}

	async star(): Promise<void> {
		return this.container.git.getRepository(this.repoPath)?.star(this);
	}

	async unstar(): Promise<void> {
		return this.container.git.getRepository(this.repoPath)?.unstar(this);
	}
}

export interface GitTrackingState {
	readonly ahead: number;
	readonly behind: number;
}

export interface GitTrackingUpstream {
	readonly name: string;
	readonly missing: boolean;
	readonly state: GitTrackingState;
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

export interface BranchTargetInfo {
	baseBranch: string | undefined;
	defaultBranch: string | undefined;
	targetBranch: MaybePausedResult<string | undefined>;
}
