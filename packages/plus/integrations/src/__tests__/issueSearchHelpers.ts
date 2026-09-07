import * as assert from 'node:assert/strict';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import type { createIntegrationService as createIntegrationManager } from '../integrationService.js';

/**
 * Fixtures shared by the two filtered-issue-read test files: the session and the GitHub API seam both reads go
 * through.
 *
 * Extracted rather than duplicated because `stubGitHubApi` stubs BOTH seams in one call — the search and the
 * count — so each file would otherwise carry a copy that stubs one method it never uses, and a seam stub copied
 * twice is a stub that stops matching the method under test in one of the copies.
 */

export function primarySession(token: string, domain = 'github.com'): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: token,
		account: { id: 'me', label: 'me' },
		scopes: ['repo'],
		cloud: true,
		type: 'oauth',
		domain: domain,
	};
}

export type SearchPageResponse = {
	values: IssueShape[];
	truncated: boolean;
	hasMore: boolean;
	page: number;
	cursor?: string;
	totalCount?: number;
};

/** Stubs the GitHub API client's two filtered-issue methods, recording what the facade asked it for. */
export async function stubGitHubApi(
	manager: ReturnType<typeof createIntegrationManager>,
	stubs: {
		searchIssuesPage?: (options: Record<string, unknown>) => SearchPageResponse | undefined;
		countIssues?: (scopes: readonly Record<string, unknown>[]) => (number | undefined)[] | undefined;
	},
): Promise<{ searchCalls: Record<string, unknown>[]; countCalls: readonly Record<string, unknown>[][] }> {
	const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
	assert.ok(gh != null);
	(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

	const githubApi = await (
		gh as unknown as {
			authenticationService: { apis: { github: Promise<Record<string, unknown> | undefined> } };
		}
	).authenticationService.apis.github;
	assert.ok(githubApi);

	const searchCalls: Record<string, unknown>[] = [];
	const countCalls: Record<string, unknown>[][] = [];
	githubApi.searchIssuesPage = (_provider: unknown, _token: unknown, options: Record<string, unknown>) => {
		searchCalls.push(options);
		return Promise.resolve(stubs.searchIssuesPage?.(options));
	};
	githubApi.countIssues = (_provider: unknown, _token: unknown, scopes: Record<string, unknown>[]) => {
		countCalls.push(scopes);
		return Promise.resolve(stubs.countIssues?.(scopes));
	};

	return { searchCalls: searchCalls, countCalls: countCalls };
}
