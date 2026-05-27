import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { Issue } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { MaybePausedResult } from '@gitlens/utils/promise.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import type { Container } from '../../../../container.js';
import { getAssociatedIssuesForBranch } from '../../../../git/utils/-webview/branch.issue.utils.js';
import { getBranchAssociatedPullRequest } from '../../../../git/utils/-webview/branch.utils.js';
import { getBestRemoteWithIntegration } from '../../../../git/utils/-webview/remote.utils.js';

export interface ChangesContextCommit {
	sha: string;
	message: string;
}

export interface ChangesContextInput {
	/** Commits in scope. Source of per-commit autolink enrichment and (for commit/commit-range) owning-branch resolution. */
	commits?: readonly ChangesContextCommit[];
	/** Branch context for WIP and branch-tip kinds. Ignored for commit/commit-range — the gatherer resolves owning branch from `commits`. */
	branch?: GitBranch;
	changeKind?: 'wip' | 'commit' | 'commit-range' | 'branch-tip';
}

export interface ChangesContextItem {
	kind: 'pr' | 'issue';
	id: string;
	state: string;
	url: string;
	title: string;
	author?: string;
	body?: string;
	refs?: { base: string; head: string };
	relation: ChangesContextRelation;
}

export type ChangesContextRelation =
	| { source: 'branch-head'; branch: string }
	| { source: 'branch-associated'; branch: string }
	| { source: 'autolink'; commit: string };

export interface ChangesContextPayload {
	items: ChangesContextItem[];
}

const maxItems = 30;
const maxBodyChars = 500;
const gatherTimeoutMs = 5000;

export async function gatherContextForChanges(
	container: Container,
	repoPath: string,
	input: ChangesContextInput,
	signal?: AbortSignal,
): Promise<ChangesContextPayload> {
	const items: ChangesContextItem[] = [];
	const seen = new Set<string>();

	const work = (async () => {
		try {
			const branch = await resolveBranchForKind(container, repoPath, input, signal);
			signal?.throwIfAborted?.();
			if (branch != null) {
				await collectBranchAssociations(container, branch, items, seen, signal);
				signal?.throwIfAborted?.();
			}

			if (input.changeKind !== 'wip' && input.commits?.length && items.length < maxItems) {
				const remote = await getBestRemoteWithIntegration(repoPath, undefined, signal).catch(() => undefined);
				signal?.throwIfAborted?.();
				await collectCommitAutolinks(container, input.commits, remote, items, seen, signal);
			}
		} catch {
			// Silent — fall through to return whatever we managed to gather.
		}
	})();

	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<void>(resolve => {
		timer = setTimeout(resolve, gatherTimeoutMs);
	});

	try {
		await Promise.race([work, timeout]);
	} finally {
		if (timer != null) {
			clearTimeout(timer);
		}
	}

	return { items: items };
}

async function resolveBranchForKind(
	container: Container,
	repoPath: string,
	input: ChangesContextInput,
	signal: AbortSignal | undefined,
): Promise<GitBranch | undefined> {
	switch (input.changeKind) {
		case 'wip':
		case 'branch-tip':
			return input.branch;
		case 'commit':
		case 'commit-range':
			if (!input.commits?.length) return undefined;
			return resolveOwningBranchForCommits(container, repoPath, input.commits, signal);
	}
	return input.branch;
}

async function resolveOwningBranchForCommits(
	container: Container,
	repoPath: string,
	commits: readonly ChangesContextCommit[],
	signal: AbortSignal | undefined,
): Promise<GitBranch | undefined> {
	const svc = container.git.getRepositoryService(repoPath);
	const shas = commits.map(c => c.sha);

	let names: string[];
	try {
		names = await svc.branches.getBranchesWithCommits(shas, undefined, { mode: 'contains', remotes: true }, signal);
	} catch {
		return undefined;
	}
	if (!names.length) return undefined;

	signal?.throwIfAborted?.();

	let allBranches;
	try {
		const result = await svc.branches.getBranches(undefined, signal);
		allBranches = result.values;
	} catch {
		return undefined;
	}
	signal?.throwIfAborted?.();

	const nameSet = new Set(names);
	const matched = allBranches.filter(b => nameSet.has(b.name));

	const byLogical = new Map<string, GitBranch>();
	for (const b of matched) {
		const key = b.nameWithoutRemote;
		const existing = byLogical.get(key);
		if (existing == null || (existing.remote && !b.remote)) {
			byLogical.set(key, b);
		}
	}

	if (byLogical.size !== 1) return undefined;
	return [...byLogical.values()][0];
}

async function collectBranchAssociations(
	container: Container,
	branch: GitBranch,
	items: ChangesContextItem[],
	seen: Set<string>,
	signal: AbortSignal | undefined,
): Promise<void> {
	const [prResult, issuesResult] = await Promise.allSettled([
		getBranchAssociatedPullRequest(container, branch, { cached: true }).catch(() => undefined),
		getAssociatedIssuesForBranch(container, branch, { cancellation: signal, cached: true }).catch(() => undefined),
	]);

	const pr = getSettledValue(prResult);
	if (pr != null) {
		registerItem(items, seen, pullRequestToItem(pr, { source: 'branch-head', branch: branch.name }));
	}

	const issuesPaused = getSettledValue(issuesResult);
	const issues = await resolveMaybePaused(issuesPaused, signal);
	if (issues != null) {
		for (const issue of issues) {
			if (items.length >= maxItems) break;

			registerItem(items, seen, issueToItem(issue, { source: 'branch-associated', branch: branch.name }));
		}
	}
}

