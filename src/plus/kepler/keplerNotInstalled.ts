import type { QuickPick, QuickPickItem } from 'vscode';
import { l10n, QuickPickItemKind, window } from 'vscode';
import type { AsyncStepResultGenerator, StepSelection } from '../../commands/quick-wizard/models/steps.js';
import { StepResultBreak } from '../../commands/quick-wizard/models/steps.js';
import type { QuickPickStep } from '../../commands/quick-wizard/models/steps.quickpick.js';
import { canPickStepContinue, createPickStep } from '../../commands/quick-wizard/utils/steps.utils.js';
import type { Source } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import { executeCommand } from '../../system/-webview/command.js';
import type { StartReviewCommandArgs } from '../launchpad/startReview.js';
import type { KeplerRelease } from './keplerRelease.js';
import { toMegabytes } from './keplerRelease.js';
import type { KeplerTaskIntent } from './keplerTask.js';

/** What was blocked by Kepler not being installed: a task (by intent), or opening an agent session. */
export type KeplerNotInstalledIntent = KeplerTaskIntent | 'open-session';

/** What the user can pick. `review` / `review-agent` continue a PR review without Kepler. */
export type KeplerNotInstalledAction = 'install' | 'learn-more' | 'review' | 'review-agent';

export interface KeplerNotInstalledItem extends QuickPickItem {
	readonly action?: KeplerNotInstalledAction;
}

export interface KeplerNotInstalledItemsOptions {
	intent: KeplerNotInstalledIntent;
	/** The release Install Kepler would install, for its version and size; `undefined` while unknown */
	release?: KeplerRelease;
	/** Whether GitLens can install Kepler here; otherwise Install Kepler opens the download page */
	canInstall: boolean;
	/** Offer the "Continue without Kepler" PR review alternatives — a PR review outside a wizard only */
	alternatives?: { aiAllowed: boolean };
}

/**
 * The rows of the "Kepler isn't installed" prompt: a header, Install Kepler and Learn More,
 * then — for a PR review outside a wizard — ways to continue without Kepler. Mirrors the agent
 * picker's empty state (`buildAgentPickerItems`): a separator header followed by actions.
 */
export function buildKeplerNotInstalledItems(options: KeplerNotInstalledItemsOptions): KeplerNotInstalledItem[] {
	const items: KeplerNotInstalledItem[] = [
		// VS Code doesn't render `$(icon)` syntax in separator labels, so this one stays plain text
		{ label: l10n.t("Kepler isn't installed"), kind: QuickPickItemKind.Separator },
		{
			label: l10n.t('$(cloud-download) Install Kepler'),
			description: options.canInstall
				? getInstallDescription(options.intent, options.release)
				: l10n.t('Opens the Kepler download page in your browser'),
			action: 'install',
		},
		{
			label: l10n.t('$(info) Learn More'),
			description: l10n.t('Opens the Kepler page in your browser'),
			action: 'learn-more',
		},
	];

	if (options.intent === 'start-review' && options.alternatives != null) {
		items.push({ label: l10n.t('Continue without Kepler'), kind: QuickPickItemKind.Separator });
		if (options.alternatives.aiAllowed) {
			items.push({
				label: l10n.t('$(robot) Start PR Review with Agent'),
				description: l10n.t('Open a chat or CLI session with the PR context'),
				action: 'review-agent',
			});
		}
		items.push({
			label: l10n.t('$(arrow-right) Start PR Review'),
			description: l10n.t('Create a worktree for the PR and review it in VS Code'),
			action: 'review',
		});
	}

	return items;
}

function getInstallDescription(intent: KeplerNotInstalledIntent, release: KeplerRelease | undefined): string {
	const version = release?.version;
	const size = release?.size != null ? toMegabytes(release.size) : undefined;

	switch (intent) {
		case 'start-review':
			if (version != null && size != null) {
				return l10n.t('Installs Kepler {0} ({1} MB), then starts this review', version, size);
			}
			if (size != null) return l10n.t('Installs Kepler ({0} MB), then starts this review', size);

			return l10n.t('Installs Kepler, then starts this review');
		case 'start-work':
			if (version != null && size != null) {
				return l10n.t('Installs Kepler {0} ({1} MB), then starts this work', version, size);
			}
			if (size != null) return l10n.t('Installs Kepler ({0} MB), then starts this work', size);

			return l10n.t('Installs Kepler, then starts this work');
		case 'new-task':
			if (version != null && size != null) {
				return l10n.t('Installs Kepler {0} ({1} MB), then starts this task', version, size);
			}
			if (size != null) return l10n.t('Installs Kepler ({0} MB), then starts this task', size);

			return l10n.t('Installs Kepler, then starts this task');
		case 'open-session':
			if (version != null && size != null) {
				return l10n.t('Installs Kepler {0} ({1} MB), then opens this session', version, size);
			}
			if (size != null) return l10n.t('Installs Kepler ({0} MB), then opens this session', size);

			return l10n.t('Installs Kepler, then opens this session');
	}
}

function getTitle(intent: KeplerNotInstalledIntent): string {
	switch (intent) {
		case 'start-review':
			return l10n.t('Start Review in Kepler');
		case 'start-work':
			return l10n.t('Start Work in Kepler');
		case 'new-task':
			return l10n.t('Start Task in Kepler');
		case 'open-session':
			return l10n.t('Open Session in Kepler');
	}
}

