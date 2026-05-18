import type { AgentSessionState } from '../../../../home/protocol.js';
import type { AgentSessionCategory } from '../../../shared/agentUtils.js';
import { agentPhaseToCategory, getAgentCategoryLabel } from '../../../shared/agentUtils.js';

/** Idle window mirrored from the host-side `agentBranchesIdleThresholdMs` in `graphWebview.ts`.
 *  An `idle` session whose `lastActivity` falls outside this window stops surfacing an indicator
 *  on its WIP row — the host filter that drives `branchesVisibility === 'agents'` uses the same
 *  bound, so a row that picked up an indicator here is also a row that the agents-scope filter
 *  would keep. Keep the two in lock-step if you change one. */
export const wipRowAgentIdleThresholdMs = 24 * 60 * 60 * 1000;

/** Priority used when collapsing multiple per-worktree sessions into a single indicator:
 *  `needs-input > working > idle`. Picked so the indicator always surfaces the category that
 *  most warrants attention. */
const categoryPriority: Record<AgentSessionCategory, number> = {
	'needs-input': 0,
	working: 1,
	idle: 2,
};

export interface WipRowAgentStatus {
	readonly category: AgentSessionCategory;
	readonly sessions: readonly AgentSessionState[];
}

/** Drops `idle` sessions older than `wipRowAgentIdleThresholdMs` (clock-skew-clamped so a
 *  future-dated `lastActivity` can't pin a session as permanently recent). Returns `undefined`
 *  when nothing survives so callers can `!= null` test for "row has an indicator". */
export function pickWipRowAgentStatus(
	sessions: readonly AgentSessionState[] | undefined,
	now: number = Date.now(),
): WipRowAgentStatus | undefined {
	if (sessions == null || sessions.length === 0) return undefined;

	const surviving: AgentSessionState[] = [];
	for (const session of sessions) {
		if (session.phase === 'idle') {
			const age = Math.max(0, now - session.lastActivity.getTime());
			if (age >= wipRowAgentIdleThresholdMs) continue;
		}

		surviving.push(session);
	}
	if (surviving.length === 0) return undefined;

	let worst: AgentSessionCategory = agentPhaseToCategory[surviving[0].phase];
	for (let i = 1; i < surviving.length; i++) {
		const c = agentPhaseToCategory[surviving[i].phase];
		if (categoryPriority[c] < categoryPriority[worst]) {
			worst = c;
		}
	}

	return { category: worst, sessions: surviving };
}

/** Suffix glyph paired with the `robot` icon in the WIP row indicator. `idle` has no suffix —
 *  the bare robot in its color carries the meaning. */
export function agentSuffixIconFor(category: AgentSessionCategory): string | undefined {
	switch (category) {
		case 'needs-input':
			return 'warning';
		case 'working':
			return 'sync';
		case 'idle':
			return undefined;
	}
}

/** Tooltip + aria-label for the WIP row indicator. Reused for both attributes so the spoken
 *  label matches the visible hint. */
export function agentIndicatorTooltipFor(category: AgentSessionCategory): string {
	return `Agent · ${getAgentCategoryLabel(category)}`;
}
