import type { Container } from '../../container';
import { memoize } from '../../system/decorators/memoize';
import { formatDetachedHeadName, getRemoteNameFromBranchName, isDetachedHead } from '../utils/branch.utils';
import { getFormattedDiffStatus, getUpstreamStatus } from '../utils/status.utils';
import type { GitBranchStatus, GitTrackingUpstream } from './branch';
import type { GitDiffFileStats } from './diff';
import { GitFileConflictStatus, GitFileIndexStatus, GitFileWorkingTreeStatus } from './fileStatus';
import type { GitRemote } from './remote';
import type { GitStatusFile } from './statusFile';

export class GitStatus {
	readonly detached: boolean;

	constructor(
		private readonly container: Container,
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

	get hasChanges(): boolean {
		return this.files.length !== 0;
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

	@memoize()
	computeWorkingTreeStatus(): ComputedWorkingTreeGitStatus {
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

		for (const f of this.files) {
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

	@memoize()
	getDiffStatus(): GitDiffFileStats {
		const diff = { added: 0, deleted: 0, changed: 0 };

		if (this.files.length === 0) return diff;

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

	getFormattedDiffStatus(options?: {
		compact?: boolean;
		empty?: string;
		expand?: boolean;
		prefix?: string;
		separator?: string;
		suffix?: string;
	}): string {
		return getFormattedDiffStatus(this.getDiffStatus(), options);
	}

	@memoize()
	async getRemote(): Promise<GitRemote | undefined> {
		if (this.upstream == null) return undefined;

		const remotes = await this.container.git.getRepositoryService(this.repoPath).remotes.getRemotesWithProviders();
		if (remotes.length === 0) return undefined;

		const remoteName = getRemoteNameFromBranchName(this.upstream?.name);
		return remotes.find(r => r.name === remoteName);
	}

	getUpstreamStatus(options?: {
		empty?: string;
		expand?: boolean;
		icons?: boolean;
		prefix?: string;
		separator?: string;
		suffix?: string;
	}): string {
		return getUpstreamStatus(this.upstream, options);
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