/**
 * Shows the "Kepler isn't installed" prompt outside a wizard (tree views, the Graph, Launchpad, agent
 * sessions) and carries out the pick. It opens at once and fills in Install Kepler's version and size
 * when the release resolves. Resolves `true` only when Kepler was installed, so the caller can go on
 * with what was blocked — no separate retry.
 */
export async function promptKeplerNotInstalled(
	container: Container,
	options: {
		intent: KeplerNotInstalledIntent;
		/** The PR being reviewed; enables the "Continue without Kepler" alternatives for `start-review` */
		pr?: { url: string };
		source?: Source;
	},
): Promise<boolean> {
	const { intent, pr, source } = options;
	const alternatives = intent === 'start-review' && pr != null ? { aiAllowed: container.ai.allowed } : undefined;

	const action = await pickAction(container, intent, alternatives);
	container.telemetry.sendEvent(
		'kepler/notInstalled/action',
		{ intent: intent, wizard: false, action: action ?? 'dismiss' },
		source,
	);

	switch (action) {
		case 'install':
			return container.kepler.install(source);
		case 'learn-more':
			void executeCommand('gitlens.kepler.openProductPage', source);
			return false;
		case 'review':
			void executeCommand<Partial<StartReviewCommandArgs>>('gitlens.startReview', {
				prUrl: pr?.url,
				showOpenInAgent: 'manual',
				source: source,
			});
			return false;
		case 'review-agent':
			void executeCommand<Partial<StartReviewCommandArgs>>('gitlens.startReview.openInAgent', {
				prUrl: pr?.url,
				source: source,
			});
			return false;
		default:
			return false;
	}
}

async function pickAction(
	container: Container,
	intent: KeplerNotInstalledIntent,
	alternatives: KeplerNotInstalledItemsOptions['alternatives'],
): Promise<KeplerNotInstalledAction | undefined> {
	const canInstall = container.kepler.canInstall;
	const qp: QuickPick<KeplerNotInstalledItem> = window.createQuickPick();
	qp.title = getTitle(intent);
	qp.placeholder = l10n.t('Choose how to continue');
	qp.matchOnDescription = true;
	qp.items = buildKeplerNotInstalledItems({ intent: intent, canInstall: canInstall, alternatives: alternatives });

	try {
		return await new Promise<KeplerNotInstalledAction | undefined>(resolve => {
			qp.onDidAccept(() => {
				const action = qp.activeItems[0]?.action;
				if (action == null) return;

				resolve(action);
				qp.hide();
			});
			qp.onDidHide(() => resolve(undefined));
			qp.show();

			if (!canInstall) return;

			void container.kepler.getRelease().then(release => {
				if (release == null) return;

				replaceItems(
					qp,
					buildKeplerNotInstalledItems({
						intent: intent,
						release: release,
						canInstall: canInstall,
						alternatives: alternatives,
					}),
				);
			});
		});
	} finally {
		qp.dispose();
	}
}

/** Swaps in new rows while keeping the same action highlighted. */
function replaceItems<T extends QuickPickItem>(
	qp: QuickPick<T | KeplerNotInstalledItem>,
	items: KeplerNotInstalledItem[],
): void {
	const current = qp.activeItems[0];
	const active = current != null && 'action' in current ? current.action : undefined;
	qp.items = items;

	const match = active != null ? items.find(i => i.action === active) : undefined;
	if (match != null) {
		qp.activeItems = [match];
	}
}

/**
 * The "Kepler isn't installed" prompt as a wizard step, for when "Open in Kepler" is picked in the
 * Start Work or Start Review wizard — a standalone quick pick would tear the wizard down. No "Continue
 * without Kepler" rows: the step before already offers those routes. Returns the picked action, or
 * `StepResultBreak` on Back.
 */
// Async only to be a wizard step generator; the wizard machinery does the waiting
// oxlint-disable-next-line typescript/require-await
export async function* pickKeplerNotInstalledStep(
	container: Container,
	options: { intent: KeplerNotInstalledIntent; showBackButton?: boolean },
): AsyncStepResultGenerator<'install' | 'learn-more'> {
	const { intent } = options;
	const canInstall = container.kepler.canInstall;

	const step: QuickPickStep<KeplerNotInstalledItem> = createPickStep<KeplerNotInstalledItem>({
		title: getTitle(intent),
		placeholder: l10n.t('Choose how to continue'),
		items: buildKeplerNotInstalledItems({ intent: intent, canInstall: canInstall }),
		canGoBack: options.showBackButton,
		onDidActivate: qp => {
			if (!canInstall) return;

			void container.kepler.getRelease().then(release => {
				// Only while this step is still the one showing
				if (release == null || step.quickpick !== qp) return;

				replaceItems(
					qp,
					buildKeplerNotInstalledItems({ intent: intent, release: release, canInstall: canInstall }),
				);
			});
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	if (!canPickStepContinue(step, {}, selection)) return StepResultBreak;

	const action = selection[0]?.action;
	if (action === 'install' || action === 'learn-more') return action;

	return StepResultBreak;
}
