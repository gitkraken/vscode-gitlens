import type { Disposable, Uri } from 'vscode';
import { ThemeIcon, window } from 'vscode';
import type { Keys } from '../constants.js';
import type { Container } from '../container.js';
import type { KeyboardScope } from '../system/-webview/keyboard.js';
import { splitPath } from '../system/-webview/path.js';
import { getQuickPickIgnoreFocusOut, supportedInVSCodeVersion } from '../system/-webview/vscode.js';
import { dirname } from '../system/path.js';
import type { QuickPickItemOfT } from './items/common.js';

interface WorkingFileEntry {
	path: string;
}

type WorkingFileQuickPickItem = QuickPickItemOfT<WorkingFileEntry>;

export async function showWorkingFilesPicker(
	container: Container,
	repoPath: string,
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
): Promise<{ uri: Uri } | undefined> {
	const disposables: Disposable[] = [];

	const svc = container.git.getRepositoryService(repoPath);

	function getWorkingUri(item: WorkingFileQuickPickItem) {
		return svc.getAbsoluteUri(item.item.path, repoPath);
	}

	try {
		const quickpick = window.createQuickPick<WorkingFileQuickPickItem>();
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

										await keyboard.onDidPressKey(key, getWorkingUri(item));

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

		const filePaths = await svc.revision.getTrackedFiles();

		const supportsFileIcons = supportedInVSCodeVersion('quickpick-resourceuri');
		const items: WorkingFileQuickPickItem[] = [
			{ label: `..`, alwaysShow: true, item: undefined! } satisfies WorkingFileQuickPickItem,
			...filePaths.map(path => {
				const [label, description] = splitPath(path, undefined, true);
				return {
					label: label,
					description: description === '.' ? '' : description,
					iconPath: supportsFileIcons ? ThemeIcon.File : undefined,
					resourceUri: supportsFileIcons ? svc.getAbsoluteUri(path, repoPath) : undefined,
					item: { path: path },
				} satisfies WorkingFileQuickPickItem;
			}),
		];

		quickpick.items = items;
		quickpick.busy = false;

		const pick = await new Promise<WorkingFileQuickPickItem | undefined>(resolve => {
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
			);
		});

		return pick != null ? { uri: getWorkingUri(pick) } : undefined;
	} finally {
		disposables.forEach(d => void d.dispose());
	}
}
