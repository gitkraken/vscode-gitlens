import * as assert from 'assert';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../../../../../constants.integrations.js';
import type { ParsedIssueUrl } from '../issueUrl.utils.js';
import { parseIssueUrl } from '../issueUrl.utils.js';

suite('parseIssueUrl()', () => {
	suite('GitHub', () => {
		test('should parse standard issue URL', () => {
			const result = parseIssueUrl('https://github.com/gitkraken/vscode-gitlens/issues/1234');
			assert.deepStrictEqual(result, {
				type: 'gitHost',
				integrationId: GitCloudHostIntegrationId.GitHub,
				domain: 'github.com',
				owner: 'gitkraken',
				repo: 'vscode-gitlens',
				issueId: '1234',
			} satisfies ParsedIssueUrl);
		});

		test('should parse URL with trailing slash', () => {
			const result = parseIssueUrl('https://github.com/owner/repo/issues/42/');
			assert.ok(result);
			assert.strictEqual(result.type, 'gitHost');
			if (result.type === 'gitHost') {
				assert.strictEqual(result.issueId, '42');
			}
		});

		test('should return undefined for PR URL (not issue)', () => {
			const result = parseIssueUrl('https://github.com/owner/repo/pull/1');
			assert.strictEqual(result, undefined);
		});

		test('should return undefined for non-issue path', () => {
			const result = parseIssueUrl('https://github.com/owner/repo');
			assert.strictEqual(result, undefined);
		});
	});

	suite('GitLab', () => {
		test('should parse standard issue URL', () => {
			const result = parseIssueUrl('https://gitlab.com/mygroup/myproject/-/issues/99');
			assert.deepStrictEqual(result, {
				type: 'gitHost',
				integrationId: GitCloudHostIntegrationId.GitLab,
				domain: 'gitlab.com',
				owner: 'mygroup',
				repo: 'myproject',
				issueId: '99',
			} satisfies ParsedIssueUrl);
		});

		test('should handle nested groups', () => {
			const result = parseIssueUrl('https://gitlab.com/group/subgroup/project/-/issues/5');
			assert.ok(result);
			assert.strictEqual(result.type, 'gitHost');
			if (result.type === 'gitHost') {
				assert.strictEqual(result.owner, 'group/subgroup');
				assert.strictEqual(result.repo, 'project');
				assert.strictEqual(result.issueId, '5');
			}
		});

		test('should handle deeply nested groups', () => {
			const result = parseIssueUrl('https://gitlab.com/a/b/c/d/project/-/issues/1');
			assert.ok(result);
			assert.strictEqual(result.type, 'gitHost');
			if (result.type === 'gitHost') {
				assert.strictEqual(result.owner, 'a/b/c/d');
				assert.strictEqual(result.repo, 'project');
			}
		});
	});

	suite('Bitbucket', () => {
		test('should parse standard issue URL', () => {
			const result = parseIssueUrl('https://bitbucket.org/myteam/myrepo/issues/42');
			assert.deepStrictEqual(result, {
				type: 'gitHost',
				integrationId: GitCloudHostIntegrationId.Bitbucket,
				domain: 'bitbucket.org',
				owner: 'myteam',
				repo: 'myrepo',
				issueId: '42',
			} satisfies ParsedIssueUrl);
		});
	});

	suite('Azure DevOps', () => {
		test('should parse dev.azure.com work item URL', () => {
			const result = parseIssueUrl('https://dev.azure.com/myorg/myproject/_workitems/edit/123');
			assert.deepStrictEqual(result, {
				type: 'gitHost',
				integrationId: GitCloudHostIntegrationId.AzureDevOps,
				domain: 'dev.azure.com',
				owner: 'myorg',
				repo: 'myproject',
				issueId: '123',
			} satisfies ParsedIssueUrl);
		});

		test('should parse legacy VSTS URL', () => {
			const result = parseIssueUrl('https://myorg.visualstudio.com/MyProject/_workitems/edit/456');
			assert.ok(result);
			assert.strictEqual(result.type, 'gitHost');
			if (result.type === 'gitHost') {
				assert.strictEqual(result.integrationId, GitCloudHostIntegrationId.AzureDevOps);
				assert.strictEqual(result.owner, 'myorg');
				assert.strictEqual(result.repo, 'MyProject');
				assert.strictEqual(result.issueId, '456');
			}
		});
	});

	suite('Jira', () => {
		test('should parse standard Jira issue URL', () => {
			const result = parseIssueUrl('https://mycompany.atlassian.net/browse/PROJ-123');
			assert.deepStrictEqual(result, {
				type: 'issueProvider',
				integrationId: IssuesCloudHostIntegrationId.Jira,
				domain: 'mycompany.atlassian.net',
				issueId: 'PROJ-123',
			} satisfies ParsedIssueUrl);
		});

		test('should parse issue key with digits in project name', () => {
			const result = parseIssueUrl('https://org.atlassian.net/browse/AB2-99');
			assert.ok(result);
			assert.strictEqual(result.type, 'issueProvider');
			if (result.type === 'issueProvider') {
				assert.strictEqual(result.issueId, 'AB2-99');
			}
		});

		test('should return undefined for non-browse path', () => {
			const result = parseIssueUrl('https://org.atlassian.net/wiki/spaces/TEAM');
			assert.strictEqual(result, undefined);
		});
	});

	suite('Linear', () => {
		test('should parse standard Linear issue URL', () => {
			const result = parseIssueUrl('https://linear.app/myworkspace/issue/TEAM-456');
			assert.deepStrictEqual(result, {
				type: 'issueProvider',
				integrationId: IssuesCloudHostIntegrationId.Linear,
				domain: 'linear.app',
				issueId: 'TEAM-456',
			} satisfies ParsedIssueUrl);
		});

		test('should parse URL with trailing slash', () => {
			const result = parseIssueUrl('https://linear.app/ws/issue/ENG-1/');
			assert.ok(result);
			assert.strictEqual(result.type, 'issueProvider');
			if (result.type === 'issueProvider') {
				assert.strictEqual(result.issueId, 'ENG-1');
			}
		});
	});

	suite('Self-hosted (fallback)', () => {
		test('should parse GitHub Enterprise pattern for unknown domains', () => {
			const result = parseIssueUrl('https://github.internal.com/myorg/myrepo/issues/789');
			assert.ok(result);
			assert.strictEqual(result.type, 'gitHost');
			if (result.type === 'gitHost') {
				assert.strictEqual(result.integrationId, GitSelfManagedHostIntegrationId.CloudGitHubEnterprise);
				assert.strictEqual(result.domain, 'github.internal.com');
				assert.strictEqual(result.owner, 'myorg');
				assert.strictEqual(result.repo, 'myrepo');
				assert.strictEqual(result.issueId, '789');
			}
		});

		test('should parse GitLab Self-Hosted pattern for unknown domains', () => {
			const result = parseIssueUrl('https://gitlab.company.com/group/project/-/issues/10');
			assert.ok(result);
			assert.strictEqual(result.type, 'gitHost');
			if (result.type === 'gitHost') {
				assert.strictEqual(result.integrationId, GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted);
				assert.strictEqual(result.domain, 'gitlab.company.com');
			}
		});
	});

	suite('Invalid inputs', () => {
		test('should return undefined for invalid URL', () => {
			assert.strictEqual(parseIssueUrl('not-a-url'), undefined);
		});

		test('should return undefined for empty string', () => {
			assert.strictEqual(parseIssueUrl(''), undefined);
		});

		test('should return undefined for URL with no matching provider pattern', () => {
			assert.strictEqual(parseIssueUrl('https://example.com/something'), undefined);
		});

		test('should return undefined for GitHub URL with non-numeric issue ID', () => {
			assert.strictEqual(parseIssueUrl('https://github.com/owner/repo/issues/abc'), undefined);
		});
	});
});
