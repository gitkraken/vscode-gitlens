import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { Issue, IssueShape } from '@gitlens/git/models/issue.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import { createIntegrationManager } from '../index.js';
import type { IssuesIntegration } from '../models/issuesIntegration.js';
import type { ProviderIssue } from '../providers/models.js';
import { getIssueFromGitConfigEntityIdentifier } from '../providers/utils.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Verifies the Linear issue reads implemented for #5438: getProviderIssuesForProject reads a team's issues
 * (Linear's "project" descriptor is a team) and getProviderAccountForResource resolves the viewer — both
 * previously threw 'Method not implemented.', which made every Linear read surface as a failure.
 */

function linearSession(): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: 'tok',
		account: { id: 'me', label: 'me' },
		scopes: [],
		cloud: true,
		type: 'oauth',
		domain: 'linear.app',
	};
}

function stubApi(integration: IssuesIntegration, api: Record<string, unknown>): void {
	(integration as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () =>
		Promise.resolve(api);
}

function fakeLinearIssue(id: string, assignee?: { id: string; name: string }): ProviderIssue {
	return {
		id: id,
		number: id,
		title: `Issue ${id}`,
		url: `https://linear.app/i/${id}`,
		createdDate: new Date(0),
		updatedDate: new Date(0),
		closedDate: null,
		author: { id: 'a', name: 'A', avatarUrl: null, url: null },
		assignees: assignee != null ? [{ id: assignee.id, name: assignee.name, avatarUrl: null, url: null }] : [],
		labels: [],
	} as unknown as ProviderIssue;
}

suite('Linear issue reads (#5438)', () => {
	test('getIssuesForProject reads the team issues and maps them to issue shapes', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const linear = await manager.get(IssuesCloudHostIntegrationId.Linear);
		(linear as unknown as { _session: ProviderAuthenticationSession })._session = linearSession();

		let capturedTeams: string[] | undefined;
		stubApi(linear, {
			getLinearIssues: (_t: unknown, input: { teams?: string[] }) => {
				capturedTeams = input.teams;
				return Promise.resolve({ values: [fakeLinearIssue('1')], paging: { more: false, cursor: '{}' } });
			},
		});

		const issues = await linear.getIssuesForProject({ key: 't1', id: 't1', name: 'Team 1' });
		assert.equal(issues?.length, 1, 'the team issues are mapped');
		assert.deepEqual(capturedTeams, ['t1'], 'scoped to the team id');

		manager.dispose();
	});

	test('getIssuesForProject scopes to the assignee client-side when a user is given', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const linear = await manager.get(IssuesCloudHostIntegrationId.Linear);
		(linear as unknown as { _session: ProviderAuthenticationSession })._session = linearSession();

		stubApi(linear, {
			// Assignee `name` (full name) deliberately differs from the viewer id, since the filter must match
			// on the stable Linear user id, not a display/name string (name vs displayName diverge in Linear).
			getLinearIssues: () =>
				Promise.resolve({
					values: [
						fakeLinearIssue('1', { id: 'u1', name: 'Ada Lovelace' }),
						fakeLinearIssue('2', { id: 'u2', name: 'Someone Else' }),
					],
					paging: { more: false, cursor: '{}' },
				}),
			getLinearCurrentUser: () =>
				Promise.resolve({ id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', displayName: 'ada' }),
		});

		// `user` is the displayName ('ada'), which does NOT equal the assignee's name ('Ada Lovelace'); the
		// filter must still match via the resolved viewer id (u1).
		const issues = await linear.getIssuesForProject({ key: 't1', id: 't1', name: 'Team 1' }, { user: 'ada' });
		assert.equal(issues?.length, 1, 'only the current user (by id) issue survives, despite name≠displayName');
		assert.equal(issues?.[0].id, '1');

		manager.dispose();
	});

	test('getIssuesForProject surfaces an error (not [] and not the unfiltered issues) when the viewer is unresolved', async () => {
		// Regression guard for the "my-issues leak": when a user scope is requested but the current viewer
		// can't be resolved, returning the unfiltered team issues would leak everyone else's, and returning []
		// is indistinguishable from "no issues assigned to me". This has regressed twice along this axis, so
		// pin that it surfaces an error the facade can turn into a warning + fetchFailed.
		const manager = createIntegrationManager(createFakeRuntime());
		const linear = await manager.get(IssuesCloudHostIntegrationId.Linear);
		(linear as unknown as { _session: ProviderAuthenticationSession })._session = linearSession();

		stubApi(linear, {
			getLinearIssues: () =>
				Promise.resolve({
					values: [
						fakeLinearIssue('1', { id: 'u1', name: 'Ada Lovelace' }),
						fakeLinearIssue('2', { id: 'u2', name: 'Someone Else' }),
					],
					paging: { more: false, cursor: '{}' },
				}),
			// Viewer resolves to an id-less object → cannot scope to "my issues".
			getLinearCurrentUser: () => Promise.resolve(undefined),
		});

		// The result-returning core recovers the throw into { error } (no leaked issues, distinguishable from
		// a genuinely empty read).
		const result = await (
			linear as unknown as {
				getIssuesForProjectResult: (
					p: ResourceDescriptor,
					o?: { user?: string },
				) => Promise<{ value?: IssueShape[]; error?: unknown }>;
			}
		).getIssuesForProjectResult({ key: 't1', id: 't1', name: 'Team 1' }, { user: 'ada' });
		assert.equal(result.value, undefined, 'no issues leak when the viewer is unresolved');
		assert.ok(result.error != null, 'an unresolved viewer is surfaced as an error, not a silent empty');

		manager.dispose();
	});

	test('getAccountForResource resolves the viewer', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const linear = await manager.get(IssuesCloudHostIntegrationId.Linear);
		(linear as unknown as { _session: ProviderAuthenticationSession })._session = linearSession();

		stubApi(linear, {
			getLinearCurrentUser: () =>
				Promise.resolve({ id: 'u1', name: 'Me', email: 'me@example.com', displayName: 'me' }),
		});

		const account = await linear.getAccountForResource({ key: 't1', id: 't1', name: 'Team 1' });
		assert.equal(account?.id, 'u1');
		assert.equal(account?.username, 'me');

		manager.dispose();
	});

	test('cached Linear branch-association lookups fall back from the persisted UUID to the identifier (#5570)', async () => {
		// A pre-#5567 Linear association carries the UUID in `metadata.id` (Issue.id used to be the Linear
		// UUID), while fresh cache entries key by the human identifier (`DRE-2`). The cached path must peek
		// both keys so upgraded users don't lose still-cached associations.
		const identifier = {
			provider: 'linear',
			entityType: 'issue',
			version: '1',
			domain: null,
			// The UUID survives in `entityId` (encoded from `nodeId`), matching newly encoded identifiers.
			entityId: 'uuid-123',
			accountOrOrgId: null,
			organizationName: null,
			projectId: null,
			repoId: null,
			resourceId: null,
			metadata: {
				// Legacy generation: the UUID, not the identifier.
				id: 'uuid-123',
				owner: { key: 't1', id: 't1', name: 'Team 1', owner: undefined },
				createdDate: new Date(0).toISOString(),
				isCloudEnterprise: false,
			},
		} as unknown as Parameters<typeof getIssueFromGitConfigEntityIdentifier>[1];

		const cachedIssue = { id: 'DRE-2', nodeId: 'uuid-123', type: 'issue' } as unknown as Issue;
		const peekedIds: string[] = [];
		const resolved = await getIssueFromGitConfigEntityIdentifier(async () => undefined, identifier, {
			cached: true,
			peekCachedIssue: (_integration, _resource, id) => {
				peekedIds.push(id);
				// The fresh cache is keyed by the identifier-generation key (the UUID via entityId here,
				// since new encodes carry the identifier in metadata.id and the UUID in entityId).
				return id === 'uuid-123' && peekedIds.length === 2 ? cachedIssue : undefined;
			},
		});

		assert.deepEqual(peekedIds, ['uuid-123', 'uuid-123'], 'both id generations are peeked');
		assert.equal(resolved, cachedIssue);
	});

	test('cached Linear lookups peek the identifier-generation entityId after a metadata.id miss (#5570)', async () => {
		// New-generation association: identifier in `metadata.id`, UUID in `entityId`. A cache still keyed by
		// the UUID (entries written pre-upgrade) must be reachable through the second peek.
		const identifier = {
			provider: 'linear',
			entityType: 'issue',
			version: '1',
			domain: null,
			entityId: 'uuid-123',
			accountOrOrgId: null,
			organizationName: null,
			projectId: null,
			repoId: null,
			resourceId: null,
			metadata: {
				id: 'DRE-2',
				owner: { key: 't1', id: 't1', name: 'Team 1', owner: undefined },
				createdDate: new Date(0).toISOString(),
				isCloudEnterprise: false,
			},
		} as unknown as Parameters<typeof getIssueFromGitConfigEntityIdentifier>[1];

		const cachedIssue = { id: 'DRE-2', nodeId: 'uuid-123', type: 'issue' } as unknown as Issue;
		const peekedIds: string[] = [];
		const resolved = await getIssueFromGitConfigEntityIdentifier(async () => undefined, identifier, {
			cached: true,
			peekCachedIssue: (_integration, _resource, id) => {
				peekedIds.push(id);
				return id === 'uuid-123' ? cachedIssue : undefined;
			},
		});

		assert.deepEqual(peekedIds, ['DRE-2', 'uuid-123'], 'the UUID-keyed cache entry is found on the second peek');
		assert.equal(resolved, cachedIssue);
	});
});
