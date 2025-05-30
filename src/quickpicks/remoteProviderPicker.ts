import type { Disposable, QuickInputButton } from 'vscode';
import { env, Uri, window } from 'vscode';
import type { OpenOnRemoteCommandArgs } from '../commands';
import { SetRemoteAsDefaultQuickInputButton } from '../commands/quickCommand.buttons';
import type { Keys } from '../constants';
import { Commands, GlyphChars } from '../constants';
import { Container } from '../container';
import { getBranchNameWithoutRemote, getRemoteNameFromBranchName } from '../git/models/branch';
import { GitRemote } from '../git/models/remote';
import type { RemoteResource } from '../git/models/remoteResource';
import { getNameFromRemoteResource, RemoteResourceType } from '../git/models/remoteResource';
import type { RemoteProvider } from '../git/remotes/remoteProvider';
import { getSettledValue } from '../system/promise';
import { getQuickPickIgnoreFocusOut } from '../system/utils';
import { CommandQuickPickItem } from './items/common';

export class ConfigureCustomRemoteProviderCommandQuickPickItem extends CommandQuickPickItem {
	constructor() {
		super({ label: 'See how to configure a custom remote provider...' });
	}

	override async execute(): Promise<void> {
		await env.openExternal(
			Uri.parse('https://github.com/gitkraken/vscode-gitlens#remote-provider-integration-settings-'),
		);
	}
}

export class CopyOrOpenRemoteCommandQuickPickItem extends CommandQuickPickItem {
	constructor(
		private readonly remote: GitRemote<RemoteProvider>,
		private readonly resource: RemoteResource,
		private readonly clipboard?: boolean,
		buttons?: QuickInputButton[],
	) {
		super({
			label: `$(repo) ${remote.provider.path}`,
			description: remote.name,
			buttons: buttons,
		});
	}

	override async execute(): Promise<void> {
		let resource = this.resource;
		if (resource.type === RemoteResourceType.Comparison) {
			if (getRemoteNameFromBranchName(resource.base) === this.remote.name) {
				resource = { ...resource, base: getBranchNameWithoutRemote(resource.base) };
			}

			if (getRemoteNameFromBranchName(resource.compare) === this.remote.name) {
				resource = { ...resource, compare: getBranchNameWithoutRemote(resource.compare) };
			}
		} else if (resource.type === RemoteResourceType.CreatePullRequest) {
			let branch = resource.base.branch;
			if (branch == null) {
				branch = await Container.instance.git.getDefaultBranchName(this.remote.repoPath, this.remote.name);
				if (branch == null && this.remote.hasRichProvider()) {
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
			const [branches, tags] = await Promise.allSettled([
				Container.instance.git.getBranches(this.remote.repoPath, {
					filter: b => b.name === branchOrTag || b.getNameWithoutRemote() === branchOrTag,
				}),
				Container.instance.git.getTags(this.remote.repoPath, { filter: t => t.name === branchOrTag }),
			]);

			const sha = getSettledValue(branches)?.values[0]?.sha ?? getSettledValue(tags)?.values[0]?.sha;
			if (sha) {
				resource = { ...resource, type: RemoteResourceType.Revision, sha: sha };
			}
		}

		void (await (this.clipboard ? this.remote.provider.copy(resource) : this.remote.provider.open(resource)));
	}

	setAsDefault(): Promise<void> {
		return this.remote.setAsDefault(true);
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
		const label = `$(copy) Copy Link to ${getNameFromRemoteResource(resource)} for ${
			providers?.length ? providers[0].name : 'Remote'
		}${providers?.length === 1 ? '' : GlyphChars.Ellipsis}`;
		super(label, Commands.OpenOnRemote, [commandArgs]);
	}

	override async onDidPressKey(key: Keys): Promise<void> {
		await super.onDidPressKey(key);
		void window.showInformationMessage('URL copied to the clipboard');
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

export async function showRemoteProviderPicker(
	title: string,
	placeholder: string,
	resource: RemoteResource,
	remotes: GitRemote<RemoteProvider>[],
	options?: {
		autoPick?: 'default' | boolean;
		clipboard?: boolean;
		setDefault?: boolean;
	},
): Promise<ConfigureCustomRemoteProviderCommandQuickPickItem | CopyOrOpenRemoteCommandQuickPickItem | undefined> {
	const { autoPick, clipboard, setDefault } = {
		autoPick: false,
		clipboard: false,
		setDefault: true,
		...options,
	};

	let items: (ConfigureCustomRemoteProviderCommandQuickPickItem | CopyOrOpenRemoteCommandQuickPickItem)[];
	if (remotes.length === 0) {
		items = [new ConfigureCustomRemoteProviderCommandQuickPickItem()];
		placeholder = 'No auto-detected or configured remote providers found';
	} else {
		if (autoPick === 'default' && remotes.length > 1) {
			// If there is a default just execute it directly
			const remote = remotes.find(r => r.default);
			if (remote != null) {
				remotes = [remote];
			}
		}

		items = remotes.map(
			r =>
				new CopyOrOpenRemoteCommandQuickPickItem(
					r,
					resource,
					clipboard,
					setDefault ? [SetRemoteAsDefaultQuickInputButton] : undefined,
				),
		);
	}

	if (autoPick && remotes.length === 1) return items[0];

	const quickpick = window.createQuickPick<
		ConfigureCustomRemoteProviderCommandQuickPickItem | CopyOrOpenRemoteCommandQuickPickItem
	>();
	quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();

	const disposables: Disposable[] = [];

	try {
		const pick = await new Promise<
			ConfigureCustomRemoteProviderCommandQuickPickItem | CopyOrOpenRemoteCommandQuickPickItem | undefined
		>(resolve => {
			disposables.push(
				quickpick.onDidHide(() => resolve(undefined)),
				quickpick.onDidAccept(() => {
					if (quickpick.activeItems.length !== 0) {
						resolve(quickpick.activeItems[0]);
					}
				}),
				quickpick.onDidTriggerItemButton(async e => {
					if (
						e.button === SetRemoteAsDefaultQuickInputButton &&
						e.item instanceof CopyOrOpenRemoteCommandQuickPickItem
					) {
						await e.item.setAsDefault();
						resolve(e.item);
					}
				}),
			);

			quickpick.title = title;
			quickpick.placeholder = placeholder;
			quickpick.matchOnDetail = true;
			quickpick.items = items;

			quickpick.show();
		});
		if (pick == null) return undefined;

		return pick;
	} finally {
		quickpick.dispose();
		disposables.forEach(d => void d.dispose());
	}
}
