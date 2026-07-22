import type { Uri } from 'vscode';
import { uncommitted } from '@gitlens/git/models/revision.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { Source, Sources } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import { showGenericErrorMessage } from '../messages.js';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker.js';
import { command, executeCommand } from '../system/-webview/command.js';
import { GlCommandBase } from './commandBase.js';
import type { CommandContext } from './commandContext.js';
import {
	isCommandContextViewNodeHasRepoPath,
	isCommandContextViewNodeHasRepository,
	isCommandContextViewNodeHasWorktree,
} from './commandContext.utils.js';

export interface ComposerCommandArgs {
	repoPath?: string | Uri;
	source?: Sources | Source;
	includedUnstagedChanges?: boolean;
	branchName?: string;
	/** Optional filter: if provided, only these commits are selectable for composition */
	commitShas?: string[];
	/** If provided, defines the commit range directly (skips merge target resolution) */
	range?: { base: string; head: string };
	autoComposeInstructions?: string;
}

/**
 * Opens the Commit Graph in the WIP details "Compose" mode for a repo's uncommitted changes —
 * the entry point from outside the graph (Command Palette, SCM, sidebar tree views, MCP).
 * The actual compose UI lives in the graph; this command resolves the target repo and routes
 * through the graph's `enter-compose` pending action so there's a single results surface.
 */
@command()
export class ComposeCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(['gitlens.composeCommits', 'gitlens.composeCommits:scm']);
	}

	protected override async preExecute(context: CommandContext, args?: ComposerCommandArgs): Promise<void> {
		if (context.command === 'gitlens.composeCommits:scm') {
			args = { ...args };
			args.source = args.source ?? 'scm';

			if (context.type === 'scm' && context.scm.rootUri != null) {
				args.repoPath = context.scm.rootUri;
			} else if (context.type === 'scm-groups') {
				const group = context.scmResourceGroups[0];
				const uri = group?.resourceStates[0]?.resourceUri;
				if (uri != null) {
					const repo = await this.container.git.getOrAddRepository(uri, { opened: false });
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

		return this.execute(args);
	}

	async execute(args?: ComposerCommandArgs): Promise<void> {
		try {
			// Normalize to a repo path string (context surfaces may pass a Uri; palette passes nothing).
			let repoPath: string | undefined;
			const rawRepo = args?.repoPath;
			if (rawRepo != null) {
				if (typeof rawRepo === 'string') {
					repoPath = rawRepo;
				} else {
					const repo = await this.container.git.getOrAddRepository(rawRepo, { opened: false });
					repoPath = repo?.path;
				}
			}
			if (repoPath == null) {
				const repo = await getRepositoryOrShowPicker(this.container, 'Compose Commits');
				repoPath = repo?.path;
			}
			if (repoPath == null) return;

			// `args.source` may already be a Source object (e.g. the MCP path) or a plain Sources string
			// (scm/view/palette) — normalize without double-wrapping.
			const source: Source =
				typeof args?.source === 'string'
					? { source: args.source }
					: (args?.source ?? { source: 'commandPalette' });

			void executeCommand('gitlens.showGraph', {
				action: 'enter-compose',
				target: { sha: uncommitted, worktreePath: repoPath },
				source: source,
				composeInstructions: args?.autoComposeInstructions,
			});
		} catch (ex) {
			Logger.error(ex, 'ComposeCommand', 'execute');
			void showGenericErrorMessage('Unable to compose commits');
		}
	}
}
