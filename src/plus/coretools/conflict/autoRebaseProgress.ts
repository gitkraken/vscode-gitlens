import { ProgressLocation, window } from 'vscode';
import { uncommitted } from '@gitlens/git/models/revision.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { Source } from '../../../constants.telemetry.js';
import type { Container } from '../../../container.js';
import { abortPausedOperation } from '../../../git/actions/pausedOperation.js';
import type { GitRepositoryService } from '../../../git/gitRepositoryService.js';
import { executeCommand } from '../../../system/-webview/command.js';
import type { AutoRebaseSession } from './autoRebase.types.js';
import type { AutoRebaseStartOptions } from './autoRebaseService.js';

/**
 * Runs an automatic rebase behind a cancellable progress notification (cancel = abort, restoring
 * the pre-rebase state) and routes the terminal outcome to the right toast: completion offers
 * View Summary/Undo, an escalation offers Review & Resolve/Abort. Shared by every entry point
 * (rebase quickpick, command palette, takeover).
 */
export async function startAutoRebaseWithProgress(
	container: Container,
	svc: GitRepositoryService,
	options: AutoRebaseStartOptions,
): Promise<void> {
	const target = options.onto ?? options.upstream;
	return runWithProgress(
		container,
		svc,
		`Automatic Rebase${options.branch ? `: ${options.branch}` : ''} onto ${target}`,
		() => container.autoRebase.start(svc, options),
	);
}

/** Takes over an already-paused rebase and automates its remaining steps. See {@link startAutoRebaseWithProgress}. */
export async function takeoverAutoRebaseWithProgress(
	container: Container,
	svc: GitRepositoryService,
	source: Source,
): Promise<void> {
	return runWithProgress(container, svc, 'Automatic Rebase', () => container.autoRebase.takeover(svc, source));
}

async function runWithProgress(
	container: Container,
	svc: GitRepositoryService,
	title: string,
	run: () => Promise<AutoRebaseSession>,
): Promise<void> {
	const repoPath = svc.path;

	let session: AutoRebaseSession;
	try {
		session = await window.withProgress(
			{ location: ProgressLocation.Notification, cancellable: true, title: title },
			async (progress, token) => {
				const cancellation = token.onCancellationRequested(() =>
					container.autoRebase.cancel(repoPath, 'abort'),
				);
				const subscription = container.autoRebase.onDidChange(e => {
					if (e.repoPath !== repoPath || e.session?.progressMessage == null) return;

					progress.report({ message: e.session.progressMessage });
				});
				try {
					return await run();
				} finally {
					cancellation.dispose();
					subscription.dispose();
				}
			},
		);
	} catch (ex) {
		// Pre-flight refusal (AI unavailable, an operation already in progress, …)
		void window.showWarningMessage(ex instanceof Error ? ex.message : String(ex));
		return;
	}

	switch (session.phase) {
		case 'completed':
			onCompleted(container, session);
			break;
		case 'escalated':
			onEscalated(svc, session);
			break;
		case 'aborted':
			void window.showInformationMessage(
				`Automatic rebase cancelled — ${session.preRun.branch ?? 'the branch'} is unchanged.`,
			);
			break;
		case 'failed':
			void window.showErrorMessage(`Automatic rebase failed${session.failure ? `: ${session.failure}` : ''}.`);
			break;
		default:
			break;
	}
}

function onCompleted(container: Container, session: AutoRebaseSession): void {
	const repoPath = session.repoPath;
	const conflictCount = session.steps.reduce((sum, s) => sum + s.files.length, 0);
	const undoable = container.autoRebase.getStoredUndo(repoPath) != null;

	let message =
		session.steps.length > 0
			? `Automatic rebase completed: ${pluralize('conflict', conflictCount)} resolved across ${pluralize(
					'step',
					session.steps.length,
				)}.`
			: 'Automatic rebase completed — no conflicts.';
	if (session.postRun?.autostash === 'left-in-stash') {
		message += ' Your uncommitted changes conflicted when re-applied — they are safe in the stash.';
	}

	const viewSummary = { title: 'View Summary' };
	const undo = { title: 'Undo' };
	const actions = [...(session.steps.length > 0 ? [viewSummary] : []), ...(undoable ? [undo] : [])];

	void window.showInformationMessage(message, ...actions).then(result => {
		if (result === viewSummary) {
			showRebaseSummary(repoPath);
		} else if (result === undo) {
			void undoWithConfirmation(container, repoPath, session.preRun.branch);
		}
	});
}

function onEscalated(svc: GitRepositoryService, session: AutoRebaseSession): void {
	const step = session.escalation?.stepNumber;
	const total = session.escalation?.totalSteps ?? session.steps[0]?.totalSteps;
	const where = step != null ? ` at step ${step}${total != null ? ` of ${total}` : ''}` : '';
	const message = `Automatic rebase paused${where} — ${
		session.escalation?.message ?? 'the rebase needs your attention.'
	}`;

	const review = { title: 'Review & Resolve' };
	const abort = { title: 'Abort Rebase' };
	void window.showWarningMessage(message, review, abort).then(result => {
		if (result === review) {
			void executeCommand('gitlens.showGraph', {
				action: 'enter-resolve',
				target: { sha: uncommitted, worktreePath: session.repoPath },
				source: { source: 'auto-rebase' },
			});
		} else if (result === abort) {
			void abortPausedOperation(svc);
		}
	});
}

function showRebaseSummary(repoPath: string): void {
	void executeCommand('gitlens.showGraph', {
		action: 'show-rebase-summary',
		target: { sha: uncommitted, worktreePath: repoPath },
		source: { source: 'auto-rebase' },
	});
}

/** Modal-confirmed undo for the completion toast (the summary sheet has its own inline confirm). */
export async function undoWithConfirmation(
	container: Container,
	repoPath: string,
	branchName: string | undefined,
): Promise<void> {
	const branch = branchName ?? 'the branch';
	const confirm = { title: 'Undo Rebase' };
	const result = await window.showWarningMessage(
		`Undo the automatic rebase of ${branch}?\n\nThe branch will be reset to its pre-rebase state and the commits created by the rebase will be discarded.`,
		{ modal: true },
		confirm,
	);
	if (result !== confirm) return;

	const undone = await container.autoRebase.undo(repoPath);
	if (!undone.ok) {
		void window.showWarningMessage(`Can't undo the automatic rebase — ${undone.message}`);
		return;
	}

	void window.showInformationMessage(
		`Rebase undone — ${branch} was restored.${
			undone.warning === 'changes-left-in-stash' ? ' Your working changes were left in the stash.' : ''
		}`,
	);
}
