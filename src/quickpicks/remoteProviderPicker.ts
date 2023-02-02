import type { Disposable, QuickInputButton } from 'vscode';
import { env, ThemeIcon, Uri, window } from 'vscode';
import type { OpenOnRemoteCommandArgs } from '../commands';
import { Commands, GlyphChars } from '../constants';
import { Container } from '../container';
import { getBranchNameWithoutRemote, getRemoteNameFromBranchName } from '../git/models/branch';
import { GitRemote } from '../git/models/remote';
import type { RemoteResource } from '../git/models/remoteResource';
import { getNameFromRemoteResource, RemoteResourceType } from '../git/models/remoteResource';
import type { RemoteProvider } from '../git/remotes/remoteProvider';
import type { Keys } from '../keyboard';
import { getSettledValue } from '../system/promise';
import { getQuickPickIgnoreFocusOut } from '../system/utils';
import { DeepLinkType } from '../uris/deepLinks/deepLink';
import { CommandQuickPickItem } from './items/common';

export class ConfigureCustomRemoteProviderCommandQuickPickItem extends CommandQuickPickItem {
	constructor() {
		super({ label: 'See how to configure a custom remote provider...' });
	}

	get name(): string {
		return this.label;
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
		private readonly deepLink?: boolean,
		buttons?: QuickInputButton[],
	) {
		super({
			label: `$(repo) ${remote.provider.path}`,
			description: remote.name,
			buttons: buttons,
		});
	}

	get name(): string {
		return this.remote.name;
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

		if (this.clipboard) {
			if (this.deepLink) {
				let targetType: DeepLinkType | undefined;
				let targetId: string | undefined;
				let repoId: string | undefined;
				switch (resource.type) {
					case RemoteResourceType.Branch:
						targetType = DeepLinkType.Branch;
						targetId = resource.branch;
						repoId = resource.repoId;
						break;
					case RemoteResourceType.Commit:
						targetType = DeepLinkType.Commit;
						targetId = resource.sha;
						repoId = resource.repoId;
						break;
					case RemoteResourceType.Tag:
						targetType = DeepLinkType.Tag;
						targetId = resource.tag;
						repoId = resource.repoId;
						break;
					case RemoteResourceType.Repo:
						targetType = DeepLinkType.Repository;
						repoId = resource.repoId;
						break;
				}
				if (!targetType) return;
				await Container.instance.deepLinks.copyDeepLinkUrl(repoId!, this.remote.url, targetType, targetId);
				return;
			}

			await this.remote.provider.copy(resource);
			return;
		}

		await this.remote.provider.open(resource);
	}

	setAsDefault(): Promise<void> {
		return this.remote.setAsDefault(true);
	}
}

export class CopyRemoteResourceCommandQuickPickItem extends CommandQuickPickItem {
	constructor(remotes: GitRemote<RemoteProvider>[], resource: RemoteResource, deepLink?: boolean) {
		const providers = GitRemote.getHighlanderProviders(remotes);
		const commandArgs: OpenOnRemoteCommandArgs = {
			resource: resource,
			remotes: remotes,
			clipboard: true,
			deepLink: deepLink,
		};
		const label: string = deepLink
			? `$(copy) Copy Link to ${getNameFromRemoteResource(resource)}`
			: `$(copy) Copy ${providers?.length ? providers[0].name : 'Remote'} ${getNameFromRemoteResource(
					resource,
			  )} URL${providers?.length === 1 ? '' : GlyphChars.Ellipsis}`;
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

namespace QuickCommandButtons {
	export const SetRemoteAsDefault: QuickInputButton = {
		iconPath: new ThemeIcon('settings-gear'),
		tooltip: 'Set as Default Remote',
	};
}

export namespace RemoteProviderPicker {
	export async function show(
		title: string,
		placeHolder: string,
		resource: RemoteResource,
		remotes: GitRemote<RemoteProvider>[],
		options?: {
			autoPick?: 'default' | boolean;
			clipboard?: boolean;
			deepLink?: boolean;
			setDefault?: boolean;
			preSelected?: string;
		},
	): Promise<ConfigureCustomRemoteProviderCommandQuickPickItem | CopyOrOpenRemoteCommandQuickPickItem | undefined> {
		const { autoPick, clipboard, deepLink, setDefault, preSelected } = {
			autoPick: false,
			clipboard: false,
			deepLink: false,
			setDefault: true,
			preSelected: undefined,
			...options,
		};

		let items: (ConfigureCustomRemoteProviderCommandQuickPickItem | CopyOrOpenRemoteCommandQuickPickItem)[];
		let preSelectedItem:
			| ConfigureCustomRemoteProviderCommandQuickPickItem
			| CopyOrOpenRemoteCommandQuickPickItem
			| undefined;
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

			items = remotes.map(
				r =>
					new CopyOrOpenRemoteCommandQuickPickItem(
						r,
						resource,
						clipboard,
						deepLink,
						setDefault ? [QuickCommandButtons.SetRemoteAsDefault] : undefined,
					),
			);

			if (preSelected != null) {
				preSelectedItem = items.find(i => i.name === preSelected);
			}
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
							e.button === QuickCommandButtons.SetRemoteAsDefault &&
							e.item instanceof CopyOrOpenRemoteCommandQuickPickItem
						) {
							await e.item.setAsDefault();
							resolve(e.item);
						}
					}),
				);

				quickpick.title = title;
				quickpick.placeholder = placeHolder;
				quickpick.matchOnDetail = true;
				quickpick.items = items;
				if (preSelectedItem != null) {
					quickpick.activeItems = [preSelectedItem];
				}

				quickpick.show();
			});
			if (pick == null) return undefined;

			return pick;
		} finally {
			quickpick.dispose();
			disposables.forEach(d => void d.dispose());
		}
	}
}
