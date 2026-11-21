import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { GitCloudHostIntegrationId, IssuesCloudHostIntegrationId } from '../constants.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { connectedGitHub, connectedGitLab } from './sweepHelpers.js';

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } });
}

suite('IntegrationManager.getPullRequestCheckLogs', () => {
	test('answers each target under its key with a log or a reason, and drops only the target whose read failed', async () => {
		const runtime = createFakeRuntime();
		const urls: string[] = [];
		const storage = 'https://storage.example/job.log';
		const log = new TextEncoder().encode('one\ntwo\n');
		runtime.http.fetch = (url, init) => {
			urls.push(String(url));
			if (String(url) === storage) {
				const range = new Headers(init?.headers).get('range');
				return Promise.resolve(
					range === 'bytes=0-0'
						? new Response(log.slice(0, 1), { status: 206, headers: { 'content-range': 'bytes 0-0/8' } })
						: new Response(log, { status: 206, headers: { 'content-range': 'bytes 0-7/8' } }),
				);
			}
			if (String(url).endsWith('/jobs/1/logs')) {
				return Promise.resolve(new Response(null, { status: 302, headers: { location: storage } }));
			}
			return Promise.resolve(json(429, { message: 'API rate limit exceeded' }));
		};
		const { manager } = await connectedGitHub(runtime);

		const result = await manager.getPullRequestCheckLogs({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'job', owner: 'o', repo: 'r', checkRunId: 'a:1' },
				{ key: 'status', owner: 'o', repo: 'r', checkRunId: 's:SC_1' },
				{ key: 'limited', owner: 'o', repo: 'r', checkRunId: 'a:2' },
			],
		});

		assert.deepEqual(result.items, [
			{ key: 'job', log: { text: 'one\ntwo', lineCount: 2, truncated: false, source: 'actions-job-log' } },
			{ key: 'status', unavailable: 'no-log' },
		]);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);
		assert.equal(result.warnings[0].kind, 'rate-limit');
		assert.deepEqual(result.warnings[0].targetKeys, ['limited']);
		assert.equal(urls.length, 4);

		const alone = await manager.getPullRequestCheckLogs({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [{ key: 'limited', owner: 'o', repo: 'r', checkRunId: 'a:2' }],
		});
		assert.deepEqual(alone.items, []);
		assert.equal(alone.fetchFailed, true);
		assert.equal(alone.warnings.length, 1);
		assert.equal(alone.warnings[0].kind, 'rate-limit');
		assert.deepEqual(alone.warnings[0].targetKeys, ['limited']);

		manager.dispose();
	});

	test('refuses the whole call, without a request, on a duplicate key, an id no read returned or a bad tailLines', async () => {
		const runtime = createFakeRuntime();
		let requests = 0;
		runtime.http.fetch = () => {
			requests++;
			return Promise.resolve(json(500, {}));
		};
		const { manager } = await connectedGitHub(runtime);
		const target = { key: 'a', owner: 'o', repo: 'r', checkRunId: 'a:1' };

		const calls: [Parameters<typeof manager.getPullRequestCheckLogs>[0], RegExp][] = [
			[{ providerId: GitCloudHostIntegrationId.GitHub, targets: [target, target] }, /Duplicate check log/],
			[
				{ providerId: GitCloudHostIntegrationId.GitHub, targets: [{ ...target, checkRunId: 'a:x' }] },
				/check run id 'a:x'/,
			],
			[
				{ providerId: GitCloudHostIntegrationId.GitHub, targets: [{ ...target, checkRunId: '1234' }] },
				/check run id '1234'/,
			],
			...[0, 2001, 1.5].map((tailLines): [Parameters<typeof manager.getPullRequestCheckLogs>[0], RegExp] => [
				{ providerId: GitCloudHostIntegrationId.GitHub, targets: [target], tailLines: tailLines },
				/tailLines/,
			]),
		];
		for (const [options, message] of calls) {
			const result = await manager.getPullRequestCheckLogs(options);
			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.equal(result.warnings.length, 1);
			assert.equal(result.warnings[0].kind, 'other');
			assert.match(result.warnings[0].message, message);
		}
		assert.equal(requests, 0);

		manager.dispose();
	});

	test('refuses every provider but GitHub and GitHub Enterprise as unsupported', async () => {
		const { manager } = await connectedGitLab(createFakeRuntime());
		const targets = [{ key: 'a', owner: 'o', repo: 'r', checkRunId: 'a:1' }];

		for (const providerId of [GitCloudHostIntegrationId.GitLab, IssuesCloudHostIntegrationId.Jira]) {
			const result = await manager.getPullRequestCheckLogs({ providerId: providerId, targets: targets });
			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.equal(result.warnings[0].kind, 'unsupported');
			assert.match(result.warnings[0].message, /not supported/);
		}

		manager.dispose();
	});
});
