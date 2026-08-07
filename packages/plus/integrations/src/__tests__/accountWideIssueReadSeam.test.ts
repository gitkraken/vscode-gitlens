import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { IntegrationResult } from '../models/integration.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { connectedGitHub, primarySession, stubApi } from './sweepHelpers.js';

/**
 * The private `searchMyIssuesWithTruncationResult` seam both account-wide issue paths go through, covered
 * directly because neither contract is observable from the public read: it must stop draining the moment its
 * signal aborts, and it must refuse `includeAllAssignees` on a provider that cannot express it rather than
 * quietly running an unfiltered read (#5535).
 */

suite('account-wide issue read seam (#5535)', () => {
	test('GitLab account-wide issue read stops before fetching the next page after cancellation (#5535)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gl = await manager.get(GitCloudHostIntegrationId.GitLab);
		(gl as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'gitlab.com',
		};

		const controller = new AbortController();
		let calls = 0;
		stubApi(gl, {
			getIssuesForCurrentUser: () => {
				calls++;
				controller.abort();
				return Promise.resolve({
					values: [],
					paging: { more: true, cursor: JSON.stringify({ value: 2, type: 'page' }) },
				});
			},
		});

		const result = await (
			gl as unknown as {
				searchMyIssuesWithTruncationResult: (
					r?: unknown,
					c?: AbortSignal,
					id?: unknown,
					o?: { includeAllAssignees?: boolean },
				) => Promise<IntegrationResult<{ values: unknown[]; truncated: boolean }>>;
			}
		).searchMyIssuesWithTruncationResult(undefined, controller.signal, undefined, { includeAllAssignees: true });

		assert.equal(calls, 1, 'the drain does not fetch a second page after cancellation');
		assert.equal(result?.value, undefined);
		assert.equal(result?.error?.name, 'CancellationError');

		manager.dispose();
	});

	test('GitHub account-wide issue seam rejects includeAllAssignees instead of advertising an unsupported read (#5535)', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		const result = await (
			gh as unknown as {
				searchMyIssuesWithTruncationResult: (
					r?: unknown,
					c?: unknown,
					id?: unknown,
					o?: { includeAllAssignees?: boolean },
				) => Promise<IntegrationResult<{ values: unknown[]; truncated: boolean }>>;
			}
		).searchMyIssuesWithTruncationResult(undefined, undefined, undefined, { includeAllAssignees: true });

		assert.equal(result?.value, undefined);
		assert.match(result?.error?.message ?? '', /includeAllAssignees/i);
		assert.match(result?.error?.message ?? '', /account-wide issue reads/i);

		manager.dispose();
	});
});
