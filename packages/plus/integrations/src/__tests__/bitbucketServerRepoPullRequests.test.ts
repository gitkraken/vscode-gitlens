import * as assert from 'node:assert/strict';
import { suite, teardown, test } from 'mocha';
import { toCloudIntegrationType } from '../authentication/models.js';
import { GitSelfManagedHostIntegrationId } from '../constants.js';
import { createIntegrationManager } from '../index.js';
import type { IntegrationManager } from '../manager.js';
import type { ProviderRepoInput } from '../providers/models.js';
import { createFakeRuntime } from './fakeRuntime.js';

const providerId = GitSelfManagedHostIntegrationId.BitbucketServer;
const baseUrl = 'https://one.test:8443/bitbucket';
const token = 'synthetic-token';
const pageCap = 50;

function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
	return new Response(JSON.stringify(body), {
		status: status,
		headers: { 'content-type': 'application/json', ...headers },
	});
}

const author = {
	id: 2,
	name: 'someone',
	slug: 'someone',
	displayName: 'someone',
	emailAddress: 'someone@example.test',
	links: { self: [{ href: `${baseUrl}/users/someone` }] },
};

function toPullRequest(id: number, repoNumber: number, index: number) {
	const slug = `repo-${repoNumber}`;
	const repository = {
		id: repoNumber,
		slug: slug,
		name: slug,
		project: { key: 'PRJ' },
		archived: false,
		links: {
			self: [{ href: `${baseUrl}/projects/PRJ/repos/${slug}/browse` }],
			clone: [{ name: 'http', href: `${baseUrl}/scm/PRJ/${slug}.git` }],
		},
	};
	const ref = { id: 'refs/heads/topic', displayId: 'topic', latestCommit: 'abc123', repository: repository };
	return {
		id: id,
		version: 0,
		title: `Pull request ${id}`,
		description: '',
		state: 'OPEN',
		createdDate: 1_000,
		// Newest first, the order the SDK pages by.
		updatedDate: 10_000_000 - index * 1_000,
		closedDate: null,
		fromRef: ref,
		toRef: ref,
		author: { user: author, role: 'AUTHOR', status: 'UNAPPROVED', approved: false },
		reviewers: [],
		participants: [],
		properties: { commentCount: 0 },
		links: { self: [{ href: `${baseUrl}/projects/PRJ/repos/${slug}/pull-requests/${id}` }] },
	};
}

function repos(...ids: number[]): ProviderRepoInput[] {
	return ids.map(id => ({ namespace: 'PRJ', name: `repo-${id}` }));
}

