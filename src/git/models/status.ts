import type { Uri } from 'vscode';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { memoize } from '../../system/decorators/memoize';
import { pluralize } from '../../system/string';
import type { GitTrackingState } from './branch';
import { formatDetachedHeadName, getRemoteNameFromBranchName, isDetachedHead } from './branch';
import { GitCommit, GitCommitIdentity } from './commit';
import { uncommitted, uncommittedStaged } from './constants';
import type { GitFile, GitFileStatus } from './file';
import {
	getGitFileFormattedDirectory,
	getGitFileFormattedPath,
	getGitFileStatusCodicon,
	getGitFileStatusText,
	GitFileChange,
	GitFileConflictStatus,
	GitFileIndexStatus,
	GitFileWorkingTreeStatus,
} from './file';
import type { GitRemote } from './remote';
import type { GitUser } from './user';

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

export class GitStatus {
	readonly detached: boolean;

	constructor(
		public readonly repoPath: string,
		public readonly branch: string,
		public readonly sha: string,
		public readonly files: GitStatusFile[],
		public readonly state: GitTrackingState,
		public readonly upstream?: string,
		public readonly rebasing: boolean = false,
	) {
		this.detached = isDetachedHead(branch);
		if (this.detached) {
			this.branch = formatDetachedHeadName(this.sha);
		}
	}

	@memoize()
	get conflicts() {
		return this.files.filter(f => f.conflicted);
	}

	get hasChanges() {
		return this.files.length !== 0;
	}

	@memoize()
	get hasConflicts() {
		return this.files.some(f => f.conflicted);
	}

