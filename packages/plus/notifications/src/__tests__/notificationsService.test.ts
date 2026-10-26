import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { NotificationsContext } from '../context.js';
import { NotificationsApiError } from '../errors.js';
import type { GkNotification, NotificationSettings } from '../models.js';
import { NotificationsService } from '../notificationsService.js';

/** `query` is present only when the request carried one */
type Call = { path: string; query?: string; method: string; body: unknown };
type Handler = (call: Call) => Response | Promise<Response>;

const day = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-10-20T00:00:00Z');

function ok(data: unknown): Response {
	return new Response(JSON.stringify({ data: data }), { status: 200 });
}

function fail(status: number = 500): Response {
	return new Response('', { status: status, statusText: 'Boom' });
}

function rawNotification(id: string, ageDays: number, overrides?: Record<string, unknown>): Record<string, unknown> {
	const createdAt = new Date(now - ageDays * day).toISOString();
	return {
		notificationId: id,
		name: `Notification ${id}`,
		notificationType: 'user',
		contentType: 'system',
		event: 'general',
		readAt: null,
		createdAt: createdAt,
		updatedAt: createdAt,
		fallback: '',
		payload: { markdown: `Body ${id}` },
		...overrides,
	};
}

function page(results: unknown[], hasMore: boolean, pageNumber: number = 1): Response {
	return ok({ results: results, hasMore: hasMore, page: pageNumber, pageSize: 50 });
}

function createService(handler: Handler): { service: NotificationsService; calls: Call[]; changes: () => number } {
	const calls: Call[] = [];
	const context: NotificationsContext = {
		productType: 'gitlens',
		now: () => now,
		fetchGkApi: async (path, init, query) => {
			const call: Call = {
				path: path,
				...(query != null ? { query: query.toString() } : {}),
				method: init?.method ?? 'GET',
				body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
			};
			calls.push(call);
			return handler(call);
		},
	};

	const service = new NotificationsService(context);
	let changeCount = 0;
	service.onDidChange(() => changeCount++);
	return { service: service, calls: calls, changes: () => changeCount };
}

function ids(items: readonly GkNotification[]): string[] {
	return items.map(n => n.id);
}

function pageOf(query: string | undefined): number {
	return Number(new URLSearchParams(query).get('page'));
}

