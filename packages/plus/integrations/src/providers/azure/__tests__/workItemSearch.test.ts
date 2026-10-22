import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import type { ProviderApiConfig } from '../../apiConfig.js';
import { AzureDevOpsApi } from '../azure.js';
import { azureProject, azureProvider, azureRestDiscoveryResponse, azureToken, createWorkItem } from './fixtures.js';

function createSearch(options?: { projectNames?: string[]; types?: string[]; beforeMetadata?: () => Promise<void> }) {
	const requests: string[] = [];
	const queries: string[] = [];
	let extraState = false;
	let state = 'Active';
	let category: 'InProgress' | 'Resolved' = 'InProgress';
	let failMetadata = false;
	const signals: (AbortSignal | null | undefined)[] = [];
	const config: ProviderApiConfig = {
		fetch: async (input, init) => {
			const discovery = azureRestDiscoveryResponse(input);
			if (discovery != null) return discovery;

			const url = input.toString();
			requests.push(url);
			if (url.includes('/workItemTypes')) {
				signals.push(init?.signal);
				if (failMetadata) return Response.json({}, { status: 503 });

				await options?.beforeMetadata?.();
				if (url.includes('/states?')) {
					return Response.json({
						value: [
							{ name: 'Active', category: category },
							...(extraState ? [{ name: 'New', category: 'Proposed' }] : []),
						],
					});
				}

				return Response.json({ value: (options?.types ?? ['Task']).map(name => ({ name: name })) });
			}

			if (url.includes('/wiql?')) {
				const query = (JSON.parse(init?.body as string) as { query: string }).query;
				queries.push(query);
				assert.ok(query.length <= 32000, `WIQL length ${query.length} exceeds Azure's limit`);
				return Response.json({ workItems: [5, 4, 3, 2, 1].map(id => ({ id: id })) });
			}

			if (url.includes('/workitemsbatch?')) {
				const ids = (JSON.parse(init?.body as string) as { ids: number[] }).ids;
				return Response.json({
					value: ids.map(id => {
						const item = createWorkItem();
						item.id = id;
						item.fields['System.WorkItemType'] = options?.types?.[0] ?? 'Task';
						item.fields['System.TeamProject'] = options?.projectNames?.[0] ?? azureProject.name;
						item.fields['System.State'] = state;
						return item;
					}),
				});
			}

			throw new Error(`Unexpected request: ${url}`);
		},
		wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
	};
	const api = new AzureDevOpsApi(config);
	const searchOptions = {
		baseUrl: 'https://azure.example.com/tfs',
		projectNames: options?.projectNames ?? [azureProject.name],
		resolveProject: (name: string) => ({ ...azureProject, name: name }),
		pageSize: 1,
	};
	return {
		api: api,
		requests: requests,
		queries: queries,
		signals: signals,
		failMetadata: (fail = true) => {
			failMetadata = fail;
		},
		options: searchOptions,
		addState: () => {
			extraState = true;
		},
		setState: (name: string) => {
			state = name;
		},
		resolveState: () => {
			category = 'Resolved';
		},
	};
}

