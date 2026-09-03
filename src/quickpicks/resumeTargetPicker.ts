import type { QuickInputButton, QuickPickItem } from 'vscode';
import { ThemeIcon, window } from 'vscode';
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
	tooltip: 'Always resume here (sets gitlens.agents.resumeTarget)',
};

function itemForTarget(
	providerId: string,
	agentLabel: string,
	cwd: string,
	target: AgentSessionResumeTarget,
): ResumeTargetQuickPickItem {
	if (target === 'extension') {
		return {
			label: `$(${getAgentProviderIcon(providerId)}) ${agentLabel} Extension`,
			description: 'opens in this window',
			buttons: [pinButton],
			target: target,
		};
	}

	return {
		label: '$(terminal) Terminal',
		description: `new terminal at ${cwd}`,
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
		quickpick.title = `Resume "${sessionName}" in…`;
		quickpick.placeholder = 'Select where to resume this session';
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