suite('Bitbucket Data Center repository-scoped pull request reads', () => {
	const managers: IntegrationManager[] = [];
	teardown(() => {
		for (const manager of managers.splice(0)) {
			manager.dispose();
		}
	});

	/**
	 * `counts` is how many open pull requests each repository number holds; a repository with `'fail'` answers 500.
	 * Ids are unique across repositories (`repo * 1000 + n`). With `delay`, each pull request read is held that long, and
	 * `gauge.peak` records the most of them in flight at once.
	 */
	async function createServer(counts: Record<number, number | 'fail'>, options?: { delay?: number }) {
		const runtime = createFakeRuntime();
		const requests: URL[] = [];
		const gauge = { inFlight: 0, peak: 0 };
		runtime.account.getAccount = async () => ({ id: 'me' });
		runtime.account.fetchGkApi = async path =>
			path === 'v1/provider-tokens'
				? json({
						data: [
							{
								tokenId: 'account-a',
								provider: toCloudIntegrationType[providerId],
								type: 'pat',
								domain: baseUrl,
							},
						],
					})
				: json({
						data: {
							tokenId: 'account-a',
							accessToken: token,
							expiresIn: 3600,
							scopes: '',
							type: 'pat',
							domain: baseUrl,
						},
					});
		runtime.http.fetch = async input => {
			const url = new URL(input);
			if (url.pathname.endsWith('/users')) {
				return json({ values: [{ ...author, name: 'me', slug: 'me', id: 1 }] }, 200, {
					'x-auserid': '1',
					'x-ausername': 'me',
				});
			}

			requests.push(url);
			const match = /\/projects\/PRJ\/repos\/repo-(\d+)\/pull-requests$/.exec(url.pathname);
			assert.ok(match, `unexpected request ${url.pathname}`);
			const repoNumber = Number(match[1]);
			const count = counts[repoNumber];
			if (options?.delay != null) {
				gauge.inFlight++;
				gauge.peak = Math.max(gauge.peak, gauge.inFlight);
				await new Promise(resolve => setTimeout(resolve, options.delay));
				gauge.inFlight--;
			}
			if (count === 'fail') return json({ errors: [{ message: 'boom' }] }, 500);

			const start = Number(url.searchParams.get('start') ?? 0);
			const limit = Math.min(Number(url.searchParams.get('limit') ?? 25), pageCap);
			const end = Math.min(start + limit, count ?? 0);
			const values = [];
			for (let n = start; n < end; n++) {
				values.push(toPullRequest(repoNumber * 1000 + n, repoNumber, n));
			}
			const isLastPage = end >= (count ?? 0);
			return json({
				values: values,
				size: values.length,
				start: start,
				limit: limit,
				isLastPage: isLastPage,
				...(isLastPage ? {} : { nextPageStart: end }),
			});
		};
		const manager = createIntegrationManager({ ...runtime, cache: undefined });
		managers.push(manager);
		await manager.refreshConnections();
		return { manager: manager, requests: requests, gauge: gauge };
	}

	const ids = (items: { id: string }[]) => items.map(pr => Number(pr.id)).sort((a, b) => a - b);
	const range = (repo: number, from: number, to: number) =>
		Array.from({ length: to - from }, (_, i) => repo * 1000 + from + i);
	const starts = (requests: URL[], repo: number) =>
		requests
			.filter(u => u.pathname.endsWith(`/repo-${repo}/pull-requests`))
			.map(u => Number(u.searchParams.get('start') ?? 0));

	test('reads the requested page of each repository instead of the first', async () => {
		const { manager, requests } = await createServer({ 1: 120, 2: 120 });

		const result = await manager.listPullRequestsPage({
			providerId: providerId,
			connectionId: 'account-a',
			repos: repos(1, 2),
			page: 2,
			itemsPerPage: pageCap,
		});

		assert.equal(result.fetchFailed, undefined, result.warnings[0]?.message);
		for (const repo of [1, 2]) {
			const offsets = starts(requests, repo);
			assert.ok(
				offsets.length > 0 && !offsets.includes(0),
				`repo ${repo} never re-reads page 1: ${offsets.join()}`,
			);
			assert.deepEqual(
				ids(result.items).filter(id => Math.floor(id / 1000) === repo),
				range(repo, pageCap, pageCap * 2),
			);
		}
		assert.equal(result.items.length, pageCap * 2);
		assert.equal(result.page.currentPage, 2);
	});

	test('reports more pages for a repository past one page and follows the cursor', async () => {
		const { manager, requests } = await createServer({ 1: 120 });
		const read = { providerId: providerId, connectionId: 'account-a', repos: repos(1), itemsPerPage: pageCap };

		const first = await manager.listPullRequestsPage(read);
		assert.equal(first.items.length, pageCap);
		assert.equal(first.hasMore, true);
		assert.ok(first.cursor != null);
		assert.notEqual(first.page.truncated, true);
		assert.deepEqual(first.warnings, []);

		const second = await manager.listPullRequestsPage({ ...read, cursor: first.cursor, page: 2 });
		assert.equal(second.items.length, pageCap);
		assert.equal(second.hasMore, true);
		assert.ok(
			!starts(requests, 1).slice(1).includes(0),
			`the cursor never re-reads page 1: ${starts(requests, 1).join()}`,
		);
		assert.deepEqual(ids(first.items), range(1, 0, pageCap));
		assert.deepEqual(ids(second.items), range(1, pageCap, pageCap * 2));

		const third = await manager.listPullRequestsPage({ ...read, cursor: second.cursor, page: 3 });
		assert.equal(third.items.length, 20);
		assert.equal(third.hasMore, false);
		assert.deepEqual(ids(third.items), range(1, pageCap * 2, 120));
	});

	test('sweeps a repository with several pages into every row', async () => {
		const { manager } = await createServer({ 1: 120 });

		const result = await manager.sweepPullRequests({
			providerIds: [providerId],
			connectionId: 'account-a',
			repos: repos(1),
		});

		assert.equal(result.items.length, 120);
		assert.equal(new Set(result.items.map(pr => pr.id)).size, 120);
		assert.equal(result.page.allPages, true);
		assert.notEqual(result.page.truncated, true);
		assert.equal(result.hasMore, false);
		assert.deepEqual(result.warnings, []);
	});

	test('shares the bound across the states each repository reads at once', async () => {
		const repoNumbers = Array.from({ length: 12 }, (_, i) => i + 1);
		const { manager, gauge } = await createServer(Object.fromEntries(repoNumbers.map(n => [n, 1])), {
			delay: 5,
		});

		const result = await manager.listPullRequestsPage({
			providerId: providerId,
			connectionId: 'account-a',
			repos: repos(...repoNumbers),
			// Two states, so each repository sends two requests at once: three repositories fill the default bound.
			states: ['closed', 'merged'],
			itemsPerPage: pageCap,
		});

		assert.equal(result.fetchFailed, undefined, result.warnings[0]?.message);
		assert.ok(gauge.peak <= 6, `peak ${gauge.peak} requests in flight`);
	});

	test('keeps the rows of repositories that answered when another fails', async () => {
		const { manager } = await createServer({ 1: 3, 2: 'fail', 3: 2 });

		const result = await manager.listPullRequestsPage({
			providerId: providerId,
			connectionId: 'account-a',
			repos: repos(1, 2, 3),
			itemsPerPage: pageCap,
		});

		assert.equal(result.items.length, 5);
		assert.equal(result.fetchFailed, true);
		assert.ok(result.warnings.length > 0);
		assert.match(JSON.stringify(result.warnings), /repo-2/);
	});
});
