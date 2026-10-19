import { formatDate, fromNow } from '@gitlens/utils/date.js';
import { loggable } from '@gitlens/utils/decorators/log.js';
import { memoize } from '@gitlens/utils/decorators/memoize.js';
import { serializable } from '@gitlens/utils/decorators/serializable.js';
import { getBranchId, getRemoteNameFromBranchName, getRemoteNameSlashIndex } from '@gitlens/utils/gitRefs.js';
import type { MaybePausedResult } from '@gitlens/utils/promise.js';
import type { Shape } from '@gitlens/utils/types.js';
import {
	formatDetachedHeadName,
	getBranchTrackingWithoutRemote,
	isDetachedHead,
	parseRefName,
} from '../utils/branch.utils.js';
import { getUpstreamStatus } from '../utils/status.utils.js';
import type { GitBranchReference } from './reference.js';

export type BranchDisposition = 'starred' | 'archived';

/** The `.git/gk/config` keys (`branch.<name>.<key>`) a branch's {@link BranchMetadata} is read from */
export type BranchMetadataGkConfigKey =
	| 'gk-last-accessed'
	| 'gk-last-modified'
	| 'gk-agent-last-activity'
	| 'gk-disposition';

/**
 * A branch's `.git/gk/config` metadata. Unlike other cached values, the cache updates these objects in place when a
 * key changes (see `Cache.patchBranchMetadata`), so every `GitBranch` holding one, old or new, reads the new value
 */
export interface BranchMetadata {
	lastAccessedAt?: string;
	lastModifiedAt?: string;
	agentLastActivityAt?: string;
	disposition?: BranchDisposition;
}

export type GitBranchShape = Shape<GitBranch>;

/**
 * Each metadata object's last parsed stamps. Not `@memoize`d on the branch: the cache updates `BranchMetadata` in
 * place, so a parse is reused only while its stamp is unchanged — and shared by every branch holding the object.
 */
const stampDates = new WeakMap<BranchMetadata, Partial<Record<StampField, { stamp: string; date: Date }>>>();
type StampField = 'lastAccessedAt' | 'lastModifiedAt';

function getStampDate(metadata: BranchMetadata, field: StampField): Date | undefined {
	const stamp = metadata[field];
	if (!stamp) return undefined;

	let parsed = stampDates.get(metadata);
	if (parsed == null) {
		parsed = {};
		stampDates.set(metadata, parsed);
	}

	let entry = parsed[field];
	if (entry?.stamp !== stamp) {
		entry = { stamp: stamp, date: new Date(stamp) };
		parsed[field] = entry;
	}
	return entry.date;
}

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
		/**
		 * GK config metadata (dates, disposition), shared with the cache and updated in place: comparing an old and a
		 * new branch can't detect a changed stamp (no change event fires for one either)
		 */
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

	get lastAccessedDate(): Date | undefined {
		return this.metadata != null ? getStampDate(this.metadata, 'lastAccessedAt') : undefined;
	}

	/** When a checkout's working tree or index last changed while on this branch (`gk-last-modified`), not only commits */
	get lastModifiedDate(): Date | undefined {
		return this.metadata != null ? getStampDate(this.metadata, 'lastModifiedAt') : undefined;
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
		if (this.upstream?.local) return undefined;
		if (this.upstream != null) return this.upstream.remote ?? getRemoteNameFromBranchName(this.upstream.name);

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
	/**
	 * The remote the upstream is on (`branch.<name>.remote`) as git reports it, so a remote whose own name contains a
	 * `/` stays whole. `undefined` when git is too old to report it (before 2.23 here) or the upstream is a local branch
	 */
	readonly remote?: string;
	/**
	 * The branch's name on its {@link remote} (`branch.<name>.merge` without `refs/heads/`), so a custom fetch refspec
	 * can't misname it. `undefined` when git is too old to report it or the upstream is a local branch
	 */
	readonly remoteBranch?: string;
	/** The upstream is a branch in this repository (`branch.<name>.remote = .`), so it has no remote */
	readonly local?: boolean;
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
