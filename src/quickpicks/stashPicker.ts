import type { Disposable } from 'vscode';
import { window } from 'vscode';
import { RevealInSideBarQuickInputButton, ShowDetailsViewQuickInputButton } from '../commands/quickCommand.buttons';
import type { Keys } from '../constants';
import { Container } from '../container';
import { revealStash, showStashInDetailsView } from '../git/actions/stash';
import type { GitStashCommit } from '../git/models/commit';
import type { GitStash } from '../git/models/stash';
import type { KeyboardScope } from '../system/-webview/keyboard';
import { getQuickPickIgnoreFocusOut } from '../system/-webview/vscode';
import { filter, map } from '../system/iterable';
import { isPromise } from '../system/promise';
import { CommandQuickPickItem } from './items/common';
import type { DirectiveQuickPickItem } from './items/directive';
import { createDirectiveQuickPickItem, Directive, isDirectiveQuickPickItem } from './items/directive';
import type { CommitQuickPickItem } from './items/gitWizard';
import { createStashQuickPickItem } from './items/gitWizard';

export async function showStashPicker(
	stash: GitStash | Promise<GitStash | undefined> | undefined,
	title: string,
	placeholder: string,
	options?: {
		empty?: string;
		filter?: (s: GitStashCommit) => boolean;
		keyboard?: {
			keys: Keys[];
			onDidPressKey(key: Keys, item: CommitQuickPickItem<GitStashCommit>): void | Promise<void>;
		};
		picked?: string;
		showOtherReferences?: CommandQuickPickItem[];
	},
): Promise<GitStashCommit | undefined> {
	const quickpick = window.createQuickPick<
		CommandQuickPickItem | CommitQuickPickItem<GitStashCommit> | DirectiveQuickPickItem
	>();
	quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();

	quickpick.title = title;
	quickpick.placeholder = placeholder;
	quickpick.matchOnDescription = true;
	quickpick.matchOnDetail = true;

	if (isPromise(stash)) {
		quickpick.busy = true;
		quickpick.show();

		stash = await stash;
	}

	if (stash?.stashes.size) {
		quickpick.items = [
			...(options?.showOtherReferences ?? []),
			...map(
				options?.filter != null ? filter(stash.stashes.values(), options.filter) : stash.stashes.values(),
				stash =>
					createStashQuickPickItem(stash, options?.picked === stash.ref, {
						buttons: [ShowDetailsViewQuickInputButton, RevealInSideBarQuickInputButton],
						compact: true,
						icon: true,
					}),
			),
		];
	}

	if (!stash?.stashes.size || quickpick.items.length <= (options?.showOtherReferences?.length ?? 0)) {
		quickpick.placeholder = !stash?.stashes.size
			? 'No stashes found'
			: (options?.empty ?? `No matching stashes found`);
		quickpick.items = [createDirectiveQuickPickItem(Directive.Cancel)];
	}

	if (options?.picked) {
		quickpick.activeItems = quickpick.items.filter(i => (CommandQuickPickItem.is(i) ? false : i.picked));
	}

	const disposables: Disposable[] = [];

	let scope: KeyboardScope | undefined;
	if (options?.keyboard != null) {
		const { keyboard } = options;
		scope = Container.instance.keyboard.createScope(
			Object.fromEntries(
				keyboard.keys.map(key => [
					key,
					{
						onDidPressKey: async key => {
							if (quickpick.activeItems.length !== 0) {
								const [item] = quickpick.activeItems;
								if (item != null && !isDirectiveQuickPickItem(item) && !CommandQuickPickItem.is(item)) {
									const ignoreFocusOut = quickpick.ignoreFocusOut;
									quickpick.ignoreFocusOut = true;

									await keyboard.onDidPressKey(key, item);

									quickpick.ignoreFocusOut = ignoreFocusOut;
								}
							}
						},
					},
				]),
			),
		);
		void scope.start();
		disposables.push(scope);
	}

	try {
		const pick = await new Promise<
			CommandQuickPickItem | CommitQuickPickItem<GitStashCommit> | DirectiveQuickPickItem | undefined
		>(resolve => {
			disposables.push(
				quickpick.onDidHide(() => resolve(undefined)),
				quickpick.onDidAccept(() => {
					if (quickpick.activeItems.length) {
						const [item] = quickpick.activeItems;
						if (isDirectiveQuickPickItem(item)) {
							resolve(undefined);
							return;
						}

						resolve(item);
					}
				}),
				quickpick.onDidChangeValue(value => {
					if (scope == null) return;

					// Pause the left/right keyboard commands if there is a value, otherwise the left/right arrows won't work in the input properly
					if (value.length !== 0) {
						void scope.pause(['left', 'ctrl+left', 'right', 'ctrl+right']);
					} else {
						void scope.resume();
					}
				}),
				quickpick.onDidTriggerItemButton(e => {
					if (isDirectiveQuickPickItem(e.item) || e.item instanceof CommandQuickPickItem) {
						return;
					}

					if (e.button === ShowDetailsViewQuickInputButton) {
						void showStashInDetailsView(e.item.item, { pin: false, preserveFocus: true });
					} else if (e.button === RevealInSideBarQuickInputButton) {
						void revealStash(e.item.item, { select: true, focus: false, expand: true });
					}
				}),
			);

			quickpick.busy = false;

			quickpick.show();
		});
		if (pick == null || isDirectiveQuickPickItem(pick)) return undefined;
		if (pick instanceof CommandQuickPickItem) {
			void (await pick.execute());

			return undefined;
		}

		return pick.item;
	} finally {
		quickpick.dispose();
		disposables.forEach(d => void d.dispose());
	}
}
