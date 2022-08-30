import { env, Uri } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { command } from '../system/command';
import { AutolinkedItemNode } from '../views/nodes/autolinkedItemNode';
import type { CommandContext } from './base';
import { Command } from './base';

export interface OpenIssueOnRemoteCommandArgs {
	clipboard?: boolean;
	issue: { url: string };
}

@command()
export class OpenIssueOnRemoteCommand extends Command {
	constructor(private readonly container: Container) {
		super([
			Commands.OpenIssueOnRemote,
			Commands.CopyRemoteIssueUrl,
			Commands.OpenAutolinkUrl,
			Commands.CopyAutolinkUrl,
		]);
	}

	protected override preExecute(context: CommandContext, args: OpenIssueOnRemoteCommandArgs) {
		if (context.type === 'viewItem' && context.node instanceof AutolinkedItemNode) {
			args = {
				...args,
				issue: { url: context.node.item.url },
				clipboard:
					context.command === Commands.CopyRemoteIssueUrl || context.command === Commands.CopyAutolinkUrl,
			};
		}

		return this.execute(args);
	}

	async execute(args: OpenIssueOnRemoteCommandArgs) {
		if (args.clipboard) {
			await env.clipboard.writeText(args.issue.url);
		} else {
			void env.openExternal(Uri.parse(args.issue.url));
		}
	}
}
