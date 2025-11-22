/* eslint-disable @typescript-eslint/no-restricted-imports -- TODO need to deal with sharing rich class shapes to webviews */
import type { Uri, WorkspaceFolder } from 'vscode';
import { workspace } from 'vscode';
import type { Container } from '../../container';
import { relative } from '../../system/-webview/path';
import { getWorkspaceFriendlyPath } from '../../system/-webview/vscode/workspaces';
import { formatDate, fromNow } from '../../system/date';
import { memoize } from '../../system/decorators/memoize';
import { getLoggableName } from '../../system/logger';
import { normalizePath } from '../../system/path';
import { getRepositoryOrWorktreePath } from '../utils/-webview/repository.utils';
import { shortenRevision } from '../utils/revision.utils';
import type { GitBranch } from './branch';
import type { GitStatus } from './status';

export class GitWorktree {
	constructor(
		private readonly container: Container,
		public readonly isDefault: boolean,
		public readonly type: 'bare' | 'branch' | 'detached',
		public readonly repoPath: string,
		public readonly uri: Uri,
		public readonly locked: boolean | string,
		public readonly prunable: boolean | string,
		public readonly sha?: string,
		public readonly branch?: GitBranch,
	) {}

	toString(): string {
		return `${getLoggableName(this)}(${this.uri.toString()})`;
	}

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

	get path(): string {
		return getRepositoryOrWorktreePath(this.uri);
	}

	@memoize()
	get friendlyPath(): string {
		const folder = this.workspaceFolder;
		if (folder != null) return getWorkspaceFriendlyPath(this.uri);

		const relativePath = normalizePath(relative(this.repoPath, this.uri.fsPath));
		return relativePath || normalizePath(this.uri.fsPath);
	}

	get formattedDate(): string {
		return this.container.BranchDateFormatting.dateStyle === 'absolute'
			? this.formatDate(this.container.BranchDateFormatting.dateFormat)
			: this.formatDateFromNow();
	}

	private _hasWorkingChanges: boolean | undefined;
	get hasChanges(): boolean | undefined {
		return this._hasWorkingChanges;
	}

	get opened(): boolean {
		return this.workspaceFolder?.uri.toString() === this.uri.toString();
	}

	get name(): string {
		switch (this.type) {
			case 'bare':
				return '(bare)';
			case 'detached':
				return shortenRevision(this.sha);
			default:
				return this.branch?.name || this.friendlyPath;
		}
	}

	@memoize()
	get workspaceFolder(): WorkspaceFolder | undefined {
		return workspace.getWorkspaceFolder(this.uri);
	}

	@memoize<GitWorktree['formatDate']>(format => format ?? 'MMMM Do, YYYY h:mma')
	formatDate(format?: string | null): string {
		return this.date != null ? formatDate(this.date, format ?? 'MMMM Do, YYYY h:mma') : '';
	}

	formatDateFromNow(): string {
		return this.date != null ? fromNow(this.date) : '';
	}

	private _statusPromise: Promise<GitStatus | undefined> | undefined;
	async getStatus(options?: { force?: boolean }): Promise<GitStatus | undefined> {
		if (this.type === 'bare') return Promise.resolve(undefined);

		if (this._statusPromise == null || options?.force) {
			// eslint-disable-next-line no-async-promise-executor
			this._statusPromise = new Promise(async (resolve, reject) => {
				try {
					const status = await this.container.git.getRepositoryService(this.uri.fsPath).status.getStatus();
					if (status != null) {
						this._hasWorkingChanges = status.hasChanges;
					}
					resolve(status);
				} catch (ex) {
					// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
					reject(ex);
				}
			});
		}
		return this._statusPromise;
	}

	private _hasWorkingChangesPromise: Promise<boolean | undefined> | undefined;
	async hasWorkingChanges(options?: {
		force?: boolean;
		staged?: boolean;
		unstaged?: boolean;
		untracked?: boolean;
	}): Promise<boolean | undefined> {
		if (this.type === 'bare') return Promise.resolve(undefined);

		if (this._hasWorkingChangesPromise == null || options?.force) {
			this._hasWorkingChangesPromise = this.container.git
				.getRepositoryService(this.uri.fsPath)
				.status?.hasWorkingChanges({
					staged: options?.staged,
					unstaged: options?.unstaged,
					untracked: options?.untracked,
				});
		}
		return this._hasWorkingChangesPromise;
	}
}

export function isWorktree(worktree: any): worktree is GitWorktree {
	return worktree instanceof GitWorktree;
}
