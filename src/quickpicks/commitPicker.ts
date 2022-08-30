import type { Disposable } from 'vscode';
import { window } from 'vscode';
import type { GitCommit, GitStashCommit } from 'src/git/models/commit';
import type { GitLog } from 'src/git/models/log';
import type { GitStash } from 'src/git/models/stash';
import { configuration } from '../configuration';
import { Container } from '../container';
import type { KeyboardScope, Keys } from '../keyboard';
import { CommandQuickPickItem } from '../quickpicks/items/common';
import { filter, map } from '../system/iterable';
import { isPromise } from '../system/promise';
import { getQuickPickIgnoreFocusOut } from '../system/utils';
import { Directive, DirectiveQuickPickItem } from './items/directive';
import { CommitQuickPickItem } from './items/gitCommands';

export namespace CommitPicker {
	export async function show(
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
			quickpick.enabled = false;
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
				? [DirectiveQuickPickItem.create(Directive.Cancel)]
				: [
						...(options?.showOtherReferences ?? []),
						...map(log.commits.values(), commit =>
							CommitQuickPickItem.create(commit, options?.picked === commit.ref, {
								compact: true,
								icon: true,
							}),
						),
						...(log?.hasMore ? [DirectiveQuickPickItem.create(Directive.LoadMore)] : []),
				  ];
		}

		async function loadMore() {
			quickpick.busy = true;
			quickpick.enabled = false;

			try {
				log = await (await log)?.more?.(configuration.get('advanced.maxListItems'));
				const items = getItems(log);

				let activeIndex = -1;
				if (quickpick.activeItems.length !== 0) {
					const active = quickpick.activeItems[0];
					activeIndex = quickpick.items.indexOf(active);

					// If the active item is the "Load more" directive, then select the previous item
					if (DirectiveQuickPickItem.is(active)) {
						activeIndex--;
					}
				}

				quickpick.items = items;

				if (activeIndex) {
					quickpick.activeItems = [quickpick.items[activeIndex]];
				}
			} finally {
				quickpick.busy = false;
				quickpick.enabled = true;
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
									if (
										item != null &&
										!DirectiveQuickPickItem.is(item) &&
										!CommandQuickPickItem.is(item)
									) {
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
				CommandQuickPickItem | CommitQuickPickItem | DirectiveQuickPickItem | undefined
			>(resolve => {
				disposables.push(
					quickpick.onDidHide(() => resolve(undefined)),
					quickpick.onDidAccept(() => {
						if (quickpick.activeItems.length !== 0) {
							const [item] = quickpick.activeItems;
							if (DirectiveQuickPickItem.is(item)) {
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
				quickpick.enabled = true;

				quickpick.show();
			});
			if (pick == null || DirectiveQuickPickItem.is(pick)) return undefined;

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
}

export namespace StashPicker {
	export async function show(
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
			quickpick.enabled = false;
			quickpick.show();

			stash = await stash;
		}

		if (stash != null) {
			quickpick.items = [
				...(options?.showOtherReferences ?? []),
				...map(
					options?.filter != null ? filter(stash.commits.values(), options.filter) : stash.commits.values(),
					commit =>
						CommitQuickPickItem.create(commit, options?.picked === commit.ref, {
							compact: true,
							icon: true,
						}),
				),
			];
		}

		if (stash == null || quickpick.items.length <= (options?.showOtherReferences?.length ?? 0)) {
			quickpick.placeholder = stash == null ? 'No stashes found' : options?.empty ?? `No matching stashes found`;
			quickpick.items = [DirectiveQuickPickItem.create(Directive.Cancel)];
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
									if (
										item != null &&
										!DirectiveQuickPickItem.is(item) &&
										!CommandQuickPickItem.is(item)
									) {
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
							if (DirectiveQuickPickItem.is(item)) {
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
				quickpick.enabled = true;

				quickpick.show();
			});
			if (pick == null || DirectiveQuickPickItem.is(pick)) return undefined;

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
}
