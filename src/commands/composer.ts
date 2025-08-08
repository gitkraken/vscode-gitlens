import type { Sources } from '../constants.telemetry';
import type { Container } from '../container';
import { showGenericErrorMessage } from '../messages';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command, executeCommand } from '../system/-webview/command';
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
	repoPath?: string;
	source?: Sources;
	mode?: 'experimental' | 'preview';
}

@command()
export class ComposeCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(['gitlens.ai.composeCommits', 'gitlens.ai.composeCommitsPreview']);
	}

	protected override preExecute(context: CommandContext, args?: ComposeCommandArgs): Promise<void> {
		if (isCommandContextViewNodeHasWorktree(context)) {
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
			args.mode = context.command === 'gitlens.ai.composeCommitsPreview' ? 'preview' : 'experimental';
		}

		return this.execute(args);
	}

	async execute(args?: ComposeCommandArgs): Promise<void> {
		try {
			let repo;
			if (args?.repoPath != null) {
				repo = this.container.git.getRepository(args.repoPath);
			}
			repo ??= await getRepositoryOrShowPicker(this.container, 'Compose Commits');
			if (repo == null) return;

			await executeCommand<WebviewPanelShowCommandArgs>('gitlens.showComposerPage', undefined, {
				repoPath: repo.path,
				source: args?.source,
				mode: args?.mode ?? 'preview',
			});
		} catch (ex) {
			Logger.error(ex, 'ComposeCommand', 'execute');
			void showGenericErrorMessage('Unable to compose commits');
		}
	}
}
