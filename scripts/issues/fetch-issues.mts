import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { config } from './config.mts';
import type {
	AuditCursor,
	AuditQueryParams,
	GitHubIssue,
	IssueComment,
	LinkedPr,
	ReactiveQueryParams,
	SingleQueryParams,
} from './types.mts';

const execFileAsync = promisify(execFile);

const cursorFile = join(config.cacheDir, 'audit-cursor.json');

export async function fetchIssues(mode: 'reactive', params: ReactiveQueryParams): Promise<GitHubIssue[]>;
export async function fetchIssues(mode: 'audit', params: AuditQueryParams): Promise<GitHubIssue[]>;
export async function fetchIssues(
	mode: 'reactive' | 'audit',
	params: ReactiveQueryParams | AuditQueryParams,
): Promise<GitHubIssue[]> {
	if (mode === 'reactive') {
		return fetchReactiveIssues(params as ReactiveQueryParams);
	}
	return fetchAuditIssues(params as AuditQueryParams);
}

function parseDuration(duration: string): number {
	const match = duration.match(/^(\d+)d$/);
	if (!match) throw new Error(`Invalid duration format: ${duration} (expected e.g. "7d")`);
	return parseInt(match[1], 10);
}

function daysAgo(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() - days);
	return d.toISOString().split('T')[0];
}

async function fetchReactiveIssues(params: ReactiveQueryParams): Promise<GitHubIssue[]> {
	const days = parseDuration(params.since);
	const sinceDate = daysAgo(days);

	const query = `
		query($owner: String!, $repo: String!, $cursor: String) {
			repository(owner: $owner, name: $repo) {
				issues(
					first: 100
					after: $cursor
					states: OPEN
					filterBy: { since: "${sinceDate}T00:00:00Z" }
					orderBy: { field: CREATED_AT, direction: DESC }
				) {
					pageInfo { hasNextPage endCursor }
					nodes {
						...IssueFields
					}
				}
			}
		}
		${issueFragment}
	`;

	return paginateGraphQL(query);
}

async function fetchAuditIssues(params: AuditQueryParams): Promise<GitHubIssue[]> {
	const days = parseDuration(params.olderThan);
	const beforeDate = daysAgo(days);
	const batchSize = params.batchSize;

	// Check for saved cursor to resume
	let savedCursor: AuditCursor | null = null;
	try {
		const raw = await readFile(cursorFile, 'utf8');
		savedCursor = JSON.parse(raw);
		if (savedCursor != null && savedCursor.batchNumber !== params.batchNumber) {
			savedCursor = null; // Different batch — start fresh
		}
	} catch {
		// No cursor file
	}

	const labelFilter = params.labelFilter ? `labels: ["${params.labelFilter}"]` : '';

	const query = `
		query($owner: String!, $repo: String!, $cursor: String) {
			repository(owner: $owner, name: $repo) {
				issues(
					first: ${batchSize}
					after: $cursor
					states: OPEN
					filterBy: { ${labelFilter} }
					orderBy: { field: CREATED_AT, direction: ASC }
				) {
					pageInfo { hasNextPage endCursor }
					nodes {
						...IssueFields
					}
				}
			}
		}
		${issueFragment}
	`;

	const startCursor = savedCursor?.endCursor ?? null;
	const issues = await fetchSinglePage(query, startCursor, params.batchNumber);

	// Filter to only issues older than the threshold
	let filtered = issues.filter(i => i.createdAt <= `${beforeDate}T23:59:59Z`);

	// Client-side type filter (GitHub GraphQL filterBy doesn't support issue types)
	if (params.typeFilter) {
		const typeFilter = params.typeFilter.toLowerCase();
		filtered = filtered.filter(i => i.type?.toLowerCase() === typeFilter);
	}

	// Save cursor for resume
	// We only fetch one page for audit mode, so save cursor from this page
	// The cursor is embedded in the response — we handle this in fetchSinglePage

	return filtered;
}

