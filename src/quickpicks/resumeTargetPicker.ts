import type { QuickInputButton, QuickPickItem } from 'vscode';
import { l10n, ThemeIcon, window } from 'vscode';
import type { AgentSessionResumeTarget } from '../agents/provider.js';
import { getAgentProviderIcon } from '../agents/utils/agentIcon.js';

export interface ResumeTargetPick {
	readonly target: AgentSessionResumeTarget;
	/** `true` when the pin item button was used — the caller persists this as the new
	 *  `gitlens.agents.resumeTarget` default. */
	readonly remember: boolean;
}

interface ResumeTargetQuickPickItem extends QuickPickItem {
	readonly target: AgentSessionResumeTarget;
}

const pinButton: QuickInputButton = {
	iconPath: new ThemeIcon('pin'),
	tooltip: l10n.t('Always resume here (sets gitlens.agents.resumeTarget)'),
};

function itemForTarget(
	providerId: string,
	agentLabel: string,
	cwd: string,
	target: AgentSessionResumeTarget,
): ResumeTargetQuickPickItem {
	if (target === 'extension') {
		return {
			label: `$(${getAgentProviderIcon(providerId)}) ${l10n.t('{0} Extension', agentLabel)}`,
			description: l10n.t('Opens in this window'),
			buttons: [pinButton],
			target: target,
		};
	}

	return {
		label: `$(terminal) ${l10n.t('Terminal')}`,
		description: l10n.t('New terminal at {0}', cwd),
		buttons: [pinButton],
		target: target,
	};
}

/**
 * Asks which of a two-target session's destinations to resume in — shown only when
 * `gitlens.agents.resumeTarget` is unset. Title reads `Resume "<sessionName>" in…`; one row per
 * `targets` entry, in order. Enter resumes there once; the pin item button resumes there AND
 * persists the choice as the new `gitlens.agents.resumeTarget` default.
 *
 * `providerId` is not part of the "in…" wording — it only resolves the extension row's agent
 * codicon via {@link getAgentProviderIcon}.
 */
export async function showResumeTargetPicker(
	providerId: string,
	sessionName: string,
	agentLabel: string,
	cwd: string,
	targets: readonly AgentSessionResumeTarget[],
): Promise<ResumeTargetPick | undefined> {
	const quickpick = window.createQuickPick<ResumeTargetQuickPickItem>();
	try {
		quickpick.title = l10n.t('Resume "{0}" in…', sessionName);
		quickpick.placeholder = l10n.t('Select where to resume this session');
		quickpick.items = targets.map(target => itemForTarget(providerId, agentLabel, cwd, target));

		return await new Promise<ResumeTargetPick | undefined>(resolve => {
			quickpick.onDidAccept(() => {
				const item = quickpick.activeItems[0];
				if (item == null) return;

				resolve({ target: item.target, remember: false });
				quickpick.hide();
			});
			quickpick.onDidTriggerItemButton(e => {
				resolve({ target: e.item.target, remember: true });
				quickpick.hide();
			});
			quickpick.onDidHide(() => resolve(undefined));
			quickpick.show();
		});
	} finally {
		quickpick.dispose();
	}
}
