import { loggable } from '@gitlens/utils/decorators/log.js';
import { memoize } from '@gitlens/utils/decorators/memoize.js';
import { serializable } from '@gitlens/utils/decorators/serializable.js';
import type { Shape } from '@gitlens/utils/types.js';
import { formatDetachedHeadName, isDetachedHead } from '../utils/branch.utils.js';
import { getFormattedDiffStatus, getUpstreamStatus } from '../utils/status.utils.js';
import type { GitBranchStatus, GitTrackingUpstream } from './branch.js';
import type { GitDiffFileStats } from './diff.js';
import { GitFileConflictStatus, GitFileIndexStatus, GitFileWorkingTreeStatus } from './fileStatus.js';
import type { GitStatusFile } from './statusFile.js';

export type GitStatusShape = Shape<GitStatus>;

@loggable(i => `${i.repoPath}|${i.branch}`)
@serializable
export class GitStatus {
	readonly detached: boolean;

	constructor(
		public readonly repoPath: string,
		public readonly branch: string,
		public readonly sha: string,
		public readonly files: GitStatusFile[],
		public readonly upstream?: GitTrackingUpstream,
		public readonly rebasing: boolean = false,
	) {
		this.detached = isDetachedHead(branch);
		if (this.detached) {
			this.branch = formatDetachedHeadName(this.sha);
		}
	}

	get branchStatus(): GitBranchStatus {
		if (this.upstream == null) return this.detached ? 'detached' : 'local';

		if (this.upstream.missing) return 'missingUpstream';
		if (this.upstream.state.ahead && this.upstream.state.behind) return 'diverged';
		if (this.upstream.state.ahead) return 'ahead';
		if (this.upstream.state.behind) return 'behind';
		return 'upToDate';
	}

	@memoize()
	get diffStatus(): GitDiffFileStats {
		const diff = { added: 0, deleted: 0, changed: 0 };
		if (!this.files.length) return diff;

		for (const f of this.files) {
			switch (f.status) {
				case 'A':
				case '?':
					diff.added++;
					break;
				case 'D':
					diff.deleted++;
					break;
				default:
					diff.changed++;
					break;
			}
		}

		return diff;
	}

	get hasChanges(): boolean {
		return Boolean(this.files.length);
	}

	@memoize()
	get hasConflicts(): boolean {
		return this.files.some(f => f.conflicted);
	}

	@memoize()
	get conflicts(): GitStatusFile[] {
		return this.files.filter(f => f.conflicted);
	}

	@memoize()
	get hasUntrackedChanges(): boolean {
		return this.files.some(f => f.workingTreeStatus === GitFileWorkingTreeStatus.Untracked);
	}

	@memoize()
	get untrackedChanges(): GitStatusFile[] {
		return this.files.filter(f => f.workingTreeStatus === GitFileWorkingTreeStatus.Untracked);
	}

	@memoize()
	get hasWorkingTreeChanges(): boolean {
		return this.files.some(f => f.workingTreeStatus != null);
	}

	@memoize()
	get workingTreeChanges(): GitStatusFile[] {
		return this.files.filter(f => f.workingTreeStatus != null);
	}

	get ref(): string {
		return this.detached ? this.sha : this.branch;
	}

	static is(status: unknown): status is GitStatus {
		return status instanceof GitStatus;
	}

	static computeWorkingTreeStatus(status: Pick<GitStatus, 'files'>): ComputedWorkingTreeGitStatus {
		let conflictedAdds = 0;
		let conflictedDeletes = 0;
		let conflictedChanges = 0;
		let stagedAdds = 0;
		let unstagedAdds = 0;
		let stagedChanges = 0;
		let unstagedChanges = 0;
		let stagedDeletes = 0;
		let unstagedDeletes = 0;

		const conflictedAddsAndChanges: GitStatusFile[] = [];
		const stagedAddsAndChanges: GitStatusFile[] = [];
		const unstagedAddsAndChanges: GitStatusFile[] = [];

		for (const f of status.files) {
			switch (f.conflictStatus) {
				case undefined:
					break;

				case GitFileConflictStatus.AddedByBoth:
				case GitFileConflictStatus.AddedByUs:
				case GitFileConflictStatus.AddedByThem:
					conflictedAdds++;
					stagedAddsAndChanges.push(f);
					break;

				case GitFileConflictStatus.DeletedByBoth:
				case GitFileConflictStatus.DeletedByUs:
				case GitFileConflictStatus.DeletedByThem:
					conflictedDeletes++;
					break;

				default:
					conflictedChanges++;
					conflictedAddsAndChanges.push(f);
					break;
			}

			switch (f.indexStatus) {
				case undefined:
					break;

				case GitFileIndexStatus.Added:
					stagedAdds++;
					stagedAddsAndChanges.push(f);
					break;

				case GitFileIndexStatus.Deleted:
					stagedDeletes++;
					break;

				default:
					stagedChanges++;
					stagedAddsAndChanges.push(f);
					break;
			}

			switch (f.workingTreeStatus) {
				case undefined:
				case GitFileWorkingTreeStatus.Ignored:
					break;

				case GitFileWorkingTreeStatus.Added:
				case GitFileWorkingTreeStatus.Untracked:
					unstagedAdds++;
					unstagedAddsAndChanges.push(f);
					break;

				case GitFileWorkingTreeStatus.Deleted:
					unstagedDeletes++;
					break;

				default:
					unstagedChanges++;
					unstagedAddsAndChanges.push(f);
					break;
			}
		}

		const conflicted = conflictedAdds + conflictedChanges + conflictedDeletes;
		const staged = stagedAdds + stagedChanges + stagedDeletes;
		const unstaged = unstagedAdds + unstagedChanges + unstagedDeletes;

		return {
			conflicted: conflicted,
			conflictedAddsAndChanges: conflictedAddsAndChanges,
			conflictedStatus: conflicted > 0 ? `+${conflictedAdds} ~${conflictedChanges} -${conflictedDeletes}` : '',
			staged: staged,
			stagedStatus: staged > 0 ? `+${stagedAdds} ~${stagedChanges} -${stagedDeletes}` : '',
			stagedAddsAndChanges: stagedAddsAndChanges,
			unstaged: unstaged,
			unstagedStatus: unstaged > 0 ? `+${unstagedAdds} ~${unstagedChanges} -${unstagedDeletes}` : '',
			unstagedAddsAndChanges: unstagedAddsAndChanges,
		};
	}

	static getFormattedDiffStatus(
		status: GitStatusShape,
		options?: {
			compact?: boolean;
			empty?: string;
			expand?: boolean;
			prefix?: string;
			separator?: string;
			suffix?: string;
		},
	): string {
		return getFormattedDiffStatus(status.diffStatus, options);
	}

	static getUpstreamStatus(
		status: GitStatusShape,
		options?: {
			empty?: string;
			expand?: boolean;
			icons?: boolean;
			prefix?: string;
			separator?: string;
			suffix?: string;
		},
	): string {
		return getUpstreamStatus(status.upstream, options);
	}
}

export interface ComputedWorkingTreeGitStatus {
	staged: number;
	stagedAddsAndChanges: GitStatusFile[];
	stagedStatus: string;

	unstaged: number;
	unstagedAddsAndChanges: GitStatusFile[];
	unstagedStatus: string;

	conflicted: number;
	conflictedAddsAndChanges: GitStatusFile[];
	conflictedStatus: string;
}
