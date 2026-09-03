import type { QuickInputButton, QuickPickItem } from 'vscode';
import { ThemeIcon, window } from 'vscode';
import { getAgentCapabilitiesByProviderId } from '@gitlens/agents/agentCapabilities.js';
import { fromNow } from '@gitlens/utils/date.js';
import type { PastAgentSessionState } from '../agents/models/agentSessionState.js';
import type { AgentSession, AgentSessionResumeTarget } from '../agents/provider.js';
import { canResumeSession } from '../agents/utils/-webview/agentResume.js';
import { getAgentProviderIcon } from '../agents/utils/agentIcon.js';
import { createQuickPickSeparator } from './items/common.js';

export interface ResumeSessionPick {
	/** `open` reaches a live session in place; `resume` starts a fresh process against the
	 *  transcript. */
	readonly action: 'open' | 'resume';
	/** Set when an item button was clicked; `undefined` on Enter (the service resolves one). */
	readonly target?: AgentSessionResumeTarget;
	readonly live?: AgentSession;
	readonly past?: PastAgentSessionState;
}

interface TargetButton extends QuickInputButton {
	readonly target: AgentSessionResumeTarget;
}

interface SessionQuickPickItem extends QuickPickItem {
	readonly live?: AgentSession;
	readonly past?: PastAgentSessionState;
}

const terminalButton: TargetButton = {
	iconPath: new ThemeIcon('terminal'),
	tooltip: 'Resume in Terminal',
	target: 'terminal',
};

/** Whether this session's agent declares a CLI resume command. The live list is not
 *  provider-filtered, so this has to be checked per row. Past rows are already safe — the caller
 *  keeps only those carrying a resume action. */
function canResumeInTerminal(session: AgentSession): boolean {
	if (!canResumeSession(session)) return false;

	return getAgentCapabilitiesByProviderId(session.providerId)?.supportsResume === true;
}

function extensionButton(providerId: string): TargetButton {
	const label = getAgentCapabilitiesByProviderId(providerId)?.displayName ?? providerId;
	return {
		iconPath: new ThemeIcon(getAgentProviderIcon(providerId)),
		tooltip: `Resume in ${label} Extension`,
		target: 'extension',
	};
}

function buttonsForTargets(providerId: string, targets: readonly AgentSessionResumeTarget[]): TargetButton[] {
	return targets.map(target => (target === 'extension' ? extensionButton(providerId) : terminalButton));
}

/** Pure item builder for {@link showResumableSessionPicker} — a live row gets the terminal button
 *  only when {@link canResumeInTerminal} allows it; a past row gets one always-visible button per
 *  entry of its `actions.resume.targets`, in order. */
export function buildResumableSessionItems(
	live: readonly AgentSession[],
	past: readonly PastAgentSessionState[],
	total: number,
): (SessionQuickPickItem | QuickPickItem)[] {
	const items: (SessionQuickPickItem | QuickPickItem)[] = [];

	if (live.length > 0) {
		items.push(createQuickPickSeparator('Active'));
		for (const session of live) {
			items.push({
				label: `$(${getAgentProviderIcon(session.providerId)}) ${session.name ?? session.id}`,
				description: session.status,
				detail: session.lastPrompt,
				buttons: canResumeInTerminal(session) ? [terminalButton] : undefined,
				live: session,
			} satisfies SessionQuickPickItem);
		}
	}

	if (past.length > 0) {
		items.push(createQuickPickSeparator(total > past.length ? `Past (${past.length} of ${total})` : 'Past'));
		for (const session of past) {
			items.push({
				// Agent mark, not `$(history)` — the "Past" separator and `fromNow(...)` below already
				// carry the recency signal, so the glyph is free to carry identity instead.
				label: `$(${getAgentProviderIcon(session.providerId)}) ${session.displayName}`,
				description: fromNow(session.lastActivity),
				detail: session.lastPrompt,
				buttons: buttonsForTargets(session.providerId, session.actions.resume?.targets ?? []),
				past: session,
			} satisfies SessionQuickPickItem);
		}
	}

	return items;
}

/**
 * Picks a session to reattach to for a worktree — the active ones it can open, then the past ones
 * recovered from the transcript store or durable session record it can resume (which includes
 * sessions that have since ended).
 *
 * Accepting a row with Enter leaves the target unset — the service resolves one (the setting, or
 * an ask). Each row also carries one always-visible button per resumable destination, which
 * resumes there directly. An active session only offers a terminal button when
 * {@link canResumeSession} allows it: resuming one that's mid-turn would run a second process
 * against a transcript the first is still writing.
 */
export async function showResumableSessionPicker(
	live: readonly AgentSession[],
	past: readonly PastAgentSessionState[],
	total: number,
	worktreeName: string | undefined,
): Promise<ResumeSessionPick | undefined> {
	const items = buildResumableSessionItems(live, past, total);

	if (items.length === 0) {
		void window.showInformationMessage(
			worktreeName != null
				? `No agent sessions found for ${worktreeName}.`
				: 'No agent sessions found for this worktree.',
		);
		return undefined;
	}

	const quickpick = window.createQuickPick<SessionQuickPickItem | QuickPickItem>();
	try {
		quickpick.title = worktreeName != null ? `Resume Agent Session in ${worktreeName}` : 'Resume Agent Session';
		quickpick.placeholder = 'Select a session to resume';
		// The prompt is the only thing that distinguishes same-titled sessions, so it must be searchable.
		quickpick.matchOnDetail = true;
		quickpick.items = items;

		return await new Promise<ResumeSessionPick | undefined>(resolve => {
			const pick = (item: SessionQuickPickItem, target: AgentSessionResumeTarget | undefined): void => {
				resolve({
					action: item.live != null && target == null ? 'open' : 'resume',
					target: target,
					live: item.live,
					past: item.past,
				});
				quickpick.hide();
			};

			quickpick.onDidAccept(() => {
				const item = quickpick.activeItems[0] as SessionQuickPickItem | undefined;
				if (item?.live == null && item?.past == null) return;

				pick(item, undefined);
			});
			quickpick.onDidTriggerItemButton(e => pick(e.item, (e.button as TargetButton).target));
			quickpick.onDidHide(() => resolve(undefined));
			quickpick.show();
		});
	} finally {
		quickpick.dispose();
	}
}
