import { formatDate, fromNow } from '@gitlens/utils/date.js';
import { loggable } from '@gitlens/utils/decorators/log.js';
import { memoize } from '@gitlens/utils/decorators/memoize.js';
import { serializable } from '@gitlens/utils/decorators/serializable.js';
import { basename, normalizePath, relative } from '@gitlens/utils/path.js';
import type { Shape } from '@gitlens/utils/types.js';
import type { Uri } from '@gitlens/utils/uri.js';
import { getRepositoryService } from '../repositoryService.js';
import { getRepositoryOrWorktreePath } from '../utils/repository.utils.js';
import { shortenRevision } from '../utils/revision.utils.js';
import type { GitBranch } from './branch.js';
import type { GitStatus } from './status.js';

export type GitWorktreeShape = Shape<GitWorktree>;

export type WorkspaceFolderResolver = (uri: Uri) => GitWorktree['workspaceFolder'] | undefined;

@loggable(i => i.uri.toString())
@serializable
export class GitWorktree {
	constructor(
		public readonly isDefault: boolean,
		public readonly type: 'bare' | 'branch' | 'detached',
		public readonly repoPath: string,
		public readonly uri: Uri,
		public readonly locked: boolean | string,
		public readonly prunable: boolean | string,
		public readonly sha?: string,
		public readonly branch?: GitBranch,
		public readonly workspaceFolder?: { readonly uri: Uri; readonly name: string },
	) {}

	get date(): Date | undefined {
		return this.branch?.date;
	}

	/** @returns The most recent date among lastModifiedDate, lastAccessedDate, and branch.date */
	@memoize()
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

		const date = this.branch?.date?.getTime();
		if (date != null && (maxTime == null || date > maxTime)) {
			maxTime = date;
		}

		return maxTime != null ? new Date(maxTime) : undefined;
	}

	/** Timestamp when the worktree branch was last accessed or modified */
	get lastAccessedDate(): Date | undefined {
		return this.branch?.lastAccessedDate;
	}

	/** Timestamp when the worktree branch was last modified (working changes / index) */
	get lastModifiedDate(): Date | undefined {
		return this.branch?.lastModifiedDate;
	}

	@memoize()
	get friendlyPath(): string {
		if (this.workspaceFolder != null) {
			const relativePath = normalizePath(relative(this.workspaceFolder.uri.fsPath, this.uri.fsPath));
			return relativePath || this.workspaceFolder.name;
		}
		const relativePath = normalizePath(relative(this.repoPath, this.uri.fsPath));
		return relativePath || normalizePath(this.uri.fsPath);
	}

	@memoize()
	get name(): string {
		switch (this.type) {
			case 'bare':
				return '(bare)';
			case 'detached':
				return `${basename(this.path)} (${shortenRevision(this.sha)})`;
			default:
				return this.branch?.name || this.friendlyPath;
		}
	}

	get opened(): boolean {
		return this.workspaceFolder?.uri.toString() === this.uri.toString();
	}

	get path(): string {
		return getRepositoryOrWorktreePath(this.uri);
	}

	/** Creates a copy of this worktree with a different repoPath and updated branch — ONLY used for worktree-aware caching */
	withRepoPath(repoPath: string): GitWorktree {
		if (repoPath === this.repoPath) return this;

		return new GitWorktree(
			this.isDefault,
			this.type,
			repoPath,
			this.uri,
			this.locked,
			this.prunable,
			this.sha,
			this.branch?.withRepoPath(repoPath, true),
			this.workspaceFolder,
		);
	}

	static is(worktree: unknown): worktree is GitWorktree {
		return worktree instanceof GitWorktree;
	}

	static formatDate(worktree: GitWorktreeShape, format?: string | null): string {
		return worktree.date != null ? formatDate(worktree.date, format ?? 'MMMM Do, YYYY h:mma') : '';
	}

	static formatDateFromNow(worktree: GitWorktreeShape): string {
		return worktree.date != null ? fromNow(worktree.date) : '';
	}

	static formatDateWithStyle(
		worktree: GitWorktreeShape,
		formatting: { dateStyle: string; dateFormat: string | null },
	): string {
		return formatting.dateStyle === 'absolute'
			? GitWorktree.formatDate(worktree, formatting.dateFormat)
			: GitWorktree.formatDateFromNow(worktree);
	}

	static async getStatus(worktree: GitWorktree): Promise<GitStatus | undefined> {
		if (worktree.type === 'bare') return undefined;
		const repo = getRepositoryService(worktree.path);
		return repo?.status.getStatus();
	}

	static async hasWorkingChanges(
		worktree: GitWorktree,
		options?: { staged?: boolean; unstaged?: boolean; untracked?: boolean },
	): Promise<boolean | undefined> {
		if (worktree.type === 'bare') return undefined;
		const repo = getRepositoryService(worktree.path);
		return repo?.status.hasWorkingChanges(options);
	}
}
