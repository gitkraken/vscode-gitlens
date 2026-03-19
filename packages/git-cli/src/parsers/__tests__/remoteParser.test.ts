import * as assert from 'assert';
import { parseGitRemotes } from '../remoteParser.js';

suite('Remote Parser Test Suite', () => {
	suite('parseGitRemotes', () => {
		test('parses single remote', () => {
			const data =
				'origin\thttps://github.com/gitkraken/vscode-gitlens.git (fetch)\norigin\thttps://github.com/gitkraken/vscode-gitlens.git (push)\n';
			const remotes = parseGitRemotes(data, '/repo/path', undefined);

			assert.strictEqual(remotes.length, 1);
			const remote = remotes[0];
			assert.strictEqual(remote.name, 'origin');
			assert.strictEqual(remote.scheme, 'https://');
			assert.strictEqual(remote.domain, 'github.com');
			assert.strictEqual(remote.path, 'gitkraken/vscode-gitlens');
			assert.strictEqual(remote.urls.length, 2);
			assert.strictEqual(remote.urls[0].type, 'fetch');
			assert.strictEqual(remote.urls[1].type, 'push');
		});

		test('parses multiple remotes', () => {
			const data = `origin\tgit@github.com:gitkraken/vscode-gitlens.git (fetch)
origin\tgit@github.com:gitkraken/vscode-gitlens.git (push)
upstream\thttps://github.com/eamodio/vscode-gitlens.git (fetch)
upstream\thttps://github.com/eamodio/vscode-gitlens.git (push)
`;
			const remotes = parseGitRemotes(data, '/repo/path', undefined);

			assert.strictEqual(remotes.length, 2);

			const origin = remotes.find(r => r.name === 'origin');
			assert.ok(origin);
			assert.strictEqual(origin.domain, 'github.com');

			const upstream = remotes.find(r => r.name === 'upstream');
			assert.ok(upstream);
			assert.strictEqual(upstream.domain, 'github.com');
			assert.strictEqual(upstream.path, 'eamodio/vscode-gitlens');
		});
	});
});
