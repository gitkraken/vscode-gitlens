import assert from 'node:assert';
import { suite, test } from 'mocha';
import { AuthenticationError, RequestRateLimitError } from '@gitlens/git/errors.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { GitHubIssueEtagInclude, GitHubPullRequestEtagInclude } from '../../models.js';
import type { GitHubApiConfig } from '../config.js';
import { GitHubApi } from '../github.js';
import type { GitHubTokenInfo } from '../token.js';
import { gitHubPullRequest } from './fixtures.js';

/**
 * The cheap checks behind the batch reads' etags: the aliased document of `getPullRequestsBatch` /
 * `getIssuesBatch`, selecting only change state. What these pin is the selection itself — minimal, and valid as
 * GitHub validates it (a declared-but-unused variable fails the whole document there, which a stub never would) —
 * and that the slot rules are the full reads' own.
 */

const provider = {
	id: 'github',
	name: 'GitHub',
	domain: 'github.com',
	icon: 'github',
	getIgnoreSSLErrors: () => false,
	reauthenticate: () => Promise.resolve(),
	trackRequestException: () => {},
} as unknown as Provider;

const token: GitHubTokenInfo = {
	providerId: 'github',
	accessToken: 'token',
	microHash: 'hash',
	cloud: true,
	type: undefined,
};

