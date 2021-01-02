'use strict';
import { Uri } from 'vscode';
import { GitBranch, GitTrackingState } from './branch';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { GitFile, GitFileConflictStatus, GitFileIndexStatus, GitFileStatus, GitFileWorkingTreeStatus } from './file';
import { GitUri } from '../gitUri';
import { GitCommitType, GitLogCommit, GitRemote, GitRevision } from './models';
import { memoize, Strings } from '../../system';

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
		this.detached = GitBranch.isDetached(branch);
		if (this.detached) {
			this.branch = GitBranch.formatDetached(this.sha);
		}
	}

	@memoize()
	get conflicts() {
		return this.files.filter(f => f.conflicted);
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
				status += `${Strings.pluralize('file', added)} added`;
			}
			if (changed) {
				status += `${status.length === 0 ? '' : separator}${Strings.pluralize('file', changed)} changed`;
			}
			if (deleted) {
				status += `${status.length === 0 ? '' : separator}${Strings.pluralize('file', deleted)} deleted`;
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

		const remotes = await Container.git.getRemotes(this.repoPath);
		if (remotes.length === 0) return undefined;

		const remoteName = GitBranch.getRemote(this.upstream);
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
		return GitStatus.getUpstreamStatus(this.upstream, this.state, options);
	}

	static getUpstreamStatus(
		upstream: string | undefined,
		state: { ahead: number; behind: number },
		options: {
			empty?: string;
			expand?: boolean;
			icons?: boolean;
			prefix?: string;
			separator?: string;
			suffix?: string;
		} = {},
	): string {
		const { expand = false, icons = false, prefix = '', separator = ' ', suffix = '' } = options;
		if (upstream == null || (state.behind === 0 && state.ahead === 0)) return options.empty ?? '';

		if (expand) {
			let status = '';
			if (state.behind) {
				status += `${Strings.pluralize('commit', state.behind, {
					infix: icons ? '$(arrow-down) ' : undefined,
				})} behind`;
			}
			if (state.ahead) {
				status += `${status.length === 0 ? '' : separator}${Strings.pluralize('commit', state.ahead, {
					infix: icons ? '$(arrow-up) ' : undefined,
				})} ahead`;
				if (suffix.startsWith(` ${upstream.split('/')[0]}`)) {
					status += ' of';
				}
			}
			return `${prefix}${status}${suffix}`;
		}

		return `${prefix}${state.behind}${GlyphChars.ArrowDown}${separator}${state.ahead}${GlyphChars.ArrowUp}${suffix}`;
	}
}

export class GitStatusFile implements GitFile {
	public readonly conflictStatus: GitFileConflictStatus | undefined;
	public readonly indexStatus: GitFileIndexStatus | undefined;
	public readonly workingTreeStatus: GitFileWorkingTreeStatus | undefined;

	constructor(
		public readonly repoPath: string,
		x: string | undefined,
		y: string | undefined,
		public readonly fileName: string,
		public readonly originalFileName?: string,
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
					this.workingTreeStatus = GitFileWorkingTreeStatus.Modified;
					break;
				case 'D':
					this.workingTreeStatus = GitFileWorkingTreeStatus.Modified;
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
		return GitUri.resolveToUri(this.fileName, this.repoPath);
	}

	getFormattedDirectory(includeOriginal: boolean = false): string {
		return GitFile.getFormattedDirectory(this, includeOriginal);
	}

	getFormattedPath(options: { relativeTo?: string; suffix?: string; truncateTo?: number } = {}): string {
		return GitFile.getFormattedPath(this, options);
	}

	getOcticon() {
		return GitFile.getStatusCodicon(this.status);
	}

	getStatusText(): string {
		return GitFile.getStatusText(this.status);
	}

	async toPsuedoCommits(): Promise<GitLogCommit[]> {
		const commits: GitLogCommit[] = [];

		if (this.conflictStatus != null) {
			const user = await Container.git.getCurrentUser(this.repoPath);
			commits.push(
				new GitLogCommit(
					GitCommitType.LogFile,
					this.repoPath,
					GitRevision.uncommitted,
					'You',
					user?.email ?? undefined,
					new Date(),
					new Date(),
					'',
					this.fileName,
					[this],
					this.status,
					this.originalFileName,
					GitRevision.uncommittedStaged,
					this.originalFileName ?? this.fileName,
				),
			);
			return commits;
		}

		if (this.workingTreeStatus == null && this.indexStatus == null) return commits;

		const user = await Container.git.getCurrentUser(this.repoPath);
		if (this.workingTreeStatus != null && this.indexStatus != null) {
			commits.push(
				new GitLogCommit(
					GitCommitType.LogFile,
					this.repoPath,
					GitRevision.uncommitted,
					'You',
					user?.email ?? undefined,
					new Date(),
					new Date(),
					'',
					this.fileName,
					[this],
					this.status,
					this.originalFileName,
					GitRevision.uncommittedStaged,
					this.originalFileName ?? this.fileName,
				),
				new GitLogCommit(
					GitCommitType.LogFile,
					this.repoPath,
					GitRevision.uncommittedStaged,
					'You',
					user != null ? user.email : undefined,
					new Date(),
					new Date(),
					'',
					this.fileName,
					[this],
					this.status,
					this.originalFileName,
					'HEAD',
					this.originalFileName ?? this.fileName,
				),
			);
		} else {
			commits.push(
				new GitLogCommit(
					GitCommitType.LogFile,
					this.repoPath,
					this.workingTreeStatus != null ? GitRevision.uncommitted : GitRevision.uncommittedStaged,
					'You',
					user?.email ?? undefined,
					new Date(),
					new Date(),
					'',
					this.fileName,
					[this],
					this.status,
					this.originalFileName,
					'HEAD',
					this.originalFileName ?? this.fileName,
				),
			);
		}

		return commits;
	}

	with(changes: {
		conflictStatus?: GitFileConflictStatus | null;
		indexStatus?: GitFileIndexStatus | null;
		workTreeStatus?: GitFileWorkingTreeStatus | null;
		fileName?: string;
		originalFileName?: string | null;
	}): GitStatusFile {
		const working = this.getChangedValue(changes.workTreeStatus, this.workingTreeStatus);

		let status: string;
		switch (working) {
			case GitFileWorkingTreeStatus.Untracked:
				status = '??';
				break;
			case GitFileWorkingTreeStatus.Ignored:
				status = '!!';
				break;
			default:
				status =
					this.getChangedValue(changes.conflictStatus, this.conflictStatus) ??
					`${this.getChangedValue(changes.indexStatus, this.indexStatus) ?? ' '}${working ?? ' '}`;
				break;
		}

		return new GitStatusFile(
			this.repoPath,
			status[0]?.trim() || undefined,
			status[1]?.trim() || undefined,
			changes.fileName ?? this.fileName,
			this.getChangedValue(changes.originalFileName, this.originalFileName),
		);
	}

	protected getChangedValue<T>(change: T | null | undefined, original: T | undefined): T | undefined {
		if (change === undefined) return original;
		return change !== null ? change : undefined;
	}
}
