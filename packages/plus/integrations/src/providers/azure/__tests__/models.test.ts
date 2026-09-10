import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { AzurePullRequest } from '../models.js';
import { getAzurePullRequestWebUrl } from '../models.js';

function pr(apiUrl: string, projectName: string, repoName: string): AzurePullRequest {
	return {
		url: apiUrl,
		pullRequestId: 5,
		repository: { name: repoName, project: { name: projectName } },
	} as unknown as AzurePullRequest;
}

suite('getAzurePullRequestWebUrl', () => {
	test('builds a dev.azure.com url without a double slash after the host', () => {
		assert.equal(
			getAzurePullRequestWebUrl(
				pr('https://dev.azure.com/myorg/Proj/_apis/git/repositories/abc/pullRequests/5', 'Proj', 'repo'),
			),
			'https://dev.azure.com/myorg/Proj/_git/repo/pullrequest/5',
		);
	});

	test('builds a visualstudio.com url without a double slash after the host', () => {
		assert.equal(
			getAzurePullRequestWebUrl(
				pr('https://myorg.visualstudio.com/Proj/_apis/git/repositories/abc/pullRequests/5', 'Proj', 'repo'),
			),
			'https://myorg.visualstudio.com/Proj/_git/repo/pullrequest/5',
		);
	});

	// The url cannot be relied on to spell the names, so they have to come off the model. The fixture addresses
	// both by id for that reason: one whose url already spelled them would pass even if the function scraped it.
	test('encodes project and repository names on dev.azure.com', () => {
		assert.equal(
			getAzurePullRequestWebUrl(
				pr(
					'https://dev.azure.com/my%20org/11111111-1111-1111-1111-111111111111/_apis/git/repositories/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/pullRequests/5',
					'My Project',
					'my repo',
				),
			),
			'https://dev.azure.com/my%20org/My%20Project/_git/my%20repo/pullrequest/5',
		);
	});

	test('encodes project and repository names on visualstudio.com', () => {
		assert.equal(
			getAzurePullRequestWebUrl(
				pr(
					'https://myorg.visualstudio.com/11111111-1111-1111-1111-111111111111/_apis/git/repositories/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/pullRequests/5',
					'My Project',
					'my repo',
				),
			),
			'https://myorg.visualstudio.com/My%20Project/_git/my%20repo/pullrequest/5',
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
				),
			),
			'https://dev.azure.com/myorg/R%26D/_git/c%2B%2B%20lib/pullrequest/5',
		);
	});
});
