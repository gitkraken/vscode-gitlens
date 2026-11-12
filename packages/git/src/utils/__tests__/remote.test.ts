import * as assert from 'assert';
import { parseGitRemoteUrl } from '../remote.utils.js';

suite('Remote URL Parser Test Suite', () => {
	suite('parseGitRemoteUrl', () => {
		test('parses https url', () => {
			const url = 'https://github.com/gitkraken/vscode-gitlens.git';
			const [scheme, domain, path] = parseGitRemoteUrl(url);
			assert.strictEqual(scheme, 'https://');
			assert.strictEqual(domain, 'github.com');
			assert.strictEqual(path, 'gitkraken/vscode-gitlens');
		});

		test('parses ssh url', () => {
			const url = 'git@github.com:gitkraken/vscode-gitlens.git';
			const [_scheme, domain, path] = parseGitRemoteUrl(url);
			assert.strictEqual(domain, 'github.com');
			assert.strictEqual(path, 'gitkraken/vscode-gitlens');
		});

		test('parses ssh:// url', () => {
			const url = 'ssh://git@github.com/gitkraken/vscode-gitlens.git';
			const [scheme, domain, path] = parseGitRemoteUrl(url);
			assert.strictEqual(scheme, 'ssh://');
			assert.strictEqual(domain, 'github.com');
			assert.strictEqual(path, 'gitkraken/vscode-gitlens');
		});

		const cases: [url: string, domain: string, path: string][] = [
			// An `@` in the path is not a user/host separator
			['https://example.com/x@github.com/owner/repo.git', 'example.com', 'x@github.com/owner/repo'],
			['https://example.com:8443/x@github.com/owner/repo.git', 'example.com:8443', 'x@github.com/owner/repo'],
			['https://user@example.com/x@github.com/owner/repo.git', 'example.com', 'x@github.com/owner/repo'],
			['ssh://git@example.com/x@github.com/owner/repo.git', 'example.com', 'x@github.com/owner/repo'],
			['ssh://example.com/x@github.com/owner/repo.git', 'example.com', 'x@github.com/owner/repo'],
			['ssh://example.com:2222/x@github.com/owner/repo.git', 'example.com', 'x@github.com/owner/repo'],
			['ssh://user:pass@example.com/x@github.com/owner/repo.git', 'example.com', 'x@github.com/owner/repo'],
			['git@example.com:x@github.com/owner/repo.git', 'example.com', 'x@github.com/owner/repo'],
			['git@example.com:x@github.com:owner/repo.git', 'example.com', 'x@github.com:owner/repo'],
			['user@example.com:x@github.com:owner/repo.git', 'example.com', 'x@github.com:owner/repo'],
			// Credentials before the host still are
			['https://user@github.com/owner/repo.git', 'github.com', 'owner/repo'],
			['https://user:pass@github.com/owner/repo.git', 'github.com', 'owner/repo'],
			['https://user:p@ss@github.com/owner/repo.git', 'github.com', 'owner/repo'],
			['ssh://git@github.com:22/owner/repo.git', 'github.com', 'owner/repo'],
			['ssh://git@github.com/~user/repo.git', 'github.com', '~user/repo'],
			['user@github.com:owner/repo.git', 'github.com', 'owner/repo'],
			['git@[::1]:owner/repo.git', '[::1]', 'owner/repo'],
		];
		for (const [url, expectedDomain, expectedPath] of cases) {
			test(`parses ${url} as host ${expectedDomain}`, () => {
				const [, domain, path] = parseGitRemoteUrl(url);
				assert.strictEqual(domain, expectedDomain);
				assert.strictEqual(path, expectedPath);
			});
		}

		test('does not take a host from a local path with an `@` and a `:`', () => {
			const url = '/srv/x@github.com:owner/repo.git';
			assert.deepStrictEqual(parseGitRemoteUrl(url), ['', '', url]);
		});
	});
});
