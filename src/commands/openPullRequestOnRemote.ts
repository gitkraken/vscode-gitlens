import { env, Uri, window } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { shortenRevision } from '../git/models/reference';
import { command } from '../system/command';
import { PullRequestNode } from '../views/nodes/pullRequestNode';
import type { CommandContext } from './base';
import { Command } from './base';

export interface OpenPullRequestOnRemoteCommandArgs {
	clipboard?: boolean;
	ref?: string;
	repoPath?: string;
	pr?: { url: string };
}

@command()
export class OpenPullRequestOnRemoteCommand extends Command {
	constructor(private readonly container: Container) {
		super([Commands.OpenPullRequestOnRemote, Commands.CopyRemotePullRequestUrl]);
	}

	protected override preExecute(context: CommandContext, args?: OpenPullRequestOnRemoteCommandArgs) {
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

			const remote = await this.container.git.getBestRemoteWithRichProvider(args.repoPath);
			if (!remote?.hasRichIntegration()) return;

			const pr = await remote.provider.getPullRequestForCommit(args.ref);
			if (pr == null) {
				void window.showInformationMessage(`No pull request associated with '${shortenRevision(args.ref)}'`);
				return;
			}

			args = { ...args };
			args.pr = pr;
		}

		if (args.clipboard) {
			await env.clipboard.writeText(args.pr.url);
		} else {
			void env.openExternal(Uri.parse(args.pr.url));
		}
	}
}
