import type { Container } from '../container';
import { RemoteResourceType } from '../git/models/remoteResource';
import type { GitRevisionRangeNotation } from '../git/models/revision';
import { showGenericErrorMessage } from '../messages';
import { command, executeCommand } from '../system/-webview/command';
import { Logger } from '../system/logger';
import { GlCommandBase } from './commandBase';
import type { CommandContext } from './commandContext';
import type { OpenOnRemoteCommandArgs } from './openOnRemote';

export interface OpenComparisonOnRemoteCommandArgs {
	clipboard?: boolean;
	ref1?: string;
	ref2?: string;
	notation?: GitRevisionRangeNotation;
	repoPath?: string;
}

@command()
export class OpenComparisonOnRemoteCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(['gitlens.openComparisonOnRemote', 'gitlens.copyRemoteComparisonUrl']);
	}

	protected override preExecute(context: CommandContext, args?: OpenComparisonOnRemoteCommandArgs): Promise<void> {
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

		if (context.command === 'gitlens.copyRemoteComparisonUrl') {
			args = { ...args, clipboard: true };
		}

		return this.execute(args);
	}

	async execute(args?: OpenComparisonOnRemoteCommandArgs): Promise<void> {
		if (args?.repoPath == null || args.ref1 == null || args.ref2 == null) return;

		try {
			void (await executeCommand<OpenOnRemoteCommandArgs>('gitlens.openOnRemote', {
				resource: {
					type: RemoteResourceType.Comparison,
					base: args.ref1,
					head: args.ref2,
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
