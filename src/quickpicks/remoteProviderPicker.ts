'use strict';
import { Disposable, env, Uri, window } from 'vscode';
import { Commands, OpenOnRemoteCommandArgs } from '../commands';
import { GlyphChars } from '../constants';
import {
	getNameFromRemoteResource,
	GitBranch,
	GitRemote,
	RemoteProvider,
	RemoteResource,
	RemoteResourceType,
} from '../git/git';
import { Keys } from '../keyboard';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut } from '../quickpicks';

export class ConfigureCustomRemoteProviderCommandQuickPickItem extends CommandQuickPickItem {
	constructor() {
		super({ label: 'See how to configure a custom remote provider...' });
	}

	async execute(): Promise<void> {
		await env.openExternal(Uri.parse('https://github.com/eamodio/vscode-gitlens#custom-remotes-settings'));
	}
}

export class CopyOrOpenRemoteCommandQuickPickItem extends CommandQuickPickItem {
	constructor(
		private readonly remote: GitRemote<RemoteProvider>,
		private readonly resource: RemoteResource,
		private readonly clipboard?: boolean,
	) {
		super({
			label: clipboard ? `Copy ${remote.provider.name} Url` : `Open on ${remote.provider.name}`,
			detail: `$(repo) ${remote.provider.path}`,
		});
	}

	async execute(): Promise<void> {
		let resource = this.resource;
		if (resource.type === RemoteResourceType.Comparison) {
			if (GitBranch.getRemote(resource.ref1) === this.remote.name) {
				resource = { ...resource, ref1: GitBranch.getNameWithoutRemote(resource.ref1) };
			}

			if (GitBranch.getRemote(resource.ref2) === this.remote.name) {
				resource = { ...resource, ref2: GitBranch.getNameWithoutRemote(resource.ref2) };
			}
		}

		void (await (this.clipboard ? this.remote.provider.copy(resource) : this.remote.provider.open(resource)));
	}
}

export class CopyRemoteResourceCommandQuickPickItem extends CommandQuickPickItem {
	constructor(remotes: GitRemote<RemoteProvider>[], resource: RemoteResource) {
		const providers = GitRemote.getHighlanderProviders(remotes);
		const commandArgs: OpenOnRemoteCommandArgs = {
			resource: resource,
			remotes: remotes,
			clipboard: true,
		};
		super(
			`$(clippy) Copy ${providers?.length ? providers[0].name : 'Remote'} ${getNameFromRemoteResource(
				resource,
			)} Url${providers?.length === 1 ? '' : GlyphChars.Ellipsis}`,
			Commands.OpenOnRemote,
			[commandArgs],
		);
	}

	async onDidPressKey(key: Keys): Promise<void> {
		await super.onDidPressKey(key);
		void window.showInformationMessage('Url copied to the clipboard');
	}
}

export class OpenRemoteResourceCommandQuickPickItem extends CommandQuickPickItem {
	constructor(remotes: GitRemote<RemoteProvider>[], resource: RemoteResource) {
		const providers = GitRemote.getHighlanderProviders(remotes);
		const commandArgs: OpenOnRemoteCommandArgs = {
			resource: resource,
			remotes: remotes,
			clipboard: false,
		};
		super(
			`$(link-external) Open ${getNameFromRemoteResource(resource)} on ${
				providers?.length === 1
					? providers[0].name
					: `${providers?.length ? providers[0].name : 'Remote'}${GlyphChars.Ellipsis}`
			}`,
			Commands.OpenOnRemote,
			[commandArgs],
		);
	}
}

export class SetADefaultRemoteCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly remotes: GitRemote<RemoteProvider>[]) {
		super({ label: 'Set a Default Remote...' });
	}

	async execute(): Promise<GitRemote<RemoteProvider> | undefined> {
		return RemoteProviderPicker.setADefaultRemote(this.remotes);
	}
}

export class SetRemoteAsDefaultCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly remote: GitRemote<RemoteProvider>) {
		super({
			label: remote.provider.name,
			detail: `$(repo) ${remote.provider.path}`,
		});
	}

	async execute(): Promise<GitRemote<RemoteProvider>> {
		void (await this.remote.setAsDefault(true));
		return this.remote;
	}
}

export namespace RemoteProviderPicker {
	export async function show(
		title: string,
		placeHolder: string,
		resource: RemoteResource,
		remotes: GitRemote<RemoteProvider>[],
		options?: { clipboard?: boolean; setDefault?: boolean },
	): Promise<
		| ConfigureCustomRemoteProviderCommandQuickPickItem
		| CopyOrOpenRemoteCommandQuickPickItem
		| SetADefaultRemoteCommandQuickPickItem
		| undefined
	> {
		const { clipboard, setDefault } = { clipboard: false, setDefault: true, ...options };

		let items: (
			| ConfigureCustomRemoteProviderCommandQuickPickItem
			| CopyOrOpenRemoteCommandQuickPickItem
			| SetADefaultRemoteCommandQuickPickItem
		)[];
		if (remotes.length === 0) {
			items = [new ConfigureCustomRemoteProviderCommandQuickPickItem()];
			//
			placeHolder = 'No auto-detected or configured remote providers found';
		} else {
			items = remotes.map(r => new CopyOrOpenRemoteCommandQuickPickItem(r, resource, clipboard));
			if (setDefault) {
				items.push(new SetADefaultRemoteCommandQuickPickItem(remotes));
			}
		}

		const quickpick = window.createQuickPick<
			| ConfigureCustomRemoteProviderCommandQuickPickItem
			| CopyOrOpenRemoteCommandQuickPickItem
			| SetADefaultRemoteCommandQuickPickItem
		>();
		quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();

		const disposables: Disposable[] = [];

		try {
			const pick = await new Promise<
				| ConfigureCustomRemoteProviderCommandQuickPickItem
				| CopyOrOpenRemoteCommandQuickPickItem
				| SetADefaultRemoteCommandQuickPickItem
				| undefined
			>(resolve => {
				disposables.push(
					quickpick.onDidHide(() => resolve(undefined)),
					quickpick.onDidAccept(() => {
						if (quickpick.activeItems.length !== 0) {
							resolve(quickpick.activeItems[0]);
						}
					}),
				);

				quickpick.title = title;
				quickpick.placeholder = placeHolder;
				quickpick.matchOnDetail = true;
				quickpick.items = items;

				quickpick.show();
			});
			if (pick == null) return undefined;

			return pick;
		} finally {
			quickpick.dispose();
			disposables.forEach(d => d.dispose());
		}
	}

	export async function setADefaultRemote(
		remotes: GitRemote<RemoteProvider>[],
	): Promise<GitRemote<RemoteProvider> | undefined> {
		const items = remotes.map(r => new SetRemoteAsDefaultCommandQuickPickItem(r));

		const quickpick = window.createQuickPick<SetRemoteAsDefaultCommandQuickPickItem>();
		quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();

		const disposables: Disposable[] = [];

		try {
			const pick = await new Promise<SetRemoteAsDefaultCommandQuickPickItem | undefined>(resolve => {
				disposables.push(
					quickpick.onDidHide(() => resolve(undefined)),
					quickpick.onDidAccept(() => {
						if (quickpick.activeItems.length !== 0) {
							resolve(quickpick.activeItems[0]);
						}
					}),
				);

				quickpick.title = 'Set a Default Remote';
				quickpick.placeholder = 'Choose which remote to set as the default';
				quickpick.matchOnDetail = true;
				quickpick.items = items;

				quickpick.show();
			});
			if (pick == null) return undefined;

			return await pick.execute();
		} finally {
			quickpick.dispose();
			disposables.forEach(d => d.dispose());
		}
	}
}
