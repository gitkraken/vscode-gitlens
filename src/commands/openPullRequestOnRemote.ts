import { env, window } from 'vscode';
import type { Container } from '../container';
import { shortenRevision } from '../git/utils/revision.utils';
import { command } from '../system/-webview/command';
import { openUrl } from '../system/-webview/vscode/uris';
import { GlCommandBase } from './commandBase';
import type { CommandContext } from './commandContext';

export interface OpenPullRequestOnRemoteCommandArgs {
	clipboard?: boolean;
	ref?: string;
	repoPath?: string;
	pr?: { url: string };
}

@command()
export class OpenPullRequestOnRemoteCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(['gitlens.openPullRequestOnRemote', 'gitlens.copyRemotePullRequestUrl']);
	}

	protected override preExecute(context: CommandContext, args?: OpenPullRequestOnRemoteCommandArgs): Promise<void> {
		if (context.type === 'viewItem' && (context.node.is('pullrequest') || context.node.is('launchpad-item'))) {
			args = {
				...args,
				pr: context.node.pullRequest != null ? { url: context.node.pullRequest.url } : undefined,
				clipboard: context.command === 'gitlens.copyRemotePullRequestUrl',
			};
		}

		return this.execute(args);
	}

	async execute(args?: OpenPullRequestOnRemoteCommandArgs): Promise<void> {
		if (args?.pr == null) {
			if (args?.repoPath == null || args?.ref == null) return;

			const remote = await this.container.git
				.getRepositoryService(args.repoPath)
				.remotes.getBestRemoteWithIntegration();
			if (remote == null) return;

			const integration = await remote?.getIntegration();
			if (integration == null) return;

			const pr = await integration.getPullRequestForCommit(remote.provider.repoDesc, args.ref);
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
			void openUrl(args.pr.url);
		}
	}
}
