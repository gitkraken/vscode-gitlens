import * as assert from 'node:assert';
import { getKeplerHost } from '../keplerHost.js';

suite('getKeplerHost', () => {
	test('is local when not running in a remote', () => {
		assert.strictEqual(
			getKeplerHost(undefined, [{ scheme: 'vscode-remote', authority: 'ssh-remote+devbox' }]),
			'local',
		);
	});

	test("uses the remote folder's authority, ignoring folders that are not vscode-remote", () => {
		const folders = [
			{ scheme: 'vscode-vfs', authority: 'github' },
			{ scheme: 'vscode-remote', authority: 'wsl+Ubuntu' },
		];

		assert.strictEqual(getKeplerHost('wsl', folders), 'wsl+Ubuntu');
	});

	test('is undefined when no folder is remote', () => {
		assert.strictEqual(getKeplerHost('ssh-remote', [{ scheme: 'file', authority: '' }]), undefined);
		assert.strictEqual(getKeplerHost('ssh-remote', []), undefined);
	});
});
