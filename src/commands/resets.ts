import type { MessageItem } from 'vscode';
import { ConfigurationTarget, window } from 'vscode';
import { resetAvatarCache } from '../avatars';
import { Commands } from '../constants.commands';
import type { Container } from '../container';
import type { QuickPickItemOfT } from '../quickpicks/items/common';
import { createQuickPickSeparator } from '../quickpicks/items/common';
import { command } from '../system/command';
import { configuration } from '../system/configuration';
import { Command } from './base';

const resetTypes = [
	'ai',
	'avatars',
	'integrations',
	'plus',
	'repositoryAccess',
	'suppressedWarnings',
	'usageTracking',
	'workspace',
] as const;
type ResetType = 'all' | (typeof resetTypes)[number];

@command()
export class ResetCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.Reset);
	}
	async execute() {
		type ResetQuickPickItem = QuickPickItemOfT<ResetType>;

		const items: ResetQuickPickItem[] = [
			{
				label: 'AI Keys...',
				detail: 'Clears any locally stored AI keys',
				item: 'ai',
			},
			{
				label: 'Avatars...',
				detail: 'Clears the stored avatar cache',
				item: 'avatars',
			},
			{
				label: 'Integrations (Authentication)...',
				detail: 'Clears any locally stored authentication for integrations',
				item: 'integrations',
			},
			{
				label: 'Repository Access...',
				detail: 'Clears the stored repository access cache',
				item: 'repositoryAccess',
			},
			{
				label: 'Suppressed Warnings...',
				detail: 'Clears any suppressed warnings, e.g. messages with "Don\'t Show Again" options',
				item: 'suppressedWarnings',
			},
			{
				label: 'Usage Tracking...',
				detail: 'Clears any locally tracked usage, typically used for first time experience',
				item: 'usageTracking',
			},
			{
				label: 'Workspace Storage...',
				detail: 'Clears stored data associated with the current workspace',
				item: 'workspace',
			},
			createQuickPickSeparator(),
			{
				label: 'Everything...',
				description: ' — \u00a0be very careful with this!',
				detail: 'Clears ALL locally stored data; ALL GitLens state will be LOST',
				item: 'all',
			},
		];

		if (this.container.debugging) {
			items.splice(
				0,
				0,
				{
					label: 'Subscription Reset',
					detail: 'Resets the stored subscription',
					item: 'plus',
				},
				createQuickPickSeparator(),
			);
		}

		// create a quick pick with options to clear all the different resets that GitLens supports
		const pick = await window.showQuickPick<ResetQuickPickItem>(items, {
			title: 'Reset Stored Data',
			placeHolder: 'Choose which data to reset, will be prompted to confirm',
		});

		if (pick?.item == null) return;
		if (pick.item === 'plus' && !this.container.debugging) return;

		const confirm: MessageItem = { title: 'Reset' };
		const cancel: MessageItem = { title: 'Cancel', isCloseAffordance: true };

		let confirmationMessage: string | undefined;
		switch (pick?.item) {
			case 'all':
				confirmationMessage = 'Are you sure you want to reset EVERYTHING?';
				confirm.title = 'Reset Everything';
				break;
			case 'ai':
				confirmationMessage = 'Are you sure you want to reset all of the stored AI keys?';
				confirm.title = 'Reset AI Keys';
				break;
			case 'avatars':
				confirmationMessage = 'Are you sure you want to reset the avatar cache?';
				confirm.title = 'Reset Avatars';
				break;
			case 'integrations':
				confirmationMessage = 'Are you sure you want to reset all of the stored integrations?';
				confirm.title = 'Reset Integrations';
				break;
			case 'repositoryAccess':
				confirmationMessage = 'Are you sure you want to reset the repository access cache?';
				confirm.title = 'Reset Repository Access';
				break;
			case 'suppressedWarnings':
				confirmationMessage = 'Are you sure you want to reset all of the suppressed warnings?';
				confirm.title = 'Reset Suppressed Warnings';
				break;
			case 'usageTracking':
				confirmationMessage = 'Are you sure you want to reset all of the usage tracking?';
				confirm.title = 'Reset Usage Tracking';
				break;
			case 'workspace':
				confirmationMessage = 'Are you sure you want to reset the stored data for the current workspace?';
				confirm.title = 'Reset Workspace Storage';
				break;
		}

		if (confirmationMessage != null) {
			const result = await window.showWarningMessage(
				`This is IRREVERSIBLE!\n${confirmationMessage}`,
				{ modal: true },
				confirm,
				cancel,
			);
			if (result !== confirm) return;
		}

		await this.reset(pick.item);
	}

	private async reset(reset: ResetType) {
		switch (reset) {
			case 'all':
				for (const r of resetTypes) {
					await this.reset(r);
				}

				await this.container.storage.reset();
				break;

			case 'ai':
				await (await this.container.ai)?.reset(true);
				break;

			case 'avatars':
				resetAvatarCache('all');
				break;

			case 'integrations':
				await this.container.integrations.reset();
				break;

			case 'plus':
				await this.container.subscription.logout(true, undefined);
				break;

			case 'repositoryAccess':
				await this.container.git.clearAllRepoVisibilityCaches();
				break;

			case 'suppressedWarnings':
				await configuration.update('advanced.messages', undefined, ConfigurationTarget.Global);
				break;

			case 'usageTracking':
				await this.container.usage.reset();
				break;

			case 'workspace':
				await this.container.storage.resetWorkspace();
				break;
		}
	}
}

@command()
export class ResetAIKeyCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.ResetAIKey);
	}

	async execute() {
		await (await this.container.ai)?.reset();
	}
}
