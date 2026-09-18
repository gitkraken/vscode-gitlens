import type { Disposable, QuickPickItem } from 'vscode';
import { l10n, ProgressLocation, window } from 'vscode';
import { uncommitted } from '@gitlens/git/models/revision.js';
import { Logger } from '@gitlens/utils/logger.js';
import { formatPlural } from '@gitlens/utils/plural.js';
import type { Source } from '../../../constants.telemetry.js';
import type { Container } from '../../../container.js';
import { getPresentableErrorMessage } from '../../../errors.js';
import type { GitRepositoryService } from '../../../git/gitRepositoryService.js';
import { executeCommand } from '../../../system/-webview/command.js';
import { ensurePaidPlan } from '../../gk/utils/-webview/plus.utils.js';
import { isSubscriptionTrialOrPaidFromState } from '../../gk/utils/subscription.utils.js';
import type { StackRebasePlan, StackRebaseSession, StackRebaseStep } from './stackRebase.types.js';
import { describeStackRebasePlan, formatStackPosition } from './stackRebase.utils.js';

interface StackRebaseModeItem extends QuickPickItem {
	mode: 'manual' | 'ai';
}

interface StackRebaseBranchItem extends QuickPickItem {
	step: StackRebaseStep;
}

/**
 * Confirms a stack rebase and which of its two runs the user wants: **Rebase Stack**, which stops at
 * every conflict, or **Auto-Rebase Stack**, which resolves conflicts with AI across every branch and
 * stops only when it needs help. `mode` seeds which is offered first.
 *
 * The AI run is gated exactly as the rebase wizard gates its own automatic mode (trial/paid, AI
 * enabled by both the user setting and org policy) — an ineligible user is simply never shown it,
 * rather than being shown it and refused.
 */
export async function confirmStackRebase(
	container: Container,
	plan: StackRebasePlan,
	mode: 'manual' | 'ai' = 'manual',
): Promise<'manual' | 'ai' | undefined> {
	const subscription = await container.subscription.getSubscription();
	const aiOffered =
		isSubscriptionTrialOrPaidFromState(subscription?.state) && container.ai.enabled && container.ai.orgEnabled;

	const manualItem: StackRebaseModeItem = {
		label: l10n.t('Rebase Stack'),
		detail: l10n.t('Rebases each branch onto the one below it, stopping at each conflict'),
		mode: 'manual',
	};
	const aiItem: StackRebaseModeItem = {
		label: l10n.t('Auto-Rebase Stack'),
		description: l10n.t('Pro'),
		detail: l10n.t('Rebases the whole stack, resolving conflicts with AI and stopping only when it needs help'),
		mode: 'ai',
	};

	const items: StackRebaseModeItem[] = [];
	if (aiOffered && mode === 'ai') {
		items.push(aiItem, manualItem);
	} else if (aiOffered) {
		items.push(manualItem, aiItem);
	} else {
		items.push(manualItem);
	}

	const pick = await window.showQuickPick(items, {
		title: l10n.t('Rebase Stack'),
		placeHolder: describeStackRebasePlan(plan),
		matchOnDetail: true,
	});
	return pick?.mode;
}

/**
 * Runs a stack rebase and routes everything the user sees: progress carrying the stack position,
 * the pause hand-offs, and the completion offer to force push what was rewritten.
 *
 * Routing rides `StackRebaseService.onDidChange` rather than `start()`'s result, because a paused
 * chain is handed back to the user and resumes — and finishes — long after that promise settled.
 *
 * Never rejects: pre-flight refusals and every terminal phase are surfaced internally.
 */
