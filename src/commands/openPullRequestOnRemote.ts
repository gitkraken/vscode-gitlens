'use strict';
import { env, Uri } from 'vscode';
import {
	Command,
	command,
	CommandContext,
	Commands,
	isCommandContextViewNodeHasCommit,
	isCommandContextViewNodeHasFileCommit,
} from './common';
import { Container } from '../container';
import { PullRequestNode } from '../views/nodes/pullRequestNode';

export interface OpenPullRequestOnRemoteCommandArgs {
	ref?: string;
	repoPath?: string;
	pr?: { url: string };
}

@command()
export class OpenPullRequestOnRemoteCommand extends Command {
	constructor() {
		super([Commands.OpenPullRequestOnRemote, Commands.OpenAssociatedPullRequestOnRemote]);
	}

	protected preExecute(context: CommandContext, args?: OpenPullRequestOnRemoteCommandArgs) {
		if (context.command === Commands.OpenPullRequestOnRemote) {
			if (context.type === 'viewItem' && context.node instanceof PullRequestNode) {
				args = {
					...args,
					pr: { url: context.node.pullRequest.url },
				};
			}
		} else if (isCommandContextViewNodeHasCommit(context) || isCommandContextViewNodeHasFileCommit(context)) {
			args = { ...args, ref: context.node.commit.sha, repoPath: context.node.commit.repoPath };
		}

		return this.execute(args);
	}

	async execute(args?: OpenPullRequestOnRemoteCommandArgs) {
		if (args?.pr == null) {
			if (args?.repoPath == null || args?.ref == null) return;

			const remote = await Container.git.getRemoteWithApiProvider(args.repoPath);
			if (remote?.provider == null) return;

			const pr = await Container.git.getPullRequestForCommit(args.ref, remote.provider);
			if (pr == null) return;

			args = { ...args };
			args.pr = pr;
		}

		void env.openExternal(Uri.parse(args.pr.url));
	}
}