const issueFragment = `
	fragment IssueFields on Issue {
		number
		title
		body
		state
		issueType { name }
		labels(first: 20) { nodes { name } }
		author { login }
		authorAssociation
		assignees(first: 10) { nodes { login } }
		milestone { title }
		createdAt
		updatedAt
		closedAt
		reactionGroups {
			content
			reactors(first: 0) { totalCount }
		}
		comments(last: ${config.issueCommentLimit}) {
			totalCount
			nodes {
				author { login }
				authorAssociation
				body
				createdAt
			}
		}
		timelineItems(last: 20, itemTypes: [CROSS_REFERENCED_EVENT, CONNECTED_EVENT]) {
			nodes {
				... on CrossReferencedEvent {
					source {
						... on PullRequest {
							number
							title
							state
							mergedAt
						}
					}
				}
				... on ConnectedEvent {
					subject {
						... on PullRequest {
							number
							title
							state
							mergedAt
						}
					}
				}
			}
		}
	}
`;

interface GraphQLIssueNode {
	number: number;
	title: string;
	body: string;
	state: 'OPEN' | 'CLOSED';
	issueType: { name: string } | null;
	labels: { nodes: Array<{ name: string }> };
	author: { login: string } | null;
	authorAssociation: string;
	assignees: { nodes: Array<{ login: string }> };
	milestone: { title: string } | null;
	createdAt: string;
	updatedAt: string;
	closedAt: string | null;
	reactionGroups: Array<{ content: string; reactors: { totalCount: number } }>;
	comments: {
		totalCount: number;
		nodes: Array<{
			author: { login: string } | null;
			authorAssociation: string;
			body: string;
			createdAt: string;
		}>;
	};
	timelineItems: {
		nodes: Array<{
			source?: { number?: number; title?: string; state?: string; mergedAt?: string | null };
			subject?: { number?: number; title?: string; state?: string; mergedAt?: string | null };
		}>;
	};
}

function mapIssueNode(node: GraphQLIssueNode): GitHubIssue {
	const linkedPrs: LinkedPr[] = [];
	const seenPrs = new Set<number>();

	for (const item of node.timelineItems.nodes) {
		const pr = item.source ?? item.subject;
		if (pr?.number != null && !seenPrs.has(pr.number)) {
			seenPrs.add(pr.number);
			linkedPrs.push({
				number: pr.number,
				title: pr.title ?? '',
				state: pr.mergedAt ? 'merged' : ((pr.state?.toLowerCase() as 'open' | 'closed') ?? 'open'),
				mergedAt: pr.mergedAt ?? null,
			});
		}
	}

	const comments: IssueComment[] = node.comments.nodes.map(c => ({
		author: c.author?.login ?? 'ghost',
		authorAssociation: c.authorAssociation,
		body: c.body,
		createdAt: c.createdAt,
	}));

	const reactionGroups = (node.reactionGroups ?? []).map(g => ({
		content: g.content,
		totalCount: g.reactors.totalCount,
	}));

	return {
		number: node.number,
		title: node.title,
		body: node.body,
		state: node.state === 'OPEN' ? 'open' : 'closed',
		type: node.issueType?.name ?? null,
		labels: node.labels.nodes.map(l => l.name),
		author: node.author?.login ?? 'ghost',
		authorAssociation: node.authorAssociation,
		assignees: node.assignees.nodes.map(a => a.login),
		milestone: node.milestone?.title ?? null,
		createdAt: node.createdAt,
		updatedAt: node.updatedAt,
		closedAt: node.closedAt,
		comments,
		commentCount: node.comments.totalCount,
		linkedPrs,
		reactionGroups,
	};
}

