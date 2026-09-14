import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { fromAzurePullRequest, getAzurePullRequestWebUrl, sanitizeAzureRepositoryUrl } from '../models.js';
import { azureProvider, createAzureForkSource, createAzurePullRequest as pr } from './fixtures.js';

suite('getAzurePullRequestWebUrl', () => {
	// The fixture's own `url` deliberately names a host and path nothing may be resolved against, so a reader that
	// went back to the payload for the prefix is caught by every case below.
	test('builds a url from the configured base and organization, without a double slash after the host', () => {
		assert.equal(
			getAzurePullRequestWebUrl(
				pr('https://dev.azure.com/myorg/Proj/_apis/git/repositories/abc/pullRequests/5', 'Proj', 'repo'),
				'https://dev.azure.com',
				'myorg',
			),
			'https://dev.azure.com/myorg/Proj/_git/repo/pullrequest/5',
		);
	});

	test('tolerates a base url spelled with a trailing slash', () => {
		assert.equal(
			getAzurePullRequestWebUrl(
				pr('https://dev.azure.com/myorg/Proj/_apis/git/repositories/abc/pullRequests/5', 'Proj', 'repo'),
				'https://dev.azure.com/',
				'myorg',
			),
			'https://dev.azure.com/myorg/Proj/_git/repo/pullrequest/5',
		);
	});

	// The names come off the model, and the organization off the caller; the fixture addresses project and repository
	// by id so a function that scraped the payload's url instead would not survive this.
	test('encodes organization, project and repository names', () => {
		assert.equal(
			getAzurePullRequestWebUrl(
				pr(
					'https://dev.azure.com/my%20org/11111111-1111-1111-1111-111111111111/_apis/git/repositories/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/pullRequests/5',
					'My Project',
					'my repo',
					'11111111-1111-1111-1111-111111111111',
				),
				'https://dev.azure.com',
				'my org',
			),
			'https://dev.azure.com/my%20org/My%20Project/_git/my%20repo/pullrequest/5',
		);
	});

	// A space is the obvious case, but not the load-bearing one — `&` is where a path-safe encoder (`encodeURI`)
	// and a segment encoder (`encodeURIComponent`) disagree, and Azure permits it in both names.
	test('encodes reserved characters in project and repository names', () => {
		assert.equal(
			getAzurePullRequestWebUrl(
				pr(
					'https://dev.azure.com/myorg/11111111-1111-1111-1111-111111111111/_apis/git/repositories/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/pullRequests/5',
					'R&D',
					'c++ lib',
					'11111111-1111-1111-1111-111111111111',
				),
				'https://dev.azure.com',
				'myorg',
			),
			'https://dev.azure.com/myorg/R%26D/_git/c%2B%2B%20lib/pullrequest/5',
		);
	});

	test('keeps the virtual directory a self-hosted base url carries', () => {
		assert.equal(
			getAzurePullRequestWebUrl(
				pr(
					'https://server.example/tfs/DefaultCollection/project-id/_apis/git/repositories/repo-id/pullRequests/5',
					'Proj',
					'repo',
				),
				'https://server.example/tfs',
				'DefaultCollection',
			),
			'https://server.example/tfs/DefaultCollection/Proj/_git/repo/pullrequest/5',
		);
	});

	test('ignores the host and path the payload url names', () => {
		assert.equal(
			getAzurePullRequestWebUrl(
				pr('https://attacker.example/evil/_apis/git/repositories/repo-id/pullRequests/5', 'Contoso', 'repo'),
				'https://dev.azure.com',
				'contoso',
			),
			'https://dev.azure.com/contoso/Contoso/_git/repo/pullrequest/5',
		);
	});
});

