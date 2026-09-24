import * as assert from 'node:assert';
import * as sinon from 'sinon';
import { defer } from '@gitlens/utils/promise.js';
// Side-effect only: `startReview.ts` pulls in `system/-webview/command.js`, whose first load is
// re-entered through container.ts's dependency chain before its `registrableCommands` array exists
// — the ordering landmine `keplerTask.test.ts` documents. Loading container.ts first avoids it.
import '../../../container.js';
import { StepResultBreak } from '../../../commands/quick-wizard/models/steps.js';
import type { AgentDescriptor } from '../../agents/agentDescriptor.js';
import { runStartReviewDispatch } from '../startReview.js';

const agent: AgentDescriptor = { id: 'claude-extension', kind: 'claude-extension', label: 'Claude' };

async function rejection(promise: Promise<unknown>): Promise<Error> {
	try {
		await promise;
	} catch (ex) {
		return ex as Error;
	}
	assert.fail('expected the result to be cancelled');
}

// `runStartReviewDispatch` is the single path BOTH Start Review entry points (pre-selected `prUrl`,
// and the PR picker) take to `startReviewFromLaunchpadItem`; `startReview` stands in for that call,
// so "not called" means no branch/worktree gets created.
suite('runStartReviewDispatch', () => {
	test('a Kepler hand-off never starts the review (no branch/worktree)', async () => {
		const startReview = sinon.stub().resolves('review');
		const result = defer<string>();

		const started = await runStartReviewDispatch({ kind: 'kepler' }, result, startReview);

		assert.strictEqual(started, false);
		assert.strictEqual(startReview.called, false);
		assert.strictEqual(result.pending, false);
		assert.match((await rejection(result.promise)).message, /Kepler/);
	});

	test('a cancelled dispatch never starts the review', async () => {
		const startReview = sinon.stub().resolves('review');
		const result = defer<string>();

		const started = await runStartReviewDispatch({ kind: 'cancel' }, result, startReview);

		assert.strictEqual(started, false);
		assert.strictEqual(startReview.called, false);
		assert.strictEqual((await rejection(result.promise)).message, 'Start Review cancelled');
	});

	test('a wizard break never starts the review', async () => {
		const startReview = sinon.stub().resolves('review');
		const result = defer<string>();

		const started = await runStartReviewDispatch(StepResultBreak, result, startReview);

		assert.strictEqual(started, false);
		assert.strictEqual(startReview.called, false);
		assert.strictEqual((await rejection(result.promise)).message, 'Start Review cancelled');
	});

	test('a review dispatch starts the review with its agent and fulfills the result', async () => {
		const startReview = sinon.stub().resolves('review');
		const result = defer<string>();

		const started = await runStartReviewDispatch(
			{ kind: 'review', agent: agent, openChatOnComplete: true },
			result,
			startReview,
		);

		assert.strictEqual(started, true);
		assert.ok(startReview.calledOnceWithExactly(agent, true));
		assert.strictEqual(await result.promise, 'review');
	});

	test('a failing review propagates to the caller and leaves the result for it to settle', async () => {
		const startReview = sinon.stub().rejects(new Error('boom'));
		const result = defer<string>();

		await assert.rejects(
			runStartReviewDispatch(
				{ kind: 'review', agent: undefined, openChatOnComplete: false },
				result,
				startReview,
			),
			/boom/,
		);
		assert.strictEqual(result.pending, true);
		result.cancel();
		await rejection(result.promise);
	});
});
