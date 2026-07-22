import { window } from 'vscode';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { Sources } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import { resolveRecomposeScope } from '../plus/coretools/compose/recomposeScope.js';
import { CommandQuickPickItem } from '../quickpicks/items/common.js';
import { showReferencePicker2 } from '../quickpicks/referencePicker.js';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker.js';
import { command, executeCommand } from '../system/-webview/command.js';
import { getNodeRepoPath } from '../views/nodes/abstract/viewNode.js';
import { GlCommandBase } from './commandBase.js';
import type { CommandContext } from './commandContext.js';
import { isCommandContextViewNodeHasBranch } from './commandContext.utils.js';
import { resolveRecomposeAnchor } from './recompose.utils.js';

export interface RecomposeBranchCommandArgs {
	repoPath?: string;
	branchName?: string;
	/** Optional filter: if provided, only these commits are selectable for composition */
	commitShas?: string[];
	/** If provided, defines the commit range directly (skips merge target resolution) */
	range?: { base: string; head: string };
	source?: Sources;
}

@command()
export class RecomposeBranchCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super([
			'gitlens.ai.recomposeBranch',
			'gitlens.ai.recomposeBranch:views',
			'gitlens.ai.recomposeSelectedCommits',
		]);
	}

	protected override preExecute(context: CommandContext, args?: RecomposeBranchCommandArgs): Promise<void> {
		if (isCommandContextViewNodeHasBranch(context)) {
			args = { ...args };
			args.repoPath = args.repoPath ?? getNodeRepoPath(context.node);
			args.branchName = args.branchName ?? context.node.branch.name;
			args.source = args.source ?? 'view';
		}

		return this.execute(args);
	}

	async execute(args?: RecomposeBranchCommandArgs): Promise<void> {
		try {
			// Get repository path using picker fallback
			const repoPath =
				args?.repoPath ??
				(await getBestRepositoryOrShowPicker(this.container, undefined, undefined, 'Recompose Branch'))?.path;
			if (!repoPath) return;

			args = { ...args };

			// Get branch name using picker fallback
			let branchName = args.branchName;
			if (!branchName) {
				const result = await showReferencePicker2(
					repoPath,
					'Recompose Branch',
					'Choose a branch to recompose',
					{
						include: ['branches'],
						sort: { branches: { current: true } },
					},
				);
				if (result.value == null || result.value instanceof CommandQuickPickItem) return;

				const pick = result.value;
				if (pick.refType === 'branch') {
					branchName = pick.name;
				} else {
					return;
				}
			}

			// Validate that the repository exists
			const repo = this.container.git.getRepository(repoPath);
			if (!repo) {
				void window.showErrorMessage('Repository not found');
				return;
			}

			// Validate that the branch exists
			const branch = await repo.git.branches.getBranch(branchName);
			if (!branch) {
				void window.showErrorMessage(`Branch '${branchName}' not found`);
				return;
			}

			// Check if branch is remote-only
			if (branch.remote && !branch.upstream) {
				void window.showErrorMessage(`Cannot recompose remote-only branch '${branchName}'`);
				return;
			}

			// Anchor on the branch's worktree (primary or secondary), creating one for a branch
			// with no worktree; stop if the user declines or cancels the creation.
			const anchor = await resolveRecomposeAnchor(this.container, branch);
			if (anchor == null) return;

			const resolved = await resolveRecomposeScope(this.container, anchor.svc, {
				branchName: branchName,
				commitShas: args?.commitShas,
				range: args?.range,
				includeWip: false,
			});
			if (!resolved.ok) {
				void window.showErrorMessage(`Unable to recompose branch '${branchName}': ${resolved.message}`);
				return;
			}

			void executeCommand('gitlens.showGraph', {
				action: 'enter-compose',
				target: { sha: uncommitted, worktreePath: anchor.worktreePath },
				composeScope: { shas: resolved.shas, includeWip: resolved.includeWip },
				source: { source: args?.source ?? 'commandPalette' },
			});
		} catch (ex) {
			void window.showErrorMessage(`Failed to recompose branch: ${ex}`);
		}
	}
}
