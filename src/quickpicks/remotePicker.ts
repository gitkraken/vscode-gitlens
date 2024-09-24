import type { Disposable } from 'vscode';
import { window } from 'vscode';
import { SetRemoteAsDefaultQuickInputButton } from '../commands/quickCommand.buttons';
import type { GitRemote } from '../git/models/remote';
import { getQuickPickIgnoreFocusOut } from '../system/vscode/utils';
import type { RemoteQuickPickItem } from './items/gitWizard';
import { createRemoteQuickPickItem } from './items/gitWizard';

export async function showRemotePicker(
	title: string | undefined,
	placeholder: string = 'Choose a remote',
	remotes: GitRemote[],
	options?: {
		autoPick?: 'default' | boolean;
		picked?: string;
		setDefault?: boolean;
	},
): Promise<GitRemote | undefined> {
	const items: RemoteQuickPickItem[] = [];
	let picked: RemoteQuickPickItem | undefined;

	if (remotes.length === 0) {
		placeholder = 'No remotes found';
	} else {
		if (options?.autoPick === 'default' && remotes.length > 1) {
			// If there is a default just execute it directly
			const remote = remotes.find(r => r.default);
			if (remote != null) {
				remotes = [remote];
			}
		}

		const pickOpts: Parameters<typeof createRemoteQuickPickItem>[2] = {
			upstream: true,
			buttons: options?.setDefault ? [SetRemoteAsDefaultQuickInputButton] : undefined,
		};

		for (const r of remotes) {
			items.push(createRemoteQuickPickItem(r, undefined, pickOpts));
			if (r.name === options?.picked) {
				picked = items[items.length - 1];
			}
		}
	}

	if (options?.autoPick && remotes.length === 1) return items[0].item;

	const quickpick = window.createQuickPick<RemoteQuickPickItem>();
	quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();

	const disposables: Disposable[] = [];

	try {
		const pick = await new Promise<RemoteQuickPickItem | undefined>(resolve => {
			disposables.push(
				quickpick.onDidHide(() => resolve(undefined)),
				quickpick.onDidAccept(() => {
					if (quickpick.activeItems.length !== 0) {
						resolve(quickpick.activeItems[0]);
					}
				}),
				quickpick.onDidTriggerItemButton(async e => {
					if (e.button === SetRemoteAsDefaultQuickInputButton) {
						await e.item.item.setAsDefault();
						resolve(e.item);
					}
				}),
			);

			quickpick.title = title;
			quickpick.placeholder = placeholder;
			quickpick.matchOnDetail = true;
			quickpick.items = items;
			if (picked != null) {
				quickpick.activeItems = [picked];
			}

			quickpick.show();
		});

		return pick?.item;
	} finally {
		quickpick.dispose();
		disposables.forEach(d => void d.dispose());
	}
}
