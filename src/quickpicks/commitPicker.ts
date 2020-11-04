'use strict';
import { Disposable, window } from 'vscode';
import { configuration } from '../configuration';
import { Container } from '../container';
import { GitLog, GitLogCommit } from '../git/git';
import { KeyboardScope, Keys } from '../keyboard';
import {
	CommandQuickPickItem,
	CommitQuickPickItem,
	Directive,
	DirectiveQuickPickItem,
	getQuickPickIgnoreFocusOut,
} from '../quickpicks';
import { Iterables, Promises } from '../system';

export namespace CommitPicker {
	export async function show(
		log: GitLog | undefined | Promise<GitLog | undefined>,
		title: string,
		placeholder: string,
		options?: {
			picked?: string;
			keys?: Keys[];
			onDidPressKey?(key: Keys, item: CommitQuickPickItem): void | Promise<void>;
			showOtherReferences?: CommandQuickPickItem;
		},
	): Promise<GitLogCommit | undefined> {
		const quickpick = window.createQuickPick<CommandQuickPickItem | CommitQuickPickItem | DirectiveQuickPickItem>();
		quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();

		quickpick.title = title;
		quickpick.placeholder = placeholder;
		quickpick.matchOnDescription = true;
		quickpick.matchOnDetail = true;

		if (Promises.is(log)) {
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
						...(options?.showOtherReferences != null ? [options?.showOtherReferences] : []),
						...Iterables.map(log.commits.values(), commit =>
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
				log = await (await log)?.more?.(configuration.get('advanced', 'maxListItems'));
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
			scope = Container.keyboard.createScope(
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
			disposables.forEach(d => d.dispose());
		}
	}
}