async function collectCommitAutolinks(
	container: Container,
	commits: readonly ChangesContextCommit[],
	remote: Awaited<ReturnType<typeof getBestRemoteWithIntegration>>,
	items: ChangesContextItem[],
	seen: Set<string>,
	signal: AbortSignal | undefined,
): Promise<void> {
	const seenMessages = new Set<string>();
	for (const commit of commits) {
		if (items.length >= maxItems) break;
		if (!commit.message || seenMessages.has(commit.message)) continue;

		seenMessages.add(commit.message);

		let enriched;
		try {
			enriched = await container.autolinks.getEnrichedAutolinks(commit.message, remote, { cached: true });
		} catch {
			enriched = undefined;
		}
		signal?.throwIfAborted?.();
		if (enriched == null || enriched.size === 0) continue;

		const resolutions = await Promise.allSettled(
			Array.from(enriched.values(), ([promise]) => promise ?? Promise.resolve(undefined)),
		);
		signal?.throwIfAborted?.();

		for (const settled of resolutions) {
			if (items.length >= maxItems) break;

			const value = getSettledValue(settled);
			if (value == null) continue;

			registerItem(items, seen, issueOrPrToItem(value, { source: 'autolink', commit: commit.sha }));
		}
	}
}

function registerItem(items: ChangesContextItem[], seen: Set<string>, item: ChangesContextItem | undefined): boolean {
	if (item == null) return false;

	const key = `${item.kind}:${item.url || `${providerKeyFallback(item)}:${item.id}`}`;
	if (seen.has(key)) return false;

	seen.add(key);
	items.push(item);
	return true;
}

function providerKeyFallback(item: ChangesContextItem): string {
	return item.title.slice(0, 32);
}

function pullRequestToItem(pr: PullRequest, relation: ChangesContextRelation): ChangesContextItem {
	return {
		kind: 'pr',
		id: pr.id,
		state: pr.state,
		url: pr.url,
		title: pr.title,
		author: pr.author?.name,
		refs:
			pr.refs != null
				? {
						base: pr.refs.base.branch,
						head: pr.refs.head.branch,
					}
				: undefined,
		relation: relation,
	};
}

function issueToItem(issue: Issue, relation: ChangesContextRelation): ChangesContextItem {
	return {
		kind: 'issue',
		id: issue.id,
		state: issue.state,
		url: issue.url,
		title: issue.title,
		author: issue.author?.name,
		body: truncateBody(issue.body),
		relation: relation,
	};
}

function issueOrPrToItem(item: IssueOrPullRequest, relation: ChangesContextRelation): ChangesContextItem {
	const isIssue = item.type === 'issue';
	const body = (item as Partial<Issue>).body;
	return {
		kind: isIssue ? 'issue' : 'pr',
		id: item.id,
		state: item.state,
		url: item.url,
		title: item.title,
		body: truncateBody(body),
		relation: relation,
	};
}

async function resolveMaybePaused<T>(
	result: MaybePausedResult<T> | undefined,
	signal: AbortSignal | undefined,
): Promise<T | undefined> {
	if (result == null) return undefined;
	if (!result.paused) return result.value;
	if (signal?.aborted) return undefined;

	try {
		return await result.value;
	} catch {
		return undefined;
	}
}

function truncateBody(body: string | undefined): string | undefined {
	if (!body) return undefined;

	const trimmed = body.trim();
	if (!trimmed) return undefined;
	if (trimmed.length <= maxBodyChars) return trimmed;
	return `${trimmed.slice(0, maxBodyChars).trimEnd()}…`;
}

export function formatChangesContextForPrompt(payload: ChangesContextPayload): string {
	if (!payload.items.length) return '';

	const lines: string[] = ['<work-items>'];
	for (const item of payload.items) {
		const attrs: string[] = [`kind="${item.kind}"`, `id="${escapeAttr(item.id)}"`];
		if (item.state) {
			attrs.push(`state="${escapeAttr(item.state)}"`);
		}
		if (item.url) {
			attrs.push(`url="${escapeAttr(item.url)}"`);
		}
		lines.push(`<item ${attrs.join(' ')}>`);
		lines.push(`<title>${escapeText(item.title)}</title>`);
		if (item.author) {
			lines.push(`<author>${escapeText(item.author)}</author>`);
		}
		if (item.refs) {
			lines.push(`<refs base="${escapeAttr(item.refs.base)}" head="${escapeAttr(item.refs.head)}"/>`);
		}
		if (item.body) {
			lines.push('<body>');
			lines.push(escapeText(item.body));
			lines.push('</body>');
		}
		lines.push(formatRelation(item.relation));
		lines.push('</item>');
	}
	lines.push('</work-items>');
	return lines.join('\n');
}

function formatRelation(relation: ChangesContextRelation): string {
	switch (relation.source) {
		case 'branch-head':
			return `<relation source="branch-head" branch="${escapeAttr(relation.branch)}">Pull request for the branch the change set is sitting on.</relation>`;
		case 'branch-associated':
			return `<relation source="branch-associated" branch="${escapeAttr(relation.branch)}">Tied to the branch via stored issue associations.</relation>`;
		case 'autolink':
			return `<relation source="autolink" commit="${escapeAttr(relation.commit)}">Referenced in the commit message.</relation>`;
	}
}

function escapeAttr(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeText(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
