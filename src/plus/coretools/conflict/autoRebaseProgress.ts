import { ProgressLocation, window } from 'vscode';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { Source } from '../../../constants.telemetry.js';
import type { Container } from '../../../container.js';
import { abortPausedOperation } from '../../../git/actions/pausedOperation.js';
import type { GitRepositoryService } from '../../../git/gitRepositoryService.js';
import { executeCommand } from '../../../system/-webview/command.js';
import type { AutoRebaseEscalationReason, AutoRebaseSession } from './autoRebase.types.js';
import type { AutoRebaseStartOptions } from './autoRebaseService.js';

// Escalation reasons that leave unmerged files for the user to resolve — these auto-open Resolve
// mode. Every other reason (non-conflict pause, external change, stall, continue/unexpected error,
// user detach) keeps the toast, since Resolve mode would be empty or the situation needs a choice.
const conflictEscalationReasons = new Set<AutoRebaseEscalationReason>([
	'low-confidence',
	'resolve-errors',
	'skipped-files',
]);

/**
 * Runs an automatic rebase behind a cancellable progress notification (cancel = abort, restoring
 * the pre-rebase state) and routes the terminal outcome: completion opens the summary, a conflict
 * escalation opens Resolve mode, and the remaining cases fall back to a toast. Shared by every
 * entry point (rebase quickpick, command palette, takeover).
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
			onEscalated(container, svc, session);
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

	// A rebase that resolved conflicts opens its summary directly (Undo and the autostash warning
	// live there) — no toast needed.
	if (session.steps.length > 0) {
		showRebaseSummary(repoPath);
		return;
	}

	// No conflicts, so there's no meaningful summary to open — a brief toast is enough.
	let message = 'Automatic rebase completed — no conflicts.';
	if (session.postRun?.autostash === 'left-in-stash') {
		message += ' Your uncommitted changes conflicted when re-applied — they are safe in the stash.';
	}

	const undo = { title: 'Undo' };
	const actions = container.autoRebase.getStoredUndo(repoPath) != null ? [undo] : [];
	void window.showInformationMessage(message, ...actions).then(result => {
		if (result === undo) {
			void undoWithConfirmation(container, repoPath, session.preRun.branch);
		}
	});
}

function onEscalated(container: Container, svc: GitRepositoryService, session: AutoRebaseSession): void {
	// A conflict the AI couldn't finish opens Resolve mode directly — that's the action the user
	// would take anyway, and the panel is seeded with the AI's attempted resolutions.
	if (session.escalation != null && conflictEscalationReasons.has(session.escalation.reason)) {
		showResolvePanel(session.repoPath);
		return;
	}

	const step = session.escalation?.stepNumber;
	const total = session.escalation?.totalSteps ?? session.steps[0]?.totalSteps;
	const where = step != null ? ` at step ${step}${total != null ? ` of ${total}` : ''}` : '';
	const message = `Automatic rebase paused${where} — ${
		session.escalation?.message ?? 'the rebase needs your attention.'
	}`;

	const review = { title: 'Review & Resolve' };
	const resume = { title: 'Resume with AI' };
	const abort = { title: 'Abort Rebase' };
	// Resume re-engages automation (takeover) — most useful once the step is resolved; resuming an
	// unresolved conflict simply re-escalates. Hidden when AI is off (user setting or org policy).
	const actions = container.ai.allowed ? [review, resume, abort] : [review, abort];
	void window.showWarningMessage(message, ...actions).then(result => {
		if (result === review) {
			showResolvePanel(session.repoPath);
		} else if (result === resume) {
			void takeoverAutoRebaseWithProgress(container, svc, { source: 'auto-rebase' });
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

function showResolvePanel(repoPath: string): void {
	void executeCommand('gitlens.showGraph', {
		action: 'enter-resolve',
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
