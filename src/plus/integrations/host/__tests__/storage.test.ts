import * as assert from 'node:assert/strict';
import type { ExtensionContext } from 'vscode';
import type { Container } from '../../../../container.js';
import { Storage } from '../../../../system/-webview/storage.js';
import { createStorageAdapter } from '../storage.js';

suite('Integration host storage', () => {
	test('a literal Jira prefix deletes discovery without deleting namespace siblings or its root', async () => {
		const values = new Map<string, unknown>([
			['gitlens:jira:token:organizations', []],
			['gitlens:jira:other:projects', []],
			['gitlens:jira', 'keep'],
			['gitlens:jira-server:settings', 'keep'],
			['gitlens:linear:settings', 'keep'],
		]);
		const storage = new Storage({
			globalState: {
				keys: () => [...values.keys()],
				update: async (key: string, value: unknown) => {
					if (value === undefined) {
						values.delete(key);
					} else {
						values.set(key, value);
					}
				},
			},
			secrets: { onDidChange: () => ({ dispose: () => {} }) },
		} as unknown as ExtensionContext);
		try {
			const adapter = createStorageAdapter({ storage: storage } as unknown as Container);
			await adapter.deleteWithPrefix('jira:');
			assert.deepEqual(
				[...values.keys()],
				['gitlens:jira', 'gitlens:jira-server:settings', 'gitlens:linear:settings'],
			);
		} finally {
			storage.dispose();
		}
	});
});
