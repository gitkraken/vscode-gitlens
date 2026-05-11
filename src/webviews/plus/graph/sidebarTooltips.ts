import { shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import { formatIndicators, formatTrackingTooltip } from '@gitlens/git/utils/tooltip.utils.js';
import { formatDate, fromNow } from '@gitlens/utils/date.js';
import { basename } from '@gitlens/utils/path.js';
import type { AgentSessionState } from '../../../agents/models/agentSessionState.js';
import { agentPhaseToCategory, formatAgentElapsed, getAgentCategoryLabel } from '../../apps/shared/agentUtils.js';
import type { OverviewBranch } from '../../shared/overviewBranches.js';
import type {
	GraphSidebarBranch,
	GraphSidebarRemote,
	GraphSidebarStash,
	GraphSidebarTag,
	GraphSidebarWorktree,
} from './protocol.js';

function formatDateWithFromNow(date: number, dateFormat?: string | null): string {
	const relative = fromNow(date);
	if (dateFormat == null) return relative;
	return `${relative} (${formatDate(date, dateFormat)})`;
}

export function branchTooltip(b: GraphSidebarBranch, dateFormat?: string | null): string {
	const suffixes: string[] = [];
	if (b.current) {
		suffixes.push('current branch');
	}
	if (b.worktree) {
		suffixes.push('in a worktree');
	}

	let tooltip = `$(git-branch) \`${b.name}\`${formatIndicators(suffixes)}`;

	if (b.upstream) {
		tooltip += `\n\n${formatTrackingTooltip(b.upstream.name, b.upstream.missing, b.tracking, b.providerName)}`;
	} else if (!b.remote) {
		tooltip += `\n\nLocal branch, hasn't been published to a remote`;
	}

	if (b.date != null) {
		tooltip += `\n\nLast commit ${formatDateWithFromNow(b.date, dateFormat)}`;
	}

	if (b.starred) {
		tooltip += '\\\n$(star-full) Favorited';
	}

	return tooltip;
}

export function tagTooltip(t: GraphSidebarTag, dateFormat?: string | null): string {
	let tooltip = `$(tag) \`${t.name}\``;
	if (t.sha) {
		tooltip += ` \u2014 \`${shortenRevision(t.sha)}\``;
	}
	if (t.date != null) {
		tooltip += `\\\n${formatDateWithFromNow(t.date, dateFormat)}`;
	}
	if (t.message) {
		tooltip += `\n\n${t.message}`;
	}
	return tooltip;
}

export function stashTooltip(s: GraphSidebarStash, dateFormat?: string | null): string {
	let tooltip = `$(archive) ${s.message || s.name}`;
	if (s.stashOnRef) {
		tooltip += `\\\nOn: \`${s.stashOnRef}\``;
	}
	if (s.date != null) {
		tooltip += `\\\n${formatDateWithFromNow(s.date, dateFormat)}`;
	}
	return tooltip;
}

export function worktreeTooltip(w: GraphSidebarWorktree): string {
	const indicators: string[] = [];
	if (w.isDefault) {
		indicators.push('default');
	}
	if (w.opened) {
		indicators.push('active');
	}

	const indicatorStr = formatIndicators(indicators);
	const folder = `\\\n$(folder) \`${w.uri}\``;

	let tooltip: string;
	if (w.branch != null) {
		// Branch worktree
		tooltip = `${w.isDefault ? '$(pass) ' : ''}Worktree for $(git-branch) \`${w.branch}\`${indicatorStr}${folder}`;

		if (w.upstream) {
			tooltip += `\n\n${formatTrackingTooltip(w.upstream, false, w.tracking, w.providerName)}`;
		}
	} else if (w.sha != null) {
		// Detached worktree
		tooltip = `${w.isDefault ? '$(pass) ' : ''}Detached Worktree at $(git-commit) ${shortenRevision(w.sha)}${indicatorStr}${folder}`;
	} else {
		// Bare worktree
		tooltip = `${w.isDefault ? '$(pass) ' : ''}Bare Worktree${indicatorStr}${folder}`;
	}

	if (w.hasChanges != null) {
		tooltip += w.hasChanges ? '\n\nHas Uncommitted Changes' : '\n\nNo Uncommitted Changes';
	}
	return tooltip;
}

export function remoteTooltip(r: GraphSidebarRemote): string {
	let tooltip = `\`${r.name}\``;

	if (r.providerName) {
		if (r.connected != null) {
			tooltip += ` \u00a0(${r.providerName} \u2014 _${r.connected ? 'connected' : 'not connected'}${r.isDefault ? ', default' : ''}_)`;
		} else {
			tooltip += ` \u00a0(${r.providerName}${r.isDefault ? ', default' : ''})`;
		}
	} else if (r.isDefault) {
		tooltip += ' \u00a0(_default_)';
	}

	if (r.url) {
		tooltip += `\n\n${r.url}`;
	}
	return tooltip;
}

/** Markdown tooltip for an agent leaf in the graph sidebar. Mirrors the informational content
 *  the `gl-agent-status-pill` shows in its popover (header, last prompt, current tool / request /
 *  context) and adds the related branch/worktree so the user knows what graph row this leaf maps
 *  to. Action affordances stay on the row (revealed on hover) so we don't duplicate them here. */
export function agentTooltip(session: AgentSessionState, matchingBranch: OverviewBranch | undefined): string {
	const category = agentPhaseToCategory[session.phase];
	const phaseLabel = getAgentCategoryLabel(category);
	const elapsed = formatAgentElapsed(session.phaseSinceTimestamp);

	const phaseIcon =
		category === 'needs-input' ? '$(warning)' : category === 'working' ? '$(sync)' : '$(circle-filled)';

	const headerParts = [phaseLabel];
	if (elapsed != null) {
		headerParts.push(elapsed);
	}

	let tooltip = `${phaseIcon} **${session.name}** — ${headerParts.join(' · ')}`;

	if (session.lastPrompt) {
		tooltip += `\n\n**Last Prompt**\\\n${session.lastPrompt}`;
	}

	if (category === 'working' && session.status === 'tool_use' && session.statusDetail) {
		tooltip += `\n\n**Current Tool**\\\n${session.statusDetail}`;
	}

	const detail = session.pendingPermissionDetail;
	if (category === 'needs-input' && detail != null) {
		const requestParts = [`\`${detail.toolName}\``];
		if (detail.toolDescription) {
			requestParts.push(`— ${detail.toolDescription}`);
		}
		tooltip += `\n\n**Request**\\\n${requestParts.join(' ')}`;

		if (detail.toolInputDescription) {
			tooltip += `\n\n**Context**\\\n${detail.toolInputDescription}`;
		}
	}

	// Branch line — derived live from the matched overview branch (the session's worktree's
	// currently-checked-out branch). For worktrees the overview doesn't know about (cross-repo /
	// cross-workspace sessions), fall back to the session's live `worktree.name` populated host-
	// side at serialization time. The worktree disambiguator is the directory basename when it
	// differs from the label.
	const label = matchingBranch?.name ?? session.worktree?.name;
	const worktreePath = matchingBranch?.worktree?.path ?? session.worktree?.path;
	if (label != null) {
		let branchLine = `$(git-branch) \`${label}\``;
		const worktreeBasename = worktreePath != null ? basename(worktreePath) : undefined;
		if (worktreeBasename && worktreeBasename !== label) {
			branchLine += ` — _worktree: ${worktreeBasename}_`;
		}
		tooltip += `\n\n**Branch**\\\n${branchLine}`;
	} else if (worktreePath) {
		tooltip += `\n\n**Worktree**\\\n_${basename(worktreePath)}_`;
	}

	return tooltip;
}
