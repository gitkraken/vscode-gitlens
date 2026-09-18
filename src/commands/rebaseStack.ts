import { l10n, window } from 'vscode';
import { Logger } from '@gitlens/utils/logger.js';
import type { Source, Sources } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import { showGenericErrorMessage } from '../messages.js';
import { resolveStackRebasePlan } from '../plus/coretools/conflict/stackRebase.utils.js';
import {
	confirmStackRebase,
	forcePushStackForRepo,
	startStackRebaseRun,
} from '../plus/coretools/conflict/stackRebaseProgress.js';
import { ensurePaidPlan } from '../plus/gk/utils/-webview/plus.utils.js';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker.js';
import { command } from '../system/-webview/command.js';
import { GlCommandBase } from './commandBase.js';

export interface RebaseStackCommandArgs {
	repoPath?: string;
	pullRequestNumber?: number;
	source?: Sources;
}

/**
 * Resolves the repo, plans the stack cascade, confirms with the user, and starts the run — the
 * shared implementation behind `gitlens.git.rebaseStack` / `gitlens.ai.autoRebaseStack` and the
 * rebase wizard's `rebase-stack` pseudo-flag. Exported standalone so the wizard can reuse it
 * without going through the command dispatcher.
 */
export async function rebaseStack(
	container: Container,
	mode: 'manual' | 'ai',
	args?: RebaseStackCommandArgs,
): Promise<void> {
	const source: Source = { source: args?.source ?? 'commandPalette' };

	let repoPath = args?.repoPath;
	if (repoPath == null) {
		const repo = await getRepositoryOrShowPicker(container, l10n.t('Rebase Stack'));
		repoPath = repo?.path;
	}
	if (repoPath == null) return;

	const svc = container.git.getRepositoryService(repoPath);

	const result = await resolveStackRebasePlan(container, svc, { pullRequestNumber: args?.pullRequestNumber });
	if (!result.ok) {
		void window.showWarningMessage(result.message);
		return;
	}

	const confirmedMode = await confirmStackRebase(container, result.plan, mode);
	if (confirmedMode == null) return;

	await startStackRebaseRun(container, svc, result.plan, confirmedMode, source);
}

/**
 * Rebases every branch of a GitHub stacked-pull-request chain, bottom to top, stopping at each
 * conflict for the user to resolve. The AI counterpart is {@link AutoRebaseStackCommand}.
 */
@command()
export class RebaseStackCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.git.rebaseStack');
	}

	async execute(args?: RebaseStackCommandArgs): Promise<void> {
		try {
			await rebaseStack(this.container, 'manual', args);
		} catch (ex) {
			Logger.error(ex, 'RebaseStackCommand', 'execute');
			void showGenericErrorMessage(l10n.t('Unable to rebase the stack'));
		}
	}
}

/**
 * Rebases every branch of a GitHub stacked-pull-request chain, bottom to top, with AI resolving
 * conflicts as it goes and stopping only when it needs help. The manual counterpart is
 * {@link RebaseStackCommand}.
 */
@command()
export class AutoRebaseStackCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.ai.autoRebaseStack');
	}

	async execute(args?: RebaseStackCommandArgs): Promise<void> {
		if (
			!(await ensurePaidPlan(this.container, l10n.t('Auto-Rebase Stack is a Pro feature.'), {
				source: args?.source ?? 'commandPalette',
			}))
		) {
			return;
		}

		try {
			await rebaseStack(this.container, 'ai', args);
		} catch (ex) {
			Logger.error(ex, 'AutoRebaseStackCommand', 'execute');
			void showGenericErrorMessage(l10n.t('Unable to start the Auto-Rebase Stack'));
		}
	}
}

export interface ForcePushStackCommandArgs {
	repoPath?: string;
	source?: Sources;
}

/**
 * Force pushes the branches the repository's last completed stack rebase rewrote — the durable way to
 * publish a cascade, since the completion toast auto-hides and the branch-level Force Push knows
 * nothing about the stack. Serves both modes: the Auto-Rebase summary sheet only exists for AI runs.
 */
@command()
export class ForcePushStackCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.git.forcePushStack');
	}

	async execute(args?: ForcePushStackCommandArgs): Promise<void> {
		try {
			const source: Source = { source: args?.source ?? 'commandPalette' };

			let repoPath = args?.repoPath;
			if (repoPath == null) {
				const repo = await getRepositoryOrShowPicker(this.container, l10n.t('Force Push Stack'));
				repoPath = repo?.path;
			}
			if (repoPath == null) return;

			const svc = this.container.git.getRepositoryService(repoPath);
			await forcePushStackForRepo(this.container, svc, source);
		} catch (ex) {
			Logger.error(ex, 'ForcePushStackCommand', 'execute');
			void showGenericErrorMessage(l10n.t('Unable to force push the stack'));
		}
	}
}
