import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId, IssuesCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { IntegrationResult } from '../models/integration.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { connectedGitHub } from './sweepHelpers.js';

/**
 * The batch issue read (#5802): resolve N `(owner, repo, number)` coordinates in one request.
 *
 * What these pin is the distinction the read exists for — an absent slot is a PROVEN ABSENCE, safe to cache,
 * while a target whose chunk failed is not returned at all. Conflating the two is the bug this contract prevents:
 * a caller that caches a failure as an absence never re-resolves the issue.
 */

type BatchFn = (
	coordinates: readonly { owner: string; repo: string; number: number }[],
	cancellation?: AbortSignal,
	connectionId?: string,
) => Promise<IntegrationResult<(IssueShape | undefined)[] | undefined>>;

function stubBatch(integration: GitHostIntegration, fn: BatchFn): void {
	(integration as unknown as { getIssuesBatchResult: BatchFn }).getIssuesBatchResult = fn;
}

const issue = (n: number) => ({ id: `i${n}`, title: `issue ${n}` }) as unknown as IssueShape;

suite('IntegrationManager.getIssuesBatch (#5802)', () => {
	test('resolves every coordinate in one request and echoes the caller keys', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		let calls = 0;
		let received: readonly { owner: string; repo: string; number: number }[] = [];
		stubBatch(gh, coordinates => {
			calls++;
			received = coordinates;
			return Promise.resolve({ value: coordinates.map(c => issue(c.number)) });
		});

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'left', owner: 'o', repo: 'a', number: 1 },
				{ key: 'right', owner: 'o', repo: 'b', number: 2 },
			],
		});

		assert.equal(calls, 1, 'a batch that fits a chunk costs exactly one request');
		assert.deepEqual(
			received.map(c => c.number),
			[1, 2],
		);
		assert.deepEqual(
			result.items.map(i => [i.key, i.issue?.id]),
			[
				['left', 'i1'],
				['right', 'i2'],
			],
			'results carry the caller key, not a position',
		);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('an absent issue is returned as a proven absence, not dropped', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		stubBatch(gh, coordinates =>
			Promise.resolve({ value: coordinates.map(c => (c.number === 2 ? undefined : issue(c.number))) }),
		);

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'exists', owner: 'o', repo: 'a', number: 1 },
				{ key: 'gone', owner: 'o', repo: 'a', number: 2 },
			],
		});

		// The absent target IS present in the results with no issue: that is what makes the miss cacheable.
		assert.deepEqual(
			result.items.map(i => i.key),
			['exists', 'gone'],
		);
		assert.equal(result.items[1].issue, undefined);
		assert.equal(result.fetchFailed, undefined, 'a proven absence is not a failure');

		manager.dispose();
	});

	test('a failed chunk drops only its own targets and never reports them as absent', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		// 30 targets split into two chunks; the chunk holding number 1 fails.
		stubBatch(gh, coordinates =>
			coordinates.some(c => c.number === 1)
				? Promise.resolve({ error: new Error('batch boom') })
				: Promise.resolve({ value: coordinates.map(c => issue(c.number)) }),
		);

		const targets = Array.from({ length: 30 }, (_, i) => ({
			key: `k${i + 1}`,
			owner: 'o',
			repo: 'a',
			number: i + 1,
		}));
		const result = await manager.getIssuesBatch({ providerId: GitCloudHostIntegrationId.GitHub, targets: targets });

		assert.equal(result.fetchFailed, true, 'the failure is surfaced');
		assert.ok(result.warnings.length > 0);
		assert.equal(result.items.length, 5, 'only the surviving chunk answers');
		assert.ok(
			!result.items.some(i => i.key === 'k1'),
			'a target whose chunk failed is absent from the results, NOT reported as a proven absence',
		);

		manager.dispose();
	});

	test('refuses the whole call on a duplicate key rather than answering ambiguously', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		let calls = 0;
		stubBatch(gh, coordinates => {
			calls++;
			return Promise.resolve({ value: coordinates.map(c => issue(c.number)) });
		});

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'same', owner: 'o', repo: 'a', number: 1 },
				{ key: 'same', owner: 'o', repo: 'a', number: 2 },
			],
		});

		assert.equal(calls, 0, 'the refusal costs no upstream request');
		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.match(result.warnings[0].message, /Duplicate issue batch target key/);

		manager.dispose();
	});

	test('no targets is an empty success, not a refusal', async () => {
		const { manager } = await connectedGitHub(createFakeRuntime());

		const result = await manager.getIssuesBatch({ providerId: GitCloudHostIntegrationId.GitHub, targets: [] });

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, undefined);
		assert.deepEqual(result.warnings, []);

		manager.dispose();
	});

	test('a provider that cannot batch refuses rather than degrading into N requests', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		// What a provider with no batch hook answers: `undefined` with no error.
		stubBatch(gh, () => Promise.resolve({ value: undefined }));

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [{ key: 'a', owner: 'o', repo: 'a', number: 1 }],
		});

		assert.deepEqual(result.items, [], 'nothing is invented for the caller');
		assert.equal(result.fetchFailed, true);
		assert.match(result.warnings[0].message, /not supported/i);

		manager.dispose();
	});

	test('reports an issue tracker as the wrong surface instead of attempting it', async () => {
		const manager = createIntegrationManager(createFakeRuntime());

		const result = await manager.getIssuesBatch({
			providerId: IssuesCloudHostIntegrationId.Linear,
			targets: [{ key: 'a', owner: 'o', repo: 'a', number: 1 }],
		});

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.match(result.warnings[0].message, /not supported/i);

		manager.dispose();
	});

	test('a lost session is reported, not answered as a batch of absences', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession | undefined })._session = undefined;
		// What the read core returns when it cannot resolve a session.
		stubBatch(gh, () => Promise.resolve(undefined));

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [{ key: 'a', owner: 'o', repo: 'a', number: 1 }],
			connectionId: 'gone',
		});

		assert.deepEqual(result.items, [], 'no target is reported as proven absent');
		assert.equal(result.fetchFailed, true);

		manager.dispose();
	});
});