suite('fromAzurePullRequest', () => {
	test('builds the base repository url for both refs', () => {
		const pullRequest = fromAzurePullRequest(
			pr(
				'https://dev.azure.com/myorg/project-id/_apis/git/repositories/repository-id/pullRequests/5',
				'My Project',
				'my repo',
			),
			azureProvider,
			'myorg',
			'https://dev.azure.com',
			undefined,
		);

		assert.equal(pullRequest.refs?.base.url, 'https://dev.azure.com/myorg/My%20Project/_git/my%20repo');
		assert.equal(pullRequest.refs?.head.url, 'https://dev.azure.com/myorg/My%20Project/_git/my%20repo');
		assert.equal(pullRequest.url, 'https://dev.azure.com/myorg/My%20Project/_git/my%20repo/pullrequest/5');
		assert.equal(pullRequest.refs?.base.owner, 'myorg');
		assert.equal(pullRequest.repository?.owner, 'myorg');
	});

	test('names the configured collection as the owner on an Azure DevOps Server', () => {
		const pullRequest = fromAzurePullRequest(
			pr(
				'https://server.example/tfs/DefaultCollection/project-id/_apis/git/repositories/repository-id/pullRequests/5',
				'Proj',
				'repo',
			),
			azureProvider,
			'DefaultCollection',
			'https://server.example/tfs',
			undefined,
		);

		assert.equal(pullRequest.refs?.base.url, 'https://server.example/tfs/DefaultCollection/Proj/_git/repo');
		assert.equal(pullRequest.refs?.base.owner, 'DefaultCollection');
		assert.equal(pullRequest.repository?.owner, 'DefaultCollection');
	});

	test('uses the resolved fork url for the head ref', () => {
		const azurePullRequest = pr(
			'https://dev.azure.com/myorg/project-id/_apis/git/repositories/repository-id/pullRequests/5',
			'My Project',
			'my repo',
		);
		azurePullRequest.forkSource = createAzureForkSource(azurePullRequest);

		const pullRequest = fromAzurePullRequest(azurePullRequest, azureProvider, 'myorg', 'https://dev.azure.com', {
			url: 'https://dev.azure.com/myorg/Fork%20Project/_git/fork%20repo',
			cloneHttps: undefined,
		});

		assert.equal(pullRequest.refs?.base.url, 'https://dev.azure.com/myorg/My%20Project/_git/my%20repo');
		assert.equal(pullRequest.refs?.head.url, 'https://dev.azure.com/myorg/Fork%20Project/_git/fork%20repo');
		assert.equal(pullRequest.refs?.head.repo, 'fork repo');
		assert.equal(pullRequest.refs?.head.owner, 'myorg');
	});

	test('carries the clone url of each ref, taken from the resolved fork for the head', () => {
		const azurePullRequest = pr(
			'https://dev.azure.com/myorg/project-id/_apis/git/repositories/repository-id/pullRequests/5',
			'My Project',
			'my repo',
		);
		azurePullRequest.repository.remoteUrl = 'https://dev.azure.com/myorg/My%20Project/_git/my%20repo';
		azurePullRequest.forkSource = createAzureForkSource(azurePullRequest);

		const pullRequest = fromAzurePullRequest(azurePullRequest, azureProvider, 'myorg', 'https://dev.azure.com', {
			url: 'https://dev.azure.com/myorg/Fork%20Project/_git/fork%20repo',
			cloneHttps: 'https://dev.azure.com/myorg/Fork%20Project/_git/fork%20repo',
		});

		assert.equal(pullRequest.refs?.base.cloneHttps, 'https://dev.azure.com/myorg/My%20Project/_git/my%20repo');
		assert.equal(pullRequest.refs?.head.cloneHttps, 'https://dev.azure.com/myorg/Fork%20Project/_git/fork%20repo');
	});

	test('reports the same clone url on both refs of a same-repository pull request', () => {
		const azurePullRequest = pr(
			'https://dev.azure.com/myorg/project-id/_apis/git/repositories/repository-id/pullRequests/5',
			'Proj',
			'repo',
		);
		azurePullRequest.repository.remoteUrl = 'https://dev.azure.com/myorg/Proj/_git/repo';

		const pullRequest = fromAzurePullRequest(
			azurePullRequest,
			azureProvider,
			'myorg',
			'https://dev.azure.com',
			undefined,
		);

		assert.equal(pullRequest.refs?.base.cloneHttps, 'https://dev.azure.com/myorg/Proj/_git/repo');
		assert.equal(pullRequest.refs?.head.cloneHttps, 'https://dev.azure.com/myorg/Proj/_git/repo');
	});

	// Under the right collection but naming a different repository: the collection check passes, so only the
	// cross-check against the repository the payload itself names stops `cloneHttps` and `url` disagreeing.
	test('drops a clone url that names another repository in the same organization', () => {
		const azurePullRequest = pr(
			'https://dev.azure.com/myorg/project-id/_apis/git/repositories/repository-id/pullRequests/5',
			'My Project',
			'my repo',
		);
		azurePullRequest.repository.remoteUrl = 'https://dev.azure.com/myorg/OtherProject/_git/OtherRepo';

		const pullRequest = fromAzurePullRequest(
			azurePullRequest,
			azureProvider,
			'myorg',
			'https://dev.azure.com',
			undefined,
		);

		assert.equal(pullRequest.refs?.base.url, 'https://dev.azure.com/myorg/My%20Project/_git/my%20repo');
		assert.equal(pullRequest.refs?.base.cloneHttps, undefined);
	});

	// Azure shortens a clone url to `{owner}/_git/{repo}` when a repository carries its project's name, and the
	// legacy host spells no organization at all — both are the repository the payload names, so both stand.
	test('keeps a clone url spelled in a form that names no project', () => {
		for (const [remoteUrl, expected] of [
			['https://dev.azure.com/myorg/_git/repo', 'https://dev.azure.com/myorg/_git/repo'],
			['https://myorg.visualstudio.com/_git/repo', 'https://myorg.visualstudio.com/_git/repo'],
		]) {
			const azurePullRequest = pr(
				'https://dev.azure.com/myorg/project-id/_apis/git/repositories/repository-id/pullRequests/5',
				'repo',
				'repo',
			);
			azurePullRequest.repository.remoteUrl = remoteUrl;

			const pullRequest = fromAzurePullRequest(
				azurePullRequest,
				azureProvider,
				'myorg',
				'https://dev.azure.com',
				undefined,
			);

			assert.equal(pullRequest.refs?.base.cloneHttps, expected, remoteUrl);
		}
	});

	// Azure permits a space and a reserved character in a repository name, so the comparison has to decode the
	// segment; it also resolves names case-insensitively, so it must not be stricter than the provider.
	test('matches an encoded or differently-cased repository name in a clone url', () => {
		for (const remoteUrl of [
			'https://dev.azure.com/myorg/My%20Project/_git/my%20repo',
			'https://dev.azure.com/myorg/My%20Project/_git/MY%20REPO',
		]) {
			const azurePullRequest = pr(
				'https://dev.azure.com/myorg/project-id/_apis/git/repositories/repository-id/pullRequests/5',
				'My Project',
				'my repo',
			);
			azurePullRequest.repository.remoteUrl = remoteUrl;

			const pullRequest = fromAzurePullRequest(
				azurePullRequest,
				azureProvider,
				'myorg',
				'https://dev.azure.com',
				undefined,
			);

			assert.equal(pullRequest.refs?.base.cloneHttps, remoteUrl, remoteUrl);
		}
	});

	// A url that is not a repository url at all — no `_git` boundary, or a stray percent escape that cannot be
	// decoded — names nothing that can be compared, so it is refused rather than passed through.
	test('drops a clone url that carries no _git boundary or cannot be decoded', () => {
		for (const remoteUrl of [
			'https://dev.azure.com/myorg/My%20Project/my%20repo',
			'https://dev.azure.com/myorg/My%20Project/_git/',
			'https://dev.azure.com/myorg/My%20Project/_git/my%ZZrepo',
		]) {
			const azurePullRequest = pr(
				'https://dev.azure.com/myorg/project-id/_apis/git/repositories/repository-id/pullRequests/5',
				'My Project',
				'my repo',
			);
			azurePullRequest.repository.remoteUrl = remoteUrl;

			const pullRequest = fromAzurePullRequest(
				azurePullRequest,
				azureProvider,
				'myorg',
				'https://dev.azure.com',
				undefined,
			);

			assert.equal(pullRequest.refs?.base.cloneHttps, undefined, remoteUrl);
		}
	});

	// The clone url is the one repository url still taken from the payload, so it carries the same trust boundary as
	// the fork url the lookup resolves — a consumer fetches from it.
	test('drops a clone url that names a host or organization the integration never asked for', () => {
		for (const remoteUrl of [
			'https://attacker.invalid/myorg/Proj/_git/repo',
			'https://dev.azure.com/attacker/Proj/_git/repo',
			'not-a-url',
		]) {
			const azurePullRequest = pr(
				'https://dev.azure.com/myorg/project-id/_apis/git/repositories/repository-id/pullRequests/5',
				'Proj',
				'repo',
			);
			azurePullRequest.repository.remoteUrl = remoteUrl;

			const pullRequest = fromAzurePullRequest(
				azurePullRequest,
				azureProvider,
				'myorg',
				'https://dev.azure.com',
				undefined,
			);

			assert.equal(pullRequest.refs?.base.url, 'https://dev.azure.com/myorg/Proj/_git/repo');
			assert.equal(pullRequest.refs?.base.cloneHttps, undefined, remoteUrl);
		}
	});

	test('strips the credentials Azure spells into a clone url', () => {
		const azurePullRequest = pr(
			'https://dev.azure.com/myorg/project-id/_apis/git/repositories/repository-id/pullRequests/5',
			'Proj',
			'repo',
		);
		azurePullRequest.repository.remoteUrl = 'https://myorg@dev.azure.com/myorg/Proj/_git/repo';

		const pullRequest = fromAzurePullRequest(
			azurePullRequest,
			azureProvider,
			'myorg',
			'https://dev.azure.com',
			undefined,
		);

		assert.equal(pullRequest.refs?.base.cloneHttps, 'https://dev.azure.com/myorg/Proj/_git/repo');
	});

	test('leaves the clone urls unset when the payload reports no remote url', () => {
		const pullRequest = fromAzurePullRequest(
			pr(
				'https://dev.azure.com/myorg/project-id/_apis/git/repositories/repository-id/pullRequests/5',
				'Proj',
				'repo',
			),
			azureProvider,
			'myorg',
			'https://dev.azure.com',
			undefined,
		);

		assert.equal(pullRequest.refs?.base.cloneHttps, undefined);
		assert.equal(pullRequest.refs?.head.cloneHttps, undefined);
	});

	test('returns the pull request with no head url when the fork url was not resolved', () => {
		const azurePullRequest = pr(
			'https://dev.azure.com/myorg/project-id/_apis/git/repositories/repository-id/pullRequests/5',
			'My Project',
			'my repo',
		);
		azurePullRequest.forkSource = createAzureForkSource(
			azurePullRequest,
			'https://dev.azure.com/myorg/Fork%20Project/_git/fork%20repo',
		);

		const pullRequest = fromAzurePullRequest(
			azurePullRequest,
			azureProvider,
			'myorg',
			'https://dev.azure.com',
			undefined,
		);

		assert.equal(pullRequest.refs?.base.url, 'https://dev.azure.com/myorg/My%20Project/_git/my%20repo');
		assert.equal(pullRequest.refs?.head.url, undefined);
		assert.equal(pullRequest.refs?.head.branch, 'feature');
	});
});

