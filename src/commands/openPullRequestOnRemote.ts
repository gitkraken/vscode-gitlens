'use strict';
import { env, Uri } from 'vscode';
import { Command, command, CommandContext, Commands } from './common';
import { Container } from '../container';
import { PullRequestNode } from '../views/nodes';

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
			void (await env.clipboard.writeText(args.pr.url));
		} else {
			void env.openExternal(Uri.parse(args.pr.url));
		}
	}
}
