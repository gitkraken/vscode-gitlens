import { formatDate, fromNow } from '@gitlens/utils/date.js';
import { loggable } from '@gitlens/utils/decorators/log.js';
import { memoize } from '@gitlens/utils/decorators/memoize.js';
import { serializable } from '@gitlens/utils/decorators/serializable.js';
import type { MaybePausedResult } from '@gitlens/utils/promise.js';
import type { Shape } from '@gitlens/utils/types.js';
import {
	formatDetachedHeadName,
	getBranchId,
	getBranchTrackingWithoutRemote,
	getRemoteNameFromBranchName,
	getRemoteNameSlashIndex,
	isDetachedHead,
	parseRefName,
} from '../utils/branch.utils.js';
import { getUpstreamStatus } from '../utils/status.utils.js';
import type { GitBranchReference } from './reference.js';

export type BranchDisposition = 'starred' | 'archived';

export interface BranchMetadata {
	lastAccessedAt?: string;
	lastModifiedAt?: string;
	agentLastActivityAt?: string;
	disposition?: BranchDisposition;
}

export type GitBranchShape = Shape<GitBranch>;

@loggable(i => i.id)
@serializable
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
		public readonly repoPath: string,
		public readonly refName: string,
		public readonly current: boolean,
		public readonly date: Date | undefined,
		/** GK config metadata (dates, disposition) */
		public readonly metadata: BranchMetadata | undefined,
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

	get archived(): boolean {
		return this.metadata?.disposition === 'archived';
	}

	@memoize()
	get basename(): string {
		const name = this.nameWithoutRemote;
		const index = name.lastIndexOf('/');
		return index !== -1 ? name.substring(index + 1) : name;
	}

	get disposition(): BranchDisposition | undefined {
		return this.metadata?.disposition;
	}

	/** @returns The most recent date among lastModifiedDate, lastAccessedDate, and branch.date */
	get effectiveDate(): Date | undefined {
		let maxTime: number | undefined;

		const accessed = this.lastAccessedDate?.getTime();
		if (accessed != null && (maxTime == null || accessed > maxTime)) {
			maxTime = accessed;
		}

		const modified = this.lastModifiedDate?.getTime();
		if (modified != null && (maxTime == null || modified > maxTime)) {
			maxTime = modified;
		}

		const date = this.date?.getTime();
		if (date != null && (maxTime == null || date > maxTime)) {
			maxTime = date;
		}

		return maxTime != null ? new Date(maxTime) : undefined;
	}

	@memoize()
	get lastAccessedDate(): Date | undefined {
		return this.metadata?.lastAccessedAt ? new Date(this.metadata.lastAccessedAt) : undefined;
	}

	@memoize()
	get lastModifiedDate(): Date | undefined {
		return this.metadata?.lastModifiedAt ? new Date(this.metadata.lastModifiedAt) : undefined;
	}

	@memoize()
	get nameWithoutRemote(): string {
		return this.remote ? this.name.substring(getRemoteNameSlashIndex(this.name) + 1) : this.name;
	}

	get ref(): string {
		return this.detached ? this.sha! : this._name;
	}

	@memoize()
	get remoteName(): string | undefined {
		if (this.remote) return getRemoteNameFromBranchName(this.name);
		if (this.upstream != null) return getRemoteNameFromBranchName(this.upstream.name);

		return undefined;
	}

	get starred(): boolean {
		return this.metadata?.disposition === 'starred';
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

	@memoize()
	get trackingWithoutRemote(): string | undefined {
		return getBranchTrackingWithoutRemote(this);
	}

	/** Creates a copy of this branch with a different repoPath and optionally a different current flag — ONLY used for worktree-aware caching */
	withRepoPath(repoPath: string, current?: boolean): GitBranch {
		const newCurrent = current ?? this.current;
		if (repoPath === this.repoPath && newCurrent === this.current) return this;
		return new GitBranch(
			repoPath,
			this.refName,
			newCurrent,
			this.date,
			this.metadata,
			this.sha,
			this.upstream,
			this.worktree,
			this.detached,
			this.rebasing,
		);
	}

	static is(branch: unknown): branch is GitBranch {
		return branch instanceof GitBranch;
	}

	static formatDate(branch: GitBranchShape, format?: string | null): string {
		return branch.date != null ? formatDate(branch.date, format ?? 'MMMM Do, YYYY h:mma') : '';
	}

	static formatDateFromNow(branch: GitBranchShape): string {
		return branch.date != null ? fromNow(branch.date) : '';
	}

	static formatDateWithStyle(
		branch: GitBranchShape,
		formatting: { dateStyle: string; dateFormat: string | null },
	): string {
		return formatting.dateStyle === 'absolute'
			? GitBranch.formatDate(branch, formatting.dateFormat)
			: GitBranch.formatDateFromNow(branch);
	}

	static getTrackingStatus(
		branch: GitBranchShape,
		options?: {
			count?: boolean;
			empty?: string;
			expand?: boolean;
			icons?: boolean;
			prefix?: string;
			separator?: string;
			suffix?: string;
		},
	): string {
		return getUpstreamStatus(branch.upstream, options);
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
	mergeTargetBranch: MaybePausedResult<string | undefined>;
	baseBranch: string | undefined;
	defaultBranch: string | undefined;
}
