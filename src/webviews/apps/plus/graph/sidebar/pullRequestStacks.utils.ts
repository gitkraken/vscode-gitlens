import type { GraphSidebarPullRequest } from '../../../../plus/graph/protocol.js';

/** A stack and the members of it present in the list, ordered top layer first. */
export interface PullRequestStackEntry {
	kind: 'stack';
	/** Identifies the stack within its repository. */
	number: number;
	/** Total layers GitHub reports, which can exceed `members.length` when paging cut the rest off. */
	size: number;
	/** The branch the whole stack lands on — not any member's own base, which is the layer below it. */
	baseRef: string;
	members: GraphSidebarPullRequest[];
}

export interface PullRequestEntry {
	kind: 'pullRequest';
	pr: GraphSidebarPullRequest;
}

export type PullRequestListEntry = PullRequestStackEntry | PullRequestEntry;

/**
 * Collects each stack's members into one entry, leaving every other pull request as its own.
 *
 * A stack becomes an entry only when at least two of its members are present. A lone member — the paging
 * cap cut the rest off, or a searched pull request was spliced in — stays an ordinary row, so the list
 * never draws a group around a single thing.
 */
export function groupPullRequestsByStack(prs: GraphSidebarPullRequest[]): PullRequestListEntry[] {
	const membersByStack = new Map<number, GraphSidebarPullRequest[]>();
	for (const pr of prs) {
		if (pr.stack == null) continue;

		const members = membersByStack.get(pr.stack.number);
		if (members == null) {
			membersByStack.set(pr.stack.number, [pr]);
		} else {
			members.push(pr);
		}
	}

	const entries: PullRequestListEntry[] = [];
	const emitted = new Set<number>();

	for (const pr of prs) {
		const members = pr.stack != null ? membersByStack.get(pr.stack.number) : undefined;
		if (pr.stack == null || members == null || members.length < 2) {
			entries.push({ kind: 'pullRequest', pr: pr });
			continue;
		}

		// The group lands where its first member would have — provider order is updated-descending, so a
		// stack sorts by its most recently updated layer rather than jumping to the top of the list.
		if (emitted.has(pr.stack.number)) continue;

		emitted.add(pr.stack.number);
		entries.push({
			kind: 'stack',
			number: pr.stack.number,
			size: pr.stack.size,
			baseRef: pr.stack.baseRef,
			// Top layer first, matching the Commit Graph and github.com — a stack reads downward.
			members: [...members].sort((a, b) => (b.stack?.position ?? 0) - (a.stack?.position ?? 0)),
		});
	}

	return entries;
}
