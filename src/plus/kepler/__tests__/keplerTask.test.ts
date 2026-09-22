import * as assert from 'node:assert';
import * as sinon from 'sinon';
import { env, window } from 'vscode';
import type { Container } from '../../../container.js';
import type { KeplerTaskItem } from '../keplerTask.js';
import { getKeplerRepoPath, resolveKeplerTaskRequest, startKeplerTask } from '../keplerTask.js';

const githubPr: KeplerTaskItem = {
	kind: 'pr',
	url: 'https://github.com/gitkraken/vscode-gitlens/pull/1',
	provider: { id: 'github', name: 'GitHub' },
};

const repoPath = '/Users/keith/code/vscode-gitlens';

function makeContainer(sendEvent: sinon.SinonSpy): Container {
	return {
		kepler: { channel: 'staging', scheme: 'kepler-staging://' },
		telemetry: { sendEvent: sendEvent },
	} as unknown as Container;
}

suite('resolveKeplerTaskRequest', () => {
	test('start-review on a supported PR sends identity plus the pinned review action', () => {
		const resolution = resolveKeplerTaskRequest({ intent: 'start-review', item: githubPr, repoPath: repoPath });

		assert.ok(resolution.supported);
		assert.deepStrictEqual(resolution.options, {
			url: githubPr.url,
			kind: 'pr',
			provider: 'github',
			repo: repoPath,
			action: 'default-review',
		});
	});

	test('start-work pins the plan action; new-task pins none', () => {
		const work = resolveKeplerTaskRequest({
			intent: 'start-work',
			item: { kind: 'issue', url: 'https://linear.app/x/issue/X-1', provider: { id: 'linear', name: 'Linear' } },
		});
		assert.ok(work.supported);
		assert.strictEqual(work.options.action, 'default-plan');

		const task = resolveKeplerTaskRequest({ intent: 'new-task', repoPath: repoPath });
		assert.ok(task.supported);
		assert.deepStrictEqual(task.options, {
			url: undefined,
			kind: undefined,
			provider: undefined,
			repo: repoPath,
			action: undefined,
		});
	});

	test('refuses a PR whose provider does not map to a Kepler provider at all', () => {
		const resolution = resolveKeplerTaskRequest({
			intent: 'start-review',
			item: {
				kind: 'pr',
				url: 'https://bitbucket.example.com/pr/1',
				provider: { id: 'bitbucket-server', name: 'Bitbucket Server' },
			},
		});

		assert.strictEqual(resolution.supported, false);
		assert.strictEqual(resolution.provider, undefined);
	});

	test('gates on the (kind, provider) pair — Bitbucket PRs pass, Bitbucket issues are refused', () => {
		const bitbucket = { id: 'bitbucket', name: 'Bitbucket' };

		assert.ok(
			resolveKeplerTaskRequest({ intent: 'start-review', item: { kind: 'pr', url: 'u', provider: bitbucket } })
				.supported,
		);

		const issue = resolveKeplerTaskRequest({
			intent: 'start-work',
			item: { kind: 'issue', url: 'u', provider: bitbucket },
		});
		assert.strictEqual(issue.supported, false);
		assert.strictEqual(issue.provider, 'bitbucket');
	});
});

