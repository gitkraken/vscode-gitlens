import * as assert from 'assert';
import type { RemoteProvider } from '@gitlens/git/models/remoteProvider.js';
import { parseGitRemotes } from '../remoteParser.js';

suite('Remote Parser Test Suite', () => {
	suite('parseGitRemotes', () => {
		test('parses single remote with fetch and push URLs', () => {
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

		test('returns empty array for empty data', () => {
			assert.deepStrictEqual(parseGitRemotes('', '/repo', undefined), []);
		});

		test('returns empty array for undefined-like data', () => {
			assert.deepStrictEqual(parseGitRemotes('', '/repo', undefined), []);
		});

		test('skips malformed lines without tab', () => {
			const data = 'origin https://github.com/owner/repo.git (fetch)\n';
			const remotes = parseGitRemotes(data, '/repo', undefined);
			assert.strictEqual(remotes.length, 0, 'Should skip lines without tab separator');
		});

		test('skips malformed lines without type parentheses', () => {
			const data = 'origin\thttps://github.com/owner/repo.git\n';
			const remotes = parseGitRemotes(data, '/repo', undefined);
			assert.strictEqual(remotes.length, 0, 'Should skip lines without (type)');
		});

		test('marks default remote when defaultRemoteName matches', () => {
			const data = [
				'origin\thttps://github.com/owner/repo.git (fetch)',
				'origin\thttps://github.com/owner/repo.git (push)',
				'upstream\thttps://github.com/other/repo.git (fetch)',
				'upstream\thttps://github.com/other/repo.git (push)',
			].join('\n');

			const remotes = parseGitRemotes(data, '/repo', undefined, 'upstream');

			const origin = remotes.find(r => r.name === 'origin');
			const upstream = remotes.find(r => r.name === 'upstream');
			assert.ok(origin, 'Should have origin');
			assert.ok(upstream, 'Should have upstream');
			assert.strictEqual(origin.default, false, 'origin should not be default');
			assert.strictEqual(upstream.default, true, 'upstream should be marked as default');
		});

		test('no remote is default when defaultRemoteName is not provided', () => {
			const data =
				'origin\thttps://github.com/owner/repo.git (fetch)\norigin\thttps://github.com/owner/repo.git (push)\n';
			const remotes = parseGitRemotes(data, '/repo', undefined);
			assert.strictEqual(remotes[0].default, false, 'No remote should be default');
		});

		test('calls remoteProviderMatcher for each URL and attaches provider', () => {
			const data =
				'origin\thttps://github.com/owner/repo.git (fetch)\norigin\thttps://github.com/owner/repo.git (push)\n';

			const fakeProvider = { id: 'github', name: 'GitHub' } as unknown as RemoteProvider;
			const matcher = (_url: string, _domain: string) => fakeProvider;

			const remotes = parseGitRemotes(data, '/repo', matcher);

			assert.strictEqual(remotes.length, 1);
			assert.strictEqual(remotes[0].provider, fakeProvider, 'Should attach provider from matcher');
		});

		test('replaces remote with provider from push URL when fetch had no provider', () => {
			// The parser tries remoteProviderMatcher for each URL. When a remote already
			// exists with no provider, and the push URL yields a provider, the remote is
			// reconstructed with the new provider.
			const data = [
				'origin\thttps://internal.proxy/owner/repo.git (fetch)',
				'origin\thttps://github.com/owner/repo.git (push)',
			].join('\n');

			const githubProvider = { id: 'github', name: 'GitHub' } as unknown as RemoteProvider;
			const matcher = (url: string) => {
				// Only the push URL (github.com) returns a provider
				if (url.includes('github.com')) return githubProvider;
				return undefined;
			};

			const remotes = parseGitRemotes(data, '/repo', matcher);

			assert.strictEqual(remotes.length, 1);
			assert.strictEqual(remotes[0].provider, githubProvider, 'Should use provider from push URL');
			assert.strictEqual(remotes[0].urls.length, 2, 'Should still have both URLs');
			// The remote's domain/path should be from the push URL (which had the provider)
			assert.strictEqual(remotes[0].domain, 'github.com', 'Domain should be from push URL');
		});

		test('does not replace provider when push URL has no provider', () => {
			// When fetch already has a provider and push does not, the original provider is kept
			const data = [
				'origin\thttps://github.com/owner/repo.git (fetch)',
				'origin\thttps://internal.mirror/owner/repo.git (push)',
			].join('\n');

			const githubProvider = { id: 'github', name: 'GitHub' } as unknown as RemoteProvider;
			const matcher = (url: string) => {
				if (url.includes('github.com')) return githubProvider;
				return undefined;
			};

			const remotes = parseGitRemotes(data, '/repo', matcher);

			assert.strictEqual(remotes.length, 1);
			assert.strictEqual(remotes[0].provider, githubProvider, 'Should keep provider from fetch URL');
		});

		test('replaces provider when push URL yields a different provider', () => {
			// When fetch has a provider but push also yields one, the push provider wins
			// (because line 82 skips replacement only when provider != null AND type !== 'push')
			const data = [
				'origin\thttps://github.com/owner/repo.git (fetch)',
				'origin\thttps://gitlab.com/owner/repo.git (push)',
			].join('\n');

			const githubProvider = { id: 'github', name: 'GitHub' } as unknown as RemoteProvider;
			const gitlabProvider = { id: 'gitlab', name: 'GitLab' } as unknown as RemoteProvider;
			const matcher = (url: string) => {
				if (url.includes('github.com')) return githubProvider;
				if (url.includes('gitlab.com')) return gitlabProvider;
				return undefined;
			};

			const remotes = parseGitRemotes(data, '/repo', matcher);

			assert.strictEqual(remotes.length, 1);
			// Line 82: `if (remote.provider != null && type !== 'push') continue;`
			// Since type IS 'push', it proceeds to try the matcher, and gitlabProvider replaces githubProvider
			assert.strictEqual(remotes[0].provider, gitlabProvider, 'Push URL provider should replace fetch provider');
		});
	});
});
