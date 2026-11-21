import assert from 'node:assert';
import { suite, test } from 'mocha';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { GitHubCheckContext, GitHubCheckContexts, GitHubCheckRunContext } from '../../models.js';
import { decodeGitHubCheckRunId } from '../../models.js';
import type { GitHubApiConfig } from '../config.js';
import { GitHubApi } from '../github.js';
import type { GitHubTokenInfo } from '../token.js';
import { gitHubPullRequest } from './fixtures.js';

suite('GitHubApi check runs', () => {
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

	const enterprise = 'https://github.acme.com/api/v3';

	type Request = { query: string; variables: Record<string, unknown> };

	function serve(
		answer: (request: Request) => Record<string, unknown>,
		errors?: (request: Request) => unknown[] | undefined,
	): { api: GitHubApi; requests: Request[] } {
		const requests: Request[] = [];
		const config = {
			isWeb: false,
			wrapForForcedInsecureSSL: (_ignore: unknown, fn: () => unknown) => fn(),
			fetch: async (_url: unknown, init?: { body?: string }) => {
				const body = JSON.parse(init?.body ?? '{}') as Partial<Request>;
				const request = { query: body.query ?? '', variables: body.variables ?? {} };
				requests.push(request);
				return new Response(JSON.stringify({ data: answer(request), errors: errors?.(request) }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			},
		} as unknown as GitHubApiConfig;
		return { api: new GitHubApi(config), requests: requests };
	}

	function assertEveryVariableUsed(query: string): void {
		const header = query.slice(0, query.indexOf(')'));
		const body = query.slice(query.indexOf(')'));
		for (const [, name] of header.matchAll(/\$(\w+):/g)) {
			assert.match(body, new RegExp(`\\$${name}\\b`), `$${name} is declared but unused`);
		}
	}

	function contexts(
		nodes: (GitHubCheckContext | null)[],
		next?: string,
	): { statusCheckRollup: { state: 'SUCCESS'; contexts: GitHubCheckContexts } } {
		return {
			statusCheckRollup: {
				state: 'SUCCESS',
				contexts: {
					pageInfo: { hasNextPage: next != null, endCursor: next ?? null },
					nodes: nodes,
				},
			},
		};
	}

	function checkRun(name: string, overrides?: Partial<GitHubCheckRunContext>): GitHubCheckRunContext {
		return {
			__typename: 'CheckRun',
			id: `CR_${name}`,
			databaseId: 7,
			name: name,
			status: 'COMPLETED',
			conclusion: 'SUCCESS',
			detailsUrl: `https://example.com/${name}`,
			url: `https://github.com/o/a/runs/${name}`,
			title: null,
			startedAt: '2026-01-01T00:00:00Z',
			completedAt: '2026-01-01T00:01:00Z',
			checkSuite: { app: { slug: 'other-ci' }, workflowRun: null },
			...overrides,
		};
	}

	test('selects check contexts only when asked, declaring only the variables it uses, and isRequired only on github.com batches', async () => {
		const { api, requests } = serve(() => ({}));
		const coordinates = [
			{ owner: 'o', repo: 'a', number: 1 },
			{ owner: 'o', repo: 'b', number: 2 },
		];
		const branches = [{ owner: 'o', repo: 'a', branch: 'main', headOwners: [undefined] }];

		const documents = async (options: { baseUrl?: string; checkRuns?: boolean }): Promise<string[]> => {
			requests.length = 0;
			await api.getPullRequestsBatch(provider, token, coordinates, options);
			await api.getPullRequestsEtagFieldsBatch(provider, token, coordinates, {
				...options,
				etagIncludes: ['checks'],
			});
			await api.getPullRequestsForBranches(provider, token, branches, { ...options, limit: 10 });
			return requests.map(r => r.query);
		};

		for (const query of await documents({})) {
			assert.doesNotMatch(query, /\bcontexts\b/);
			assertEveryVariableUsed(query);
		}

		const [batch, cheap, branch] = await documents({ checkRuns: true });
		for (const query of [batch, cheap, branch]) {
			assert.match(query, /contexts\(first: 100\)/);
			assertEveryVariableUsed(query);
		}
		assert.match(batch, /isRequired\(pullRequestNumber: \$k0\)/);
		assert.match(batch, /isRequired\(pullRequestNumber: \$k1\)/);
		assert.match(batch, /checkSuite \{/);
		assert.doesNotMatch(cheap, /isRequired|workflowRun|detailsUrl/);
		assert.match(cheap, /statusCheckRollup \{\s*state/);
		assert.doesNotMatch(branch, /isRequired/);

		for (const query of await documents({ baseUrl: enterprise, checkRuns: true })) {
			assert.match(query, /contexts\(first: 100\)/);
			assert.doesNotMatch(query, /isRequired/);
			assertEveryVariableUsed(query);
		}
	});

	test('maps Actions jobs, other check runs and commit statuses, and an unknown enum value never fails the row', async () => {
		const nodes: GitHubCheckContext[] = [
			checkRun('build', {
				databaseId: 123,
				isRequired: true,
				checkSuite: { app: { slug: 'github-actions' }, workflowRun: { workflow: { name: 'CI' } } },
			}),
			checkRun('lint', { status: 'IN_PROGRESS', conclusion: null, detailsUrl: null, title: 'Linting' }),
			{
				__typename: 'StatusContext',
				id: 'SC_deploy',
				context: 'deploy',
				state: 'ERROR',
				targetUrl: 'https://deploy.example.com',
				createdAt: '2026-01-01T00:02:00Z',
				isRequired: false,
			},
			{
				__typename: 'StatusContext',
				id: 'SC_preview',
				context: 'preview',
				state: 'EXPECTED',
				targetUrl: null,
				createdAt: '2026-01-01T00:03:00Z',
			},
			checkRun('future', {
				status: 'SOMEDAY' as 'QUEUED',
				conclusion: 'SOMETHING_NEW' as 'SUCCESS',
				checkSuite: null,
			}),
		];
		const { api } = serve(() => ({
			p0: {
				pullRequest: gitHubPullRequest(1, {
					commits: { totalCount: 1, nodes: [{ commit: contexts(nodes) }] },
				}),
			},
		}));

		const [slot] = await api.getPullRequestsBatch(provider, token, [{ owner: 'o', repo: 'a', number: 1 }], {
			checkRuns: true,
		});
		assert.ok(slot.status === 'fulfilled');
		const pr = slot.value;
		assert.equal(pr?.checkRunsTruncated, undefined);
		assert.deepStrictEqual(pr?.checkRuns, [
			{
				kind: 'check-run',
				name: 'build',
				status: 'completed',
				conclusion: 'success',
				id: 'a:123',
				workflowName: 'CI',
				url: 'https://example.com/build',
				required: true,
				startedAt: new Date('2026-01-01T00:00:00Z'),
				completedAt: new Date('2026-01-01T00:01:00Z'),
				hasLog: true,
			},
			{
				kind: 'check-run',
				name: 'lint',
				status: 'in-progress',
				conclusion: undefined,
				id: 'c:CR_lint',
				workflowName: undefined,
				url: 'https://github.com/o/a/runs/lint',
				required: undefined,
				startedAt: new Date('2026-01-01T00:00:00Z'),
				completedAt: new Date('2026-01-01T00:01:00Z'),
				hasLog: true,
			},
			{
				kind: 'status',
				name: 'deploy',
				status: 'completed',
				conclusion: 'error',
				id: 's:SC_deploy',
				url: 'https://deploy.example.com',
				required: false,
				startedAt: new Date('2026-01-01T00:02:00Z'),
				hasLog: false,
			},
			{
				kind: 'status',
				name: 'preview',
				status: 'pending',
				id: 's:SC_preview',
				url: undefined,
				required: undefined,
				startedAt: new Date('2026-01-01T00:03:00Z'),
				hasLog: false,
			},
			{
				kind: 'check-run',
				name: 'future',
				status: 'pending',
				conclusion: undefined,
				id: 'c:CR_future',
				workflowName: undefined,
				url: 'https://example.com/future',
				required: undefined,
				startedAt: new Date('2026-01-01T00:00:00Z'),
				completedAt: new Date('2026-01-01T00:01:00Z'),
				hasLog: false,
			},
		]);
		assert.deepStrictEqual(decodeGitHubCheckRunId('a:123'), { kind: 'actions-job', jobId: 123 });
		assert.deepStrictEqual(decodeGitHubCheckRunId('c:CR_lint'), { kind: 'check-run', nodeId: 'CR_lint' });
		assert.deepStrictEqual(decodeGitHubCheckRunId('s:SC_deploy'), { kind: 'status', nodeId: 'SC_deploy' });
		assert.equal(decodeGitHubCheckRunId('a:x'), undefined);

		const { api: none } = serve(() => ({
			p0: {
				pullRequest: gitHubPullRequest(1, {
					commits: { totalCount: 1, nodes: [{ commit: { statusCheckRollup: null } }] },
				}),
			},
		}));
		const [empty] = await none.getPullRequestsBatch(provider, token, [{ owner: 'o', repo: 'a', number: 1 }], {
			checkRuns: true,
		});
		assert.deepStrictEqual(empty.status === 'fulfilled' ? empty.value?.checkRuns : 'rejected', []);
	});

	test('reads later pages through the head commit, one request per page for every pull request, and keeps paging past a lost check', async () => {
		const first = (number: number, name: string, next: string) => ({
			pullRequest: gitHubPullRequest(number, {
				commits: {
					totalCount: 1,
					nodes: [{ commit: { id: `C_${number}`, ...contexts([checkRun(name)], next) } }],
				},
			}),
		});
		const pages: Record<string, { nodes: (GitHubCheckContext | null)[]; next?: string }> = {
			'cursor-1': { nodes: [checkRun('b')], next: 'cursor-2' },
			'cursor-2': { nodes: [checkRun('c')] },
			'cursor-z': { nodes: [checkRun('n'), null], next: 'cursor-more' },
			'cursor-more': { nodes: [checkRun('o')] },
		};
		const aliasOf = (request: Request, cursor: string): string | undefined => {
			const name = Object.entries(request.variables).find(([, value]) => value === cursor)?.[0];
			return name != null ? `c${name.slice(1)}` : undefined;
		};
		const { api, requests } = serve(
			request => {
				if (request.query.startsWith('query getPullRequestsBatch(')) {
					return {
						p0: first(1, 'a', 'cursor-1'),
						p1: first(2, 'x', 'cursor-x'),
						p2: first(3, 'm', 'cursor-z'),
					};
				}

				const data: Record<string, unknown> = {};
				for (const [name, value] of Object.entries(request.variables)) {
					const alias = /^a(\d+)$/.exec(name);
					if (alias == null) continue;

					const page = pages[value as string];
					data[`c${alias[1]}`] = page != null ? contexts(page.nodes, page.next) : null;
				}
				return data;
			},
			request => {
				const errors: unknown[] = [];
				const gone = aliasOf(request, 'cursor-x');
				if (gone != null) {
					errors.push({ type: 'NOT_FOUND', message: 'Gone', path: [gone] });
				}
				const refused = aliasOf(request, 'cursor-z');
				if (refused != null) {
					const path = [refused, 'statusCheckRollup', 'contexts', 'nodes', 1, 'isRequired'];
					errors.push({ type: 'FORBIDDEN', message: 'Refused', path: path });
				}
				return errors.length !== 0 ? errors : undefined;
			},
		);

		const slots = await api.getPullRequestsBatch(
			provider,
			token,
			[
				{ owner: 'o', repo: 'a', number: 1 },
				{ owner: 'o', repo: 'a', number: 2 },
				{ owner: 'o', repo: 'a', number: 3 },
			],
			{ checkRuns: true },
		);

		const [paged, unreadable, lost] = slots.map(slot => (slot.status === 'fulfilled' ? slot.value : undefined));
		assert.deepStrictEqual(
			paged?.checkRuns?.map(run => run.name),
			['a', 'b', 'c'],
		);
		assert.equal(paged?.checkRunsTruncated, undefined);
		assert.deepStrictEqual(
			unreadable?.checkRuns?.map(run => run.name),
			['x'],
		);
		assert.equal(unreadable?.checkRunsTruncated, true);
		assert.deepStrictEqual(
			lost?.checkRuns?.map(run => run.name),
			['m', 'n', 'o'],
		);
		assert.equal(lost?.checkRunsTruncated, true);

		const pageRequests = requests.filter(r => r.query.startsWith('query getCommitCheckContextsPage('));
		assert.equal(pageRequests.length, 2, 'one request per page, every pull request sharing the first');
		assert.deepStrictEqual([pageRequests[0].variables.c0, pageRequests[0].variables.k0], ['C_1', 1]);
		assert.match(pageRequests[0].query, /c0: node\(id: \$c0\)/);
		assert.match(pageRequests[0].query, /contexts\(first: 100, after: \$a0\)/);
		assert.match(pageRequests[0].query, /isRequired\(pullRequestNumber: \$k0\)/);
		for (const { query } of pageRequests) {
			assertEveryVariableUsed(query);
		}
	});

	test('a field error under the check contexts keeps the row, truncated only when it lost a check', async () => {
		const forbidden = (path: (string | number)[]) => ({
			type: 'FORBIDDEN',
			message: 'Resource not accessible by integration',
			path: path,
		});
		const rollup = ['commits', 'nodes', 0, 'commit', 'statusCheckRollup', 'contexts', 'nodes'];
		const withError = {
			totalCount: 1,
			nodes: [
				{
					commit: {
						id: 'C_head',
						...contexts([checkRun('build', { checkSuite: { app: null, workflowRun: null } }), null]),
					},
				},
			],
		};
		const clean = {
			totalCount: 1,
			nodes: [{ commit: { id: 'C_head', ...contexts([checkRun('lint')]) } }],
		};
		const { api } = serve(
			request =>
				request.query.startsWith('query getPullRequestsForBranches(')
					? {
							b0: {
								pullRequests: {
									totalCount: 2,
									nodes: [
										{ ...gitHubPullRequest(3, { commits: clean }), headRepositoryOwner: null },
										{ ...gitHubPullRequest(4, { commits: withError }), headRepositoryOwner: null },
									],
								},
							},
						}
					: {
							p0: { pullRequest: gitHubPullRequest(1, { commits: withError }) },
							p1: { pullRequest: gitHubPullRequest(2, { commits: clean }) },
							p2: { pullRequest: gitHubPullRequest(3, { commits: withError }) },
						},
			request =>
				request.query.startsWith('query getPullRequestsForBranches(')
					? [forbidden(['b0', 'pullRequests', 'nodes', 1, ...rollup, 1, 'checkSuite', 'workflowRun'])]
					: request.query.startsWith('query getPullRequestsEtagFieldsBatch(')
						? [forbidden(['p0', 'pullRequest', ...rollup, 1, 'name'])]
						: [
								forbidden(['p0', 'pullRequest', ...rollup, 0, 'checkSuite', 'workflowRun']),
								forbidden(['p0', 'pullRequest', ...rollup, 1, 'isRequired']),
								forbidden(['p1', 'pullRequest', 'reviewRequests']),
								forbidden(['p2', 'pullRequest', ...rollup, 0, 'checkSuite', 'workflowRun']),
							],
		);
		const coordinates = [
			{ owner: 'o', repo: 'a', number: 1 },
			{ owner: 'o', repo: 'a', number: 2 },
		];

		const [partial, refused] = await api.getPullRequestsBatch(provider, token, coordinates, { checkRuns: true });
		assert.ok(partial.status === 'fulfilled');
		assert.deepStrictEqual(
			partial.value?.checkRuns?.map(run => run.name),
			['build'],
		);
		assert.equal(partial.value?.checkRunsTruncated, true, 'its null check was lost');
		assert.equal(refused.status, 'rejected', 'an error outside the check contexts still rejects its slot');

		const [, , detailOnly] = await api.getPullRequestsBatch(
			provider,
			token,
			[...coordinates, { owner: 'o', repo: 'a', number: 3 }],
			{ checkRuns: true },
		);
		assert.ok(detailOnly.status === 'fulfilled');
		assert.deepStrictEqual(
			detailOnly.value?.checkRuns?.map(run => [run.name, run.workflowName]),
			[['build', undefined]],
		);
		assert.equal(detailOnly.value?.checkRunsTruncated, undefined, 'a refused workflow loses no check');

		const without = await api.getPullRequestsBatch(provider, token, coordinates);
		assert.deepStrictEqual(
			without.map(slot => slot.status),
			['rejected', 'rejected'],
		);

		const [cheap] = await api.getPullRequestsEtagFieldsBatch(provider, token, coordinates.slice(0, 1), {
			checkRuns: true,
		});
		assert.ok(cheap.status === 'fulfilled');
		assert.equal(cheap.value?.checkRuns?.truncated, true, 'the cheap check classifies its errors alike');

		const [branch] = await api.getPullRequestsForBranches(
			provider,
			token,
			[{ owner: 'o', repo: 'a', branch: 'feature', headOwners: [undefined] }],
			{ limit: 10, checkRuns: true },
		);
		assert.ok(branch.status === 'fulfilled');
		assert.deepStrictEqual(
			branch.value.pullRequests[0].map(pr => [pr.number, pr.checkRunsTruncated]),
			[
				[3, undefined],
				[4, true],
			],
		);
	});

	test('an error on the check contexts connection rejects its slot, since it nulls the rollup it belongs to', async () => {
		const rollupPath = ['commits', 'nodes', 0, 'commit', 'statusCheckRollup', 'contexts'];
		const { api } = serve(
			() => ({
				p0: {
					pullRequest: gitHubPullRequest(1, {
						commits: { totalCount: 1, nodes: [{ commit: { id: 'C_head', statusCheckRollup: null } }] },
					}),
				},
			}),
			() => [{ type: 'SERVICE_UNAVAILABLE', message: 'Timeout', path: ['p0', 'pullRequest', ...rollupPath] }],
		);

		const [row] = await api.getPullRequestsBatch(provider, token, [{ owner: 'o', repo: 'a', number: 1 }], {
			checkRuns: true,
		});
		assert.equal(row.status, 'rejected', 'a row kept here would read its rollup as no checks');
	});
});
