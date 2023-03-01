import type { Disposable } from 'vscode';
import { window } from 'vscode';
import { Container } from '../container';
import type { GitCommit, GitStashCommit } from '../git/models/commit';
import type { GitLog } from '../git/models/log';
import type { GitStash } from '../git/models/stash';
import { configuration } from '../system/configuration';
import { filter, map } from '../system/iterable';
import type { KeyboardScope, Keys } from '../system/keyboard';
import { isPromise } from '../system/promise';
import { getQuickPickIgnoreFocusOut } from '../system/utils';
import { CommandQuickPickItem } from './items/common';
import type { DirectiveQuickPickItem } from './items/directive';
import { createDirectiveQuickPickItem, Directive, isDirectiveQuickPickItem } from './items/directive';
import type { CommitQuickPickItem } from './items/gitCommands';
import { createCommitQuickPickItem } from './items/gitCommands';

export async function showCommitPicker(
	log: GitLog | undefined | Promise<GitLog | undefined>,
	title: string,
	placeholder: string,
	options?: {
		picked?: string;
		keys?: Keys[];
		onDidPressKey?(key: Keys, item: CommitQuickPickItem): void | Promise<void>;
		showOtherReferences?: CommandQuickPickItem[];
	},
): Promise<GitCommit | undefined> {
	const quickpick = window.createQuickPick<CommandQuickPickItem | CommitQuickPickItem | DirectiveQuickPickItem>();
	quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();

	quickpick.title = title;
	quickpick.placeholder = placeholder;
	quickpick.matchOnDescription = true;
	quickpick.matchOnDetail = true;

	if (isPromise(log)) {
		quickpick.busy = true;
		quickpick.show();

		log = await log;

		if (log == null) {
			quickpick.placeholder = 'Unable to show commit history';
		}
	}

	quickpick.items = getItems(log);

	if (options?.picked) {
		quickpick.activeItems = quickpick.items.filter(i => (CommandQuickPickItem.is(i) ? false : i.picked));
	}

	function getItems(log: GitLog | undefined) {
		return log == null
			? [createDirectiveQuickPickItem(Directive.Cancel)]
			: [
					...(options?.showOtherReferences ?? []),
					...map(log.commits.values(), commit =>
						createCommitQuickPickItem(commit, options?.picked === commit.ref, {
							compact: true,
							icon: true,
						}),
					),
					...(log?.hasMore ? [createDirectiveQuickPickItem(Directive.LoadMore)] : []),
			  ];
	}

	async function loadMore() {
		quickpick.busy = true;

		try {
			log = await (await log)?.more?.(configuration.get('advanced.maxListItems'));
			const items = getItems(log);

			let activeIndex = -1;
			if (quickpick.activeItems.length !== 0) {
				const active = quickpick.activeItems[0];
				activeIndex = quickpick.items.indexOf(active);

				// If the active item is the "Load more" directive, then select the previous item
				if (isDirectiveQuickPickItem(active)) {
					activeIndex--;
				}
			}

			quickpick.items = items;

			if (activeIndex) {
				quickpick.activeItems = [quickpick.items[activeIndex]];
			}
		} finally {
			quickpick.busy = false;
		}
	}

	const disposables: Disposable[] = [];

	let scope: KeyboardScope | undefined;
	if (options?.keys != null && options.keys.length !== 0 && options?.onDidPressKey !== null) {
		scope = Container.instance.keyboard.createScope(
			Object.fromEntries(
				options.keys.map(key => [
					key,
					{
						onDidPressKey: key => {
							if (quickpick.activeItems.length !== 0) {
								const [item] = quickpick.activeItems;
								if (item != null && !isDirectiveQuickPickItem(item) && !CommandQuickPickItem.is(item)) {
									void options.onDidPressKey!(key, item);
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
		const pick = await new Promise<CommandQuickPickItem | CommitQuickPickItem | DirectiveQuickPickItem | undefined>(
			resolve => {
				disposables.push(
					quickpick.onDidHide(() => resolve(undefined)),
					quickpick.onDidAccept(() => {
						if (quickpick.activeItems.length !== 0) {
							const [item] = quickpick.activeItems;
							if (isDirectiveQuickPickItem(item)) {
								switch (item.directive) {
									case Directive.LoadMore:
										void loadMore();
										return;

									default:
										resolve(undefined);
										return;
								}
							}

							resolve(item);
						}
					}),
					quickpick.onDidChangeValue(async e => {
						if (scope == null) return;

						// Pause the left/right keyboard commands if there is a value, otherwise the left/right arrows won't work in the input properly
						if (e.length !== 0) {
							await scope.pause(['left', 'right']);
						} else {
							await scope.resume();
						}
					}),
				);

				quickpick.busy = false;

				quickpick.show();
			},
		);
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

export async function showStashPicker(
	stash: GitStash | undefined | Promise<GitStash | undefined>,
	title: string,
	placeholder: string,
	options?: {
		empty?: string;
		filter?: (c: GitStashCommit) => boolean;
		keys?: Keys[];
		onDidPressKey?(key: Keys, item: CommitQuickPickItem<GitStashCommit>): void | Promise<void>;
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

	if (stash != null) {
		quickpick.items = [
			...(options?.showOtherReferences ?? []),
			...map(
				options?.filter != null ? filter(stash.commits.values(), options.filter) : stash.commits.values(),
				commit =>
					createCommitQuickPickItem(commit, options?.picked === commit.ref, {
						compact: true,
						icon: true,
					}),
			),
		];
	}

	if (stash == null || quickpick.items.length <= (options?.showOtherReferences?.length ?? 0)) {
		quickpick.placeholder = stash == null ? 'No stashes found' : options?.empty ?? `No matching stashes found`;
		quickpick.items = [createDirectiveQuickPickItem(Directive.Cancel)];
	}

	if (options?.picked) {
		quickpick.activeItems = quickpick.items.filter(i => (CommandQuickPickItem.is(i) ? false : i.picked));
	}

	const disposables: Disposable[] = [];

	let scope: KeyboardScope | undefined;
	if (options?.keys != null && options.keys.length !== 0 && options?.onDidPressKey !== null) {
		scope = Container.instance.keyboard.createScope(
			Object.fromEntries(
				options.keys.map(key => [
					key,
					{
						onDidPressKey: key => {
							if (quickpick.activeItems.length !== 0) {
								const [item] = quickpick.activeItems;
								if (item != null && !isDirectiveQuickPickItem(item) && !CommandQuickPickItem.is(item)) {
									void options.onDidPressKey!(key, item);
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
					if (quickpick.activeItems.length !== 0) {
						const [item] = quickpick.activeItems;
						if (isDirectiveQuickPickItem(item)) {
							resolve(undefined);
							return;
						}

						resolve(item);
					}
				}),
				quickpick.onDidChangeValue(async e => {
					if (scope == null) return;

					// Pause the left/right keyboard commands if there is a value, otherwise the left/right arrows won't work in the input properly
					if (e.length !== 0) {
						await scope.pause(['left', 'right']);
					} else {
						await scope.resume();
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