function batchServe(
	byAlias: Record<string, unknown> | null,
	errors?: { type: string; path?: string[]; message?: string }[],
): { config: GitHubApiConfig; requests: { query: string; variables: Record<string, unknown> }[] } {
	const requests: { query: string; variables: Record<string, unknown> }[] = [];
	const config = {
		isWeb: false,
		wrapForForcedInsecureSSL: (_i: unknown, fn: () => unknown) => fn(),
		fetch: async (_url: unknown, init?: { body?: string }) => {
			const body = JSON.parse(init?.body ?? '{}') as { query?: string; variables?: Record<string, unknown> };
			requests.push({ query: body.query ?? '', variables: body.variables ?? {} });
			return new Response(JSON.stringify({ data: byAlias, ...(errors != null ? { errors: errors } : {}) }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		},
	} as unknown as GitHubApiConfig;
	return { config: config, requests: requests };
}

/** Every `$name` the document declares in its header is referenced in its body, as GitHub requires. */
function assertEveryDeclaredVariableIsUsed(query: string): void {
	const open = query.indexOf('(');
	const close = query.indexOf(')');
	const declared = Array.from(query.slice(open, close).matchAll(/\$(\w+)\s*:/g), m => m[1]);
	const body = query.slice(close + 1);
	assert.ok(declared.length > 0);
	for (const name of declared) {
		assert.match(body, new RegExp(`\\$${name}\\b`), `$${name} is declared but never used`);
	}
}

/** The change state alone, which is all the etag-fields read selects. */
const prNode = (number: number) => {
	const { id, state, isDraft, updatedAt, headRefOid } = gitHubPullRequest(number, {
		updatedAt: '2026-01-01T00:00:00Z',
		headRefOid: `head-${number}`,
	});
	return { id: id, number: number, state: state, isDraft: isDraft, updatedAt: updatedAt, headRefOid: headRefOid };
};

suite('GitHubApi.getPullRequestsEtagFieldsBatch', () => {
	test('selects only the change state, positionally, in one request', async () => {
		const { config, requests } = batchServe({ p0: { pullRequest: prNode(1) }, p1: { pullRequest: prNode(2) } });
		const api = new GitHubApi(config);

		const out = await api.getPullRequestsEtagFieldsBatch(provider, token, [
			{ owner: 'o', repo: 'a', number: 1 },
			{ owner: 'o', repo: 'b', number: 2 },
		]);

		assert.equal(requests.length, 1);
		assert.deepEqual(
			out.map(r => (r.status === 'fulfilled' ? r.value?.headRefOid : 'rejected')),
			['head-1', 'head-2'],
		);
		const { query, variables } = requests[0];
		assert.match(query, /^query getPullRequestsEtagFieldsBatch\(/);
		assert.match(query, /p0: repository\(owner: \$o0, name: \$n0\)/);
		assert.match(query, /pullRequest\(number: \$k1\)/);
		for (const field of ['id', 'number', 'state', 'isDraft', 'updatedAt', 'headRefOid']) {
			assert.match(query, new RegExp(`^\\s*${field}$`, 'm'), `selects ${field}`);
		}
		for (const field of [
			'title',
			'body',
			'author',
			'latestReviews',
			'viewerLatestReview',
			'assignees',
			'additions',
			'stack',
			// Only with an include.
			'mergeable',
			'reviewDecision',
			'reviewRequests',
			'commits',
			'statusCheckRollup',
		]) {
			assert.doesNotMatch(query, new RegExp(`\\b${field}\\b`), `does not select ${field}`);
		}
		assert.equal(variables.o1, 'o');
		assert.equal(variables.n1, 'b');
		assert.equal(variables.k1, 2);
	});

	/** What each include selects, and the one thing that proves it: the field's own selection in the document. */
	const includeSelections: [GitHubPullRequestEtagInclude, RegExp[]][] = [
		['mergeable', [/^\s*mergeable$/m]],
		['reviewDecision', [/^\s*reviewDecision$/m]],
		['checks', [/commits\(last: 1\)\s*\{\s*nodes\s*\{\s*commit\s*\{\s*statusCheckRollup\s*\{\s*state\s*\}/]],
	];
	const includeSets: GitHubPullRequestEtagInclude[][] = [
		[],
		['mergeable'],
		['reviewDecision'],
		['checks'],
		['mergeable', 'checks'],
		['mergeable', 'reviewDecision', 'checks'],
	];

	for (const includes of includeSets) {
		test(`selects exactly the sub-selections of etagIncludes [${includes.join(', ')}], with the full fragment’s own selections`, async () => {
			const { config, requests } = batchServe({ p0: { pullRequest: prNode(1) } });
			const api = new GitHubApi(config);

			await api.getPullRequestsEtagFieldsBatch(provider, token, [{ owner: 'o', repo: 'a', number: 1 }], {
				etagIncludes: includes,
			});

			const { query } = requests[0];
			for (const [include, selections] of includeSelections) {
				for (const selection of selections) {
					if (includes.includes(include)) {
						assert.match(query, selection, `selects ${include}`);
					} else {
						assert.doesNotMatch(query, selection, `does not select ${include}`);
					}
				}
			}
			if (!includes.includes('mergeable')) {
				assert.doesNotMatch(query, /\bmergeable\b/);
			}
			if (!includes.includes('reviewDecision')) {
				assert.doesNotMatch(query, /\breviewDecision\b/);
			}
			// The review decision is GitHub's own alone: no include selects the pending requests.
			assert.doesNotMatch(query, /\b(reviewRequests|requestedReviewer)\b/);
			if (!includes.includes('checks')) {
				assert.doesNotMatch(query, /\b(commits|statusCheckRollup)\b/);
			}
			assert.doesNotMatch(query, /latestReviews|avatarUrl|totalCount/);
		});
	}

	test('a repeated include does not repeat its selection', async () => {
		const { config, requests } = batchServe({ p0: { pullRequest: prNode(1) } });
		const api = new GitHubApi(config);

		await api.getPullRequestsEtagFieldsBatch(provider, token, [{ owner: 'o', repo: 'a', number: 1 }], {
			etagIncludes: ['mergeable', 'mergeable'],
		});

		assert.equal(requests[0].query.match(/^\s*mergeable$/gm)?.length, 1);
	});

	for (const includes of includeSets) {
		test(`declares no $avatarSize and uses every variable it declares (etagIncludes: [${includes.join(', ')}])`, async () => {
			const { config, requests } = batchServe({ p0: { pullRequest: prNode(1) }, p1: { pullRequest: prNode(2) } });
			const api = new GitHubApi(config);

			await api.getPullRequestsEtagFieldsBatch(
				provider,
				token,
				[
					{ owner: 'o', repo: 'a', number: 1 },
					{ owner: 'o', repo: 'b', number: 2 },
				],
				{ etagIncludes: includes },
			);

			const { query, variables } = requests[0];
			assert.doesNotMatch(query, /\$avatarSize/);
			assert.ok(!('avatarSize' in variables));
			assertEveryDeclaredVariableIsUsed(query);
		});
	}

	test('a NOT_FOUND alias is a proven absence; another alias’s refusal rejects only its own slot', async () => {
		const { config } = batchServe(
			{ p0: { pullRequest: prNode(1) }, p1: { pullRequest: null }, p2: null, p3: { pullRequest: null } },
			[
				{ type: 'NOT_FOUND', path: ['p1', 'pullRequest'] },
				{ type: 'NOT_FOUND', path: ['p2'] },
				{ type: 'FORBIDDEN', path: ['p3'], message: 'SAML enforcement' },
			],
		);
		const api = new GitHubApi(config);

		const out = await api.getPullRequestsEtagFieldsBatch(provider, token, [
			{ owner: 'o', repo: 'a', number: 1 },
			{ owner: 'o', repo: 'a', number: 999 },
			{ owner: 'o', repo: 'gone', number: 1 },
			{ owner: 'o', repo: 'saml-org', number: 1 },
		]);

		assert.deepEqual(
			out.map(r => (r.status === 'fulfilled' ? r.value?.id : 'rejected')),
			['node-1', undefined, undefined, 'rejected'],
		);
		const reason = out[3].status === 'rejected' ? (out[3].reason as unknown) : undefined;
		assert.ok(!(reason instanceof AuthenticationError), 'one alias refused is not an auth failure');
	});

	test('a RATE_LIMITED response throws the whole call, typed as the full read’s', async () => {
		const { config } = batchServe({ p0: { pullRequest: prNode(1) } }, [{ type: 'RATE_LIMITED' }]);
		const api = new GitHubApi(config);

		await assert.rejects(
			() => api.getPullRequestsEtagFieldsBatch(provider, token, [{ owner: 'o', repo: 'a', number: 1 }]),
			(ex: unknown) => ex instanceof RequestRateLimitError,
		);
	});

	test('a response with no data throws rather than reading as a batch of absences', async () => {
		const { config } = batchServe(null);
		const api = new GitHubApi(config);

		await assert.rejects(() =>
			api.getPullRequestsEtagFieldsBatch(provider, token, [{ owner: 'o', repo: 'a', number: 1 }]),
		);
	});

	test('no coordinates costs no request', async () => {
		const { config, requests } = batchServe({});
		const api = new GitHubApi(config);

		assert.deepEqual(await api.getPullRequestsEtagFieldsBatch(provider, token, []), []);
		assert.equal(requests.length, 0);
	});
});

suite('GitHubApi.getIssuesEtagFieldsBatch', () => {
	const issueNode = (number: number) => ({
		id: `issue-${number}`,
		number: number,
		state: 'OPEN',
		updatedAt: '2026-01-01T00:00:00Z',
	});

	test('selects only the change state, positionally, in one request', async () => {
		const { config, requests } = batchServe({ i0: { issue: issueNode(1) }, i1: { issue: issueNode(2) } });
		const api = new GitHubApi(config);

		const out = await api.getIssuesEtagFieldsBatch(provider, token, [
			{ owner: 'o', repo: 'a', number: 1 },
			{ owner: 'o', repo: 'b', number: 2 },
		]);

		assert.equal(requests.length, 1);
		assert.deepEqual(
			out.map(r => (r.status === 'fulfilled' ? r.value?.id : 'rejected')),
			['issue-1', 'issue-2'],
		);
		const { query, variables } = requests[0];
		assert.match(query, /^query getIssuesEtagFieldsBatch\(/);
		assert.match(query, /i1: repository\(owner: \$o1, name: \$n1\)/);
		assert.match(query, /issue\(number: \$k1\)/);
		for (const field of ['id', 'number', 'state', 'updatedAt']) {
			assert.match(query, new RegExp(`^\\s*${field}$`, 'm'), `selects ${field}`);
		}
		for (const field of ['title', 'body', 'author', 'assignees', 'labels', 'comments', 'reactions']) {
			assert.doesNotMatch(query, new RegExp(`\\b${field}\\b`), `does not select ${field}`);
		}
		assert.doesNotMatch(query, /\$avatarSize/);
		assert.ok(!('avatarSize' in variables));
		assertEveryDeclaredVariableIsUsed(query);
		assert.equal(variables.k1, 2);
	});

	for (const includes of [[], ['reactions'], ['reactions', 'reactions']] as GitHubIssueEtagInclude[][]) {
		test(`selects the full fragment's thumbs-up reactions only with 'reactions', and once (etagIncludes: [${includes.join(', ')}])`, async () => {
			const { config, requests } = batchServe({
				i0: { issue: { ...issueNode(1), reactions: { totalCount: 3 } } },
				i1: { issue: issueNode(2) },
			});
			const api = new GitHubApi(config);

			const out = await api.getIssuesEtagFieldsBatch(
				provider,
				token,
				[
					{ owner: 'o', repo: 'a', number: 1 },
					{ owner: 'o', repo: 'b', number: 2 },
				],
				{ etagIncludes: includes },
			);

			const { query, variables } = requests[0];
			const selection = /reactions\(content: THUMBS_UP\) \{\s*totalCount\s*\}/g;
			assert.equal(query.match(selection)?.length ?? 0, includes.length ? 2 : 0, 'once per alias');
			if (!includes.length) {
				assert.doesNotMatch(query, /\b(reactions|totalCount)\b/);
			}
			assert.doesNotMatch(query, /\$avatarSize/);
			assert.ok(!('avatarSize' in variables));
			assertEveryDeclaredVariableIsUsed(query);
			assert.deepEqual(
				out.map(r => (r.status === 'fulfilled' ? r.value?.reactions?.totalCount : 'rejected')),
				[3, undefined],
				'the node is returned as GitHub answered it',
			);
		});
	}

	test('a NOT_FOUND alias is a proven absence; another alias’s refusal rejects only its own slot', async () => {
		const { config } = batchServe({ i0: { issue: issueNode(1) }, i1: { issue: null }, i2: { issue: null } }, [
			{ type: 'NOT_FOUND', path: ['i1', 'issue'] },
			{ type: 'FORBIDDEN', path: ['i2'], message: 'SAML enforcement' },
		]);
		const api = new GitHubApi(config);

		const out = await api.getIssuesEtagFieldsBatch(provider, token, [
			{ owner: 'o', repo: 'a', number: 1 },
			{ owner: 'o', repo: 'a', number: 999 },
			{ owner: 'o', repo: 'saml-org', number: 1 },
		]);

		assert.deepEqual(
			out.map(r => (r.status === 'fulfilled' ? r.value?.id : 'rejected')),
			['issue-1', undefined, 'rejected'],
		);
	});

	test('a RATE_LIMITED response throws the whole call, typed as the full read’s', async () => {
		const { config } = batchServe({ i0: { issue: issueNode(1) } }, [{ type: 'RATE_LIMITED' }]);
		const api = new GitHubApi(config);

		await assert.rejects(
			() => api.getIssuesEtagFieldsBatch(provider, token, [{ owner: 'o', repo: 'a', number: 1 }]),
			(ex: unknown) => ex instanceof RequestRateLimitError,
		);
	});

	test('a response with no data throws rather than reading as a batch of absences', async () => {
		const { config } = batchServe(null);
		const api = new GitHubApi(config);

		await assert.rejects(() =>
			api.getIssuesEtagFieldsBatch(provider, token, [{ owner: 'o', repo: 'a', number: 1 }]),
		);
	});

	test('no coordinates costs no request', async () => {
		const { config, requests } = batchServe({});
		const api = new GitHubApi(config);

		assert.deepEqual(await api.getIssuesEtagFieldsBatch(provider, token, []), []);
		assert.equal(requests.length, 0);
	});
});
