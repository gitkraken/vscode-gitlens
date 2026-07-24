import type { QuickInputButton, QuickPickItem } from 'vscode';
import { ThemeIcon, window } from 'vscode';
import { fromNow } from '@gitlens/utils/date.js';
import type { PastAgentSessionState } from '../agents/models/agentSessionState.js';
import type { AgentSession } from '../agents/provider.js';
import { canResumeSession } from '../agents/utils/-webview/claudeResume.js';
import { createQuickPickSeparator } from './items/common.js';

/** How the user chose to reattach: `open` reaches a live session in place; `resume` starts a fresh
 *  process against the transcript. */
export type ResumeSessionTarget = 'open' | 'resume' | 'resume-terminal';

export interface ResumeSessionPick {
	readonly target: ResumeSessionTarget;
	readonly live?: AgentSession;
	readonly past?: PastAgentSessionState;
}

interface SessionQuickPickItem extends QuickPickItem {
	readonly live?: AgentSession;
	readonly past?: PastAgentSessionState;
}

const resumeInTerminalButton: QuickInputButton = {
	iconPath: new ThemeIcon('terminal'),
	tooltip: 'Resume in Terminal',
};

/**
 * Picks a session to reattach to for a worktree — the live ones it can open, then the past ones it
 * can resume out of the transcript store.
 *
 * Accepting a row uses the default target (the extension when it's available, otherwise a terminal);
 * the per-row terminal button forces a terminal instead. Both are offered on past sessions
 * unconditionally — the process is gone, so nothing can collide. A live session only offers the
 * terminal when {@link canResumeSession} allows it: resuming one that's mid-turn would run a second
 * process against a transcript the first is still writing.
 */
export async function showResumableSessionPicker(
	live: AgentSession[],
	past: PastAgentSessionState[],
	total: number,
	worktreeName: string | undefined,
): Promise<ResumeSessionPick | undefined> {
	const items: (SessionQuickPickItem | QuickPickItem)[] = [];

	if (live.length > 0) {
		items.push(createQuickPickSeparator('Active'));
		for (const session of live) {
			items.push({
				label: `$(robot) ${session.name ?? session.id}`,
				description: session.status,
				detail: session.lastPrompt,
				buttons: canResumeSession(session) ? [resumeInTerminalButton] : undefined,
				live: session,
			} satisfies SessionQuickPickItem);
		}
	}

	if (past.length > 0) {
		items.push(createQuickPickSeparator(total > past.length ? `Past (${past.length} of ${total})` : 'Past'));
		for (const session of past) {
			items.push({
				label: `$(history) ${session.displayName}`,
				description: fromNow(session.lastActivity),
				detail: session.lastPrompt,
				buttons: [resumeInTerminalButton],
				past: session,
			} satisfies SessionQuickPickItem);
		}
	}

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
		quickpick.placeholder = 'Choose a session to resume';
		// The prompt is the only thing that distinguishes same-titled sessions, so it must be searchable.
		quickpick.matchOnDetail = true;
		quickpick.items = items;

		return await new Promise<ResumeSessionPick | undefined>(resolve => {
			const pick = (item: SessionQuickPickItem, target: ResumeSessionTarget): void => {
				resolve({ target: target, live: item.live, past: item.past });
				quickpick.hide();
			};

			quickpick.onDidAccept(() => {
				const item = quickpick.activeItems[0] as SessionQuickPickItem | undefined;
				if (item?.live == null && item?.past == null) return;

				pick(item, item.live != null ? 'open' : 'resume');
			});
			quickpick.onDidTriggerItemButton(e => pick(e.item, 'resume-terminal'));
			quickpick.onDidHide(() => resolve(undefined));
			quickpick.show();
		});
	} finally {
		quickpick.dispose();
	}
}
