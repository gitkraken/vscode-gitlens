import type { Disposable } from 'vscode';
import { window } from 'vscode';
import { RevealInSideBarQuickInputButton, ShowDetailsViewQuickInputButton } from '../commands/quickCommand.buttons';
import * as StashActions from '../git/actions/stash';
import type { GitStashCommit } from '../git/models/commit';
import { Repository } from '../git/models/repository';
import { getQuickPickIgnoreFocusOut } from '../system/-webview/vscode';
import type { CommitQuickPickItem } from './items/gitWizard';
import { createStashQuickPickItem } from './items/gitWizard';

export async function showStashPicker(
	title: string | undefined,
	placeholder?: string,
	repository?: Repository | Repository[],
	options?: {
		filter?: (b: GitStashCommit) => boolean;
	},
): Promise<GitStashCommit | undefined> {
	if (repository == null) {
		return undefined;
	}

	if (repository instanceof Repository) {
		repository = [repository];
	}

	let stashes: GitStashCommit[] = [];
	for (const repo of repository) {
		const stash = await repo.git.stash()?.getStash();
		if (stash == null || stash.stashes.size === 0) {
			continue;
		}

		stashes.push(...stash.stashes.values());
	}

	if (options?.filter != null) {
		stashes = stashes.filter(options.filter);
	}

	if (stashes.length === 0) {
		return undefined;
	}

	const items: CommitQuickPickItem<GitStashCommit>[] = stashes.map(stash =>
		createStashQuickPickItem(stash, false, {
			buttons: [ShowDetailsViewQuickInputButton, RevealInSideBarQuickInputButton],
			compact: true,
			icon: true,
		}),
	);

	const quickpick = window.createQuickPick<CommitQuickPickItem<GitStashCommit>>();
	quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();
	const disposables: Disposable[] = [];

	try {
		const pick = await new Promise<CommitQuickPickItem<GitStashCommit> | undefined>(resolve => {
			disposables.push(
				quickpick.onDidHide(() => resolve(undefined)),
				quickpick.onDidAccept(() => {
					if (quickpick.activeItems.length !== 0) {
						resolve(quickpick.activeItems[0]);
					}
				}),
				quickpick.onDidTriggerItemButton(e => {
					if (e.button === ShowDetailsViewQuickInputButton) {
						void StashActions.showDetailsView(e.item.item, { pin: false, preserveFocus: true });
					} else if (e.button === RevealInSideBarQuickInputButton) {
						void StashActions.reveal(e.item.item, {
							select: true,
							focus: false,
							expand: true,
						});
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
