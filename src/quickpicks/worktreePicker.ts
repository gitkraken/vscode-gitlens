import type { Disposable } from 'vscode';
import { window } from 'vscode';
import type { GitWorktree } from '@gitlens/git/models/worktree.js';
import type { WorktreeQuickPickItem } from '../git/utils/-webview/worktree.quickpick.js';
import { createWorktreeQuickPickItem } from '../git/utils/-webview/worktree.quickpick.js';
import { getQuickPickIgnoreFocusOut } from '../system/-webview/vscode.js';

export async function showWorktreePicker(
	title: string | undefined,
	placeholder: string | undefined,
	worktrees: GitWorktree[],
	options?: { picked?: string },
): Promise<GitWorktree | undefined> {
	if (worktrees.length === 0) return undefined;

	const items = worktrees.map(wt =>
		createWorktreeQuickPickItem(wt, options?.picked === wt.uri.toString(), false, {
			includeStatus: true,
			path: true,
			type: true,
		}),
	);

	const quickpick = window.createQuickPick<WorktreeQuickPickItem>();
	quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();

	const disposables: Disposable[] = [];

	try {
		const pick = await new Promise<WorktreeQuickPickItem | undefined>(resolve => {
			disposables.push(
				quickpick.onDidHide(() => resolve(undefined)),
				quickpick.onDidAccept(() => {
					if (quickpick.activeItems.length !== 0) {
						resolve(quickpick.activeItems[0]);
					}
				}),
			);

			quickpick.title = title;
			quickpick.placeholder = placeholder;
			quickpick.matchOnDescription = true;
			quickpick.matchOnDetail = true;
			quickpick.items = items;

			quickpick.show();
		});

		return pick?.item;
	} finally {
		quickpick.dispose();
		disposables.forEach(d => void d.dispose());
	}
}
