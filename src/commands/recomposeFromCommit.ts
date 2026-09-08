import { l10n, window } from 'vscode';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { Sources } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import { getRecomposeScopeErrorMessage, resolveRecomposeScope } from '../plus/coretools/compose/recomposeScope.js';
import { command, executeCommand } from '../system/-webview/command.js';
import { getNodeRepoPath } from '../views/nodes/abstract/viewNode.js';
import { GlCommandBase } from './commandBase.js';
import type { CommandContext } from './commandContext.js';
import { isCommandContextViewNodeHasCommit } from './commandContext.utils.js';
import { resolveRecomposeAnchor } from './recompose.utils.js';

export interface RecomposeFromCommitCommandArgs {
	repoPath?: string;
	commitSha?: string;
	branchName?: string;
	source?: Sources;
}

@command()
export class RecomposeFromCommitCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(['gitlens.ai.recomposeFromCommit']);
	}

	protected override preExecute(context: CommandContext, args?: RecomposeFromCommitCommandArgs): Promise<void> {
		if (isCommandContextViewNodeHasCommit(context)) {
			args = { ...args };
			args.repoPath = args.repoPath ?? getNodeRepoPath(context.node);
			args.commitSha = args.commitSha ?? context.node.commit.sha;
			args.source = args.source ?? 'view';
		}

		return this.execute(args);
	}

	async execute(args?: RecomposeFromCommitCommandArgs): Promise<void> {
		try {
			if (!args?.commitSha) {
				void window.showErrorMessage(l10n.t('Unable to recompose: missing commit information'));
				return;
			}

			const repoPath = args.repoPath;
			if (!repoPath) {
				void window.showErrorMessage(l10n.t('Unable to recompose: missing repository information'));
				return;
			}

			const repo = this.container.git.getRepository(repoPath);
			if (repo == null) {
				void window.showErrorMessage(l10n.t('Repository not found'));
				return;
			}

			const commit = await repo.git.commits.getCommit(args.commitSha);
			if (!commit) {
				void window.showErrorMessage(l10n.t("Commit '{0}' not found", args.commitSha));
				return;
			}

			const branchName = args.branchName;
			if (!branchName) {
				void window.showErrorMessage(l10n.t('Unable to determine branch for commit'));
				return;
			}

			const branch = await repo.git.branches.getBranch(branchName);
			if (!branch) {
				void window.showErrorMessage(l10n.t("Branch '{0}' not found", branchName));
				return;
			}

			if (branch.remote && !branch.upstream) {
				void window.showErrorMessage(l10n.t("Cannot recompose remote-only branch '{0}'", branchName));
				return;
			}

			const headCommitSha = branch.sha;
			if (!headCommitSha) {
				void window.showErrorMessage(l10n.t("Unable to determine head commit for branch '{0}'", branchName));
				return;
			}

			const baseCommitSha = commit.parents.length > 0 ? commit.parents[0] : undefined;
			if (!baseCommitSha) {
				void window.showErrorMessage(l10n.t('Unable to determine parent commit'));
				return;
			}

			// Anchor on the branch's worktree (primary or secondary), creating one for a branch
			// with no worktree; stop if the user declines or cancels the creation.
			const anchor = await resolveRecomposeAnchor(this.container, branch);
			if (anchor == null) return;

			const resolved = await resolveRecomposeScope(this.container, anchor.svc, {
				branchName: branchName,
				range: { base: baseCommitSha, head: headCommitSha },
				includeWip: false,
			});
			if (!resolved.ok) {
				void window.showErrorMessage(getRecomposeScopeErrorMessage(resolved, { type: 'from-commit' }));
				return;
			}

			void executeCommand('gitlens.showGraph', {
				action: 'enter-compose',
				target: { sha: uncommitted, worktreePath: anchor.worktreePath },
				composeScope: { shas: resolved.shas, includeWip: resolved.includeWip },
				source: { source: args.source ?? 'commandPalette' },
			});
		} catch (ex) {
			void window.showErrorMessage(l10n.t('Failed to recompose from commit: {0}', String(ex)));
		}
	}
}
