import type { Disposable } from 'vscode';
import { window } from 'vscode';
import type { Keys } from '../constants';
import { Container } from '../container';
import type { GitCommit, GitStashCommit } from '../git/models/commit';
import type { GitLog } from '../git/models/log';
import type { GitStash } from '../git/models/stash';
import { filterMap } from '../system/array';
import { filter, map } from '../system/iterable';
import { isPromise } from '../system/promise';
import { configuration } from '../system/vscode/configuration';
import type { KeyboardScope } from '../system/vscode/keyboard';
import { getQuickPickIgnoreFocusOut } from '../system/vscode/utils';
import { CommandQuickPickItem } from './items/common';
import type { DirectiveQuickPickItem } from './items/directive';
import { createDirectiveQuickPickItem, Directive, isDirectiveQuickPickItem } from './items/directive';
import type { CommitQuickPickItem } from './items/gitWizard';
import { createCommitQuickPickItem, createStashQuickPickItem } from './items/gitWizard';

type Item = CommandQuickPickItem | CommitQuickPickItem | DirectiveQuickPickItem;

export async function showCommitPicker(
	log: GitLog | undefined | Promise<GitLog | undefined>,
	title: string,
	placeholder: string,
	options?: {
		empty?: {
			getState?: () =>
				| { items: Item[]; placeholder?: string; title?: string }
				| Promise<{ items: Item[]; placeholder?: string; title?: string }>;
		};
		picked?: string;
		keyboard?: {
			keys: Keys[];
			onDidPressKey(key: Keys, item: CommitQuickPickItem): void | Promise<void>;
		};
		showOtherReferences?: CommandQuickPickItem[];
	},
): Promise<GitCommit | undefined> {
	const quickpick = window.createQuickPick<Item>();
	quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();

	quickpick.title = title;
	quickpick.placeholder = placeholder;
	quickpick.matchOnDescription = true;
	quickpick.matchOnDetail = true;

	if (isPromise(log)) {
		quickpick.busy = true;
		quickpick.show();

		log = await log;
	}

	if (log == null) {
		quickpick.placeholder = 'No commits found';

		if (options?.empty?.getState != null) {
			const empty = await options.empty.getState();
			quickpick.items = empty.items;
			if (empty.placeholder != null) {
				quickpick.placeholder = empty.placeholder;
			}
			if (empty.title != null) {
				quickpick.title = empty.title;
			}
		} else {
			quickpick.items = [createDirectiveQuickPickItem(Directive.Cancel, undefined, { label: 'OK' })];
		}
	} else {
		quickpick.items = await getItems(log);
	}

	if (options?.picked) {
		quickpick.activeItems = quickpick.items.filter(i => (CommandQuickPickItem.is(i) ? false : i.picked));
	}

	async function getItems(log: GitLog) {
		const items = [];
		if (options?.showOtherReferences != null) {
			items.push(...options.showOtherReferences);
		}

		items.push(
			...filterMap(
				await Promise.allSettled(
					map(log.commits.values(), async commit =>
						createCommitQuickPickItem(commit, options?.picked === commit.ref, {
							compact: true,
							icon: 'avatar',
						}),
					),
				),
				r => (r.status === 'fulfilled' ? r.value : undefined),
			),
		);

		if (log.hasMore) {
			items.push(createDirectiveQuickPickItem(Directive.LoadMore));
		}

		return items;
	}

	async function loadMore() {
		quickpick.ignoreFocusOut = true;
		quickpick.busy = true;

		try {
			log = await (await log)?.more?.(configuration.get('advanced.maxListItems'));

			let items;
			if (log == null) {
				if (options?.empty?.getState != null) {
					const empty = await options.empty.getState();
					items = empty.items;
					if (empty.placeholder != null) {
						quickpick.placeholder = empty.placeholder;
					}
					if (empty.title != null) {
						quickpick.title = empty.title;
					}
				} else {
					items = [createDirectiveQuickPickItem(Directive.Cancel, undefined, { label: 'OK' })];
				}
			} else {
				items = await getItems(log);
			}

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
		const pick = await new Promise<Item | undefined>(resolve => {
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
				quickpick.onDidChangeValue(value => {
					if (scope == null) return;

					// Pause the left/right keyboard commands if there is a value, otherwise the left/right arrows won't work in the input properly
					if (value.length !== 0) {
						void scope.pause(['left', 'ctrl+left', 'right', 'ctrl+right']);
					} else {
						void scope.resume();
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

export async function showStashPicker(
	gitStash: GitStash | undefined | Promise<GitStash | undefined>,
	title: string,
	placeholder: string,
	options?: {
		empty?: string;
		filter?: (c: GitStashCommit) => boolean;
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

	if (isPromise(gitStash)) {
		quickpick.busy = true;
		quickpick.show();

		gitStash = await gitStash;
	}

	if (gitStash != null) {
		quickpick.items = [
			...(options?.showOtherReferences ?? []),
			...map(
				options?.filter != null ? filter(gitStash.stashes.values(), options.filter) : gitStash.stashes.values(),
				stash =>
					createStashQuickPickItem(stash, options?.picked === stash.ref, {
						compact: true,
						icon: true,
					}),
			),
		];
	}

	if (gitStash == null || quickpick.items.length <= (options?.showOtherReferences?.length ?? 0)) {
		quickpick.placeholder = gitStash == null ? 'No stashes found' : options?.empty ?? `No matching stashes found`;
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
					if (quickpick.activeItems.length !== 0) {
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
