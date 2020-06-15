'use strict';
import { Uri } from 'vscode';
import { GitBranch, GitTrackingState } from './branch';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { GitFile, GitFileStatus } from './file';
import { GitUri } from '../gitUri';
import { GitCommitType, GitLogCommit, GitRevision } from './models';
import { memoize, Strings } from '../../system';

export interface ComputedWorkingTreeGitStatus {
	staged: number;
	stagedAddsAndChanges: GitStatusFile[];
	stagedStatus: string;

	unstaged: number;
	unstagedAddsAndChanges: GitStatusFile[];
	unstagedStatus: string;
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
	) {
		this.detached = GitBranch.isDetached(branch);
		if (this.detached) {
			this.branch = GitBranch.formatDetached(this.sha);
		}
	}

	get ref() {
		return this.detached ? this.sha : this.branch;
	}

	@memoize()
	computeWorkingTreeStatus(): ComputedWorkingTreeGitStatus {
		let stagedAdds = 0;
		let unstagedAdds = 0;
		let stagedChanges = 0;
		let unstagedChanges = 0;
		let stagedDeletes = 0;
		let unstagedDeletes = 0;

		const stagedAddsAndChanges: GitStatusFile[] = [];
		const unstagedAddsAndChanges: GitStatusFile[] = [];

		for (const f of this.files) {
			switch (f.indexStatus) {
				case 'A':
				case '?':
					stagedAdds++;
					stagedAddsAndChanges.push(f);
					break;

				case 'D':
					stagedDeletes++;
					break;

				case undefined:
					break;

				default:
					stagedChanges++;
					stagedAddsAndChanges.push(f);
					break;
			}

			switch (f.workingTreeStatus) {
				case 'A':
				case '?':
					unstagedAdds++;
					unstagedAddsAndChanges.push(f);
					break;

				case 'D':
					unstagedDeletes++;
					break;

				case undefined:
					break;

				default:
					unstagedChanges++;
					unstagedAddsAndChanges.push(f);
					break;
			}
		}

		const staged = stagedAdds + stagedChanges + stagedDeletes;
		const unstaged = unstagedAdds + unstagedChanges + unstagedDeletes;

		return {
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

	getUpstreamStatus(options: {
		empty?: string;
		expand?: boolean;
		prefix?: string;
		separator?: string;
		suffix?: string;
	}): string {
		return GitStatus.getUpstreamStatus(this.upstream, this.state, options);
	}

	static getUpstreamStatus(
		upstream: string | undefined,
		state: { ahead: number; behind: number },
		options: { empty?: string; expand?: boolean; prefix?: string; separator?: string; suffix?: string } = {},
	): string {
		if (upstream == null || (state.behind === 0 && state.ahead === 0)) return options.empty ?? '';

		const { expand, prefix = '', separator = ' ', suffix = '' } = options;
		if (expand) {
			let status = '';
			if (state.behind) {
				status += `${Strings.pluralize('commit', state.behind)} behind`;
			}
			if (state.ahead) {
				status += `${status.length === 0 ? '' : separator}${Strings.pluralize('commit', state.ahead)} ahead`;
			}
			return `${prefix}${status}${suffix}`;
		}

		return `${prefix}${state.behind}${GlyphChars.ArrowDown}${separator}${state.ahead}${GlyphChars.ArrowUp}${suffix}`;
	}
}

export class GitStatusFile implements GitFile {
	constructor(
		public readonly repoPath: string,
		public readonly indexStatus: GitFileStatus | undefined,
		public readonly workingTreeStatus: GitFileStatus | undefined,
		public readonly fileName: string,
		public readonly originalFileName?: string,
	) {}

	get edited() {
		return this.workingTreeStatus != null;
	}

	get status(): GitFileStatus {
		return this.indexStatus ?? this.workingTreeStatus ?? '?';
	}

	get staged() {
		return this.indexStatus != null;
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
		if (this.workingTreeStatus == null && this.indexStatus == null) return [];

		const commits = [];

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
		indexStatus?: GitFileStatus | null;
		workTreeStatus?: GitFileStatus | null;
		fileName?: string;
		originalFileName?: string | null;
	}): GitStatusFile {
		return new GitStatusFile(
			this.repoPath,
			this.getChangedValue(changes.indexStatus, this.indexStatus) as GitFileStatus,
			this.getChangedValue(changes.workTreeStatus, this.workingTreeStatus) as GitFileStatus,
			changes.fileName ?? this.fileName,
			this.getChangedValue(changes.originalFileName, this.originalFileName),
		);
	}

	protected getChangedValue<T>(change: T | null | undefined, original: T | undefined): T | undefined {
		if (change === undefined) return original;
		return change !== null ? change : undefined;
	}
}