export async function startStackRebaseRun(
	container: Container,
	svc: GitRepositoryService,
	plan: StackRebasePlan,
	mode: 'manual' | 'ai',
	source: Source,
): Promise<void> {
	if (mode === 'ai' && !(await ensurePaidPlan(container, l10n.t('Auto-Rebase Stack is a Pro feature.'), source))) {
		return;
	}

	let opened = false;
	let progressOpen = false;
	let notifiedPauseAt: number | undefined;

	const subscription = container.stackRebase.onDidChange(e => {
		if (e.repoPath !== svc.path || e.session == null) return;

		const session = e.session;
		if (!opened) {
			opened = true;
			// The Resolve panel is the AI run's progress surface (it streams each branch's steps and owns
			// cancelling them), so it opens as the cascade starts rather than on the first escalation
			if (mode === 'ai') {
				openResolvePanel(svc.path);
			}
		}

		switch (session.phase) {
			case 'starting':
			case 'running':
				notifiedPauseAt = undefined;
				// A manual run has no panel, so the notification is its only progress surface — and it
				// re-opens after every pause, since a paused chain resumes on its own
				if (mode === 'manual' && !progressOpen) {
					progressOpen = true;
					void trackManualProgress(container, svc.path).finally(() => (progressOpen = false));
				}
				break;

			case 'paused':
				// Guarded by branch index so a repeated pause on the SAME branch (the user resumed an
				// escalation that immediately re-escalated) doesn't stack up toasts
				if (notifiedPauseAt !== session.index) {
					notifiedPauseAt = session.index;
					onPaused(container, session, plan);
				}
				break;

			case 'completed':
				subscription.dispose();
				void onCompleted(container, svc, session, source);
				break;

			case 'stopped':
				subscription.dispose();
				void window.showInformationMessage(session.message ?? l10n.t('Stack rebase stopped.'));
				break;

			case 'failed':
				subscription.dispose();
				void window.showErrorMessage(
					session.failure
						? l10n.t('Stack rebase failed — {0}', session.failure)
						: l10n.t('Stack rebase failed.'),
				);
				break;
		}
	});

	try {
		await container.stackRebase.start(svc, plan, { mode: mode, source: source });
	} catch (ex) {
		// Pre-flight refusal (an operation already in progress, a dirty working tree, a chain already
		// running) — no session was ever created, so nothing routes it
		subscription.dispose();
		void window.showWarningMessage(getPresentableErrorMessage(ex));
	}
}

/** A notification that lives for as long as the chain is actively running, narrating it with the
 *  session's own message — which always leads with `Branch {n} of {m} · {branch}`. */
function trackManualProgress(container: Container, repoPath: string): Promise<void> {
	return Promise.resolve(
		window.withProgress(
			{ location: ProgressLocation.Notification, title: l10n.t('Rebasing stack'), cancellable: false },
			progress =>
				new Promise<void>(resolve => {
					let subscription: Disposable | undefined;

					// Anything but a running chain closes the notification: a pause gets its own toast with
					// actions, and a terminal phase is routed by the caller
					const update = (session: StackRebaseSession | undefined): void => {
						if (session == null || (session.phase !== 'starting' && session.phase !== 'running')) {
							subscription?.dispose();
							resolve();
							return;
						}

						progress.report({ message: session.message });
					};

					subscription = container.stackRebase.onDidChange(e => {
						if (e.repoPath !== repoPath) return;

						update(e.session);
					});

					// Covers a chain that settled between the caller seeing its event and this subscribing
					update(container.stackRebase.getSession(repoPath));
				}),
		),
	);
}

/**
 * Hands the user the one branch the cascade can't finish on its own. Deliberately does NOT offer a
 * "resume the stack" action: the chain resumes itself the moment that branch's rebase finishes —
 * manually, or through the existing `Continue with Auto-Rebase`.
 */
function onPaused(container: Container, session: StackRebaseSession, plan: StackRebasePlan): void {
	const position = formatStackPosition(plan, session.index);
	const stop = { title: l10n.t('Stop Stack Rebase') };

	if (session.mode === 'manual') {
		void window
			.showWarningMessage(
				l10n.t('{0} — resolve the conflicts and continue the rebase to carry on up the stack.', position),
				stop,
			)
			.then(result => {
				if (result === stop) {
					container.stackRebase.cancel(session.repoPath);
				}
			});
		return;
	}

	const review = { title: l10n.t('Review & Resolve') };
	const resume = { title: l10n.t('Continue with Auto-Rebase') };
	void window
		.showWarningMessage(
			l10n.t('{0} — Auto-Rebase needs your help before the rest of the stack can continue.', position),
			review,
			resume,
			stop,
		)
		.then(result => {
			if (result === review) {
				openResolvePanel(session.repoPath);
			} else if (result === resume) {
				void executeCommand('gitlens.ai.continueRebase', { repoPath: session.repoPath });
			} else if (result === stop) {
				container.stackRebase.cancel(session.repoPath);
			}
		});
}

async function onCompleted(
	container: Container,
	svc: GitRepositoryService,
	session: StackRebaseSession,
	source: Source,
): Promise<void> {
	const rewritten = await container.stackRebase.getPushableBranches(session.repoPath);
	const message = formatPlural(
		l10n.t(
			'{count, plural, one{Stack rebase completed — {count} branch rebased onto {upstream}} other{Stack rebase completed — {count} branches rebased onto {upstream}}}',
		),
		{ count: session.steps.length, upstream: session.upstreamRef },
	);

	// Every branch is already in sync with its remote — don't offer a push that would publish nothing
	if (!rewritten.length) {
		void window.showInformationMessage(message);
		return;
	}

	const push = { title: l10n.t('Force Push Stack') };
	void window.showInformationMessage(message, push).then(result => {
		if (result === push) {
			void forcePushStack(container, svc, session, rewritten, source);
		}
	});
}