	get ref() {
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
	getDiffStatus() {
		const diff = {
			added: 0,
			deleted: 0,
			changed: 0,
		};

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

	getFormattedDiffStatus({
		compact,
		empty,
		expand,
		prefix = '',
		separator = ' ',
		suffix = '',
	}: {
		compact?: boolean;
		empty?: string;
		expand?: boolean;
		prefix?: string;
		separator?: string;
		suffix?: string;
	} = {}): string {
		const { added, changed, deleted } = this.getDiffStatus();
		if (added === 0 && changed === 0 && deleted === 0) return empty ?? '';

		if (expand) {
			let status = '';
			if (added) {
				status += `${pluralize('file', added)} added`;
			}
			if (changed) {
				status += `${status.length === 0 ? '' : separator}${pluralize('file', changed)} changed`;
			}
			if (deleted) {
				status += `${status.length === 0 ? '' : separator}${pluralize('file', deleted)} deleted`;
			}
			return `${prefix}${status}${suffix}`;
		}

		let status = '';
		if (compact) {
			if (added !== 0) {
				status += `+${added}`;
			}
			if (changed !== 0) {
				status += `${status.length === 0 ? '' : separator}~${changed}`;
			}
			if (deleted !== 0) {
				status += `${status.length === 0 ? '' : separator}-${deleted}`;
			}
		} else {
			status += `+${added}${separator}~${changed}${separator}-${deleted}`;
		}

		return `${prefix}${status}${suffix}`;
	}

	@memoize()
	async getRemote(): Promise<GitRemote | undefined> {
		if (this.upstream == null) return undefined;

		const remotes = await Container.instance.git.getRemotesWithProviders(this.repoPath);
		if (remotes.length === 0) return undefined;

		const remoteName = getRemoteNameFromBranchName(this.upstream);
		return remotes.find(r => r.name === remoteName);
	}

	getUpstreamStatus(options: {
		empty?: string;
		expand?: boolean;
		icons?: boolean;
		prefix?: string;
		separator?: string;
		suffix?: string;
	}): string {
		return getUpstreamStatus(
			this.upstream ? { name: this.upstream, missing: false } : undefined,
			this.state,
			options,
		);
	}
}

export function getUpstreamStatus(
	upstream: { name: string; missing: boolean } | undefined,
	state: { ahead: number; behind: number },
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
	let count = true;
	let expand = false;
	let icons = false;
	let prefix = '';
	let separator = ' ';
	let suffix = '';
	if (options != null) {
		({ count = true, expand = false, icons = false, prefix = '', separator = ' ', suffix = '' } = options);
	}
	if (upstream == null || (state.behind === 0 && state.ahead === 0)) return options?.empty ?? '';

	if (expand) {
		let status = '';
		if (upstream.missing) {
			status = 'missing';
		} else {
			if (state.behind) {
				status += `${pluralize('commit', state.behind, {
					infix: icons ? '$(arrow-down) ' : undefined,
				})} behind`;
			}
			if (state.ahead) {
				status += `${status.length === 0 ? '' : separator}${pluralize('commit', state.ahead, {
					infix: icons ? '$(arrow-up) ' : undefined,
				})} ahead`;
				if (suffix.startsWith(` ${upstream.name.split('/')[0]}`)) {
					status += ' of';
				}
			}
		}
		return `${prefix}${status}${suffix}`;
	}

	const showCounts = count && !upstream.missing;

	return `${prefix}${showCounts ? state.behind : ''}${
		showCounts || state.behind !== 0 ? GlyphChars.ArrowDown : ''
	}${separator}${showCounts ? state.ahead : ''}${showCounts || state.ahead !== 0 ? GlyphChars.ArrowUp : ''}${suffix}`;
}

export class GitStatusFile implements GitFile {
	public readonly conflictStatus: GitFileConflictStatus | undefined;
	public readonly indexStatus: GitFileIndexStatus | undefined;
	public readonly workingTreeStatus: GitFileWorkingTreeStatus | undefined;

	constructor(
		public readonly repoPath: string,
		x: string | undefined,
		y: string | undefined,
		public readonly path: string,
		public readonly originalPath?: string,
	) {
		if (x != null && y != null) {
			switch (x + y) {
				case '??':
					this.workingTreeStatus = GitFileWorkingTreeStatus.Untracked;
					break;
				case '!!':
					this.workingTreeStatus = GitFileWorkingTreeStatus.Ignored;
					break;
				case 'AA':
					this.conflictStatus = GitFileConflictStatus.AddedByBoth;
					break;
				case 'AU':
					this.conflictStatus = GitFileConflictStatus.AddedByUs;
					break;
				case 'UA':
					this.conflictStatus = GitFileConflictStatus.AddedByThem;
					break;
				case 'DD':
					this.conflictStatus = GitFileConflictStatus.DeletedByBoth;
					break;
				case 'DU':
					this.conflictStatus = GitFileConflictStatus.DeletedByUs;
					break;
				case 'UD':
					this.conflictStatus = GitFileConflictStatus.DeletedByThem;
					break;
				case 'UU':
					this.conflictStatus = GitFileConflictStatus.ModifiedByBoth;
					break;
			}
		}

		if (this.conflictStatus == null) {
			switch (x) {
				case 'A':
					this.indexStatus = GitFileIndexStatus.Added;
					break;
				case 'D':
					this.indexStatus = GitFileIndexStatus.Deleted;
					break;
				case 'M':
					this.indexStatus = GitFileIndexStatus.Modified;
					break;
				case 'R':
					this.indexStatus = GitFileIndexStatus.Renamed;
					break;
				case 'C':
					this.indexStatus = GitFileIndexStatus.Copied;
					break;
			}

			switch (y) {
				case 'A':
				case '?':
					this.workingTreeStatus = GitFileWorkingTreeStatus.Added;
					break;
				case 'D':
					this.workingTreeStatus = GitFileWorkingTreeStatus.Deleted;
					break;
				case 'M':
					this.workingTreeStatus = GitFileWorkingTreeStatus.Modified;
					break;
			}
		}
	}

	get conflicted() {
		return this.conflictStatus != null;
	}

	get edited() {
		return this.workingTreeStatus != null;
	}

	get staged() {
		return this.indexStatus != null;
	}

	get status(): GitFileStatus {
		return (this.conflictStatus ?? this.indexStatus ?? this.workingTreeStatus)!;
	}

	@memoize()
	get uri(): Uri {
		return Container.instance.git.getAbsoluteUri(this.path, this.repoPath);
	}

	getFormattedDirectory(includeOriginal: boolean = false): string {
		return getGitFileFormattedDirectory(this, includeOriginal);
	}

	getFormattedPath(options: { relativeTo?: string; suffix?: string; truncateTo?: number } = {}): string {
		return getGitFileFormattedPath(this, options);
	}

	getOcticon() {
		return getGitFileStatusCodicon(this.status);
	}

	getStatusText(): string {
		return getGitFileStatusText(this.status);
	}

	getPseudoCommits(container: Container, user: GitUser | undefined): GitCommit[] {
		const commits: GitCommit[] = [];

		const now = new Date();

		if (this.conflictStatus != null) {
			commits.push(
				new GitCommit(
					container,
					this.repoPath,
					uncommitted,
					new GitCommitIdentity('You', user?.email ?? undefined, now),
					new GitCommitIdentity('You', user?.email ?? undefined, now),
					'Uncommitted changes',
					[uncommittedStaged],
					'Uncommitted changes',
					new GitFileChange(this.repoPath, this.path, this.status, this.originalPath, uncommittedStaged),
					undefined,
					[],
				),
			);
			return commits;
		}

		if (this.workingTreeStatus == null && this.indexStatus == null) return commits;

		if (this.workingTreeStatus != null && this.indexStatus != null) {
			// Decrements the date to guarantee the staged entry will be sorted after the working entry (most recent first)
			const older = new Date(now);
			older.setMilliseconds(older.getMilliseconds() - 1);

			commits.push(
				new GitCommit(
					container,
					this.repoPath,
					uncommitted,
					new GitCommitIdentity('You', user?.email ?? undefined, now),
					new GitCommitIdentity('You', user?.email ?? undefined, now),
					'Uncommitted changes',
					[uncommittedStaged],
					'Uncommitted changes',
					new GitFileChange(this.repoPath, this.path, this.status, this.originalPath, uncommittedStaged),
					undefined,
					[],
				),
				new GitCommit(
					container,
					this.repoPath,
					uncommittedStaged,
					new GitCommitIdentity('You', user?.email ?? undefined, older),
					new GitCommitIdentity('You', user?.email ?? undefined, older),
					'Uncommitted changes',
					['HEAD'],
					'Uncommitted changes',
					new GitFileChange(this.repoPath, this.path, this.status, this.originalPath, 'HEAD'),
					undefined,
					[],
				),
			);
		} else {
			commits.push(
				new GitCommit(
					container,
					this.repoPath,
					this.workingTreeStatus != null ? uncommitted : uncommittedStaged,
					new GitCommitIdentity('You', user?.email ?? undefined, now),
					new GitCommitIdentity('You', user?.email ?? undefined, now),
					'Uncommitted changes',
					['HEAD'],
					'Uncommitted changes',
					new GitFileChange(this.repoPath, this.path, this.status, this.originalPath, 'HEAD'),
					undefined,
					[],
				),
			);
		}

		return commits;
	}
}
