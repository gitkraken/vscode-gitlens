import type { Uri } from 'vscode';
import type { Sources } from '../constants.telemetry';
import type { Container } from '../container';
import { showGenericErrorMessage } from '../messages';
import { command, executeCommand } from '../system/-webview/command';
import { configuration } from '../system/-webview/configuration';
import { Logger } from '../system/logger';
import type { WebviewPanelShowCommandArgs } from '../webviews/webviewsController';
import { GlCommandBase } from './commandBase';
import type { CommandContext } from './commandContext';
import {
	isCommandContextViewNodeHasRepoPath,
	isCommandContextViewNodeHasRepository,
	isCommandContextViewNodeHasWorktree,
} from './commandContext.utils';

export interface ComposeCommandArgs {
	repoPath?: string | Uri;
	source?: Sources;
	mode?: 'experimental' | 'preview';
}

@command()
export class ComposeCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(['gitlens.composeCommits', 'gitlens.composeCommits:scm']);
	}

	protected override async preExecute(context: CommandContext, args?: ComposeCommandArgs): Promise<void> {
		if (context.command === 'gitlens.composeCommits:scm') {
			args = { ...args };
			args.source = args.source ?? 'scm';

			if (context.type === 'scm' && context.scm.rootUri != null) {
				args.repoPath = context.scm.rootUri;
			} else if (context.type === 'scm-groups') {
				const uri = context.scmResourceGroups[0]?.resourceStates[0]?.resourceUri;
				if (uri != null) {
					const repo = await this.container.git.getOrOpenRepository(uri);
					args.repoPath = repo?.path;
				}
			}
		} else if (isCommandContextViewNodeHasWorktree(context)) {
			args = { ...args };
			args.repoPath = context.node.worktree.path;
			args.source = args.source ?? 'view';
		} else if (isCommandContextViewNodeHasRepository(context)) {
			args = { ...args };
			args.repoPath = context.node.repo.path;
			args.source = args.source ?? 'view';
		} else if (isCommandContextViewNodeHasRepoPath(context)) {
			args = { ...args };
			args.repoPath = context.node.repoPath;
			args.source = args.source ?? 'view';
		}

		if (args != null) {
			args.mode = configuration.get('ai.experimental.composer.enabled') ? 'experimental' : 'preview';
		}

		return this.execute(args);
	}

	async execute(args?: ComposeCommandArgs): Promise<void> {
		try {
			await executeCommand<WebviewPanelShowCommandArgs>('gitlens.showComposerPage', undefined, {
				repoPath: args?.repoPath,
				source: args?.source,
				mode: args?.mode,
			});
		} catch (ex) {
			Logger.error(ex, 'ComposeCommand', 'execute');
			void showGenericErrorMessage('Unable to compose commits');
		}
	}
}
