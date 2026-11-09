import * as assert from 'assert';
import type { IpcServer } from '../ipcServer.js';
import { createIpcServer } from '../ipcServer.js';

suite('IpcServer — authorization', () => {
	let server: IpcServer<unknown, unknown>;

	setup(async () => {
		server = await createIpcServer<unknown, unknown>();
		server.registerHandler('scoped', () => Promise.resolve({ route: 'scoped' }), 'route-secret');
		server.registerHandler('other', () => Promise.resolve({ route: 'other' }));
	});

	teardown(() => server.shutdown());

	function post(route: string, bearer: string): Promise<Response> {
		return fetch(`${server.ipcAddress}/${route}`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
			body: '{}',
		});
	}

	test('a route token opens its own route', async () => {
		const rs = await post('scoped', 'route-secret');
		assert.strictEqual(rs.status, 200);
		assert.deepStrictEqual(await rs.json(), { route: 'scoped' });
	});

	test('a route token opens no other route', async () => {
		assert.strictEqual((await post('other', 'route-secret')).status, 401);
	});

	test("the server's token still opens every route", async () => {
		assert.strictEqual((await post('scoped', server.ipcToken)).status, 200);
		assert.strictEqual((await post('other', server.ipcToken)).status, 200);
	});

	test('an unknown bearer opens nothing', async () => {
		assert.strictEqual((await post('scoped', 'nope')).status, 401);
		assert.strictEqual((await post('other', 'nope')).status, 401);
	});

	test('the route token goes with its route', async () => {
		const registration = server.registerHandler('transient', () => Promise.resolve(), 'transient-secret');
		assert.strictEqual((await post('transient', 'transient-secret')).status, 200);
		registration.dispose();
		assert.strictEqual((await post('transient', 'transient-secret')).status, 404);

		// A route registered again under the same name does not inherit the old token
		server.registerHandler('transient', () => Promise.resolve());
		assert.strictEqual((await post('transient', 'transient-secret')).status, 401);
	});
});