suite('Azure work item search lifecycle', () => {
	test('executes a heterogeneous partitioned search and count at the same server instant and global order', async () => {
		const projects = Array.from({ length: 40 }, (_, i) => `Project ${i}`);
		const types = Array.from({ length: 7 }, (_, i) => `Type ${i}`);
		const records = projects.flatMap((project, p) =>
			types.map((type, t) => ({
				id: p * types.length + t + 1,
				project: project,
				type: type,
				state: `Active ${p}/${t} ${'x'.repeat(150)}`,
			})),
		);
		const serverOrder = [...records].reverse();
		const asOf = '2026-10-22T11:00:00.123Z';
		const queries: string[] = [];
		const api = new AzureDevOpsApi({
			fetch: async (input, init) => {
				const discovery = azureRestDiscoveryResponse(input);
				if (discovery != null) return discovery;

				const url = new URL(input.toString());
				const path = decodeURIComponent(url.pathname);
				if (path.endsWith('/workItemTypes')) {
					return Response.json({ value: types.map(name => ({ name: name })) });
				}

				if (path.endsWith('/states')) {
					const record = records.find(
						r => path.includes(`/${r.project}/`) && path.endsWith(`/workItemTypes/${r.type}/states`),
					)!;
					return Response.json({ value: [{ name: record.state, category: 'InProgress' }] });
				}

				if (path.endsWith('/wiql')) {
					const query = (JSON.parse(init?.body as string) as { query: string }).query;
					queries.push(query);
					assert.ok(query.length <= 32000);
					const ranking = /\[System.Id\] IN \(([^)]+)\)/.exec(query);
					const ids = ranking == null ? undefined : new Set(ranking[1].split(', ').map(Number));
					const selected = serverOrder.filter(r =>
						ids != null ? ids.has(r.id) : query.includes(`'${r.state}'`),
					);
					return Response.json({ asOf: asOf, workItems: selected.map(r => ({ id: r.id })) });
				}

				if (path.endsWith('/workitemsbatch')) {
					const ids = (JSON.parse(init?.body as string) as { ids: number[] }).ids;
					return Response.json({
						value: ids.map(id => {
							const record = records[id - 1];
							const item = createWorkItem();
							item.id = id;
							item.fields['System.TeamProject'] = record.project;
							item.fields['System.WorkItemType'] = record.type;
							item.fields['System.State'] = record.state;
							return item;
						}),
					});
				}

				throw new Error(`Unexpected request: ${url.toString()}`);
			},
			wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
		});
		const options = {
			baseUrl: 'https://azure.example.com/tfs',
			projectNames: projects,
			resolveProject: (name: string) => ({ ...azureProject, name: name }),
			pageSize: 200,
		};
		try {
			const first = await api.searchWorkItemsPage(azureProvider, azureToken, 'Collection', options);
			const firstQueries = queries.length;
			assert.ok(queries.filter(q => !q.includes('[System.Id] IN')).length > 1);
			assert.deepEqual(
				first.values.map(i => i.id),
				serverOrder.slice(0, 200).map(r => String(r.id)),
			);
			assert.ok(first.values.every(i => i.state === 'opened'));
			assert.ok(queries.slice(1).every(q => q.endsWith(` ASOF '${asOf}'`)));
			const second = await api.searchWorkItemsPage(azureProvider, azureToken, 'Collection', {
				...options,
				cursor: first.cursor,
			});
			assert.deepEqual(
				second.values.map(i => i.id),
				serverOrder.slice(200).map(r => String(r.id)),
			);
			assert.equal(queries.length, firstQueries);
			assert.equal(await api.countWorkItems(azureProvider, azureToken, 'Collection', options), records.length);
			assert.equal(first.totalCount, records.length);
			assert.ok(queries.slice(firstQueries + 1).every(q => q.endsWith(` ASOF '${asOf}'`)));
		} finally {
			api.dispose();
		}
	});

	test('continues its live snapshot after workflow metadata expires and changes', async () => {
		const originalNow = Date.now;
		let now = originalNow();
		Date.now = () => now;
		const search = createSearch();
		const page = (cursor?: string) =>
			search.api.searchWorkItemsPage(azureProvider, azureToken, 'Collection', {
				...search.options,
				cursor: cursor,
			});
		try {
			const first = await page();
			now += 4 * 60 * 1000;
			const second = await page(first.cursor);
			search.addState();
			now += 2 * 60 * 1000;
			const third = await page(second.cursor);
			assert.equal(third.page, 3);
			assert.deepEqual(
				third.values.map(i => i.id),
				['3'],
			);
			search.failMetadata();
			const fourth = await page(third.cursor);
			assert.deepEqual(
				fourth.values.map(i => i.id),
				['2'],
			);
			assert.equal(third.totalCount, 5);
			assert.equal(search.queries.length, 1);
			assert.equal(search.requests.filter(url => url.includes('/workItemTypes')).length, 3);
		} finally {
			Date.now = originalNow;
			search.api.dispose();
		}
	});

	test('classifies current details after the workflow category changes without retargeting the snapshot', async () => {
		const originalNow = Date.now;
		let now = originalNow();
		Date.now = () => now;
		const search = createSearch();
		const page = (cursor?: string) =>
			search.api.searchWorkItemsPage(azureProvider, azureToken, 'Collection', {
				...search.options,
				cursor: cursor,
			});
		try {
			const first = await page();
			now += 4 * 60 * 1000;
			const second = await page(first.cursor);
			search.resolveState();
			now += 2 * 60 * 1000;
			assert.equal(
				await search.api.getWorkItemStateCategory(
					'Task',
					'Active',
					azureProvider,
					azureToken,
					'Collection',
					azureProject.name,
					search.options,
				),
				'Resolved',
			);
			const third = await page(second.cursor);
			assert.equal(third.values[0].id, '3');
			assert.equal(third.values[0].state, 'closed');
			assert.equal(third.values[0].providerState?.category, 'DONE');
			assert.equal(search.queries.length, 1);
		} finally {
			Date.now = originalNow;
			search.api.dispose();
		}
	});

	test('classifies a later row that moves to a newly added workflow state', async () => {
		const originalNow = Date.now;
		let now = originalNow();
		Date.now = () => now;
		const search = createSearch();
		try {
			const first = await search.api.searchWorkItemsPage(azureProvider, azureToken, 'Collection', search.options);
			now += 4 * 60 * 1000;
			const second = await search.api.searchWorkItemsPage(azureProvider, azureToken, 'Collection', {
				...search.options,
				cursor: first.cursor,
			});
			search.addState();
			search.setState('New');
			now += 2 * 60 * 1000;
			const third = await search.api.searchWorkItemsPage(azureProvider, azureToken, 'Collection', {
				...search.options,
				cursor: second.cursor,
			});
			assert.equal(third.values[0].id, '3');
			assert.equal(third.values[0].providerState?.name, 'New');
			assert.equal(third.values[0].providerState?.category, 'TO_DO');
			assert.equal(third.values[0].state, 'opened');
			assert.equal(search.queries.length, 1);
		} finally {
			Date.now = originalNow;
			search.api.dispose();
		}
	});

	test('retries the same cursor after current workflow metadata fails without rerunning the search', async () => {
		const originalNow = Date.now;
		let now = originalNow();
		Date.now = () => now;
		const search = createSearch();
		const page = (cursor?: string) =>
			search.api.searchWorkItemsPage(azureProvider, azureToken, 'Collection', {
				...search.options,
				cursor: cursor,
			});
		try {
			const first = await page();
			now += 4 * 60 * 1000;
			const second = await page(first.cursor);
			search.failMetadata();
			now += 2 * 60 * 1000;
			await assert.rejects(page(second.cursor));
			search.failMetadata(false);
			now += 31 * 1000;
			const third = await page(second.cursor);
			assert.equal(third.values[0].id, '3');
			assert.equal(third.values[0].state, 'opened');
			assert.equal(search.queries.length, 1);
		} finally {
			Date.now = originalNow;
			search.api.dispose();
		}
	});

	test('hydrates current categories when Azure returns a differently cased project name', async () => {
		const search = createSearch({ projectNames: [azureProject.name.toUpperCase()] });
		try {
			const page = await search.api.searchWorkItemsPage(azureProvider, azureToken, 'Collection', search.options);
			assert.equal(page.values[0].state, 'opened');
		} finally {
			search.api.dispose();
		}
	});

	test('keeps a collection snapshot when another discovery expands its workflow projects', async () => {
		const search = createSearch();
		const options = { ...search.options, projectNames: undefined, workflowProjectNames: [azureProject.name] };
		try {
			const first = await search.api.searchWorkItemsPage(azureProvider, azureToken, 'Collection', options);
			const requests = search.requests.length;
			search.failMetadata();
			const second = await search.api.searchWorkItemsPage(azureProvider, azureToken, 'Collection', {
				...options,
				workflowProjectNames: [...options.workflowProjectNames, 'New project'],
				cursor: first.cursor,
			});
			assert.equal(second.page, 2);
			assert.equal(second.values[0].state, 'opened');
			assert.equal(search.queries.length, 1);
			assert.equal(search.requests.length, requests + 1);
		} finally {
			search.api.dispose();
		}
	});

	test('bounds the WIQL sent by both search and count across many project workflows', async () => {
		const search = createSearch({
			projectNames: Array.from({ length: 40 }, (_, i) => `Project ${i}`),
			types: Array.from({ length: 7 }, (_, i) => `Work item type ${i}`),
		});
		try {
			const page = await search.api.searchWorkItemsPage(azureProvider, azureToken, 'Collection', search.options);
			const count = await search.api.countWorkItems(azureProvider, azureToken, 'Collection', search.options);
			assert.equal(page.totalCount, 5);
			assert.equal(count, page.totalCount);
		} finally {
			search.api.dispose();
		}
	});

	test('does no metadata work for an already canceled search or count', async () => {
		const search = createSearch();
		const controller = new AbortController();
		controller.abort();
		try {
			await assert.rejects(
				search.api.searchWorkItemsPage(
					azureProvider,
					azureToken,
					'Collection',
					search.options,
					controller.signal,
				),
				isCancellationError,
			);
			await assert.rejects(
				search.api.countWorkItems(azureProvider, azureToken, 'Collection', search.options, controller.signal),
				isCancellationError,
			);
			assert.equal(search.requests.length, 0);
		} finally {
			search.api.dispose();
		}
	});

	test('refuses expired and foreign snapshots before attempting unavailable metadata', async () => {
		const originalNow = Date.now;
		let now = originalNow();
		Date.now = () => now;
		const search = createSearch();
		try {
			const first = await search.api.searchWorkItemsPage(azureProvider, azureToken, 'Collection', search.options);
			const requests = search.requests.length;
			search.failMetadata();
			for (const criteria of [
				{ state: 'closed' },
				{ text: 'another search' },
				{ sort: 'created:asc' },
			] as const) {
				await assert.rejects(
					search.api.searchWorkItemsPage(azureProvider, azureToken, 'Collection', {
						...search.options,
						criteria: criteria,
						cursor: first.cursor,
					}),
					/different query/,
				);
			}
			await assert.rejects(
				search.api.searchWorkItemsPage(
					azureProvider,
					{ ...azureToken, accessToken: 'another credential' },
					'Collection',
					{ ...search.options, cursor: first.cursor },
				),
				/expired/,
			);
			await assert.rejects(
				search.api.searchWorkItemsPage(azureProvider, azureToken, 'Collection', {
					...search.options,
					baseUrl: 'https://another.example.com',
					cursor: first.cursor,
				}),
				/expired/,
			);
			now += 6 * 60 * 1000;
			await assert.rejects(
				search.api.searchWorkItemsPage(azureProvider, azureToken, 'Collection', {
					...search.options,
					cursor: first.cursor,
				}),
				/expired/,
			);
			assert.equal(search.requests.length, requests);
		} finally {
			Date.now = originalNow;
			search.api.dispose();
		}
	});

	test('cancels category hydration without canceling a noncancelable lookup sharing its metadata', async () => {
		let release!: () => void;
		let started!: () => void;
		const pending = new Promise<void>(resolve => {
			release = resolve;
		});
		const entered = new Promise<void>(resolve => {
			started = resolve;
		});
		const search = createSearch({
			beforeMetadata: () => {
				started();
				return pending;
			},
		});
		const controller = new AbortController();
		const page = search.api.searchWorkItemsPage(
			azureProvider,
			azureToken,
			'Collection',
			{ ...search.options, criteria: { state: 'all' } },
			controller.signal,
		);
		await entered;
		const lookup = search.api.getWorkItemStateCategory(
			'Task',
			'Active',
			azureProvider,
			azureToken,
			'Collection',
			azureProject.name,
			search.options,
		);
		controller.abort();
		try {
			await assert.rejects(page, isCancellationError);
			assert.equal(search.signals.length, 1);
			assert.equal(search.signals[0]?.aborted, false);
		} finally {
			release();
			await Promise.allSettled([page, lookup]);
			search.api.dispose();
		}
		assert.equal(await lookup, 'InProgress');
	});

	test('honors cancellation from a metadata peer before publishing the completed page', async () => {
		let release!: () => void;
		let started!: () => void;
		let joined!: () => void;
		const pending = new Promise<void>(resolve => {
			release = resolve;
		});
		const entered = new Promise<void>(resolve => {
			started = resolve;
		});
		const pageJoined = new Promise<void>(resolve => {
			joined = resolve;
		});
		const search = createSearch({
			beforeMetadata: () => {
				started();
				return pending;
			},
		});
		const controller = new AbortController();
		const getCategory = search.api.getWorkItemStateCategory.bind(search.api);
		search.api.getWorkItemStateCategory = (...args) => {
			const result = getCategory(...args);
			if (args[7] === controller.signal) {
				joined();
			}
			return result;
		};
		const peer = getCategory(
			'Task',
			'Active',
			azureProvider,
			azureToken,
			'Collection',
			azureProject.name,
			search.options,
		).then(category => {
			controller.abort();
			return category;
		});
		await entered;
		const page = search.api.searchWorkItemsPage(
			azureProvider,
			azureToken,
			'Collection',
			{ ...search.options, criteria: { state: 'all' } },
			controller.signal,
		);
		try {
			await pageJoined;
			release();
			assert.equal(await peer, 'InProgress');
			await assert.rejects(page, isCancellationError);
			assert.equal(search.signals.length, 1);
		} finally {
			release();
			await Promise.allSettled([page, peer]);
			search.api.dispose();
		}
	});

	test('cancels a stalled metadata waiter promptly while another caller can finish', async () => {
		let release!: () => void;
		const stalled = new Promise<void>(resolve => {
			release = resolve;
		});
		const search = createSearch({ beforeMetadata: () => stalled });
		const controller = new AbortController();
		const canceled = search.api.countWorkItems(
			azureProvider,
			azureToken,
			'Collection',
			search.options,
			controller.signal,
		);
		const survivor = search.api.countWorkItems(azureProvider, azureToken, 'Collection', search.options);
		let outcome = 'pending';
		void canceled.then(
			() => {
				outcome = 'fulfilled';
			},
			(error: unknown) => {
				outcome = isCancellationError(error) ? 'canceled' : 'failed';
			},
		);
		controller.abort();
		try {
			await new Promise(resolve => setImmediate(resolve));
			assert.equal(outcome, 'canceled');
			assert.equal(search.signals.length, 1);
			assert.ok(search.signals.every(signal => signal != null && !signal.aborted));
		} finally {
			release();
			await Promise.allSettled([canceled, survivor]);
			search.api.dispose();
		}
		assert.equal(await survivor, 5);
	});
});
