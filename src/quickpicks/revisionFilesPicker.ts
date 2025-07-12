import type { Disposable, QuickInputButton, Uri } from 'vscode';
import { ThemeIcon, window } from 'vscode';
import type { Keys } from '../constants';
import type { Container } from '../container';
import type { GitRevisionReference } from '../git/models/reference';
import type { GitTreeEntry } from '../git/models/tree';
import type { KeyboardScope } from '../system/-webview/keyboard';
import { splitPath } from '../system/-webview/path';
import { getQuickPickIgnoreFocusOut } from '../system/-webview/vscode';
import { filterMap } from '../system/iterable';
import { dirname } from '../system/path';
import type { QuickPickItemOfT } from './items/common';

export type RevisionQuickPickItem = QuickPickItemOfT<Pick<GitTreeEntry, 'type' | 'path'>>;

export async function showRevisionFilesPicker(
	container: Container,
	revision: GitRevisionReference,
	options: {
		allowFolders?: boolean;
		ignoreFocusOut?: boolean;
		initialPath?: string;
		keyboard?: {
			keys: Keys[];
			onDidPressKey(key: Keys, uri: Uri): void | Promise<void>;
		};
		placeholder?: string;
		title: string;
	},
): Promise<{ type: 'file' | 'folder'; uri: Uri } | undefined> {
	const disposables: Disposable[] = [];

	const repoPath = revision.repoPath;
	const ref = revision.ref;

	function getRevisionUri(item: RevisionQuickPickItem) {
		return container.git.getRepositoryService(repoPath).getRevisionUri(ref, `${repoPath}/${item.item.path}`);
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

		const allowFolders = options?.allowFolders ?? false;
		const pickFolder: QuickInputButton = { iconPath: new ThemeIcon('folder-opened'), tooltip: 'Choose Folder' };

		const tree = await container.git.getRepositoryService(repoPath).revision.getTreeForRevision(ref);
		const items: RevisionQuickPickItem[] = [
			{ label: `..`, alwaysShow: true, item: undefined! } satisfies RevisionQuickPickItem,
			...filterMap(tree, file => {
				if (file.type !== 'blob' && !allowFolders) return undefined;

				const [label, description] = splitPath(file.path, undefined, true);
				return {
					label: label,
					description: description === '.' ? '' : description,
					iconPath: allowFolders ? (file.type === 'tree' ? ThemeIcon.Folder : ThemeIcon.File) : undefined,
					buttons: file.type === 'tree' ? [pickFolder] : [],
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
					if (!quickpick.activeItems.length) return;

					const [item] = quickpick.activeItems;
					if (item.item == null) {
						const value = dirname(quickpick.value);
						quickpick.value = value === '.' ? '' : value;
						return;
					}

					if (item.item.type === 'tree' && quickpick.value !== item.item.path) {
						quickpick.value = item.item.path;
						return;
					}

					resolve(item);
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
				quickpick.onDidTriggerItemButton(({ button, item }) => {
					if (button === pickFolder) {
						resolve(item);
					}
				}),
			);
		});

		return pick != null
			? { type: pick.item.type === 'tree' ? 'folder' : 'file', uri: getRevisionUri(pick) }
			: undefined;
	} finally {
		disposables.forEach(d => void d.dispose());
	}
}
