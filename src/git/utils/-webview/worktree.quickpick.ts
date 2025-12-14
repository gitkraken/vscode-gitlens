import type { QuickInputButton } from 'vscode';
import { ThemeIcon } from 'vscode';
import { GlyphChars } from '../../../constants';
import { Container } from '../../../container';
import type { QuickPickItemOfT } from '../../../quickpicks/items/common';
import { pad } from '../../../system/string';
import type { GitWorktree } from '../../models/worktree';
import { shortenRevision } from '../revision.utils';
import { getBranchIconPath } from './icons';

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
		hasChanges?: boolean | undefined;
		includeStatus?: boolean;
		message?: boolean;
		path?: boolean;
		type?: boolean;
	},
): WorktreeQuickPickItem {
	let description = '';
	let detail = '';
	if (options?.type) {
		description = 'worktree';
	}

	if (options?.includeStatus) {
		let status = '';
		let blank = 0;
		if (worktree.branch?.upstream?.missing) {
			status += GlyphChars.Warning;
			blank += 3;
		} else {
			if (worktree.branch?.upstream?.state.behind) {
				status += GlyphChars.ArrowDown;
			} else {
				blank += 2;
			}

			if (worktree.branch?.upstream?.state.ahead) {
				status += GlyphChars.ArrowUp;
			} else {
				blank += 2;
			}

			if (options?.hasChanges) {
				status += '\u00B1';
			} else {
				blank += 2;
			}
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
		hasChanges: options?.hasChanges,
		opened: worktree.opened,
		iconPath: iconPath,
	};

	return item;
}
