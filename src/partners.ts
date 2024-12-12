import type { CancellationTokenSource, Extension, ExtensionContext, Uri } from 'vscode';
import { extensions } from 'vscode';
import type { ActionContext, HoverCommandsActionContext } from './api/gitlens';
import type { InviteToLiveShareCommandArgs } from './commands/inviteToLiveShare';
import { GlCommand } from './constants.commands';
import { Container } from './container';
import { executeCommand, executeCoreCommand } from './system/vscode/command';
import type { ContactPresence } from './vsls/vsls';

export async function installExtension<T>(
	extensionId: string,
	tokenSource: CancellationTokenSource,
	timeout: number,
	vsix?: Uri,
): Promise<Extension<T> | undefined> {
	try {
		let timer: ReturnType<typeof setTimeout> | undefined = undefined;
		const extension = new Promise<Extension<any> | undefined>(resolve => {
			const disposable = extensions.onDidChange(() => {
				const extension = extensions.getExtension(extensionId);
				if (extension != null) {
					if (timer != null) {
						clearTimeout(timer);
						timer = undefined;
					}
					disposable.dispose();

					resolve(extension);
				}
			});

			tokenSource.token.onCancellationRequested(() => {
				disposable.dispose();

				resolve(undefined);
			});
		});

		await executeCoreCommand('workbench.extensions.installExtension', vsix ?? extensionId);
		// Wait for extension activation until timeout expires
		timer = setTimeout(() => {
			timer = undefined;
			tokenSource.cancel();
		}, timeout);

		return await extension;
	} catch {
		tokenSource.cancel();
		return undefined;
	}
}

export function registerPartnerActionRunners(context: ExtensionContext): void {
	registerLiveShare(context);
}

function registerLiveShare(context: ExtensionContext) {
	context.subscriptions.push(
		Container.instance.actionRunners.registerBuiltInPartner<HoverCommandsActionContext>(
			'liveshare',
			'hover.commands',
			{
				name: 'Live Share',
				label: (context: ActionContext) => {
					if (context.type === 'hover.commands') {
						if (context.commit.author.name !== 'You') {
							return `$(live-share) Invite ${context.commit.author.name}${
								(context.commit.author.presence as ContactPresence)?.statusText
									? ` (${(context.commit.author.presence as ContactPresence)?.statusText})`
									: ''
							} to a Live Share Session`;
						}
					}

					return '$(live-share) Start a Live Share Session';
				},
				run: async (context: ActionContext) => {
					if (context.type !== 'hover.commands' || context.commit.author.name === 'You') {
						await executeCommand<InviteToLiveShareCommandArgs>(GlCommand.InviteToLiveShare, {});

						return;
					}

					await executeCommand<InviteToLiveShareCommandArgs>(GlCommand.InviteToLiveShare, {
						email: context.commit.author.email,
					});
				},
			},
		),
	);
}
