'use strict';
import { Disposable, env, Uri, window } from 'vscode';
import { Commands, OpenOnRemoteCommandArgs } from '../commands';
import { GlyphChars } from '../constants';
import { Container } from '../container';
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

	override async execute(): Promise<void> {
		await env.openExternal(
			Uri.parse('https://github.com/eamodio/vscode-gitlens#remote-provider-integration-settings-'),
		);
	}
}

export class CopyOrOpenRemoteCommandQuickPickItem extends CommandQuickPickItem {
	constructor(
		private readonly remote: GitRemote<RemoteProvider>,
		private readonly resource: RemoteResource,
		private readonly clipboard?: boolean,
	) {
		super({
			label: `$(repo) ${remote.provider.path}`,
			description: remote.name,
		});
	}

	override async execute(): Promise<void> {
		let resource = this.resource;
		if (resource.type === RemoteResourceType.Comparison) {
			if (GitBranch.getRemote(resource.base) === this.remote.name) {
				resource = { ...resource, base: GitBranch.getNameWithoutRemote(resource.base) };
			}

			if (GitBranch.getRemote(resource.compare) === this.remote.name) {
				resource = { ...resource, compare: GitBranch.getNameWithoutRemote(resource.compare) };
			}
		} else if (resource.type === RemoteResourceType.CreatePullRequest) {
			let branch = resource.base.branch;
			if (branch == null) {
				branch = await Container.git.getDefaultBranchName(this.remote.repoPath, this.remote.name);
				if (branch == null && this.remote.provider.hasApi()) {
					const defaultBranch = await this.remote.provider.getDefaultBranch?.();
					branch = defaultBranch?.name;
				}
			}

			resource = {
				...resource,
				base: { branch: branch, remote: { path: this.remote.path, url: this.remote.url } },
			};
		} else if (
			resource.type === RemoteResourceType.File &&
			resource.branchOrTag != null &&
			(this.remote.provider.id === 'bitbucket' || this.remote.provider.id === 'bitbucket-server')
		) {
			// HACK ALERT
			// Since Bitbucket can't support branch names in the url (other than with the default branch),
			// turn this into a `Revision` request
			const { branchOrTag } = resource;
			const branchesOrTags = await Container.git.getBranchesAndOrTags(this.remote.repoPath, {
				filter: {
					branches: b => b.name === branchOrTag || GitBranch.getNameWithoutRemote(b.name) === branchOrTag,
					tags: b => b.name === branchOrTag,
				},
			});

			const sha = branchesOrTags?.[0]?.sha;
			if (sha) {
				resource = { ...resource, type: RemoteResourceType.Revision, sha: sha };
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

	override async onDidPressKey(key: Keys): Promise<void> {
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

	override async execute(): Promise<GitRemote<RemoteProvider> | undefined> {
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

	override async execute(): Promise<GitRemote<RemoteProvider>> {
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
		options?: { autoPick?: 'default' | boolean; clipboard?: boolean; setDefault?: boolean },
	): Promise<
		| ConfigureCustomRemoteProviderCommandQuickPickItem
		| CopyOrOpenRemoteCommandQuickPickItem
		| SetADefaultRemoteCommandQuickPickItem
		| undefined
	> {
		const { autoPick, clipboard, setDefault } = { autoPick: false, clipboard: false, setDefault: true, ...options };

		let items: (
			| ConfigureCustomRemoteProviderCommandQuickPickItem
			| CopyOrOpenRemoteCommandQuickPickItem
			| SetADefaultRemoteCommandQuickPickItem
		)[];
		if (remotes.length === 0) {
			items = [new ConfigureCustomRemoteProviderCommandQuickPickItem()];
			placeHolder = 'No auto-detected or configured remote providers found';
		} else {
			if (autoPick === 'default' && remotes.length > 1) {
				// If there is a default just execute it directly
				const remote = remotes.find(r => r.default);
				if (remote != null) {
					remotes = [remote];
				}
			}

			items = remotes.map(r => new CopyOrOpenRemoteCommandQuickPickItem(r, resource, clipboard));
			if (setDefault) {
				items.push(new SetADefaultRemoteCommandQuickPickItem(remotes));
			}
		}

		// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
		if (autoPick && remotes.length === 1) return items[0];

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
