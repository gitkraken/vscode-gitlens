import * as assert from 'assert';
import { RemoteResourceType } from '../../models/remoteResource.js';
import { AzureDevOpsRemoteProvider } from '../azure-devops.js';
import { createRemoteProviderMatcher } from '../matcher.js';

const matcher = createRemoteProviderMatcher([{ domain: 'server.test', type: 'azure-devops' }]);

function parse(url: string) {
	const { hostname, pathname } = new URL(url);
	const provider = matcher(url, hostname, pathname.substring(1), 'https');
	assert.ok(provider instanceof AzureDevOpsRemoteProvider, url);
	return provider;
}

suite('AzureDevOpsRemoteProvider legacy and short repository paths (#5999)', () => {
	test('gives a legacy remote the same repository identity as its dev.azure.com equivalent', () => {
		const expected = parse('https://dev.azure.com/myorg/Project/_git/Repo').providerDesc;
		assert.ok(expected);
		for (const url of [
			'https://myorg.visualstudio.com/DefaultCollection/Project/_git/Repo',
			'https://myorg.visualstudio.com/defaultcollection/Project/_git/Repo',
			'https://myorg.visualstudio.com/Project/_git/Repo',
		]) {
			assert.deepEqual(parse(url).providerDesc, expected, url);
		}
	});

	test('links work items at the organization root for every repository shape', () => {
		for (const { url, workItems } of [
			{
				url: 'https://myorg.visualstudio.com/DefaultCollection/Project/_git/Repo',
				workItems: 'https://myorg.visualstudio.com/_workitems/edit/<num>',
			},
			{
				url: 'https://myorg.visualstudio.com/DefaultCollection/_git/Repo',
				workItems: 'https://myorg.visualstudio.com/_workitems/edit/<num>',
			},
			{
				url: 'https://myorg.visualstudio.com/_git/Repo',
				workItems: 'https://myorg.visualstudio.com/_workitems/edit/<num>',
			},
			{
				url: 'https://myorg.visualstudio.com/Project/_git/Repo',
				workItems: 'https://myorg.visualstudio.com/_workitems/edit/<num>',
			},
			{
				url: 'https://dev.azure.com/myorg/_git/Repo',
				workItems: 'https://dev.azure.com/myorg/_workitems/edit/<num>',
			},
			{
				url: 'https://dev.azure.com/myorg/Project/_git/Repo',
				workItems: 'https://dev.azure.com/myorg/_workitems/edit/<num>',
			},
			{
				url: 'https://server.test/tfs/DefaultCollection/Project/_git/Repo',
				workItems: 'https://server.test/tfs/DefaultCollection/_workitems/edit/<num>',
			},
		]) {
			const autolink = parse(url).autolinks.find(a => 'prefix' in a && a.prefix === '#');
			assert.strictEqual(autolink != null && 'url' in autolink ? autolink.url : undefined, workItems, url);
		}
	});

	test('keeps the collection and `_git` segments out of the display path', () => {
		for (const { url, displayPath } of [
			{ url: 'https://myorg.visualstudio.com/DefaultCollection/Project/_git/Repo', displayPath: 'Project/Repo' },
			{ url: 'https://myorg.visualstudio.com/DefaultCollection/_git/Repo', displayPath: 'Repo' },
			{ url: 'https://myorg.visualstudio.com/_git/Repo', displayPath: 'Repo' },
			{ url: 'https://dev.azure.com/myorg/_git/Repo', displayPath: 'myorg/Repo' },
		]) {
			assert.strictEqual(parse(url).displayPath, displayPath, url);
		}
	});

	test('looks up the target repository of a cross-remote pull request by organization and project', async () => {
		for (const { url, target } of [
			{
				url: 'https://myorg.visualstudio.com/DefaultCollection/Project/_git/Repo',
				target: { owner: 'myorg', name: 'Repo', project: 'Project' },
			},
			{
				url: 'https://myorg.visualstudio.com/DefaultCollection/_git/Repo',
				target: { owner: 'myorg', name: 'Repo', project: 'Repo' },
			},
			{
				url: 'https://myorg.visualstudio.com/Project/_git/Repo',
				target: { owner: 'myorg', name: 'Repo', project: 'Project' },
			},
			{
				url: 'https://dev.azure.com/myorg/_git/Repo',
				target: { owner: 'myorg', name: 'Repo', project: 'Repo' },
			},
			{
				url: 'https://user@dev.azure.com/myorg/My%20Project/_git/My%20Repo',
				target: { owner: 'myorg', name: 'My Repo', project: 'My Project' },
			},
			{
				url: 'https://server.test/tfs/DefaultCollection/Project/_git/Repo/',
				target: { owner: 'DefaultCollection', name: 'Repo', project: 'Project' },
			},
			{
				url: 'myorg@vs-ssh.visualstudio.com:v3/myorg/Project/Repo',
				target: { owner: 'myorg', name: 'Repo', project: 'Project' },
			},
		]) {
			let captured: { owner: string; name: string; project?: string } | undefined;
			const head = new AzureDevOpsRemoteProvider(
				'dev.azure.com',
				'fork-org/Project/_git/Fork',
				'https',
				undefined,
				false,
				{
					getRepositoryInfo: (_id, target) => {
						captured = target;
						return Promise.resolve({ id: 'target-id' });
					},
				},
			);

			const createUrl = await head.url({
				type: RemoteResourceType.CreatePullRequest,
				repoPath: '/repo',
				base: { branch: 'main', remote: { path: '', url: url, name: 'upstream' } },
				head: {
					branch: 'feature',
					remote: {
						path: 'fork-org/Project/_git/Fork',
						url: 'https://dev.azure.com/fork-org/Project/_git/Fork',
						name: 'origin',
					},
				},
			});
			assert.deepEqual(captured, target, url);
			assert.ok(createUrl?.includes('targetRepositoryId=target-id'), url);
		}
	});

	test('skips the cross-remote pull request when the target remote is not an Azure repository', async () => {
		const head = new AzureDevOpsRemoteProvider(
			'dev.azure.com',
			'fork-org/Project/_git/Fork',
			'https',
			undefined,
			false,
			{
				getRepositoryInfo: () => assert.fail('no lookup expected'),
			},
		);

		const createUrl = await head.url({
			type: RemoteResourceType.CreatePullRequest,
			repoPath: '/repo',
			base: {
				branch: 'main',
				remote: { path: '', url: 'https://dev.azure.com/myorg/not-a-repo', name: 'upstream' },
			},
			head: {
				branch: 'feature',
				remote: {
					path: 'fork-org/Project/_git/Fork',
					url: 'https://dev.azure.com/fork-org/Project/_git/Fork',
					name: 'origin',
				},
			},
		});
		assert.strictEqual(createUrl, undefined);
	});
});
