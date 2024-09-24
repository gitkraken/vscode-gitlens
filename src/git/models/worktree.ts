import type { QuickInputButton, Uri, WorkspaceFolder } from 'vscode';
import { ThemeIcon, workspace } from 'vscode';
import type { BranchSorting } from '../../config';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import type { QuickPickItemOfT } from '../../quickpicks/items/common';
import { formatDate, fromNow } from '../../system/date';
import { memoize } from '../../system/decorators/memoize';
import { filterMap } from '../../system/iterable';
import { PageableResult } from '../../system/paging';
import { normalizePath } from '../../system/path';
import { pad, sortCompare } from '../../system/string';
import { configuration } from '../../system/vscode/configuration';
import { relative } from '../../system/vscode/path';
import { getWorkspaceFriendlyPath } from '../../system/vscode/utils';
import { getBranchIconPath } from '../utils/branch-utils';
import type { GitBranch } from './branch';
import { shortenRevision } from './reference';
import type { Repository } from './repository';
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
			iconPath = getBranchIconPath(Container.instance, worktree.branch);
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
	upstreamNames?: string | string[],
	worktrees?: GitWorktree[],
	branches?: PageableResult<GitBranch> | Map<unknown, GitBranch>,
): Promise<GitWorktree | undefined> {
	if (upstreamNames != null && !Array.isArray(upstreamNames)) {
		upstreamNames = [upstreamNames];
	}

	worktrees ??= await repo.git.getWorktrees();
	for (const worktree of worktrees) {
		if (worktree.branch?.name === branchName) return worktree;

		if (upstreamNames == null || worktree.branch == null) continue;

		branches ??= new PageableResult<GitBranch>(p => repo.git.getBranches(p != null ? { paging: p } : undefined));
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

export function getWorktreeId(repoPath: string, name: string): string {
	return `${repoPath}|worktrees/${name}`;
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

export async function getWorktreesByBranch(
	repos: Repository | Repository[] | undefined,
	options?: { includeDefault?: boolean },
) {
	const worktreesByBranch = new Map<string, GitWorktree>();
	if (repos == null) return worktreesByBranch;

	async function addWorktrees(repo: Repository) {
		groupWorktreesByBranch(await repo.git.getWorktrees(), {
			includeDefault: options?.includeDefault,
			worktreesByBranch: worktreesByBranch,
		});
	}

	if (!Array.isArray(repos)) {
		await addWorktrees(repos);
	} else {
		await Promise.allSettled(repos.map(async r => addWorktrees(r)));
	}

	return worktreesByBranch;
}

export function groupWorktreesByBranch(
	worktrees: GitWorktree[],
	options?: { includeDefault?: boolean; worktreesByBranch?: Map<string, GitWorktree> },
) {
	const worktreesByBranch = options?.worktreesByBranch ?? new Map<string, GitWorktree>();
	if (worktrees == null) return worktreesByBranch;

	for (const wt of worktrees) {
		if (wt.branch == null || (!options?.includeDefault && wt.isDefault)) continue;

		worktreesByBranch.set(wt.branch.id, wt);
	}

	return worktreesByBranch;
}

export function getOpenedWorktreesByBranch(
	worktreesByBranch: Map<string, GitWorktree> | undefined,
): Set<string> | undefined {
	let openedWorktreesByBranch: Set<string> | undefined;
	if (worktreesByBranch?.size) {
		openedWorktreesByBranch = new Set(filterMap(worktreesByBranch, ([id, wt]) => (wt.opened ? id : undefined)));
		if (!openedWorktreesByBranch.size) {
			openedWorktreesByBranch = undefined;
		}
	}
	return openedWorktreesByBranch;
}