/**
 * Force pushes whatever the repository's last completed cascade still has to publish — the durable
 * counterpart to the completion toast's offer, which VS Code auto-hides. Reachable from anywhere that
 * knows the repository (the `gitlens.git.forcePushStack` command, the Auto-Rebase summary sheet), and
 * self-retiring: once every rewritten branch has been pushed there is nothing left to offer.
 */
export async function forcePushStackForRepo(
	container: Container,
	svc: GitRepositoryService,
	source: Source,
): Promise<void> {
	// Keyed off `svc.path` rather than a separately-passed repo path: the session map is keyed by the
	// service's own path, so accepting a second copy of it only creates a way for the two to disagree
	// (an unnormalized path would silently look up nothing and report "nothing to push").
	const session = container.stackRebase.getSession(svc.path);
	const pushable = await container.stackRebase.getPushableBranches(svc.path);
	if (session == null || !pushable.length) {
		void window.showInformationMessage(l10n.t('There are no rebased branches waiting to be force pushed.'));
		return;
	}

	await forcePushStack(container, svc, session, pushable, source);
}

/**
 * Force pushes the rewritten branches, pre-checked but individually holdable — a rebased stack is
 * only half-published until the remote branches move, but a user may still have a reason to keep one
 * back (an open review, a shared branch).
 *
 * Pushes sequentially and through `svc.ops.push` rather than `svc.push`: the latter swallows failures
 * into its own notification, and this has to report which branches didn't make it by name.
 */
async function forcePushStack(
	container: Container,
	svc: GitRepositoryService,
	session: StackRebaseSession,
	rewritten: StackRebaseStep[],
	source: Source,
): Promise<void> {
	if (svc.ops == null) return;

	const items: StackRebaseBranchItem[] = rewritten.map(s => ({
		label: s.branchName,
		// A pull request number, not prose — deliberately not localized
		description: `#${s.prNumber}`,
		picked: true,
		step: s,
	}));

	const picks = await window.showQuickPick(items, {
		title: l10n.t('Force Push Stack'),
		placeHolder: l10n.t('Choose the rebased branches to force push'),
		canPickMany: true,
	});
	// Dismissed — no push, and nothing to report
	if (picks == null) return;

	const pushed: string[] = [];
	const failed: string[] = [];
	if (picks.length) {
		await window.withProgress(
			{ location: ProgressLocation.Notification, title: l10n.t('Force pushing stack'), cancellable: false },
			async progress => {
				let index = 0;
				for (const pick of picks) {
					index++;
					progress.report({
						message: l10n.t('Branch {current} of {total} · {branch}', {
							current: index,
							total: picks.length,
							branch: pick.step.branchName,
						}),
					});

					try {
						const branch = await svc.branches.getBranch(pick.step.branchName);
						if (branch == null) throw new Error(l10n.t('The branch no longer exists.'));

						// Sequential, never `Promise.all`: a lease failure on one branch must not race the
						// others, and the user needs to know exactly which ones landed
						await svc.ops!.push({
							reference: branch,
							force: true,
							// A layer the cascade created locally may never have been pushed — publish it to
							// the stack's remote instead of failing for want of an upstream
							publish: branch.upstream == null ? { remote: session.remoteName } : undefined,
						});
						pushed.push(pick.step.branchName);
					} catch (ex) {
						Logger.error(ex, 'stackRebaseProgress', 'forcePushStack');
						failed.push(pick.step.branchName);
					}
				}
			},
		);
	}

	// Only what actually landed retires from the offer — a failed push and a held-back branch both still
	// have something to publish, so both stay on the table for the next invocation
	if (pushed.length) {
		container.stackRebase.markPushed(session.repoPath, pushed);
	}

	container.telemetry.sendEvent(
		'stackRebase/push/completed',
		{
			'branches.count': picks.length,
			'branches.held.count': rewritten.length - picks.length,
			'branches.failed.count': failed.length,
		},
		source,
	);

	if (failed.length) {
		void window.showWarningMessage(
			formatPlural(
				l10n.t(
					'{count, plural, one{Couldn’t force push {branches}} other{Couldn’t force push {count} branches: {branches}}}',
				),
				{ count: failed.length, branches: failed.join(', ') },
			),
		);
		return;
	}

	if (!picks.length) return;

	void window.showInformationMessage(
		formatPlural(l10n.t('{count, plural, one{Force pushed {count} branch} other{Force pushed {count} branches}}'), {
			count: picks.length,
		}),
	);
}

/** Opens (or re-focuses) the Commit Graph's Resolve panel — the AI run's progress surface, and where
 *  an escalated branch's resolutions are handed off for review. */
function openResolvePanel(repoPath: string): void {
	void executeCommand('gitlens.showGraph', {
		action: 'enter-resolve',
		target: { sha: uncommitted, worktreePath: repoPath },
		source: { source: 'auto-rebase' },
	});
}
