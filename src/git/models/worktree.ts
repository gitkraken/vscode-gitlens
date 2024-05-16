import type { QuickInputButton, Uri, WorkspaceFolder } from 'vscode';
import { ThemeIcon, workspace } from 'vscode';
import type { BranchSorting } from '../../config';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import type { QuickPickItemOfT } from '../../quickpicks/items/common';
import { configuration } from '../../system/configuration';
import { formatDate, fromNow } from '../../system/date';
import { memoize } from '../../system/decorators/memoize';
import { PageableResult } from '../../system/paging';
import { normalizePath, relative } from '../../system/path';
import { pad, sortCompare } from '../../system/string';
import { getWorkspaceFriendlyPath } from '../../system/utils';
import type { GitBranch } from './branch';
import { shortenRevision } from './reference';
import type { Repository } from './repository';
import type { GitStatus } from './status';

export class GitWorktree {
	constructor(
		private readonly container: Container,
		public readonly main: boolean,
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
					const status = await Container.instance.git.getStatusForRepo(this.uri.fsPath);
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

export interface WorktreeQuickPickItem extends QuickPickItemOfT<GitWorktree> {
	readonly opened: boolean;
	readonly hasChanges: boolean | undefined;
}

export function createWorktreeQuickPickItem(
	worktree: GitWorktree,
	picked?: boolean,
	missing?: boolean,
	options?: {
		alwaysShow?: boolean;
		buttons?: QuickInputButton[];
		checked?: boolean;
		includeStatus?: boolean;
		message?: boolean;
		path?: boolean;
		type?: boolean;
		status?: GitStatus;
	},
) {
	let description = '';
	let detail = '';
	if (options?.type) {
		description = 'worktree';
	}

	if (options?.includeStatus) {
		let status = '';
		let blank = 0;
		if (options?.status != null) {
			if (options.status.upstream?.missing) {
				status += GlyphChars.Warning;
				blank += 3;
			} else {
				if (options.status.state.behind) {
					status += GlyphChars.ArrowDown;
				} else {
					blank += 2;
				}

				if (options.status.state.ahead) {
					status += GlyphChars.ArrowUp;
				} else {
					blank += 2;
				}

				if (options.status.hasChanges) {
					status += '\u00B1';
				} else {
					blank += 2;
				}
			}
		} else {
			blank += 6;
		}

		if (blank > 0) {
			status += ' '.repeat(blank);
		}

		const formattedDate = worktree.formattedDate;
		if (formattedDate) {
			if (description) {
				description += `  ${GlyphChars.Dot}  ${worktree.formattedDate}`;
			} else {
				description = formattedDate;
			}
		}

		if (status) {
			detail += detail ? `  ${GlyphChars.Dot}  ${status}` : status;
		}
	}

	let iconPath;
	let label;
	switch (worktree.type) {
		case 'bare':
			label = '(bare)';
			iconPath = new ThemeIcon('folder');
			break;
		case 'branch':
			label = worktree.branch?.name ?? 'unknown';
			iconPath = new ThemeIcon('git-branch');
			break;
		case 'detached':
			label = shortenRevision(worktree.sha);
			iconPath = new ThemeIcon('git-commit');
			break;
	}

	const item: WorktreeQuickPickItem = {
		label: options?.checked ? `${label}${pad('$(check)', 2)}` : label,
		description: description ? ` ${description}` : undefined,
		detail: options?.path
			? `${detail ? `${detail}  ` : ''}${missing ? `${GlyphChars.Warning} (missing)` : '$(folder)'} ${
					worktree.friendlyPath
			  }`
			: detail,
		alwaysShow: options?.alwaysShow,
		buttons: options?.buttons,
		picked: picked,
		item: worktree,
		opened: worktree.opened,
		hasChanges: options?.status?.hasChanges,
		iconPath: iconPath,
	};

	return item;
}

export async function getWorktreeForBranch(
	repo: Repository,
	branchName: string,
	upstreamNames: string | string[],
	worktrees?: GitWorktree[],
	branches?: PageableResult<GitBranch> | Map<unknown, GitBranch>,
): Promise<GitWorktree | undefined> {
	if (upstreamNames != null && !Array.isArray(upstreamNames)) {
		upstreamNames = [upstreamNames];
	}

	worktrees ??= await repo.getWorktrees();
	for (const worktree of worktrees) {
		if (worktree.branch?.name === branchName) return worktree;

		if (upstreamNames == null || worktree.branch == null) continue;

		branches ??= new PageableResult<GitBranch>(p => repo.getBranches(p != null ? { paging: p } : undefined));
		for await (const branch of branches.values()) {
			if (branch.name === worktree.branch.name) {
				if (
					branch.upstream?.name != null &&
					(upstreamNames.includes(branch.upstream.name) ||
						(branch.upstream.name.startsWith('remotes/') &&
							upstreamNames.includes(branch.upstream.name.substring(8))))
				) {
					return worktree;
				}

				break;
			}
		}
	}

	return undefined;
}

export function isWorktree(worktree: any): worktree is GitWorktree {
	return worktree instanceof GitWorktree;
}

export interface WorktreeSortOptions {
	orderBy?: BranchSorting;
}
export function sortWorktrees(worktrees: GitWorktree[], options?: WorktreeSortOptions): GitWorktree[];
export function sortWorktrees(
	worktrees: WorktreeQuickPickItem[],
	options?: WorktreeSortOptions,
): WorktreeQuickPickItem[];
export function sortWorktrees(worktrees: GitWorktree[] | WorktreeQuickPickItem[], options?: WorktreeSortOptions) {
	options = { orderBy: configuration.get('sortBranchesBy'), ...options };

	const getWorktree = (worktree: GitWorktree | WorktreeQuickPickItem): GitWorktree => {
		return isWorktree(worktree) ? worktree : worktree.item;
	};

	switch (options.orderBy) {
		case 'date:asc':
			return worktrees.sort((a, b) => {
				a = getWorktree(a);
				b = getWorktree(b);

				return (
					(a.opened ? -1 : 1) - (b.opened ? -1 : 1) ||
					(a.hasChanges === null ? 0 : a.hasChanges ? -1 : 1) -
						(b.hasChanges === null ? 0 : b.hasChanges ? -1 : 1) ||
					(a.date == null ? -1 : a.date.getTime()) - (b.date == null ? -1 : b.date.getTime()) ||
					sortCompare(a.name, b.name)
				);
			});
		case 'name:asc':
			return worktrees.sort((a, b) => {
				a = getWorktree(a);
				b = getWorktree(b);

				return (
					(a.opened ? -1 : 1) - (b.opened ? -1 : 1) ||
					(a.hasChanges === null ? 0 : a.hasChanges ? -1 : 1) -
						(b.hasChanges === null ? 0 : b.hasChanges ? -1 : 1) ||
					(a.name === 'main' ? -1 : 1) - (b.name === 'main' ? -1 : 1) ||
					(a.name === 'master' ? -1 : 1) - (b.name === 'master' ? -1 : 1) ||
					(a.name === 'develop' ? -1 : 1) - (b.name === 'develop' ? -1 : 1) ||
					sortCompare(a.name, b.name)
				);
			});
		case 'name:desc':
			return worktrees.sort((a, b) => {
				a = getWorktree(a);
				b = getWorktree(b);

				return (
					(a.opened ? -1 : 1) - (b.opened ? -1 : 1) ||
					(a.hasChanges === null ? 0 : a.hasChanges ? -1 : 1) -
						(b.hasChanges === null ? 0 : b.hasChanges ? -1 : 1) ||
					(a.name === 'main' ? -1 : 1) - (b.name === 'main' ? -1 : 1) ||
					(a.name === 'master' ? -1 : 1) - (b.name === 'master' ? -1 : 1) ||
					(a.name === 'develop' ? -1 : 1) - (b.name === 'develop' ? -1 : 1) ||
					sortCompare(b.name, a.name)
				);
			});
		case 'date:desc':
		default:
			return worktrees.sort((a, b) => {
				a = getWorktree(a);
				b = getWorktree(b);

				return (
					(a.opened ? -1 : 1) - (b.opened ? -1 : 1) ||
					(b.date == null ? -1 : b.date.getTime()) - (a.date == null ? -1 : a.date.getTime()) ||
					(a.hasChanges === null ? 0 : a.hasChanges ? -1 : 1) -
						(b.hasChanges === null ? 0 : b.hasChanges ? -1 : 1) ||
					sortCompare(b.name, a.name)
				);
			});
	}
}
