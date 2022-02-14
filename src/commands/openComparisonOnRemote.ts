import { window } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { RemoteResourceType } from '../git/remotes/provider';
import { Logger } from '../logger';
import { command, executeCommand } from '../system/command';
import { ResultsCommitsNode } from '../views/nodes';
import { Command, CommandContext } from './base';
import { OpenOnRemoteCommandArgs } from './openOnRemote';

export interface OpenComparisonOnRemoteCommandArgs {
	clipboard?: boolean;
	ref1?: string;
	ref2?: string;
	notation?: '..' | '...';
	repoPath?: string;
}

@command()
export class OpenComparisonOnRemoteCommand extends Command {
	constructor(private readonly container: Container) {
		super([Commands.OpenComparisonOnRemote, Commands.CopyRemoteComparisonUrl]);
	}

	protected override preExecute(context: CommandContext, args?: OpenComparisonOnRemoteCommandArgs) {
		if (context.type === 'viewItem') {
			if (context.node instanceof ResultsCommitsNode) {
				args = {
					...args,
					repoPath: context.node.repoPath,
					ref1: context.node.ref1,
					ref2: context.node.ref2,
				};
			}
		}

		if (context.command === Commands.CopyRemoteBranchesUrl) {
			args = { ...args, clipboard: true };
		}

		return this.execute(args);
	}

	async execute(args?: OpenComparisonOnRemoteCommandArgs) {
		if (args?.repoPath == null || args.ref1 == null || args.ref2 == null) return;

		try {
			void (await executeCommand<OpenOnRemoteCommandArgs>(Commands.OpenOnRemote, {
				resource: {
					type: RemoteResourceType.Comparison,
					base: args.ref1,
					compare: args.ref2,
					notation: args.notation,
				},
				repoPath: args.repoPath,
				clipboard: args?.clipboard,
			}));
		} catch (ex) {
			Logger.error(ex, 'OpenComparisonOnRemoteCommand');
			void window.showErrorMessage(
				'Unable to open comparison on remote provider. See output channel for more details',
			);
		}
	}
}
