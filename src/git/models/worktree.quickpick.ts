import type { QuickInputButton } from 'vscode';
import { ThemeIcon } from 'vscode';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import type { QuickPickItemOfT } from '../../quickpicks/items/common';
import { pad } from '../../system/string';
import { getBranchIconPath } from '../utils/icons';
import { shortenRevision } from './revision.utils';
import type { GitStatus } from './status';
import type { GitWorktree } from './worktree';

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