suite('NotificationsService', () => {
	suite('refresh', () => {
		test('loads the first page for the product, newest first, and counts unread', async () => {
			const { service, calls } = createService(() =>
				page(
					[
						rawNotification('old', 3),
						rawNotification('new', 1),
						rawNotification('read', 2, { readAt: new Date(now).toISOString() }),
					],
					false,
				),
			);

			await service.refresh();

			assert.strictEqual(calls[0].path, 'v1/notifications');
			assert.strictEqual(calls[0].query, 'productType=gitlens&page=1&pageSize=50');
			assert.strictEqual(calls[0].method, 'GET');
			const state = service.getState();
			assert.deepStrictEqual(ids(state.items), ['new', 'read', 'old']);
			assert.strictEqual(state.status, 'ready');
			assert.strictEqual(state.hasMore, false);
			assert.strictEqual(state.lastSyncedAt, now);
			assert.strictEqual(state.unreadCount, 2);
		});

		test('drops invalid notifications', async () => {
			const { service } = createService(() =>
				page([rawNotification('good', 1), rawNotification('bad', 1, { payload: {} }), 'garbage'], false),
			);

			await service.refresh();

			assert.deepStrictEqual(ids(service.getState().items), ['good']);
		});

		test('prunes expired notifications', async () => {
			const { service } = createService(() =>
				page(
					[
						rawNotification('expired', 2, { expiresAt: new Date(now - 1).toISOString() }),
						rawNotification('live', 1, { expiresAt: new Date(now + day).toISOString() }),
					],
					false,
				),
			);

			await service.refresh();

			assert.deepStrictEqual(ids(service.getState().items), ['live']);
		});

		test('keeps cached items and reports an error when the request fails', async () => {
			let failing = false;
			const { service } = createService(() => (failing ? fail() : page([rawNotification('a', 1)], false)));
			await service.refresh();

			failing = true;
			await service.refresh();

			const state = service.getState();
			assert.strictEqual(state.status, 'error');
			assert.deepStrictEqual(ids(state.items), ['a']);
			assert.strictEqual(state.lastSyncedAt, now);
		});

		test('shares one request between concurrent calls', async () => {
			const { service, calls } = createService(() => page([rawNotification('a', 1)], false));

			await Promise.all([service.refresh(), service.refresh()]);

			assert.strictEqual(calls.length, 1);
		});

		test('re-fetches every loaded page, so changes elsewhere reach them without collapsing the list', async () => {
			let firstPage = [rawNotification('p1a', 1), rawNotification('p1b', 2)];
			let secondPage = [rawNotification('p2a', 5), rawNotification('p2b', 6)];
			const { service, calls } = createService(({ query }) =>
				pageOf(query) === 1 ? page(firstPage, true) : page(secondPage, false, 2),
			);
			await service.refresh();
			await service.loadMore();
			assert.deepStrictEqual(ids(service.getState().items), ['p1a', 'p1b', 'p2a', 'p2b']);
			assert.strictEqual(service.getState().hasMore, false);

			// Elsewhere: a new notification arrives, `p1a` is deleted, and `p2b` is read
			firstPage = [rawNotification('fresh', 0), rawNotification('p1b', 2)];
			secondPage = [
				rawNotification('p2a', 5),
				rawNotification('p2b', 6, { readAt: new Date(now).toISOString() }),
			];
			const before = calls.length;
			await service.refresh();

			assert.deepStrictEqual(
				calls.slice(before).map(c => pageOf(c.query)),
				[1, 2],
			);
			const state = service.getState();
			assert.deepStrictEqual(ids(state.items), ['fresh', 'p1b', 'p2a', 'p2b']);
			assert.strictEqual(state.items.find(n => n.id === 'p2b')?.readAt, now);
			assert.strictEqual(state.hasMore, false);
			assert.strictEqual(service.toSnapshot().page, 2);
		});

		test('stops after the loaded pages even if the server never advances its page number', async () => {
			const { service, calls } = createService(() => page([rawNotification('a', 1)], true, 1));
			await service.refresh();
			await service.loadMore();

			const before = calls.length;
			await service.refresh();

			assert.deepStrictEqual(
				calls.slice(before).map(c => pageOf(c.query)),
				[1, 2],
			);
		});

		test('re-fetches at most five pages', async () => {
			const { service, calls } = createService(({ query }) =>
				page([rawNotification(`p${pageOf(query)}`, pageOf(query))], true, pageOf(query)),
			);
			await service.refresh();
			for (let i = 0; i < 6; i++) {
				await service.loadMore();
			}

			const before = calls.length;
			await service.refresh();

			assert.deepStrictEqual(
				calls.slice(before).map(c => pageOf(c.query)),
				[1, 2, 3, 4, 5],
			);
			assert.strictEqual(service.toSnapshot().page, 5);
		});

		test('keeps an action made while a refresh was fetching', async () => {
			let release!: () => void;
			const gate = new Promise<void>(resolve => {
				release = resolve;
			});
			let gated = false;
			const { service } = createService(async ({ path, method }) => {
				if (method !== 'GET') return ok(null);

				if (gated) {
					await gate;
				}
				return page([rawNotification('a', 1), rawNotification('b', 2)], false);
			});
			await service.refresh();

			gated = true;
			const refreshing = service.refresh();
			await service.markAllRead();
			await service.delete(['b']);
			release();
			await refreshing;

			const state = service.getState();
			assert.deepStrictEqual(ids(state.items), ['a']);
			assert.strictEqual(state.unreadCount, 0);
		});

		test('loads the next page only after a refresh in flight lands', async () => {
			let release!: () => void;
			const gate = new Promise<void>(resolve => {
				release = resolve;
			});
			let gated = false;
			const { service, calls } = createService(async ({ query }) => {
				if (gated && pageOf(query) === 1) {
					await gate;
				}
				return pageOf(query) === 1
					? page([rawNotification('p1', 1)], true, 1)
					: page([rawNotification('p2', 5)], false, 2);
			});
			await service.refresh();

			gated = true;
			const refreshing = service.refresh();
			const loading = service.loadMore();
			release();
			await Promise.all([refreshing, loading]);

			assert.deepStrictEqual(ids(service.getState().items), ['p1', 'p2']);
			assert.strictEqual(pageOf(calls.at(-1)!.query), 2);
		});

		test('a refresh started during Load More keeps the page it adds', async () => {
			let release!: () => void;
			const gate = new Promise<void>(resolve => {
				release = resolve;
			});
			const { service } = createService(async ({ query }) => {
				if (pageOf(query) === 2) {
					await gate;
					return page([rawNotification('p2', 5)], false, 2);
				}
				return page([rawNotification('p1', 1)], true, 1);
			});
			await service.refresh();

			const loading = service.loadMore();
			const refreshing = service.refresh();
			release();
			await Promise.all([loading, refreshing]);

			assert.deepStrictEqual(ids(service.getState().items), ['p1', 'p2']);
			assert.strictEqual(service.toSnapshot().page, 2);
		});

		test('replaces everything when the first page is the whole list', async () => {
			let results = [rawNotification('a', 1), rawNotification('b', 2)];
			const { service } = createService(() => page(results, false));
			await service.refresh();

			results = [rawNotification('b', 2)];
			await service.refresh();

			assert.deepStrictEqual(ids(service.getState().items), ['b']);
		});
	});

	suite('loadMore', () => {
		test('appends the next page and tracks hasMore', async () => {
			const { service, calls } = createService(({ query }) =>
				pageOf(query) === 1
					? page([rawNotification('a', 1)], true)
					: page([rawNotification('a', 1), rawNotification('b', 4)], false, 2),
			);
			await service.refresh();
			assert.strictEqual(service.getState().hasMore, true);

			await service.loadMore();

			assert.strictEqual(pageOf(calls[1].query), 2);
			assert.deepStrictEqual(ids(service.getState().items), ['a', 'b']);
			assert.strictEqual(service.getState().hasMore, false);

			await service.loadMore();
			assert.strictEqual(calls.length, 2);
		});

		test('throws and leaves the items alone on failure', async () => {
			const { service } = createService(({ query }) =>
				pageOf(query) === 1 ? page([rawNotification('a', 1)], true) : fail(503),
			);
			await service.refresh();

			await assert.rejects(
				service.loadMore(),
				(ex: unknown) => NotificationsApiError.is(ex) && ex.status === 503,
			);
			assert.deepStrictEqual(ids(service.getState().items), ['a']);
			assert.strictEqual(service.getState().hasMore, true);
		});

		test('throws an API error when a successful response is not JSON', async () => {
			const { service } = createService(({ query }) =>
				pageOf(query) === 1
					? page([rawNotification('a', 1)], true)
					: new Response('<html>Bad gateway</html>', { status: 200 }),
			);
			await service.refresh();

			await assert.rejects(
				service.loadMore(),
				(ex: unknown) => NotificationsApiError.is(ex) && ex.status === 200 && ex.operation === 'list',
			);
		});
	});

	suite('actions', () => {
		function setup(actionResponse: () => Response | Promise<Response>): ReturnType<typeof createService> {
			return createService(({ query }) =>
				query != null
					? page(
							[
								rawNotification('unread', 1),
								rawNotification('read', 2, { readAt: new Date(now - day).toISOString() }),
							],
							false,
						)
					: actionResponse(),
			);
		}

		test('markRead applies optimistically and posts the ids', async () => {
			let respond!: (rsp: Response) => void;
			const { service, calls } = setup(() => new Promise<Response>(resolve => (respond = resolve)));
			await service.refresh();

			const done = service.markRead(['unread']);
			assert.strictEqual(service.getState().unreadCount, 0, 'applied before the request completes');
			assert.strictEqual(service.getState().items.find(n => n.id === 'unread')?.readAt, now);

			respond(new Response(null, { status: 200 }));
			await done;

			assert.deepStrictEqual(calls[1], {
				path: 'v1/notifications/read',
				method: 'POST',
				body: { notificationIds: ['unread'] },
			});
			assert.strictEqual(service.getState().unreadCount, 0);
		});

		test('markRead rolls back and rethrows on failure', async () => {
			const { service } = setup(() => fail());
			await service.refresh();

			await assert.rejects(service.markRead(['unread']), NotificationsApiError);

			assert.strictEqual(service.getState().unreadCount, 1);
			assert.strictEqual(service.getState().items.find(n => n.id === 'unread')?.readAt, undefined);
		});

		test('markUnread applies optimistically and rolls back on failure', async () => {
			let failing = false;
			const { service, calls } = setup(() => (failing ? fail() : new Response(null, { status: 200 })));
			await service.refresh();

			await service.markUnread(['read']);
			assert.strictEqual(service.getState().unreadCount, 2);
			assert.deepStrictEqual(calls[1], {
				path: 'v1/notifications/unread',
				method: 'POST',
				body: { notificationIds: ['read'] },
			});

			await service.markRead(['read']);
			failing = true;
			await assert.rejects(service.markUnread(['read']));
			assert.strictEqual(service.getState().items.find(n => n.id === 'read')?.readAt, now);
		});

		test('delete removes optimistically and restores on failure', async () => {
			let failing = false;
			const { service, calls } = setup(() => (failing ? fail() : new Response(null, { status: 204 })));
			await service.refresh();

			await service.delete(['read']);
			assert.deepStrictEqual(ids(service.getState().items), ['unread']);
			assert.deepStrictEqual(calls[1], {
				path: 'v1/notifications',
				method: 'DELETE',
				body: { notificationIds: ['read'] },
			});

			failing = true;
			await assert.rejects(service.delete(['unread']));
			assert.deepStrictEqual(ids(service.getState().items), ['unread']);
		});

		test('delete answered with 404 keeps the item removed and resolves', async () => {
			const { service } = setup(() => fail(404));
			await service.refresh();

			await service.delete(['read']);

			assert.deepStrictEqual(ids(service.getState().items), ['unread']);
		});

		test('markRead answered with 404 removes the item and resolves', async () => {
			const { service } = setup(() => fail(404));
			await service.refresh();

			await service.markRead(['unread']);

			assert.deepStrictEqual(ids(service.getState().items), ['read']);
		});

		test('a 404 delete does not let an in-flight refresh bring the item back', async () => {
			let respondDelete!: (rsp: Response) => void;
			let respondList!: (rsp: Response) => void;
			let listCalls = 0;
			const { service } = createService(({ query }) => {
				if (query != null) {
					// The first list seeds the state; the second is the in-flight refresh
					return ++listCalls === 1
						? page([rawNotification('a', 1), rawNotification('b', 2)], false)
						: new Promise<Response>(resolve => (respondList = resolve));
				}
				return new Promise<Response>(resolve => (respondDelete = resolve));
			});
			await service.refresh();

			const deleting = service.delete(['a']);
			const refreshing = service.refresh();

			respondDelete(fail(404));
			await deleting;
			// Fetched before the deletion elsewhere: still contains the item
			respondList(page([rawNotification('a', 1), rawNotification('b', 2)], false));
			await refreshing;

			assert.deepStrictEqual(ids(service.getState().items), ['b']);
		});

		test('a delete during Load More does not let the page it adds bring the item back', async () => {
			let respondPage2!: (rsp: Response) => void;
			const { service } = createService(({ query }) => {
				if (query == null) return ok(null);

				return pageOf(query) === 1
					? page([rawNotification('a', 1), rawNotification('b', 2)], true, 1)
					: new Promise<Response>(resolve => (respondPage2 = resolve));
			});
			await service.refresh();

			const loading = service.loadMore();
			// Let Load More send its request before the deletion
			await new Promise(resolve => setTimeout(resolve, 0));
			await service.delete(['b']);
			// Fetched before the deletion (the page boundary moved): still contains the item
			respondPage2(page([rawNotification('b', 2), rawNotification('c', 3)], false, 2));
			await loading;

			assert.deepStrictEqual(ids(service.getState().items), ['a', 'c']);
		});

		test('markAllRead and deleteAllRead target only the matching loaded items', async () => {
			const { service, calls } = setup(() => new Response(null, { status: 200 }));
			await service.refresh();

			await service.deleteAllRead();
			assert.deepStrictEqual(calls[1].body, { notificationIds: ['read'] });

			await service.markAllRead();
			assert.deepStrictEqual(calls[2].body, { notificationIds: ['unread'] });
			assert.strictEqual(service.getState().unreadCount, 0);

			// Nothing left to do: no request
			await service.markAllRead();
			assert.strictEqual(calls.length, 3);
		});

		test('a failed action rolls back to the server state even when a refresh landed meanwhile', async () => {
			let rejectAction!: (ex: unknown) => void;
			const { service } = setup(() => new Promise<Response>((_, reject) => (rejectAction = reject)));
			await service.refresh();

			const action = service.markRead(['unread']);
			// The server's truth (still unread) arrives while the action is in flight; the action stays applied
			await service.refresh();
			assert.notStrictEqual(service.getState().items.find(n => n.id === 'unread')?.readAt, undefined);

			rejectAction(new Error('network'));
			await assert.rejects(action);

			assert.strictEqual(service.getState().items.find(n => n.id === 'unread')?.readAt, undefined);
			assert.strictEqual(service.getState().unreadCount, 1);
		});

		test('an action settled before a refresh no longer overrides the server', async () => {
			let serverReadAt: string | null = null;
			const { service } = createService(({ method }) =>
				method === 'GET' ? page([rawNotification('a', 1, { readAt: serverReadAt })], false) : ok(null),
			);
			await service.refresh();
			await service.markRead(['a']);

			// Marked unread again elsewhere
			serverReadAt = null;
			await service.refresh();

			assert.strictEqual(service.getState().unreadCount, 1);
		});
	});

	suite('settings', () => {
		const settings: NotificationSettings = { marketingEnabled: true, helpEnabled: true, securityEnabled: true };

		test('getSettings fetches and caches them', async () => {
			const { service, calls } = createService(() => ok(settings));

			assert.deepStrictEqual(await service.getSettings(), settings);
			assert.strictEqual(calls[0].path, 'v1/notifications/user-settings');
			assert.deepStrictEqual(service.getState().settings, settings);
		});

		test('updateSettings applies optimistically and posts the full shape', async () => {
			const { service, calls } = createService(({ method }) =>
				method === 'GET' ? ok(settings) : new Response(null, { status: 200 }),
			);
			await service.getSettings();

			const result = await service.updateSettings({ marketingEnabled: false });

			const expected = { ...settings, marketingEnabled: false };
			assert.deepStrictEqual(result, expected);
			assert.deepStrictEqual(service.getState().settings, expected);
			assert.deepStrictEqual(calls[1], {
				path: 'v1/notifications/user-settings',
				method: 'POST',
				body: expected,
			});
		});

		test('updateSettings fetches first when nothing is cached', async () => {
			const { service, calls } = createService(({ method }) =>
				method === 'GET' ? ok(settings) : new Response(null, { status: 200 }),
			);

			await service.updateSettings({ helpEnabled: false });

			assert.deepStrictEqual(
				calls.map(c => c.method),
				['GET', 'POST'],
			);
			assert.deepStrictEqual(calls[1].body, { ...settings, helpEnabled: false });
		});

		test('updateSettings rolls back and rethrows on failure', async () => {
			const { service } = createService(({ method }) => (method === 'GET' ? ok(settings) : fail()));
			await service.getSettings();

			await assert.rejects(service.updateSettings({ marketingEnabled: false }));

			assert.deepStrictEqual(service.getState().settings, settings);
		});

		suite('serialization', () => {
			const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

			test('the server ends with the client final state when the first POST is slower', async () => {
				let server = settings;
				let n = 0;
				const { service, calls } = createService(async ({ method, body }) => {
					if (method === 'POST') {
						const sent = body as NotificationSettings;
						await sleep(n++ === 0 ? 50 : 5);
						server = sent;
						return ok(sent);
					}
					return ok(server);
				});
				await service.getSettings();

				await Promise.all([
					service.updateSettings({ marketingEnabled: false }),
					service.updateSettings({ helpEnabled: false }),
				]);

				const expected = { ...settings, marketingEnabled: false, helpEnabled: false };
				assert.deepStrictEqual(service.getState().settings, expected);
				assert.deepStrictEqual(server, expected);
				assert.strictEqual(calls.filter(c => c.method === 'POST').length, 2);
			});

			test('three quick calls make at most two POSTs, the last carrying the final state', async () => {
				const { service, calls } = createService(async ({ method }) => {
					if (method === 'POST') {
						await sleep(10);
						return new Response(null, { status: 200 });
					}
					return ok(settings);
				});
				await service.getSettings();

				const results = await Promise.all([
					service.updateSettings({ marketingEnabled: false }),
					service.updateSettings({ helpEnabled: false }),
					service.updateSettings({ securityEnabled: false }),
				]);

				const posts = calls.filter(c => c.method === 'POST');
				const final = { marketingEnabled: false, helpEnabled: false, securityEnabled: false };
				assert.strictEqual(posts.length, 2);
				assert.deepStrictEqual(posts[1].body, final);
				assert.deepStrictEqual(results[0], { ...settings, marketingEnabled: false });
				assert.deepStrictEqual(results[1], final);
				assert.deepStrictEqual(results[2], final);
			});

			test('a failure with no newer change rolls back to the confirmed settings', async () => {
				const { service } = createService(({ method }) => (method === 'GET' ? ok(settings) : fail()));
				await service.getSettings();

				await assert.rejects(service.updateSettings({ marketingEnabled: false }));
				assert.deepStrictEqual(service.getState().settings, settings);
			});

			test('a failure followed by a queued newer change does not roll back', async () => {
				let n = 0;
				const { service, calls } = createService(async ({ method }) => {
					if (method === 'GET') return ok(settings);

					if (n++ === 0) {
						await sleep(20);
						return fail();
					}
					return new Response(null, { status: 200 });
				});
				await service.getSettings();

				const first = service.updateSettings({ marketingEnabled: false });
				const second = service.updateSettings({ helpEnabled: false });

				await assert.rejects(first);
				const final = { ...settings, marketingEnabled: false, helpEnabled: false };
				assert.deepStrictEqual(await second, final);
				assert.deepStrictEqual(service.getState().settings, final);
				assert.deepStrictEqual(calls.filter(c => c.method === 'POST').at(-1)?.body, final);
			});
		});
	});

	suite('refresh result (newly arrived toastable notices)', () => {
		const hour = 60 * 60 * 1000;
		const minute = 60 * 1000;

		function rawAt(id: string, createdAt: number, overrides?: Record<string, unknown>): Record<string, unknown> {
			const iso = new Date(createdAt).toISOString();
			return rawNotification(id, 0, { createdAt: iso, updatedAt: iso, ...overrides });
		}

		function heldAt(id: string, createdAt: number): GkNotification {
			return {
				id: id,
				event: 'general',
				contentType: 'system',
				headline: id,
				body: 'Body',
				createdAt: createdAt,
			};
		}

		/** Seeds the service as if it had synced before, holding `items` */
		function restoreSynced(service: NotificationsService, items: GkNotification[]): void {
			service.restore({
				items: items,
				hasMore: false,
				page: 1,
				lastSyncedAt: now - hour,
				settings: undefined,
			});
		}

		test('returns unread security and system notices that are new since the previous sync', async () => {
			const { service } = createService(() =>
				page(
					[
						rawAt('system-new', now - hour),
						rawAt('security-new', now - hour, { contentType: 'security' }),
						rawAt('marketing-new', now - hour, { contentType: 'marketing' }),
						rawAt('system-read', now - hour, { readAt: new Date(now).toISOString() }),
						rawAt('system-known', now - hour),
					],
					false,
				),
			);
			restoreSynced(service, [heldAt('system-known', now - hour)]);

			const toastable = await service.refresh();

			assert.deepStrictEqual(ids(toastable).sort(), ['security-new', 'system-new']);
		});

		test('no backfill: the first sync returns nothing, and only later arrivals qualify', async () => {
			let notices = [rawAt('existing', now - hour, { contentType: 'security' })];
			const { service } = createService(() => page(notices, false));

			assert.deepStrictEqual(await service.refresh(), []);
			assert.deepStrictEqual(ids(service.getState().items), ['existing']);

			notices = [rawAt('arrived', now - 30 * minute), ...notices];
			assert.deepStrictEqual(ids(await service.refresh()), ['arrived']);
		});

		test('a failed refresh returns nothing', async () => {
			const { service } = createService(() => fail(503));
			restoreSynced(service, [heldAt('known', now - 2 * day)]);

			assert.deepStrictEqual(await service.refresh(), []);
			assert.strictEqual(service.getState().status, 'error');
		});

		test('a notice that arrived overnight toasts after the cache is restored', async () => {
			const known = heldAt('known', now - 2 * day);
			const { service } = createService(() =>
				page([rawAt('overnight', now - 3 * hour), rawAt('known', known.createdAt)], false),
			);
			service.restore({
				items: [known],
				hasMore: false,
				page: 1,
				lastSyncedAt: now - 12 * hour,
				settings: undefined,
			});

			assert.deepStrictEqual(ids(await service.refresh()), ['overnight']);
		});

		test('an old notice shifting into the first page does not toast', async () => {
			// `older` was beyond the first page (or never loaded) before the sync; a deletion moved it up
			const { service } = createService(() =>
				page([rawAt('recent', now - 2 * day), rawAt('older', now - 10 * day)], false),
			);
			restoreSynced(service, [heldAt('recent', now - 2 * day)]);

			assert.deepStrictEqual(await service.refresh(), []);
		});

		test('does not depend on the client clock', async () => {
			// The client's clock runs 10 minutes ahead of the server's timestamps
			let notices = [rawAt('first', now - hour)];
			const service = new NotificationsService({
				productType: 'gitlens',
				now: () => now + 10 * minute,
				fetchGkApi: async () => page(notices, false),
			});
			assert.deepStrictEqual(await service.refresh(), []);

			notices = [rawAt('late', now - hour + 2 * minute, { contentType: 'security' }), ...notices];

			assert.deepStrictEqual(ids(await service.refresh()), ['late']);
		});

		test('with nothing previously held, any new unread eligible notice qualifies', async () => {
			const { service } = createService(() => page([rawAt('old', now - 30 * day)], false));
			restoreSynced(service, []);

			assert.deepStrictEqual(ids(await service.refresh()), ['old']);
		});

		test('concurrent calls share one refresh and resolve to the same list', async () => {
			const { service, calls } = createService(() => page([rawAt('new', now - hour)], false));
			restoreSynced(service, []);

			const [first, second] = await Promise.all([service.refresh(), service.refresh()]);

			assert.strictEqual(calls.length, 1);
			assert.deepStrictEqual(ids(first), ['new']);
			assert.strictEqual(second, first);
		});
	});

	suite('snapshots', () => {
		test('round-trip through JSON', async () => {
			const { service } = createService(({ path }) =>
				path.includes('user-settings')
					? ok({ marketingEnabled: false, helpEnabled: true, securityEnabled: true })
					: page([rawNotification('a', 1), rawNotification('b', 2)], true),
			);
			await service.refresh();
			await service.getSettings();
			const snapshot = JSON.parse(JSON.stringify(service.toSnapshot()));

			const { service: restored, changes } = createService(() => fail());
			restored.restore(snapshot);

			assert.deepStrictEqual(restored.toSnapshot(), service.toSnapshot());
			assert.deepStrictEqual(restored.getState().items, service.getState().items);
			assert.strictEqual(restored.getState().hasMore, true);
			assert.strictEqual(restored.getState().lastSyncedAt, now);
			assert.strictEqual(changes(), 1);
		});

		test('restore prunes expired items', () => {
			const { service } = createService(() => fail());
			const live: GkNotification = {
				id: 'live',
				event: 'general',
				contentType: 'help',
				headline: 'Live',
				body: 'Body',
				createdAt: now - day,
			};

			service.restore({
				items: [{ ...live, id: 'expired', expiresAt: now - 1 }, live],
				hasMore: false,
				page: 1,
				lastSyncedAt: now - day,
				settings: undefined,
			});

			assert.deepStrictEqual(ids(service.getState().items), ['live']);
		});
	});

	test('fires onDidChange for state changes', async () => {
		const { service, changes } = createService(() => page([rawNotification('a', 1)], false));

		await service.refresh();

		// loading, then ready
		assert.strictEqual(changes(), 2);
	});
});
