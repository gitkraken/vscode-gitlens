'use strict';
import { ExtensionContext } from 'vscode';
import { ActionContext, HoverCommandsActionContext } from './api/gitlens';
import { Commands, executeCommand, InviteToLiveShareCommandArgs } from './commands';
import { Container } from './container';

export function registerPartnerActionRunners(context: ExtensionContext): void {
	registerLiveShare(context);
}

function registerLiveShare(context: ExtensionContext) {
	context.subscriptions.push(
		Container.actionRunners.registerBuiltInPartner<HoverCommandsActionContext>('liveshare', 'hover.commands', {
			name: 'Live Share',
			label: (context: ActionContext) => {
				if (context.type === 'hover.commands') {
					if (context.commit.author.name !== 'You') {
						return `$(live-share) Invite ${context.commit.author.name}${
							// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
							context.commit.author.presence?.statusText
								? ` (${context.commit.author.presence?.statusText})`
								: ''
						} to a Live Share Session`;
					}
				}

				return '$(live-share) Start a Live Share Session';
			},
			run: async (context: ActionContext) => {
				if (context.type !== 'hover.commands' || context.commit.author.name === 'You') {
					await executeCommand<InviteToLiveShareCommandArgs>(Commands.InviteToLiveShare, {});

					return;
				}

				await executeCommand<InviteToLiveShareCommandArgs>(Commands.InviteToLiveShare, {
					email: context.commit.author.email,
				});
			},
		}),
	);
}
