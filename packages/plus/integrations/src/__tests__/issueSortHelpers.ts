import * as assert from 'node:assert/strict';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import type { GitCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Fixtures shared by the two issue-ordering test files: a session, the two seams the reads go through, and an
 * issue carrying the fields the comparator reads.
 *
 * Extracted rather than duplicated because `issue` is needed by both files — the read tests build pages out of it
 * and the comparator test builds pairs out of it — and a fixture copied twice is a fixture that stops matching the
 * shape under test in one of the copies.
 */

export type IntegrationManager = ReturnType<typeof createIntegrationManager>;

/**
 * Runs a body against a fresh manager and disposes it however the body ends.
 *
 * Every ordering test needs exactly this, and the `try`/`finally` around each one was four lines of ceremony for
 * every one line of assertion — enough that a test written without the `finally` would have leaked a manager
 * without looking any different from its neighbours.
 */
export async function withManager<T>(body: (manager: IntegrationManager) => Promise<T> | T): Promise<T> {
	const manager = createIntegrationManager(createFakeRuntime());
	try {
		return await body(manager);
	} finally {
		manager.dispose();
	}
}

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

/**
 * The integration for a provider, with a session installed and its methods open to replacement.
 *
 * Returned as an index signature rather than the integration type: every stub below replaces one method with a
 * differently-shaped fake, which the real type rightly refuses. One cast here, described once, instead of a
 * six-line cast block per stub asserting the exact method it is about to overwrite anyway.
 */
async function connectedIntegration(
	manager: IntegrationManager,
	providerId: GitCloudHostIntegrationId,
): Promise<Record<string, unknown>> {
	const integration = await manager.get(providerId);
	assert.ok(integration != null);
	(integration as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

	return integration as unknown as Record<string, unknown>;
}

/** Stubs the repo-scoped shapes seam, recording the options the facade passed to it. */
export async function stubRepoScopedRead(
	manager: IntegrationManager,
	providerId: GitCloudHostIntegrationId,
	values: unknown[] = [],
): Promise<Record<string, unknown>[]> {
	const integration = await connectedIntegration(manager, providerId);
	const calls: Record<string, unknown>[] = [];
	integration.getMyIssuesForReposAsShapesResult = (_repos: unknown, options: Record<string, unknown>) => {
		calls.push(options);
		return Promise.resolve({ value: { values: values, paging: { more: false } } });
	};
	return calls;
}

/** Stubs the account-wide seam, recording the options the facade passed to it. */
export async function stubAccountWideRead(
	manager: IntegrationManager,
	providerId: GitCloudHostIntegrationId,
	values: unknown[] = [],
): Promise<Record<string, unknown>[]> {
	const integration = await connectedIntegration(manager, providerId);
	const calls: Record<string, unknown>[] = [];
	integration.searchMyIssuesWithTruncationResult = (
		_resources: unknown,
		_cancellation: unknown,
		_connectionId: unknown,
		options: Record<string, unknown>,
	) => {
		calls.push(options);
		return Promise.resolve({ value: { values: values, truncated: false, hasMore: false } });
	};
	return calls;
}

export function issue(title: string, fields: { updated?: string; created?: string; comments?: number }): IssueShape {
	return {
		type: 'issue',
		provider: { id: 'github', name: 'GitHub', domain: 'github.com', icon: 'github' },
		id: title,
		nodeId: undefined,
		title: title,
		url: `https://github.com/o/a/issues/${title}`,
		createdDate: new Date(fields.created ?? '2020-01-01T00:00:00Z'),
		updatedDate: new Date(fields.updated ?? '2020-01-01T00:00:00Z'),
		closed: false,
		state: 'opened',
		author: undefined,
		assignees: [],
		commentsCount: fields.comments,
	};
}
