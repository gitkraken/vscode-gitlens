import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { RemoteResourceType } from '../git/models/remoteResource';
import { showGenericErrorMessage } from '../messages';
import { Logger } from '../system/logger';
import { command, executeCommand } from '../system/vscode/command';
import type { CommandContext } from './base';
import { GlCommandBase } from './base';
import type { OpenOnRemoteCommandArgs } from './openOnRemote';

export interface OpenComparisonOnRemoteCommandArgs {
	clipboard?: boolean;
	ref1?: string;
	ref2?: string;
	notation?: '..' | '...';
	repoPath?: string;
}

@command()
export class OpenComparisonOnRemoteCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super([GlCommand.OpenComparisonOnRemote, GlCommand.CopyRemoteComparisonUrl]);
	}

	protected override preExecute(context: CommandContext, args?: OpenComparisonOnRemoteCommandArgs) {
		if (context.type === 'viewItem') {
			if (context.node.isAny('results-commits')) {
				args = {
					...args,
					repoPath: context.node.repoPath,
					ref1: context.node.ref1 || 'HEAD',
					ref2: context.node.ref2 || 'HEAD',
				};
			} else if (context.node.is('compare-results')) {
				args = {
					...args,
					repoPath: context.node.repoPath,
					ref1: context.node.ahead.ref1,
					ref2: context.node.ahead.ref2,
				};
			} else if (context.node.is('compare-branch')) {
				args = {
					...args,
					repoPath: context.node.repoPath,
					ref1: context.node.ahead.ref1,
					ref2: context.node.ahead.ref2,
				};
			}
		}

		if (context.command === GlCommand.CopyRemoteComparisonUrl) {
			args = { ...args, clipboard: true };
		}

		return this.execute(args);
	}

	async execute(args?: OpenComparisonOnRemoteCommandArgs) {
		if (args?.repoPath == null || args.ref1 == null || args.ref2 == null) return;

		try {
			void (await executeCommand<OpenOnRemoteCommandArgs>(GlCommand.OpenOnRemote, {
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
			void showGenericErrorMessage('Unable to open comparison on remote provider');
		}
	}
}
