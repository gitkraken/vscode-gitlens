import { env, l10n, window } from 'vscode';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import { shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import { LookupBackedOffError } from '@gitlens/integrations/index.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { Container } from '../container.js';
import { getBestRemoteWithIntegration, getRemoteIntegration } from '../git/utils/-webview/remote.utils.js';
import { showGenericErrorMessage } from '../messages.js';
import { command } from '../system/-webview/command.js';
import { openUrl } from '../system/-webview/vscode/uris.js';
import { GlCommandBase } from './commandBase.js';
import type { CommandContext } from './commandContext.js';

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

			const remote = await getBestRemoteWithIntegration(args.repoPath);
			if (remote == null) return;

			const integration = await getRemoteIntegration(remote);
			if (integration == null) return;

			let pr: PullRequest | undefined;
			try {
				try {
					pr = await integration.getPullRequestForCommit(remote.provider.repoDesc, args.ref, {
						throwOnError: true,
					});
				} catch (ex) {
					if (!(ex instanceof LookupBackedOffError)) throw ex;
				}

				pr ??= await integration.getPullRequestForCommit(remote.provider.repoDesc, args.ref, {
					expiryOverride: true,
					throwOnError: true,
				});
			} catch (ex) {
				if (isCancellationError(ex)) return;

				Logger.error(ex, 'OpenPullRequestOnRemoteCommand');
				void showGenericErrorMessage(
					l10n.t("Unable to get the pull request associated with '{0}'", shortenRevision(args.ref)),
				);
				return;
			}
			if (pr == null) {
				void window.showInformationMessage(
					l10n.t("No pull request associated with '{0}'", shortenRevision(args.ref)),
				);
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
