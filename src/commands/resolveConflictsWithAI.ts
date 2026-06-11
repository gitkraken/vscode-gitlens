import { uncommitted } from '@gitlens/git/models/revision.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { Container } from '../container.js';
import { showGenericErrorMessage } from '../messages.js';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker.js';
import { command, executeCommand } from '../system/-webview/command.js';
import { GlCommandBase } from './commandBase.js';
import type { CommandContext } from './commandContext.js';
import {
	isCommandContextViewNodeHasFile,
	isCommandContextViewNodeHasRepoPath,
	isCommandContextViewNodeHasRepository,
	isCommandContextViewNodeHasWorktree,
} from './commandContext.utils.js';

export interface ResolveConflictsWithAICommandArgs {
	repoPath?: string;
	/** When set, scopes the run to a single conflicted file; otherwise all conflicts are resolved. */
	filePath?: string;
	source?: string;
}

/**
 * Opens the Commit Graph in the WIP details "Resolve" mode for a repo's merge/rebase/cherry-pick
 * conflicts — the entry point from outside the graph (Command Palette, SCM, sidebar tree views).
 * The actual resolution UI lives in the graph; this command resolves the target repo/file and
 * routes through the graph's `enter-resolve` pending action so there's a single results surface.
 */
@command()
export class ResolveConflictsWithAICommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(['gitlens.ai.resolveConflicts', 'gitlens.ai.resolveConflicts:views']);
	}

	protected override async preExecute(
		context: CommandContext,
		args?: ResolveConflictsWithAICommandArgs,
	): Promise<void> {
		args = { ...args };

		if (isCommandContextViewNodeHasFile(context)) {
			args.repoPath ??= context.node.file.repoPath ?? context.node.repoPath;
			args.filePath ??= context.node.file.path;
			args.source ??= 'view';
		} else if (isCommandContextViewNodeHasWorktree(context)) {
			args.repoPath ??= context.node.worktree.path;
			args.source ??= 'view';
		} else if (isCommandContextViewNodeHasRepository(context)) {
			args.repoPath ??= context.node.repo.path;
			args.source ??= 'view';
		} else if (isCommandContextViewNodeHasRepoPath(context)) {
			args.repoPath ??= context.node.repoPath;
			args.source ??= 'view';
		}

		return this.execute(args);
	}

	async execute(args?: ResolveConflictsWithAICommandArgs): Promise<void> {
		try {
			// Resolve the target repo. When invoked from a surface that already names one (view/scm
			// context), use it; otherwise resolve the workspace repo (single repo → no prompt; several
			// → a picker). `getRepositoryOrShowPicker` is workspace-based, not editor-anchored, so it
			// works from the Command Palette where there's no active editor.
			let repoPath = args?.repoPath;
			if (repoPath == null) {
				const repo = await getRepositoryOrShowPicker(this.container, 'Resolve Conflicts with AI');
				repoPath = repo?.path;
			}
			if (repoPath == null) return;

			// The conflict set is read + surfaced by the graph's resolve mode (idle state lists the
			// conflicted files; the Resolve button disables when there are none), so no pre-check here.
			void executeCommand('gitlens.showGraph', {
				action: 'enter-resolve',
				target: {
					sha: uncommitted,
					worktreePath: repoPath,
					filePaths: args?.filePath != null ? [args.filePath] : undefined,
				},
				source: { source: args?.source ?? 'commandPalette' },
			});
		} catch (ex) {
			Logger.error(ex, 'ResolveConflictsWithAICommand', 'execute');
			void showGenericErrorMessage('Unable to resolve conflicts with AI');
		}
	}
}