suite('startKeplerTask', () => {
	let sandbox: sinon.SinonSandbox;
	let openExternal: sinon.SinonStub;
	let showWarningMessage: sinon.SinonStub;
	let sendEvent: sinon.SinonSpy;

	setup(() => {
		sandbox = sinon.createSandbox();
		openExternal = sandbox.stub(env, 'openExternal').resolves(true);
		showWarningMessage = sandbox.stub(window, 'showWarningMessage').resolves(undefined);
		sendEvent = sandbox.spy();
	});

	teardown(() => {
		sandbox.restore();
	});

	test('opens the link on the configured channel scheme and reports only enums and booleans', async () => {
		const started = await startKeplerTask(
			makeContainer(sendEvent),
			{ intent: 'start-review', item: githubPr, repoPath: repoPath },
			{ source: 'view' },
		);

		assert.strictEqual(started, true);
		assert.strictEqual(openExternal.callCount, 1);
		const link = String(openExternal.firstCall.args[0]);
		assert.ok(link.startsWith('kepler-staging://task/new?'));
		assert.ok(link.includes(`repo=${encodeURIComponent(repoPath)}`));

		assert.strictEqual(sendEvent.callCount, 1);
		const [name, data, source] = sendEvent.firstCall.args;
		assert.strictEqual(name, 'kepler/task/start');
		assert.deepStrictEqual(data, {
			intent: 'start-review',
			kind: 'pr',
			provider: 'github',
			'provider.mapped': true,
			'repo.resolved': true,
			channel: 'staging',
			action: 'default-review',
		});
		assert.deepStrictEqual(source, { source: 'view' });
	});

	test('refuses an unsupported provider: warns naming it, sends no link, reports the reason', async () => {
		const started = await startKeplerTask(makeContainer(sendEvent), {
			intent: 'start-review',
			item: { kind: 'pr', url: 'u', provider: { id: 'azure-devops-server', name: 'Azure DevOps Server' } },
		});

		assert.strictEqual(started, false);
		assert.strictEqual(openExternal.callCount, 0);
		assert.strictEqual(showWarningMessage.callCount, 1);
		assert.ok(String(showWarningMessage.firstCall.args[0]).includes('Azure DevOps Server'));

		const [name, data] = sendEvent.firstCall.args;
		assert.strictEqual(name, 'kepler/task/start/failed');
		assert.strictEqual(data['failure.reason'], 'unsupported-provider');
		assert.strictEqual(data['provider.mapped'], false);
		assert.strictEqual(data.action, undefined);
	});

	test('reports open-failed when the link cannot be handed off, or the handoff throws', async () => {
		openExternal.resolves(false);
		assert.strictEqual(await startKeplerTask(makeContainer(sendEvent), { intent: 'new-task' }), false);

		openExternal.rejects(new Error('boom'));
		assert.strictEqual(await startKeplerTask(makeContainer(sendEvent), { intent: 'new-task' }), false);

		assert.strictEqual(sendEvent.callCount, 2);
		for (const call of sendEvent.getCalls()) {
			assert.strictEqual(call.args[0], 'kepler/task/start/failed');
			assert.strictEqual(call.args[1]['failure.reason'], 'open-failed');
			// No item, so there is no provider to have mapped (or not)
			assert.strictEqual(call.args[1]['provider.mapped'], undefined);
			assert.strictEqual(call.args[1]['repo.resolved'], false);
		}
	});
});

suite('getKeplerRepoPath', () => {
	function makeGitContainer(
		repo: { virtual: boolean; uri: { fsPath: string }; commonUri?: { fsPath: string } } | undefined,
	): Container {
		return { git: { getRepository: () => repo } } as unknown as Container;
	}

	test('returns the on-disk path of a known local repository', () => {
		assert.strictEqual(
			getKeplerRepoPath(makeGitContainer({ virtual: false, uri: { fsPath: repoPath } }), repoPath),
			repoPath,
		);
	});

	test("sends a worktree's main clone, which Kepler's repo catalog matches directly", () => {
		const worktreePath = '/gitkraken/vscode-gitlens.worktrees/feature';
		assert.strictEqual(
			getKeplerRepoPath(
				makeGitContainer({ virtual: false, uri: { fsPath: worktreePath }, commonUri: { fsPath: repoPath } }),
				worktreePath,
			),
			repoPath,
		);
	});

	test('omits a virtual repository, whose path is not on disk, and an unknown one', () => {
		assert.strictEqual(
			getKeplerRepoPath(makeGitContainer({ virtual: true, uri: { fsPath: '/gitkraken/vscode-gitlens' } }), '/x'),
			undefined,
		);
		assert.strictEqual(getKeplerRepoPath(makeGitContainer(undefined), repoPath), undefined);
		assert.strictEqual(getKeplerRepoPath(makeGitContainer(undefined), undefined), undefined);
	});
});
