/* eslint-disable @typescript-eslint/no-restricted-imports */ /* TODO need to deal with sharing rich class shapes to webviews */
import type { Uri } from 'vscode';
import type { Container } from '../../container';
import { memoize } from '../../system/decorators/-webview/memoize';
import { createUncommittedChangesCommit } from '../utils/-webview/commit.utils';
import { getGitFileFormattedDirectory, getGitFileFormattedPath } from '../utils/-webview/file.utils';
import { getGitFileStatusText } from '../utils/fileStatus.utils';
import type { GitCommit } from './commit';
import type { GitFile } from './file';
import { GitFileChange } from './fileChange';
import type { GitFileStatus } from './fileStatus';
import { GitFileConflictStatus, GitFileIndexStatus, GitFileWorkingTreeStatus } from './fileStatus';
import { uncommitted, uncommittedStaged } from './revision';
import type { GitUser } from './user';

export class GitStatusFile implements GitFile {
	public readonly conflictStatus: GitFileConflictStatus | undefined;
	public readonly indexStatus: GitFileIndexStatus | undefined;
	public readonly workingTreeStatus: GitFileWorkingTreeStatus | undefined;

	constructor(
		private readonly container: Container,
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
					// case '?':
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

	get conflicted(): boolean {
		return this.conflictStatus != null;
	}

	get staged(): boolean {
		return this.indexStatus != null;
	}

	@memoize()
	get status(): GitFileStatus {
		return (this.conflictStatus ?? this.indexStatus ?? this.workingTreeStatus)!;
	}

	@memoize()
	get uri(): Uri {
		return this.container.git.getAbsoluteUri(this.path, this.repoPath);
	}

	get wip(): boolean {
		return this.workingTreeStatus != null;
	}

	getFormattedDirectory(includeOriginal: boolean = false): string {
		return getGitFileFormattedDirectory(this, includeOriginal);
	}

	getFormattedPath(options: { relativeTo?: string; suffix?: string; truncateTo?: number } = {}): string {
		return getGitFileFormattedPath(this, options);
	}

	getStatusText(): string {
		return getGitFileStatusText(this.status);
	}

	getPseudoCommits(container: Container, user: GitUser | undefined): GitCommit[] {
		let now = new Date();

		if (this.conflicted) {
			const file = new GitFileChange(
				container,
				this.repoPath,
				this.path,
				this.status,
				this.originalPath,
				'HEAD',
				undefined,
				false,
			);
			return [
				createUncommittedChangesCommit(container, this.repoPath, uncommitted, now, user, {
					files: { file: file, files: [file] },
					parents: ['HEAD'],
				}),
			];
		}

		const commits: GitCommit[] = [];
		const staged = this.staged;

		if (this.wip) {
			const previousSha = staged ? uncommittedStaged : 'HEAD';
			const file = new GitFileChange(
				this.container,
				this.repoPath,
				this.path,
				this.workingTreeStatus ?? this.status,
				this.originalPath,
				previousSha,
				undefined,
				false,
			);
			commits.push(
				createUncommittedChangesCommit(container, this.repoPath, uncommitted, now, user, {
					files: { file: file, files: [file] },
					parents: [previousSha],
				}),
			);

			// Decrements the date to guarantee the staged entry (if exists) will be sorted after the working entry (most recent first)
			now = new Date(now.getTime() - 60000);
		}

		if (staged) {
			const file = new GitFileChange(
				this.container,
				this.repoPath,
				this.path,
				this.indexStatus ?? this.status,
				this.originalPath,
				'HEAD',
				undefined,
				true,
			);
			commits.push(
				createUncommittedChangesCommit(container, this.repoPath, uncommittedStaged, now, user, {
					files: { file: file, files: [file] },
					parents: ['HEAD'],
				}),
			);
		}

		return commits;
	}

	getPseudoFileChanges(): GitFileChange[] {
		if (this.conflicted) {
			return [
				new GitFileChange(
					this.container,
					this.repoPath,
					this.path,
					this.status,
					this.originalPath,
					'HEAD',
					undefined,
					false,
				),
			];
		}

		const files: GitFileChange[] = [];
		const staged = this.staged;

		if (this.wip) {
			files.push(
				new GitFileChange(
					this.container,

					this.repoPath,
					this.path,
					this.status,
					this.originalPath,
					staged ? uncommittedStaged : 'HEAD',
					undefined,
					false,
				),
			);
		}

		if (staged) {
			files.push(
				new GitFileChange(
					this.container,
					this.repoPath,
					this.path,
					this.status,
					this.originalPath,
					'HEAD',
					undefined,
					true,
				),
			);
		}

		return files;
	}
}
