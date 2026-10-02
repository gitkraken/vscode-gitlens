import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import type {
	BatchSlot,
	IssueEtagFields,
	PullRequestEtagFields,
	PullRequestEtagInclude,
} from '../models/integration.js';
import { pullRequestEtagIncludes } from '../models/integration.js';
import { issueEtag, issueEtagFieldsFromShape, pullRequestEtag, pullRequestEtagFieldsFromShape } from '../reads/etag.js';
import type { FakeRuntime } from './fakeRuntime.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { connectedGitHub } from './sweepHelpers.js';

/**
 * The correctness core of the batch reads' etags on GitHub/GHE: a cheap check and a full read of the SAME pull
 * request must compute the SAME etag, or every refresh of it costs a full read (or, were the cheap path to collapse
 * two states the full one tells apart, answers `unchanged` for a pull request that changed).
 *
 * The full row's etag is computed after `fromGitHubPullRequest`'s conversions, which are not the identity everywhere
 * (`EXPECTED` checks read as success, a null mergeability as none). So each case feeds ONE raw GitHub node through the integration's real full read and its real cheap read, answering each
 * request with only the fields that request selected, and compares the etags.
 */

type Node = Record<string, unknown>;

function prNode(number: number, overrides: Node): Node {
	return {
		id: `node-${number}`,
		number: number,
		title: `PR ${number}`,
		body: `Body ${number}`,
		permalink: `https://github.com/o/r/pull/${number}`,
		url: `https://github.com/o/r/pull/${number}`,
		state: 'OPEN',
		closed: false,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-02T03:04:05Z',
		closedAt: null,
		mergedAt: null,
		author: { login: 'octo', avatarUrl: '', url: 'https://github.com/octo' },
		baseRefName: 'main',
		baseRefOid: 'base',
		headRefName: 'feature',
		headRefOid: `head-${number}`,
		headRepository: {
			isFork: false,
			name: 'r',
			owner: { login: 'o' },
			sshUrl: 'git@github.com:o/r.git',
			url: 'https://github.com/o/r',
		},
		repository: {
			isFork: false,
			name: 'r',
			owner: { login: 'o' },
			sshUrl: 'git@github.com:o/r.git',
			url: 'https://github.com/o/r',
			viewerPermission: 'WRITE',
		},
		isCrossRepository: false,
		isDraft: false,
		additions: 1,
		deletions: 1,
		changedFiles: 1,
		checksUrl: '',
		mergeable: 'MERGEABLE',
		mergedBy: null,
		reviewDecision: 'APPROVED',
		latestReviews: { nodes: [] },
		viewerLatestReview: null,
		reviewRequests: { nodes: [] },
		assignees: { nodes: [] },
		commits: { totalCount: 1, nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
		totalCommentsCount: 0,
		viewerCanUpdate: true,
		...overrides,
	};
}

/**
 * Exactly what `getPullRequestsEtagFieldsBatch` selects for `includes`, picked off the same node the full read is
 * served.
 */
function cheapPrNode(node: Node, includes: readonly PullRequestEtagInclude[]): Node {
	const picked: Node = {
		id: node.id,
		number: node.number,
		state: node.state,
		isDraft: node.isDraft,
		updatedAt: node.updatedAt,
		headRefOid: node.headRefOid,
	};
	if (includes.includes('mergeable')) {
		picked.mergeable = node.mergeable;
	}
	if (includes.includes('reviewDecision')) {
		picked.reviewDecision = node.reviewDecision;
	}
	if (includes.includes('checks')) {
		const commits = node.commits as { nodes: { commit: unknown }[] };
		picked.commits = { nodes: commits.nodes.map(n => ({ commit: n.commit })) };
	}
	return picked;
}

/** What the document asked for, read back from its text, so the served node answers with what was selected. */
function selectedIncludes(query: string): PullRequestEtagInclude[] {
	const selected: PullRequestEtagInclude[] = [];
	if (/\bmergeable\b/.test(query)) {
		selected.push('mergeable');
	}
	if (/\breviewDecision\b/.test(query)) {
		selected.push('reviewDecision');
	}
	if (/\bstatusCheckRollup\b/.test(query)) {
		selected.push('checks');
	}
	return selected;
}

/** Every set the agreement is proven for: none, each include alone, and all of them. */
const etagIncludeSets: readonly (readonly PullRequestEtagInclude[])[] = [
	[],
	['mergeable'],
	['reviewDecision'],
	['checks'],
	pullRequestEtagIncludes,
];

const userRequest = {
	asCodeOwner: false,
	id: 'rr1',
	requestedReviewer: { login: 'reviewer', avatarUrl: '', url: 'https://github.com/reviewer' },
};
/** A team request: the `... on User` selection leaves an empty, but present, reviewer. */
const teamRequest = { asCodeOwner: true, id: 'rr2', requestedReviewer: {} };
const ghostRequest = { asCodeOwner: false, id: 'rr3', requestedReviewer: null };
const commentedReview = {
	id: 'rv1',
	author: { login: 'reviewer', avatarUrl: '', url: 'https://github.com/reviewer' },
	state: 'COMMENTED',
	commit: { oid: 'head' },
};

const prCases: [string, Node][] = [
	['open', {}],
	['closed', { state: 'CLOSED', closed: true, closedAt: '2026-01-03T00:00:00Z' }],
	['merged', { state: 'MERGED', closed: true, mergedAt: '2026-01-03T00:00:00Z' }],
	['draft', { isDraft: true }],
	['mergeable CONFLICTING', { mergeable: 'CONFLICTING' }],
	['mergeable UNKNOWN', { mergeable: 'UNKNOWN' }],
	['mergeable null', { mergeable: null }],
	['reviewDecision CHANGES_REQUESTED', { reviewDecision: 'CHANGES_REQUESTED' }],
	['reviewDecision REVIEW_REQUIRED', { reviewDecision: 'REVIEW_REQUIRED' }],
	['reviewDecision null', { reviewDecision: null }],
	['reviewDecision null, a user requested', { reviewDecision: null, reviewRequests: { nodes: [userRequest] } }],
	['reviewDecision null, a team requested', { reviewDecision: null, reviewRequests: { nodes: [teamRequest] } }],
	['reviewDecision null, a ghost requested', { reviewDecision: null, reviewRequests: { nodes: [ghostRequest] } }],
	['reviewDecision null, only commented', { reviewDecision: null, latestReviews: { nodes: [commentedReview] } }],
	['reviewDecision APPROVED, a user requested', { reviewRequests: { nodes: [userRequest] } }],
	...['SUCCESS', 'FAILURE', 'PENDING', 'EXPECTED', 'ERROR'].map((state): [string, Node] => [
		`rollup ${state}`,
		{ commits: { totalCount: 1, nodes: [{ commit: { statusCheckRollup: { state: state } } }] } },
	]),
	['rollup null', { commits: { totalCount: 1, nodes: [{ commit: { statusCheckRollup: null } }] } }],
	['no commits', { commits: { totalCount: 0, nodes: [] } }],
];

/**
 * Answers every GraphQL request from `byNumber`, keyed by each alias's `$k` variable, with what that request
 * selected: the whole node for a full read, only the etag fields for a cheap one.
 */
function serveGraphQL(runtime: FakeRuntime, byNumber: Map<number, Node>, field: 'pullRequest' | 'issue'): string[] {
	const queries: string[] = [];
	runtime.http.fetch = (_input, init) => {
		const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
			query: string;
			variables: Record<string, unknown>;
		};
		queries.push(body.query);
		const cheap = /^query get(PullRequests|Issues)EtagFieldsBatch\(/.test(body.query);
		const includes = selectedIncludes(body.query);
		const prefix = field === 'pullRequest' ? 'p' : 'i';

		const data: Record<string, unknown> = {};
		for (const [name, value] of Object.entries(body.variables)) {
			const match = /^k(\d+)$/.exec(name);
			if (match == null) continue;

			const node = byNumber.get(value as number);
			assert.ok(node != null);
			data[`${prefix}${match[1]}`] = {
				[field]: !cheap ? node : field === 'pullRequest' ? cheapPrNode(node, includes) : cheapIssueNode(node),
			};
		}
		return Promise.resolve(
			new Response(JSON.stringify({ data: data }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			}),
		);
	};
	return queries;
}

function fulfilled<T>(slots: BatchSlot<T>[] | undefined): T[] {
	assert.ok(slots != null);
	return slots.map(slot => {
		assert.equal(slot.status, 'fulfilled', slot.status === 'rejected' ? String(slot.reason) : undefined);
		return slot.value;
	});
}

suite('GitHub etag agreement: the cheap check and the full read compute the same etag', () => {
	for (const includes of etagIncludeSets) {
		test(`pull requests, every state, draft, mergeable, review decision and rollup (etagIncludes: [${includes.join(', ')}])`, async () => {
			const runtime = createFakeRuntime();
			const byNumber = new Map(prCases.map(([, overrides], i) => [i + 1, prNode(i + 1, overrides)]));
			const queries = serveGraphQL(runtime, byNumber, 'pullRequest');
			const { manager, gh } = await connectedGitHub(runtime);
			const coordinates = prCases.map((_, i) => ({ owner: 'o', repo: 'r', number: i + 1 }));

			const full = await gh.getPullRequestsBatchResult(coordinates);
			const cheap = await gh.getPullRequestsEtagFieldsResult(coordinates, { etagIncludes: includes });

			assert.ok(queries.some(q => q.startsWith('query getPullRequestsBatch(')));
			assert.ok(queries.some(q => q.startsWith('query getPullRequestsEtagFieldsBatch(')));
			const fullRows = fulfilled<PullRequestShape | undefined>(full?.value);
			const cheapRows = fulfilled<PullRequestEtagFields | undefined>(cheap?.value);
			prCases.forEach(([name], i) => {
				const shape = fullRows[i];
				const fields = cheapRows[i];
				assert.ok(shape != null && fields != null, name);
				assert.equal(
					pullRequestEtag(fields, includes),
					pullRequestEtag(pullRequestEtagFieldsFromShape(shape), includes),
					name,
				);
			});

			manager.dispose();
		});
	}

	for (const includes of etagIncludeSets) {
		test(`end to end: etags a full read hands back come back unchanged, with no full request (etagIncludes: [${includes.join(', ')}])`, async () => {
			const runtime = createFakeRuntime();
			const byNumber = new Map(prCases.map(([, overrides], i) => [i + 1, prNode(i + 1, overrides)]));
			const queries = serveGraphQL(runtime, byNumber, 'pullRequest');
			const { manager, gh } = await connectedGitHub(runtime);
			(gh as unknown as { getCurrentAccount: () => Promise<undefined> }).getCurrentAccount = () =>
				Promise.resolve(undefined);
			const targets = prCases.map(([name], i) => ({ key: name, owner: 'o', repo: 'r', number: i + 1 }));

			const first = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: targets,
				etagIncludes: includes,
			});
			const etags = new Map(first.items.map(i => [i.key, i.etag]));
			queries.length = 0;

			const second = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: targets.map(t => ({ ...t, etag: etags.get(t.key) })),
				etagIncludes: includes,
			});

			assert.ok(
				queries.every(q => q.startsWith('query getPullRequestsEtagFieldsBatch(')),
				'only the cheap check is sent',
			);
			assert.deepEqual(
				second.items.filter(i => !i.unchanged).map(i => i.key),
				[],
				'every unchanged pull request is answered unchanged',
			);
			assert.deepEqual(
				second.items.map(i => i.etag),
				first.items.map(i => i.etag),
			);

			manager.dispose();
		});
	}

	test('a null review decision with a pending request reads as no decision on BOTH paths', async () => {
		// GitHub's null means the repository requires no review. Pinned so a decision derived from the pending
		// request, on either path, fails here by name rather than as one row of the table above.
		const runtime = createFakeRuntime();
		const byNumber = new Map([[1, prNode(1, { reviewDecision: null, reviewRequests: { nodes: [userRequest] } })]]);
		serveGraphQL(runtime, byNumber, 'pullRequest');
		const { manager, gh } = await connectedGitHub(runtime);
		const coordinates = [{ owner: 'o', repo: 'r', number: 1 }];

		const [shape] = fulfilled((await gh.getPullRequestsBatchResult(coordinates))?.value);
		const [fields] = fulfilled(
			(await gh.getPullRequestsEtagFieldsResult(coordinates, { etagIncludes: ['reviewDecision'] }))?.value,
		);

		assert.ok(shape != null && fields != null);
		assert.equal(shape.reviewDecision, undefined);
		assert.equal(fields.reviewDecision, undefined);

		manager.dispose();
	});
});

