'use strict';
import fetch from 'node-fetch';
import {
	CancellationTokenSource,
	commands,
	Disposable,
	env,
	Extension,
	ExtensionContext,
	extensions,
	Uri,
	workspace,
} from 'vscode';
import { ActionRunnerType } from './api/actionRunners';
import { ActionContext, HoverCommandsActionContext } from './api/gitlens';
import { Commands, executeCommand, InviteToLiveShareCommandArgs } from './commands';
import { BuiltInCommands } from './constants';
import { Container } from './container';
import { Strings } from './system';

export async function installExtension<T>(
	extensionId: string,
	tokenSource: CancellationTokenSource,
	timeout: number,
	vsix?: Uri,
): Promise<Extension<T> | undefined> {
	try {
		let timer: any = 0;
		const extension = new Promise<Extension<any> | undefined>(resolve => {
			const disposable = extensions.onDidChange(() => {
				const extension = extensions.getExtension(extensionId);
				if (extension != null) {
					clearTimeout(timer);
					disposable.dispose();

					resolve(extension);
				}
			});

			tokenSource.token.onCancellationRequested(() => {
				disposable.dispose();

				resolve(undefined);
			});
		});

		await commands.executeCommand(BuiltInCommands.InstallExtension, vsix ?? extensionId);
		// Wait for extension activation until timeout expires
		timer = setTimeout(() => tokenSource.cancel(), timeout);

		return extension;
	} catch {
		tokenSource.cancel();
		return undefined;
	}
}

export function registerPartnerActionRunners(context: ExtensionContext): void {
	registerCodeStream(context);
	registerLiveShare(context);
}

function registerCodeStream(context: ExtensionContext): void {
	if (extensions.getExtension('codestream.codestream') != null) return;

	const subscriptions: Disposable[] = [];

	const partnerId = 'codestream';

	async function runner(ctx: ActionContext) {
		const hashes = [];

		for (const repo of await Container.git.getRepositories()) {
			const user = await Container.git.getCurrentUser(repo.path);
			if (user?.email != null) {
				hashes.push(Strings.sha1(`gitlens:${user.email.trim().toLowerCase()}`, 'hex'));
			}
		}

		const config = Container.config.partners?.[partnerId];

		const url = (Container.insiders && config?.url) ?? 'https://api.codestream.com/no-auth/gitlens-user';
		const body: { emailHashes: string[]; machineIdHash: string; installed?: boolean } = {
			emailHashes: hashes,
			machineIdHash: Strings.sha1(`gitlens:${env.machineId.trim().toLowerCase()}`, 'hex'),
		};

		void sendPartnerJsonRequest(url, JSON.stringify(body), 0);

		const tokenSource = new CancellationTokenSource();

		// Re-play action when/if we can find a matching newly installed runner
		const { actionRunners } = Container;
		const rerunDisposable = actionRunners.onDidChange(action => {
			if (action != null && action !== ctx.type) return;

			const runners = actionRunners.get(ctx.type);
			if (runners == null || runners.length === 0) return;

			const runner = runners.find(r => r.type === ActionRunnerType.Partner && r.partnerId === partnerId);
			if (runner != null) {
				rerunDisposable.dispose();

				void runner.run(ctx);
			}
		});
		tokenSource.token.onCancellationRequested(() => rerunDisposable.dispose());

		const extension = await installExtension(
			'codestream.codestream',
			tokenSource,
			30000,
			Container.insiders && config?.vsix != null ? Uri.file(config.vsix) : undefined,
		);

		if (extension == null) {
			rerunDisposable.dispose();

			return;
		}

		void workspace.fs.writeFile(Uri.joinPath(extension.extensionUri, '.gitlens'), new Uint8Array());

		// Unregister the partner runners
		Disposable.from(...subscriptions).dispose();

		body.installed = true;
		void sendPartnerJsonRequest(url, JSON.stringify(body), 0);

		// Wait for 30s for new action runner registrations
		setTimeout(() => tokenSource.cancel(), 30000);
	}

	subscriptions.push(
		Container.actionRunners.registerBuiltInPartnerInstaller(partnerId, 'createPullRequest', {
			name: 'CodeStream: GitHub, GitLab, Bitbucket PRs and Code Review',
			label: 'Create Pull Request in VS Code',
			run: runner,
		}),
		Container.actionRunners.registerBuiltInPartnerInstaller(partnerId, 'openPullRequest', {
			name: 'CodeStream: GitHub, GitLab, Bitbucket PRs and Code Review',
			label: 'Open Pull Request in VS Code',
			run: runner,
		}),
		Container.actionRunners.registerBuiltInPartnerInstaller(partnerId, 'hover.commands', {
			name: 'CodeStream: GitHub, GitLab, Bitbucket PRs and Code Review',
			label: '$(comment) Leave a Comment',
			run: runner,
		}),
	);
	context.subscriptions.push(...subscriptions);
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

async function sendPartnerJsonRequest(url: string, body: string, retryCount: number) {
	try {
		const response = await fetch(url, {
			method: 'POST',
			body: body,
			headers: { 'Content-Type': 'application/json' },
		});

		if (response.ok) return;

		throw new Error(response.statusText);
	} catch (ex) {
		retryCount++;
		if (retryCount > 6) {
			// Give up
			return;
		}

		setTimeout(() => sendPartnerJsonRequest(url, body, retryCount), Math.pow(2, retryCount) * 2000);
	}
}
