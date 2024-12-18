import type { Disposable, QuickPickItem } from 'vscode';
import { window } from 'vscode';
import { getBranches } from '../commands/quickCommand.steps';
import type { GitBranch } from '../git/models/branch';
import type { Repository } from '../git/models/repository';
import { getQuickPickIgnoreFocusOut } from '../system/vscode/utils';
import type { BranchQuickPickItem } from './items/gitWizard';

export async function showBranchPicker(
	title: string | undefined,
	placeholder?: string,
	repository?: Repository | Repository[],
	options?: {
		filter?: (b: GitBranch) => boolean;
	},
): Promise<GitBranch | undefined> {
	if (repository == null) {
		return undefined;
	}

	const items: BranchQuickPickItem[] = await getBranches(repository, options ?? {});
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

		return pick?.item;
	} finally {
		quickpick.dispose();
		disposables.forEach(d => void d.dispose());
	}
}

export async function showNewBranchPicker(
	title: string | undefined,
	placeholder?: string,
	_repository?: Repository,
): Promise<string | undefined> {
	const input = window.createInputBox();
	input.ignoreFocusOut = true;

	const disposables: Disposable[] = [];

	let newBranchName: string | undefined;
	try {
		newBranchName = await new Promise<string | undefined>(resolve => {
			disposables.push(
				input.onDidHide(() => resolve(undefined)),
				input.onDidAccept(() => {
					const value = input.value.trim();
					if (value == null) {
						input.validationMessage = 'Please enter a valid branch name';
						return;
					}

					resolve(value);
				}),
			);

			input.title = title;
			input.placeholder = placeholder;
			input.prompt = 'Enter a name for the new branch';

			input.show();
		});
	} finally {
		input.dispose();
		disposables.forEach(d => void d.dispose());
	}

	return newBranchName;
}

export async function showNewOrSelectBranchPicker(
	title: string | undefined,
	repository?: Repository,
): Promise<GitBranch | string | undefined> {
	if (repository == null) {
		return undefined;
	}

	// TODO: needs updating
	const createNewBranch = {
		label: 'Create new branch',
		description:
			'Creates a branch to apply the Cloud Patch to. (Typing an existing branch name will use that branch.)',
	};
	const selectExistingBranch = {
		label: 'Select existing branch',
		description: 'Selects an existing branch to apply the Cloud Patch to.',
	};

	const items: QuickPickItem[] = [createNewBranch, selectExistingBranch];

	const quickpick = window.createQuickPick<QuickPickItem>();
	quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();

	const disposables: Disposable[] = [];

	try {
		const pick = await new Promise<QuickPickItem | undefined>(resolve => {
			disposables.push(
				quickpick.onDidHide(() => resolve(undefined)),
				quickpick.onDidAccept(() => {
					if (quickpick.activeItems.length !== 0) {
						resolve(quickpick.activeItems[0]);
					}
				}),
			);

			quickpick.title = title;
			quickpick.placeholder = 'Select a branch option';
			quickpick.matchOnDescription = true;
			quickpick.matchOnDetail = true;
			quickpick.items = items;

			quickpick.show();
		});

		if (pick === createNewBranch) {
			return await showNewBranchPicker(title, 'Enter a name for the new branch', repository);
		} else if (pick === selectExistingBranch) {
			return await showBranchPicker(title, 'Select an existing branch', repository);
		}

		return undefined;
	} finally {
		quickpick.dispose();
		disposables.forEach(d => void d.dispose());
	}
}