async function execGraphQL(query: string, cursor: string | null): Promise<string> {
	// gh api graphql expects variables as individual -F (non-string/JSON) or -f (string) flags
	const args = ['api', 'graphql', '-f', `query=${query}`, '-F', `owner=${config.owner}`, '-F', `repo=${config.repo}`];
	if (cursor != null) {
		args.push('-F', `cursor=${cursor}`);
	}

	let lastError: Error | null = null;
	for (let attempt = 0; attempt < config.graphqlRetryMaxAttempts; attempt++) {
		try {
			const { stdout } = await execFileAsync('gh', args, { maxBuffer: 50 * 1024 * 1024 });
			return stdout;
		} catch (err: unknown) {
			lastError = err instanceof Error ? err : new Error(String(err));
			const msg = lastError.message.toLowerCase();
			if (msg.includes('rate limit') || msg.includes('secondary rate')) {
				const backoff = config.graphqlRetryBackoffMs * Math.pow(2, attempt);
				console.error(
					`Rate limited. Retrying in ${backoff / 1000}s (attempt ${attempt + 1}/${config.graphqlRetryMaxAttempts})...`,
				);
				await new Promise(resolve => setTimeout(resolve, backoff));
				continue;
			}
			throw lastError;
		}
	}
	throw lastError ?? new Error('GraphQL request failed after retries');
}

async function paginateGraphQL(query: string): Promise<GitHubIssue[]> {
	const issues: GitHubIssue[] = [];
	let cursor: string | null = null;

	while (true) {
		const raw = await execGraphQL(query, cursor);
		const response = JSON.parse(raw);

		if (response.errors?.length) {
			throw new Error(`GraphQL errors: ${JSON.stringify(response.errors)}`);
		}

		const connection = response.data.repository.issues;
		const nodes: GraphQLIssueNode[] = connection.nodes;
		issues.push(...nodes.map(mapIssueNode));

		if (!connection.pageInfo.hasNextPage) break;
		cursor = connection.pageInfo.endCursor;
	}

	return issues;
}

async function fetchSinglePage(query: string, cursor: string | null, batchNumber: number = 0): Promise<GitHubIssue[]> {
	const raw = await execGraphQL(query, cursor);
	const response = JSON.parse(raw);

	if (response.errors?.length) {
		throw new Error(`GraphQL errors: ${JSON.stringify(response.errors)}`);
	}

	const connection = response.data.repository.issues;
	const nodes: GraphQLIssueNode[] = connection.nodes;
	const issues = nodes.map(mapIssueNode);

	// Save cursor for audit checkpoint/resume
	await mkdir(config.cacheDir, { recursive: true });
	const auditCursor: AuditCursor = {
		endCursor: connection.pageInfo.endCursor,
		hasNextPage: connection.pageInfo.hasNextPage,
		batchNumber: batchNumber,
		totalFetched: issues.length,
	};
	await writeFile(cursorFile, JSON.stringify(auditCursor, null, '\t'));

	return issues;
}

export async function fetchSingleIssues(params: SingleQueryParams): Promise<GitHubIssue[]> {
	const chunkSize = config.singleIssueBatchLimit;
	const allIssues: GitHubIssue[] = [];

	for (let i = 0; i < params.issueNumbers.length; i += chunkSize) {
		const chunk = params.issueNumbers.slice(i, i + chunkSize);
		const aliases = chunk.map(n => `i${n}: issue(number: ${n}) { ...IssueFields }`).join('\n');

		const query = `
			query($owner: String!, $repo: String!) {
				repository(owner: $owner, name: $repo) {
					${aliases}
				}
			}
			${issueFragment}
		`;

		const raw = await execGraphQL(query, null);
		const response = JSON.parse(raw);

		if (response.errors?.length) {
			// Some issues may not exist — filter out null results
			const nonNullErrors = response.errors.filter((e: { type?: string }) => e.type !== 'NOT_FOUND');
			if (nonNullErrors.length > 0) {
				throw new Error(`GraphQL errors: ${JSON.stringify(nonNullErrors)}`);
			}
		}

		const repo = response.data.repository;
		for (const num of chunk) {
			const node: GraphQLIssueNode | null = repo[`i${num}`];
			if (node != null) {
				allIssues.push(mapIssueNode(node));
			} else {
				console.error(`Warning: issue #${num} not found, skipping`);
			}
		}
	}

	return allIssues;
}

/** Remove the audit cursor file (called when a batch completes successfully). */
export async function clearAuditCursor(): Promise<void> {
	try {
		await unlink(cursorFile);
	} catch {
		// Already gone
	}
}
