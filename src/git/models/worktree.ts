import type { Uri, WorkspaceFolder } from 'vscode';
import { workspace } from 'vscode';
import { Container } from '../../container';
import { formatDate, fromNow } from '../../system/date';
import { memoize } from '../../system/decorators/memoize';
import { normalizePath } from '../../system/path';
import { relative } from '../../system/vscode/path';
import { getWorkspaceFriendlyPath } from '../../system/vscode/utils';
import type { GitBranch } from './branch';
import { shortenRevision } from './revision.utils';
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

	get date(): Date | undefined {
		return this.branch?.date;
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

	get hasChanges(): boolean | undefined {
		return this._status?.hasChanges;
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

	private _status: GitStatus | undefined;
	private _statusPromise: Promise<GitStatus | undefined> | undefined;
	async getStatus(options?: { force?: boolean }): Promise<GitStatus | undefined> {
		if (this.type === 'bare') return Promise.resolve(undefined);

		if (this._statusPromise == null || options?.force) {
			// eslint-disable-next-line no-async-promise-executor
			this._statusPromise = new Promise(async (resolve, reject) => {
				try {
					const status = await Container.instance.git.getStatus(this.uri.fsPath);
					this._status = status;
					resolve(status);
				} catch (ex) {
					// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
					reject(ex);
				}
			});
		}
		return this._statusPromise;
	}
}

export function getWorktreeId(repoPath: string, name: string): string {
	return `${repoPath}|worktrees/${name}`;
}

export function isWorktree(worktree: any): worktree is GitWorktree {
	return worktree instanceof GitWorktree;
}
