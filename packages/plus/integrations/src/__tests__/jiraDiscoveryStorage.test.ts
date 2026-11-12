import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { createIntegrationService } from '../integrationService.js';
import { createFakeRuntime } from './fakeRuntime.js';

async function flush(): Promise<void> {
	await new Promise(resolve => setTimeout(resolve, 0));
}

suite('Jira discovery storage cleanup', () => {
	test('removes every token discovery key once, preserving unrelated storage', async () => {
		const runtime = createFakeRuntime();
		await runtime.storage.store('jira:old-token:organizations', { data: [] });
		await runtime.storage.store('jira:other-token:projects', { data: [] });
		await runtime.storage.store('jira-server:settings', 'keep');
		await runtime.storage.store('linear:settings', 'keep');
		let cleanups = 0;
		const remove = runtime.storage.deleteWithPrefix;
		runtime.storage.deleteWithPrefix = async prefix => {
			if (prefix === 'jira:') {
				cleanups++;
			}

			await remove(prefix);
		};
		const service = createIntegrationService(runtime);
		await flush();
		service.dispose();
		assert.equal(runtime.storage.get('jira:old-token:organizations'), undefined);
		assert.equal(runtime.storage.get('jira:other-token:projects'), undefined);
		assert.equal(runtime.storage.get('jira-server:settings'), 'keep');
		assert.equal(runtime.storage.get('linear:settings'), 'keep');
		const restarted = createIntegrationService(runtime);
		await flush();
		restarted.dispose();
		assert.equal(cleanups, 1);
	});

	test('retries cleanup on startup after a storage failure', async () => {
		const runtime = createFakeRuntime();
		await runtime.storage.store('jira:token:projects', { data: [] });
		const remove = runtime.storage.deleteWithPrefix;
		runtime.storage.deleteWithPrefix = async prefix => {
			if (prefix === 'jira:') throw new Error('storage unavailable');

			await remove(prefix);
		};
		const service = createIntegrationService(runtime);
		await flush();
		service.dispose();
		assert.ok(runtime.storage.get('jira:token:projects'));
		runtime.storage.deleteWithPrefix = remove;
		const restarted = createIntegrationService(runtime);
		await flush();
		restarted.dispose();
		assert.equal(runtime.storage.get('jira:token:projects'), undefined);
	});
});