suite('sanitizeAzureRepositoryUrl', () => {
	test('returns undefined for a value that is not a url', () => {
		assert.equal(sanitizeAzureRepositoryUrl('not-a-valid-url', 'https://dev.azure.com', 'myorg'), undefined);
	});

	test('strips credentials, query and fragment from an accepted url', () => {
		const url = new URL('https://dev.azure.com/myorg/Project/_git/Repo?token=secret#fragment');
		url.username = 'bot';
		url.password = 'pat';

		assert.equal(
			sanitizeAzureRepositoryUrl(url.toString(), 'https://dev.azure.com', 'myorg'),
			'https://dev.azure.com/myorg/Project/_git/Repo',
		);
	});

	test('accepts the legacy visualstudio.com alias only within the same organization', () => {
		assert.equal(
			sanitizeAzureRepositoryUrl(
				'https://myorg.visualstudio.com/Project/_git/Repo',
				'https://dev.azure.com',
				'myorg',
			),
			'https://myorg.visualstudio.com/Project/_git/Repo',
		);
		assert.equal(
			sanitizeAzureRepositoryUrl(
				'https://attacker.visualstudio.com/Project/_git/Repo',
				'https://dev.azure.com',
				'myorg',
			),
			undefined,
		);
		assert.equal(
			sanitizeAzureRepositoryUrl(
				'https://myorg.attacker.visualstudio.com/Project/_git/Repo',
				'https://dev.azure.com',
				'myorg',
			),
			undefined,
		);
	});

	test('rejects another organization sharing the expected origin', () => {
		assert.equal(
			sanitizeAzureRepositoryUrl(
				'https://dev.azure.com/attacker/Project/_git/Repo',
				'https://dev.azure.com',
				'myorg',
			),
			undefined,
		);
		// A prefix of the organization's name is a different organization, not a sub-path of it.
		assert.equal(
			sanitizeAzureRepositoryUrl(
				'https://dev.azure.com/myorgtoo/Project/_git/Repo',
				'https://dev.azure.com',
				'myorg',
			),
			undefined,
		);
		assert.equal(
			sanitizeAzureRepositoryUrl('https://dev.azure.com/myorg/Other/_git/Repo', 'https://dev.azure.com', 'myorg'),
			'https://dev.azure.com/myorg/Other/_git/Repo',
		);
	});

	test('compares the organization case-insensitively and percent-encoded', () => {
		assert.equal(
			sanitizeAzureRepositoryUrl(
				'https://dev.azure.com/MyOrg/Project/_git/Repo',
				'https://dev.azure.com',
				'myorg',
			),
			'https://dev.azure.com/MyOrg/Project/_git/Repo',
		);
		assert.equal(
			sanitizeAzureRepositoryUrl('https://dev.azure.com/my%20org/P/_git/R', 'https://dev.azure.com', 'my org'),
			'https://dev.azure.com/my%20org/P/_git/R',
		);
	});

	test('keeps a self-hosted url under its own collection and rejects anywhere else', () => {
		assert.equal(
			sanitizeAzureRepositoryUrl(
				'https://azure.example.com:8080/tfs/DefaultCollection/Project/_git/Repo',
				'https://azure.example.com:8080/tfs',
				'DefaultCollection',
			),
			'https://azure.example.com:8080/tfs/DefaultCollection/Project/_git/Repo',
		);
		// Another collection on the same server is somewhere we didn't ask.
		assert.equal(
			sanitizeAzureRepositoryUrl(
				'https://azure.example.com:8080/tfs/OtherCollection/Project/_git/Repo',
				'https://azure.example.com:8080/tfs',
				'DefaultCollection',
			),
			undefined,
		);
		assert.equal(
			sanitizeAzureRepositoryUrl(
				'https://azure.example.com/tfs/DefaultCollection/Project/_git/Repo',
				'https://azure.example.com:8080/tfs',
				'DefaultCollection',
			),
			undefined,
		);
	});

	test('is not fooled by userinfo naming the expected host', () => {
		assert.equal(
			sanitizeAzureRepositoryUrl(
				'https://dev.azure.com@attacker.example/Project/_git/Repo',
				'https://dev.azure.com',
				'myorg',
			),
			undefined,
		);
	});
});
