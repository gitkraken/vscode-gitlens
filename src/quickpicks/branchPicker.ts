import type { Disposable } from 'vscode';
import { window } from 'vscode';
import { getBranches } from '../commands/quickCommand.steps';
import type { Repository } from '../git/models/repository';
import { getQuickPickIgnoreFocusOut } from '../system/utils';
import type { BranchQuickPickItem } from './items/gitCommands';

export async function showBranchPicker(
	title: string | undefined,
	placeholder?: string,
	repository?: Repository,
): Promise<BranchQuickPickItem | undefined> {
	if (repository == null) {
		return undefined;
	}

	const items: BranchQuickPickItem[] = await getBranches(repository, {});
	if (items.length === 0) return undefined;

	const quickpick = window.createQuickPick<BranchQuickPickItem>();
	quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();

	const disposables: Disposable[] = [];

	try {
		const pick = await new Promise<BranchQuickPickItem | undefined>(resolve => {
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
		if (pick == null) return undefined;

		return pick;
	} finally {
		quickpick.dispose();
		disposables.forEach(d => void d.dispose());
	}
}
