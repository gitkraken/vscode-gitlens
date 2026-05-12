import * as assert from 'assert';
import type { RemoteProviderConfig } from '../matcher.js';
import { createRemoteProviderMatcher } from '../matcher.js';

suite('createRemoteProviderMatcher Test Suite', () => {
	suite('built-in providers', () => {
		test('matches GitHub URL', () => {
			const matcher = createRemoteProviderMatcher();
			const provider = matcher('https://github.com/owner/repo.git', 'github.com', 'owner/repo.git', 'https');
			assert.ok(provider);
			assert.strictEqual(provider.id, 'github');
		});

		test('matches GitLab URL', () => {
			const matcher = createRemoteProviderMatcher();
			const provider = matcher('https://gitlab.com/owner/repo.git', 'gitlab.com', 'owner/repo.git', 'https');
			assert.ok(provider);
			assert.strictEqual(provider.id, 'gitlab');
		});

		test('matches Bitbucket URL', () => {
			const matcher = createRemoteProviderMatcher();
			const provider = matcher(
				'https://bitbucket.org/owner/repo.git',
				'bitbucket.org',
				'owner/repo.git',
				'https',
			);
			assert.ok(provider);
			assert.strictEqual(provider.id, 'bitbucket');
		});

		test('matches Azure DevOps URL', () => {
			const matcher = createRemoteProviderMatcher();
			const provider = matcher(
				'https://dev.azure.com/org/project/_git/repo',
				'dev.azure.com',
				'org/project/_git/repo',
				'https',
			);
			assert.ok(provider);
			assert.strictEqual(provider.id, 'azure-devops');
		});

		test('matches GitHub via SSH domain', () => {
			const matcher = createRemoteProviderMatcher();
			const provider = matcher('git@github.com:owner/repo.git', 'github.com', 'owner/repo.git', undefined);
			assert.ok(provider);
			assert.strictEqual(provider.id, 'github');
		});

		test('returns undefined for unknown domain', () => {
			const matcher = createRemoteProviderMatcher();
			const provider = matcher('https://unknown.com/repo.git', 'unknown.com', 'repo.git', 'https');
			assert.strictEqual(provider, undefined);
		});

		test('matches self-hosted GitLab via gitlab subdomain pattern', () => {
			const matcher = createRemoteProviderMatcher();
			const provider = matcher(
				'https://gitlab.mycorp.com/owner/repo.git',
				'gitlab.mycorp.com',
				'owner/repo.git',
				'https',
			);
			assert.ok(provider);
			assert.strictEqual(provider.id, 'gitlab');
		});

		test('matches Gitea domain pattern', () => {
			const matcher = createRemoteProviderMatcher();
			const provider = matcher(
				'https://gitea.example.com/owner/repo.git',
				'gitea.example.com',
				'owner/repo.git',
				'https',
			);
			assert.ok(provider);
			assert.strictEqual(provider.id, 'gitea');
		});

		test('matches Azure DevOps visualstudio.com domain', () => {
			const matcher = createRemoteProviderMatcher();
			const provider = matcher(
				'https://myorg.visualstudio.com/project/_git/repo',
				'myorg.visualstudio.com',
				'project/_git/repo',
				'https',
			);
			assert.ok(provider);
			assert.strictEqual(provider.id, 'azure-devops');
		});

		test('matches Gerrit Hub domain', () => {
			const matcher = createRemoteProviderMatcher();
			const provider = matcher(
				'https://review.gerrithub.io/owner/repo',
				'review.gerrithub.io',
				'owner/repo',
				'https',
			);
			assert.ok(provider);
			assert.strictEqual(provider.id, 'gerrit');
		});

		test('matches Google Source domain', () => {
			const matcher = createRemoteProviderMatcher();
			const provider = matcher(
				'https://source.googlesource.com/project/repo',
				'source.googlesource.com',
				'project/repo',
				'https',
			);
			assert.ok(provider);
			assert.strictEqual(provider.id, 'google-source');
		});
	});

	suite('custom provider configs', () => {
		test('matches custom domain config for GitHub type', () => {
			const configs: RemoteProviderConfig[] = [{ domain: 'git.mycorp.com', type: 'github' }];
			const matcher = createRemoteProviderMatcher(configs);
			const provider = matcher(
				'https://git.mycorp.com/owner/repo.git',
				'git.mycorp.com',
				'owner/repo.git',
				'https',
			);
			assert.ok(provider);
			assert.strictEqual(provider.id, 'github');
		});

		test('matches custom regex config for GitLab type', () => {
			const configs: RemoteProviderConfig[] = [{ regex: 'git\\.mycorp\\.com', type: 'gitlab' }];
			const matcher = createRemoteProviderMatcher(configs);
			const provider = matcher(
				'https://git.mycorp.com/owner/repo.git',
				'git.mycorp.com',
				'owner/repo.git',
				'https',
			);
			assert.ok(provider);
			assert.strictEqual(provider.id, 'gitlab');
		});

		test('custom configs take priority over built-in providers', () => {
			const configs: RemoteProviderConfig[] = [{ domain: 'github.com', type: 'gitlab' }];
			const matcher = createRemoteProviderMatcher(configs);
			const provider = matcher('https://github.com/owner/repo.git', 'github.com', 'owner/repo.git', 'https');
			assert.ok(provider);
			// Custom config maps github.com to gitlab type, so it should be gitlab
			assert.strictEqual(provider.id, 'gitlab');
		});

		test('falls back to built-in when custom config does not match', () => {
			const configs: RemoteProviderConfig[] = [{ domain: 'git.mycorp.com', type: 'github' }];
			const matcher = createRemoteProviderMatcher(configs);
			const provider = matcher('https://gitlab.com/owner/repo.git', 'gitlab.com', 'owner/repo.git', 'https');
			assert.ok(provider);
			assert.strictEqual(provider.id, 'gitlab');
		});

		test('handles invalid regex in custom config without crashing', () => {
			const configs: RemoteProviderConfig[] = [{ regex: '[invalid(regex', type: 'github' }];
			// Should not throw
			const matcher = createRemoteProviderMatcher(configs);
			const provider = matcher('https://github.com/owner/repo.git', 'github.com', 'owner/repo.git', 'https');
			// Should still match via built-in
			assert.ok(provider);
			assert.strictEqual(provider.id, 'github');
		});

		test('handles config with no domain or regex gracefully', () => {
			const configs: RemoteProviderConfig[] = [{ type: 'github' }];
			const matcher = createRemoteProviderMatcher(configs);
			const provider = matcher('https://github.com/owner/repo.git', 'github.com', 'owner/repo.git', 'https');
			// Should still match via built-in
			assert.ok(provider);
			assert.strictEqual(provider.id, 'github');
		});

		test('skips custom regex when matched URL has no positional capture groups', () => {
			// matchUrl path, zero positional groups — match[1] and match[2] are both undefined
			const customUrls = {
				repository: '{repo}',
				branches: '{repo}/branches',
				branch: '{repo}/branch/{branch}',
				commit: '{repo}/commit/{id}',
				file: '{repo}/file/{file}',
				fileInBranch: '{repo}/file/{branch}/{file}',
				fileInCommit: '{repo}/file/{id}/{file}',
				fileLine: '#L{line}',
				fileRange: '#L{start}-L{end}',
			};
			const configs: RemoteProviderConfig[] = [
				{ regex: '^https://my-host\\.example', type: 'custom', urls: customUrls },
			];
			const matcher = createRemoteProviderMatcher(configs);
			// Custom regex matches the URL via the matchUrl branch but has 0 groups; must not throw.
			const provider = matcher(
				'https://my-host.example/owner/repo.git',
				'my-host.example',
				'owner/repo.git',
				'https',
			);
			assert.strictEqual(provider, undefined);
		});

		test('skips custom regex when matched URL provides only one capture group', () => {
			// matchUrl path, regex matches URL but only one positional group — match[2] is undefined,
			// previously crashed with TypeError when destructured in CustomRemoteProvider.
			const customUrls = {
				repository: '{repo}',
				branches: '{repo}/branches',
				branch: '{repo}/branch/{branch}',
				commit: '{repo}/commit/{id}',
				file: '{repo}/file/{file}',
				fileInBranch: '{repo}/file/{branch}/{file}',
				fileInCommit: '{repo}/file/{id}/{file}',
				fileLine: '#L{line}',
				fileRange: '#L{start}-L{end}',
			};
			const configs: RemoteProviderConfig[] = [
				{
					regex: '^https://my-host\\.example/(?<repo>.+?)(?:\\.git)?$',
					type: 'custom',
					urls: customUrls,
				},
			];
			const matcher = createRemoteProviderMatcher(configs);
			const provider = matcher(
				'https://my-host.example/owner/repo.git',
				'my-host.example',
				'owner/repo.git',
				'https',
			);
			assert.strictEqual(provider, undefined);
		});

		test('matches custom regex with the documented two-group shape', () => {
			// Positive case — guard must not break the contract for valid configs.
			const customUrls = {
				repository: 'https://{domain}/{repo}',
				branches: 'https://{domain}/{repo}/branches',
				branch: 'https://{domain}/{repo}/branch/{branch}',
				commit: 'https://{domain}/{repo}/commit/{id}',
				file: 'https://{domain}/{repo}/file/{file}',
				fileInBranch: 'https://{domain}/{repo}/file/{branch}/{file}',
				fileInCommit: 'https://{domain}/{repo}/file/{id}/{file}',
				fileLine: '#L{line}',
				fileRange: '#L{start}-L{end}',
			};
			const configs: RemoteProviderConfig[] = [
				{
					regex: '^https?:\\/\\/(my-host\\.example)\\/(.+?)(?:\\.git)?$',
					type: 'custom',
					urls: customUrls,
				},
			];
			const matcher = createRemoteProviderMatcher(configs);
			const provider = matcher(
				'https://my-host.example/owner/repo.git',
				'my-host.example',
				'owner/repo.git',
				'https',
			);
			assert.ok(provider);
			assert.strictEqual(provider.id, 'custom');
			assert.strictEqual(provider.domain, 'my-host.example');
			assert.strictEqual(provider.path, 'owner/repo');
		});
	});

	suite('provider properties', () => {
		test('provider domain is set correctly', () => {
			const matcher = createRemoteProviderMatcher();
			const provider = matcher('https://github.com/owner/repo.git', 'github.com', 'owner/repo.git', 'https');
			assert.ok(provider);
			assert.strictEqual(provider.domain, 'github.com');
		});

		test('provider path is set correctly', () => {
			const matcher = createRemoteProviderMatcher();
			const provider = matcher('https://github.com/owner/repo.git', 'github.com', 'owner/repo.git', 'https');
			assert.ok(provider);
			assert.strictEqual(provider.path, 'owner/repo.git');
		});
	});

	suite('matcher with no configs', () => {
		test('works when called with undefined configs', () => {
			const matcher = createRemoteProviderMatcher(undefined);
			const provider = matcher('https://github.com/owner/repo.git', 'github.com', 'owner/repo.git', 'https');
			assert.ok(provider);
			assert.strictEqual(provider.id, 'github');
		});

		test('works when called with empty configs array', () => {
			const matcher = createRemoteProviderMatcher([]);
			const provider = matcher('https://github.com/owner/repo.git', 'github.com', 'owner/repo.git', 'https');
			assert.ok(provider);
			assert.strictEqual(provider.id, 'github');
		});
	});
});
