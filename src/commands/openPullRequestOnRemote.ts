'use strict';
import { env, Uri, window } from 'vscode';
import { Command, command, CommandContext, Commands } from './common';
import { Container } from '../container';
import { PullRequestNode } from '../views/nodes';
import { Logger } from '../logger';
import { Messages } from '../messages';

export interface OpenPullRequestOnRemoteCommandArgs {
	clipboard?: boolean;
	ref?: string;
	repoPath?: string;
	pr?: { url: string };
}

@command()
export class OpenPullRequestOnRemoteCommand extends Command {
	constructor() {
		super([Commands.OpenPullRequestOnRemote, Commands.CopyRemotePullRequestUrl]);
	}

	protected preExecute(context: CommandContext, args?: OpenPullRequestOnRemoteCommandArgs) {
		if (context.type === 'viewItem' && context.node instanceof PullRequestNode) {
			args = {
				...args,
				pr: { url: context.node.pullRequest.url },
				clipboard: context.command === Commands.CopyRemotePullRequestUrl,
			};
		}

		return this.execute(args);
	}

	async execute(args?: OpenPullRequestOnRemoteCommandArgs) {
		if (args?.pr == null) {
			if (args?.repoPath == null || args?.ref == null) return;

			const remote = await Container.git.getRichRemoteProvider(args.repoPath);
			if (remote?.provider == null) return;

			const pr = await Container.git.getPullRequestForCommit(args.ref, remote.provider);
			if (pr == null) return;

			args = { ...args };
			args.pr = pr;
		}

		if (args.clipboard) {
			try {
				void (await env.clipboard.writeText(args.pr.url));
			} catch (ex) {
				const msg: string = ex?.toString() ?? '';
				if (msg.includes("Couldn't find the required `xsel` binary")) {
					void window.showErrorMessage(
						'Unable to copy remote url, xsel is not installed. Please install it via your package manager, e.g. `sudo apt install xsel`',
					);

					return;
				}

				Logger.error(ex, 'CopyRemotePullRequestCommand');
				void Messages.showGenericErrorMessage('Unable to copy pull request url');
			}
		} else {
			void env.openExternal(Uri.parse(args.pr.url));
		}
	}
}