function issueNode(number: number, overrides: Node): Node {
	return {
		id: `issue-${number}`,
		number: number,
		title: `Issue ${number}`,
		url: `https://github.com/o/r/issues/${number}`,
		state: 'OPEN',
		closed: false,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-02T03:04:05Z',
		closedAt: null,
		author: { login: 'octo', avatarUrl: '', url: 'https://github.com/octo' },
		assignees: { nodes: [] },
		comments: { totalCount: 0 },
		labels: { nodes: [] },
		reactions: { totalCount: 0 },
		repository: { name: 'r', owner: { login: 'o' }, viewerPermission: 'WRITE', url: 'https://github.com/o/r' },
		body: '',
		...overrides,
	};
}

/** Exactly what `getIssuesEtagFieldsBatch` selects. */
function cheapIssueNode(node: Node): Node {
	return { id: node.id, number: node.number, state: node.state, updatedAt: node.updatedAt };
}

suite('GitHub issue etag agreement', () => {
	test('open and closed issues compute the same etag on the cheap check and the full read', async () => {
		const cases: [string, Node][] = [
			['open', {}],
			['closed', { state: 'CLOSED', closed: true, closedAt: '2026-01-03T00:00:00Z' }],
		];
		const runtime = createFakeRuntime();
		const byNumber = new Map(cases.map(([, overrides], i) => [i + 1, issueNode(i + 1, overrides)]));
		serveGraphQL(runtime, byNumber, 'issue');
		const { manager, gh } = await connectedGitHub(runtime);
		const coordinates = cases.map((_, i) => ({ owner: 'o', repo: 'r', number: i + 1 }));

		const fullRows = fulfilled<IssueShape | undefined>((await gh.getIssuesBatchResult(coordinates))?.value);
		const cheapRows = fulfilled<IssueEtagFields | undefined>(
			(await gh.getIssuesEtagFieldsResult(coordinates))?.value,
		);

		cases.forEach(([name], i) => {
			const shape = fullRows[i];
			const fields = cheapRows[i];
			assert.ok(shape != null && fields != null, name);
			assert.equal(issueEtag(fields), issueEtag(issueEtagFieldsFromShape(shape)), name);
		});
		assert.notEqual(issueEtag(cheapRows[0]!), issueEtag(cheapRows[1]!), 'the state is part of the etag');

		manager.dispose();
	});

	test('end to end: etags a full read hands back come back unchanged, with no full request', async () => {
		const runtime = createFakeRuntime();
		const byNumber = new Map([
			[1, issueNode(1, {})],
			[2, issueNode(2, { state: 'CLOSED', closed: true, closedAt: '2026-01-03T00:00:00Z' })],
		]);
		const queries = serveGraphQL(runtime, byNumber, 'issue');
		const { manager } = await connectedGitHub(runtime);
		const targets = [
			{ key: 'open', owner: 'o', repo: 'r', number: 1 },
			{ key: 'closed', owner: 'o', repo: 'r', number: 2 },
		];

		const first = await manager.getIssuesBatch({ providerId: GitCloudHostIntegrationId.GitHub, targets: targets });
		queries.length = 0;
		const second = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: targets.map((t, i) => ({ ...t, etag: first.items[i].etag })),
		});

		assert.ok(queries.every(q => q.startsWith('query getIssuesEtagFieldsBatch(')));
		assert.deepEqual(
			second.items.map(i => [i.key, i.unchanged]),
			[
				['open', true],
				['closed', true],
			],
		);

		manager.dispose();
	});
});
