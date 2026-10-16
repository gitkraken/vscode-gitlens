import * as assert from 'assert';
import { parseGitRemoteUrl } from '../../utils/remote.utils.js';
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
			assert.strictEqual(provider.owner, 'org');
			assert.strictEqual(provider.repoName, 'project/_git/repo');
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

	suite('Azure repository paths', () => {
		for (const { domain, prefix, virtualDirectory } of [
			{ domain: 'dev.azure.com', prefix: 'myorg/', virtualDirectory: undefined },
			{ domain: 'myorg.visualstudio.com', prefix: '', virtualDirectory: undefined },
			{ domain: 'server.test', prefix: 'tfs/myorg/', virtualDirectory: 'tfs' },
		]) {
			const matcher = createRemoteProviderMatcher([{ domain: 'server.test', type: 'azure-devops' }]);
			test(`decodes names exactly once for ${domain}`, () => {
				const path = `${prefix}Project%20%23%3F%25/_git/Repo%20%23%3F%25`;
				const provider = matcher(`https://${domain}/${path}`, domain, path, 'https');
				assert.ok(provider?.providerDesc);
				assert.deepEqual(provider.repoDesc, {
					owner: 'myorg',
					name: 'Project #?%/_git/Repo #?%',
					...(virtualDirectory == null ? {} : { virtualDirectory: virtualDirectory }),
				});
			});

			test(`rejects encoded dot and separator segments for ${domain}`, () => {
				for (const segment of ['.', '..', '%2e', '%2e%2e', '.%2e', '%2e.', '%5c', '%2f']) {
					for (const path of [`${prefix}${segment}/_git/Repo`, `${prefix}Project/_git/${segment}`]) {
						const provider = matcher(`https://${domain}/${path}`, domain, path, 'https');
						assert.ok(provider);
						assert.strictEqual(provider.providerDesc, undefined, path);
					}
				}
			});

			test(`preserves literal percent sequences in names for ${domain}`, () => {
				for (const { encoded, name } of [
					{ encoded: '%252e', name: '%2e' },
					{ encoded: '%252e%252e', name: '%2e%2e' },
					{ encoded: '%252f', name: '%2f' },
				]) {
					const path = `${prefix}Project/_git/${encoded}`;
					const provider = matcher(`https://${domain}/${path}`, domain, path, 'https');
					assert.ok(provider?.providerDesc);
					assert.deepEqual(provider.repoDesc, {
						owner: 'myorg',
						name: `Project/_git/${name}`,
						...(virtualDirectory == null ? {} : { virtualDirectory: virtualDirectory }),
					});
				}
			});
		}
	});

	suite('Azure legacy and short repository paths (#5999)', () => {
		const matcher = createRemoteProviderMatcher([{ domain: 'server.test', type: 'azure-devops' }]);
		function parse(url: string) {
			// Not `new URL`: git hands the matcher the host as written, and `URL` would lowercase it
			const [, host, path] = /^https:\/\/([^/]+)\/(.*)$/.exec(url) ?? [];
			return matcher(url, host, path, 'https');
		}

		for (const { url, owner, project, repo } of [
			{
				url: 'https://myorg.visualstudio.com/DefaultCollection/Project/_git/Repo',
				owner: 'myorg',
				project: 'Project',
				repo: 'Repo',
			},
			{
				url: 'https://myorg.visualstudio.com/defaultcollection/Project/_git/Repo',
				owner: 'myorg',
				project: 'Project',
				repo: 'Repo',
			},
			{
				url: 'https://myorg.visualstudio.com/DefaultCollection/My%20Project/_git/My%20Repo',
				owner: 'myorg',
				project: 'My Project',
				repo: 'My Repo',
			},
			{
				url: 'https://myorg.visualstudio.com/DefaultCollection/_git/Repo',
				owner: 'myorg',
				project: 'Repo',
				repo: 'Repo',
			},
			{ url: 'https://myorg.visualstudio.com/_git/Repo', owner: 'myorg', project: 'Repo', repo: 'Repo' },
			{
				url: 'https://MyOrg.VisualStudio.com/DefaultCollection/Project/_git/Repo',
				owner: 'MyOrg',
				project: 'Project',
				repo: 'Repo',
			},
			{ url: 'https://dev.azure.com/myorg/_git/Repo', owner: 'myorg', project: 'Repo', repo: 'Repo' },
			// Regressions: the shapes that already resolved keep resolving the same way
			{
				url: 'https://myorg.visualstudio.com/Project/_git/Repo',
				owner: 'myorg',
				project: 'Project',
				repo: 'Repo',
			},
			{ url: 'https://dev.azure.com/myorg/Project/_git/Repo', owner: 'myorg', project: 'Project', repo: 'Repo' },
			{
				url: 'https://server.test/DefaultCollection/Project/_git/Repo',
				owner: 'DefaultCollection',
				project: 'Project',
				repo: 'Repo',
			},
		]) {
			test(`resolves ${url}`, () => {
				const provider = parse(url);
				assert.ok(provider);
				assert.strictEqual(provider.id, 'azure-devops');
				assert.deepEqual(provider.repoDesc, { owner: owner, name: `${project}/_git/${repo}` });
				assert.deepEqual(provider.providerDesc, {
					id: 'azureDevops',
					repoDomain: project,
					repoName: `${project}/_git/${repo}`,
					repoOwnerDomain: owner,
				});
			});
		}

		test('maps an SSH remote of a VSTS organization to the same repository', () => {
			const provider = matcher(
				'myorg@vs-ssh.visualstudio.com:v3/myorg/Project/Repo',
				'vs-ssh.visualstudio.com',
				'v3/myorg/Project/Repo',
				'ssh',
			);
			assert.deepEqual(provider?.repoDesc, { owner: 'myorg', name: 'Project/_git/Repo' });
		});

		for (const url of [
			// More than a project after the collection is not a VSTS repository
			'https://myorg.visualstudio.com/DefaultCollection/Other/Project/_git/Repo',
			'https://myorg.visualstudio.com/Other/Project/_git/Repo',
			// dev.azure.com always names the organization in the path
			'https://dev.azure.com/_git/Repo',
			'https://dev.azure.com/myorg/Other/Project/_git/Repo',
			// A server path always names its collection (`{collection}/_git/{repo}` resolves, see below)
			'https://server.test/_git/Repo',
		]) {
			test(`does not resolve ${url}`, () => {
				const provider = parse(url);
				assert.ok(provider);
				assert.strictEqual(provider.providerDesc, undefined);
			});
		}
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

		test('splits an Azure DevOps Server repository behind nested virtual directories', () => {
			const configs: RemoteProviderConfig[] = [{ domain: 'azure.example.com', type: 'azure-devops' }];
			const matcher = createRemoteProviderMatcher(configs);
			const provider = matcher(
				'https://azure.example.com/tfs/team/DefaultCollection/Project/_git/Repo',
				'azure.example.com',
				'tfs/team/DefaultCollection/Project/_git/Repo',
				'https',
			);
			assert.ok(provider);
			assert.strictEqual(provider.id, 'azure-devops');
			assert.deepEqual(provider.repoDesc, {
				owner: 'DefaultCollection',
				name: 'Project/_git/Repo',
				virtualDirectory: 'tfs/team',
			});
			assert.deepEqual(provider.providerDesc, {
				id: 'azureDevops',
				repoDomain: 'Project',
				repoName: 'Project/_git/Repo',
				repoOwnerDomain: 'DefaultCollection',
			});
		});

		suite('Azure repositories named after their project (no project segment)', () => {
			const matcher = createRemoteProviderMatcher([{ domain: 'azure.example.com', type: 'azure-devops' }]);
			const match = (url: string) => {
				const [scheme, domain, path] = parseGitRemoteUrl(url);
				return matcher(url, domain, path, scheme);
			};

			for (const url of [
				'https://azure.example.com/DefaultCollection/_git/Repo',
				'ssh://azure.example.com:22/DefaultCollection/_git/Repo',
			]) {
				test(`reads the collection at the host root for ${url}`, () => {
					const provider = match(url);
					assert.ok(provider);
					assert.deepEqual(provider.repoDesc, { owner: 'DefaultCollection', name: 'Repo/_git/Repo' });
					assert.deepEqual(provider.providerDesc, {
						id: 'azureDevops',
						repoDomain: 'Repo',
						repoName: 'Repo/_git/Repo',
						repoOwnerDomain: 'DefaultCollection',
					});
				});
			}

			test('decodes the repository name once', () => {
				const provider = match('https://azure.example.com/DefaultCollection/_git/My%20Repo');
				assert.deepEqual(provider?.repoDesc, { owner: 'DefaultCollection', name: 'My Repo/_git/My Repo' });
			});

			// Behind a path the URL can't tell a virtual directory from a collection; the integration settles it.
			for (const url of [
				'https://azure.example.com/tfs/DefaultCollection/_git/Repo',
				'ssh://azure.example.com:22/tfs/DefaultCollection/_git/Repo',
			]) {
				test(`keeps reading the segment before _git as the project for ${url}`, () => {
					const provider = match(url);
					assert.deepEqual(provider?.repoDesc, { owner: 'tfs', name: 'DefaultCollection/_git/Repo' });
					assert.strictEqual(provider?.providerDesc?.repoDomain, 'DefaultCollection');
				});
			}
		});

		test("a config's protocol override wins over the URL scheme", () => {
			// The config declares plain `http` for a self-managed host; the matcher must honor that override on
			// the built provider rather than the `https` scheme carried by the URL. resolveRepository relies on
			// this when it forwards a config-derived protocol on its synthetic exact-domain entry.
			const configs: RemoteProviderConfig[] = [{ domain: 'git.mycorp.com', type: 'github', protocol: 'http' }];
			const matcher = createRemoteProviderMatcher(configs);
			const provider = matcher(
				'https://git.mycorp.com/owner/repo.git',
				'git.mycorp.com',
				'owner/repo.git',
				'https',
			);
			assert.ok(provider);
			assert.strictEqual(provider.id, 'github');
			assert.strictEqual(provider.protocol, 'http');
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
