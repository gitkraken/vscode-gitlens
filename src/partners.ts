import type { CancellationTokenSource, Extension, ExtensionContext, Uri } from 'vscode';
import { extensions, l10n } from 'vscode';
import type { ActionContext, HoverCommandsActionContext } from './api/gitlens.d.js';
import type { InviteToLiveShareCommandArgs } from './commands/inviteToLiveShare.js';
import { Container } from './container.js';
import { executeCommand, executeCoreCommand } from './system/-webview/command.js';
import type { ContactPresence } from './vsls/vsls.js';

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
						if (!context.commit.author.current) {
							const author = context.commit.author.name;
							const status = (context.commit.author.presence as ContactPresence)?.statusText;
							return status
								? l10n.t('$(live-share) Invite {author} ({status}) to a Live Share Session', {
										author: author,
										status: status,
									})
								: l10n.t('$(live-share) Invite {author} to a Live Share Session', { author: author });
						}
					}

					return l10n.t('$(live-share) Start a Live Share Session');
				},
				run: async (context: ActionContext) => {
					if (context.type !== 'hover.commands' || context.commit.author.current) {
						await executeCommand<InviteToLiveShareCommandArgs>('gitlens.inviteToLiveShare', {});

						return;
					}

					await executeCommand<InviteToLiveShareCommandArgs>('gitlens.inviteToLiveShare', {
						email: context.commit.author.email,
					});
				},
			},
		),
	);
}
