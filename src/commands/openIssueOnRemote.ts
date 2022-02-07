import { env, Uri } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { command } from '../system/command';
import { AutolinkedItemNode } from '../views/nodes/autolinkedItemNode';
import { Command, CommandContext } from './base';

export interface OpenIssueOnRemoteCommandArgs {
	clipboard?: boolean;
	issue: { url: string };
}

@command()
export class OpenIssueOnRemoteCommand extends Command {
	constructor(private readonly container: Container) {
		super([Commands.OpenIssueOnRemote, Commands.CopyRemoteIssueUrl]);
	}

	protected override preExecute(context: CommandContext, args: OpenIssueOnRemoteCommandArgs) {
		if (context.type === 'viewItem' && context.node instanceof AutolinkedItemNode) {
			args = {
				...args,
				issue: { url: context.node.issue.url },
				clipboard: context.command === Commands.CopyRemotePullRequestUrl,
			};
		}

		return this.execute(args);
	}

	async execute(args: OpenIssueOnRemoteCommandArgs) {
		if (args.clipboard) {
			void (await env.clipboard.writeText(args.issue.url));
		} else {
			void env.openExternal(Uri.parse(args.issue.url));
		}
	}
}
