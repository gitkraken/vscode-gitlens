import type { CancellationTokenSource, Extension, ExtensionContext, Uri } from 'vscode';
import { extensions } from 'vscode';
import * as nls from 'vscode-nls';
import type { ActionContext, HoverCommandsActionContext } from './api/gitlens';
import type { InviteToLiveShareCommandArgs } from './commands';
import { Commands, CoreCommands } from './constants';
import { Container } from './container';
import { executeCommand, executeCoreCommand } from './system/command';
import type { ContactPresence } from './vsls/vsls';

const localize = nls.loadMessageBundle();
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

		await executeCoreCommand(CoreCommands.InstallExtension, vsix ?? extensionId);
		// Wait for extension activation until timeout expires
		timer = setTimeout(() => {
			timer = undefined;
			tokenSource.cancel();
		}, timeout);

		return extension;
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
						if (context.commit.author.name !== localize('you', 'You')) {
							return `$(live-share) ${
								(context.commit.author.presence as ContactPresence)?.statusText
									? localize(
											'inviteCommitAuthorWithStatusToLiveShareSession',
											'Invite {0} ({1}) to a Live Share Session',
											context.commit.author.name,
											(context.commit.author.presence as ContactPresence)?.statusText,
									  )
									: localize(
											'inviteCommitAuthorToLiveShareSession',
											'Invite {0} to a Live Share Session',
											context.commit.author.name,
									  )
							}`;
						}
					}

					return `$(live-share) ${localize('startLiveShareSession', 'Start a Live Share Session')}`;
				},
				run: async (context: ActionContext) => {
					if (context.type !== 'hover.commands' || context.commit.author.name === localize('you', 'You')) {
						await executeCommand<InviteToLiveShareCommandArgs>(Commands.InviteToLiveShare, {});

						return;
					}

					await executeCommand<InviteToLiveShareCommandArgs>(Commands.InviteToLiveShare, {
						email: context.commit.author.email,
					});
				},
			},
		),
	);
}
