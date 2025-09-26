import type { MessageItem } from 'vscode';
import { ConfigurationTarget, window } from 'vscode';
import { resetAvatarCache } from '../avatars';
import type { Container } from '../container';
import type { QuickPickItemOfT } from '../quickpicks/items/common';
import { createQuickPickSeparator } from '../quickpicks/items/common';
import { command } from '../system/-webview/command';
import { configuration } from '../system/-webview/configuration';
import { GlCommandBase } from './commandBase';

const resetTypes = [
	'ai',
	'ai:confirmations',
	'avatars',
	'banners',
	'integrations',
	'previews',
	'promoOptIns',
	'repositoryAccess',
	'subscription',
	'suppressedWarnings',
	'usageTracking',
	'workspace',
] as const;
type ResetType = 'all' | (typeof resetTypes)[number];

@command()
export class ResetCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.reset');
	}
	async execute(): Promise<void> {
		type ResetQuickPickItem = QuickPickItemOfT<ResetType>;

		const items: ResetQuickPickItem[] = [
			{
				label: 'AI Keys...',
				detail: 'Clears any locally stored AI keys',
				item: 'ai',
			},
			{
				label: 'AI Confirmations...',
				detail: 'Clears any accepted AI confirmations',
				item: 'ai:confirmations',
			},
			{
				label: 'Avatars...',
				detail: 'Clears the stored avatar cache',
				item: 'avatars',
			},
			{
				label: 'Banners...',
				detail: 'Resets dismissed banners/notices',
				item: 'banners',
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

		if (DEBUG) {
			items.push(
				createQuickPickSeparator('DEBUG'),
				{
					label: 'Reset Subscription...',
					detail: 'Resets the stored subscription',
					item: 'subscription',
				},
				{
					label: 'Reset Feature Previews...',
					detail: 'Resets the stored state for feature previews',
					item: 'previews',
				},
				{
					label: 'Promo Opt-Ins...',
					detail: 'Clears any locally stored promo opt-ins',
					item: 'promoOptIns',
				},
			);
		}

		// create a quick pick with options to clear all the different resets that GitLens supports
		const pick = await window.showQuickPick<ResetQuickPickItem>(items, {
			title: 'Reset Stored Data',
			placeHolder: 'Choose which data to reset, will be prompted to confirm',
		});

		if (pick?.item == null) return;

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
			case 'ai:confirmations':
				confirmationMessage = 'Are you sure you want to reset all AI confirmations?';
				confirm.title = 'Reset AI Confirmations';
				break;
			case 'avatars':
				confirmationMessage = 'Are you sure you want to reset the avatar cache?';
				confirm.title = 'Reset Avatars';
				break;
			case 'banners':
				confirmationMessage = 'Are you sure you want to reset all dismissed banners/notices?';
				confirm.title = 'Reset Banners';
				break;
			case 'integrations':
				confirmationMessage = 'Are you sure you want to reset all of the stored integrations?';
				confirm.title = 'Reset Integrations';
				break;
			case 'previews':
				confirmationMessage = 'Are you sure you want to reset the stored state for feature previews?';
				confirm.title = 'Reset Feature Previews';
				break;
			case 'promoOptIns':
				confirmationMessage = 'Are you sure you want to reset all of the locally stored promo opt-ins?';
				confirm.title = 'Reset Promo Opt-Ins';
				break;
			case 'repositoryAccess':
				confirmationMessage = 'Are you sure you want to reset the repository access cache?';
				confirm.title = 'Reset Repository Access';
				break;
			case 'subscription':
				confirmationMessage = 'Are you sure you want to reset the stored subscription?';
				confirm.title = 'Reset Subscription';
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
			default: {
				const _exhaustiveCheck: never = pick.item;
				break;
			}
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
				await this.container.ai.reset(true);
				break;

			case 'ai:confirmations':
				this.container.ai.resetConfirmations();
				break;

			case 'avatars':
				resetAvatarCache('all');
				break;

			case 'banners':
				await this.container.storage.delete('home:sections:collapsed');
				await this.container.storage.delete('home:walkthrough:dismissed');
				await this.container.storage.delete('mcp:banner:dismissed');

				// Deprecated keys
				await this.container.storage.delete('home:banners:dismissed');
				await this.container.storage.delete('home:sections:dismissed');
				break;

			case 'integrations':
				await this.container.integrations.reset();
				break;

			case 'promoOptIns':
				await this.container.storage.deleteWithPrefix('gk:promo');
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
			default:
				if (DEBUG) {
					switch (reset) {
						case 'subscription':
							await this.container.storage.delete('premium:subscription');
							break;
						case 'previews':
							await this.container.storage.deleteWithPrefix('plus:preview');
							break;
					}
				}
				break;
		}
	}
}
