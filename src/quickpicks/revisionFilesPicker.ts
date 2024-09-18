import type { Disposable, Uri } from 'vscode';
import { window } from 'vscode';
import type { Keys } from '../constants';
import type { Container } from '../container';
import type { GitRevisionReference } from '../git/models/reference';
import type { GitTreeEntry } from '../git/models/tree';
import { filterMap } from '../system/iterable';
import type { KeyboardScope } from '../system/vscode/keyboard';
import { splitPath } from '../system/vscode/path';
import { getQuickPickIgnoreFocusOut } from '../system/vscode/utils';
import type { QuickPickItemOfT } from './items/common';

export type RevisionQuickPickItem = QuickPickItemOfT<GitTreeEntry>;

export async function showRevisionFilesPicker(
	container: Container,
	revision: GitRevisionReference,
	options: {
		ignoreFocusOut?: boolean;
		initialPath?: string;
		keyboard?: {
			keys: Keys[];
			onDidPressKey(key: Keys, uri: Uri): void | Promise<void>;
		};
		placeholder?: string;
		title: string;
	},
): Promise<Uri | undefined> {
	const disposables: Disposable[] = [];

	const repoPath = revision.repoPath;
	const ref = revision.ref;

	function getRevisionUri(item: RevisionQuickPickItem) {
		return container.git.getRevisionUri(ref, `${repoPath}/${item.item.path}`, repoPath);
	}

	try {
		const quickpick = window.createQuickPick<RevisionQuickPickItem>();
		quickpick.ignoreFocusOut = options?.ignoreFocusOut ?? getQuickPickIgnoreFocusOut();

		const value = options.initialPath ?? '';

		let scope: KeyboardScope | undefined;
		if (options?.keyboard != null) {
			const { keyboard } = options;
			scope = container.keyboard.createScope(
				Object.fromEntries(
					keyboard.keys.map(key => [
						key,
						{
							onDidPressKey: async key => {
								if (quickpick.activeItems.length !== 0) {
									const [item] = quickpick.activeItems;
									if (item.item != null) {
										const ignoreFocusOut = quickpick.ignoreFocusOut;
										quickpick.ignoreFocusOut = true;

										await keyboard.onDidPressKey(key, getRevisionUri(item));

										quickpick.ignoreFocusOut = ignoreFocusOut;
									}
								}
							},
						},
					]),
				),
			);
			void scope.start();
			if (value != null) {
				void scope.pause(['left', 'ctrl+left', 'right', 'ctrl+right']);
			}
			disposables.push(scope);
		}

		quickpick.title = options.title;
		quickpick.placeholder = options?.placeholder ?? 'Search files by name';
		quickpick.matchOnDescription = true;

		quickpick.value = value;
		quickpick.busy = true;
		quickpick.show();

		const tree = await container.git.getTreeForRevision(repoPath, ref);
		const items: RevisionQuickPickItem[] = [
			...filterMap(tree, file => {
				// Exclude directories
				if (file.type !== 'blob') return undefined;

				const [label, description] = splitPath(file.path, undefined, true);
				return {
					label: label,
					description: description === '.' ? '' : description,
					item: file,
				} satisfies RevisionQuickPickItem;
			}),
		];
		quickpick.items = items;
		quickpick.busy = false;

		const pick = await new Promise<RevisionQuickPickItem | undefined>(resolve => {
			disposables.push(
				quickpick,
				quickpick.onDidHide(() => resolve(undefined)),
				quickpick.onDidAccept(() => {
					if (quickpick.activeItems.length === 0) return;

					resolve(quickpick.activeItems[0]);
				}),
				quickpick.onDidChangeValue(value => {
					if (scope == null) return;

					// Pause the left/right keyboard commands if there is a value, otherwise the left/right arrows won't work in the input properly
					if (value.length !== 0) {
						void scope.pause(['left', 'ctrl+left', 'right', 'ctrl+right']);
					} else {
						void scope.resume();
					}

					for (const item of items) {
						if (
							item.item.path.includes(value) &&
							!item.label.includes(value) &&
							!item.description!.includes(value)
						) {
							item.alwaysShow = true;
						} else {
							item.alwaysShow = false;
						}
					}
					quickpick.items = items;
				}),
			);
		});

		return pick != null ? getRevisionUri(pick) : undefined;
	} finally {
		disposables.forEach(d => void d.dispose());
	}
}
