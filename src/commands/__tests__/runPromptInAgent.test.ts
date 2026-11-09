import * as assert from 'node:assert';
// Imported for its side effect, FIRST and deliberately — see the same import in `startAgentSession.test.ts`:
// the `@command()` decorator pulls in `container.ts`, whose import fan-out must initialize first.
import '../../container.js';
import * as sinon from 'sinon';
import { window } from 'vscode';
import type { Container } from '../../container.js';
import type { AgentDescriptor } from '../../plus/agents/agentDescriptor.js';
import type { RunPromptInAgentCommandArgs, RunPromptInAgentOutcome } from '../runPromptInAgent.js';
import { RunPromptInAgentCommand } from '../runPromptInAgent.js';

/** A CLI agent whose executable isn't on disk: every dispatch to it fails at re-validation, before any
 *  terminal is opened. */
const unreachable: AgentDescriptor = {
	id: 'cli:gone',
	kind: 'cli',
	label: 'Gone',
	agent: {
		name: 'gone',
		displayName: 'Gone',
		detected: true,
		executable: '/nonexistent/gitlens-test-agent',
		mcpSupported: false,
		mcpInstalled: false,
		hooksSupported: false,
		hooksInstalled: false,
	},
};

/** Built around the prototype without the constructor, which would register the command a second time
 *  next to the running extension's — same idiom as `startAgentSession.test.ts`. */
function makeCommand(): RunPromptInAgentCommand {
	const instance = Object.create(RunPromptInAgentCommand.prototype) as RunPromptInAgentCommand;
	(instance as unknown as { container: Container }).container = {
		usage: { track: () => Promise.resolve() },
	} as unknown as Container;
	return instance;
}

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

suite('RunPromptInAgentCommand — a failed dispatch', () => {
	let sandbox: sinon.SinonSandbox;
	let showWarningMessage: sinon.SinonStub;
	/** Answers to the failure toasts, one per toast, set by each test. */
	let answers: ((choice: string | undefined) => void)[];

	setup(() => {
		sandbox = sinon.createSandbox();
		answers = [];
		showWarningMessage = sandbox
			.stub(window, 'showWarningMessage')
			.callsFake(() => new Promise(resolve => answers.push(resolve as (choice: string | undefined) => void)));
	});

	teardown(() => {
		sandbox.restore();
	});

	/** Drives the private `dispatch` with an empty prompt: a failed dispatch copies a non-empty one to the
	 *  clipboard — the real one, which `env.clipboard` can't be stubbed out of — and `execute` refuses an
	 *  empty one. */
	const run = (args?: Partial<RunPromptInAgentCommandArgs>): Promise<RunPromptInAgentOutcome> =>
		(
			makeCommand() as unknown as {
				dispatch: (
					descriptor: AgentDescriptor,
					args: RunPromptInAgentCommandArgs,
				) => Promise<RunPromptInAgentOutcome>;
			}
		).dispatch(unreachable, { prompt: '', ...args });

	test('comes back failed while its toast is still unanswered, and a Retry from it dispatches again', async () => {
		let outcome: RunPromptInAgentOutcome | undefined;
		void run().then(o => (outcome = o));
		await settle();

		assert.strictEqual(showWarningMessage.callCount, 1);
		assert.strictEqual(outcome, 'failed', 'the caller is not held by the toast');

		answers[0]('Retry');
		await settle();
		assert.strictEqual(showWarningMessage.callCount, 2, 'the retry ran — and failed again, with its own toast');

		answers[1](undefined);
		await settle();
	});

	test('with waitForRetry, stays pending until the toast is answered and reports how the retry went', async () => {
		let outcome: RunPromptInAgentOutcome | undefined;
		const running = run({ waitForRetry: true }).then(o => (outcome = o));
		await settle();

		assert.strictEqual(showWarningMessage.callCount, 1);
		assert.strictEqual(outcome, undefined, 'waits on the toast');

		answers[0]('Retry');
		await settle();
		assert.strictEqual(showWarningMessage.callCount, 2);
		assert.strictEqual(outcome, undefined, 'and on the retry');

		answers[1](undefined);
		await running;
		assert.strictEqual(outcome, 'failed');
	});

	test('tells the caller when a Retry is on offer and when it is taken up', async () => {
		const offers: boolean[] = [];
		const running = run({ waitForRetry: true, onRetryOffer: offered => offers.push(offered) });
		await settle();
		assert.deepStrictEqual(offers, [true], 'the toast is up');

		answers[0]('Retry');
		await settle();
		assert.deepStrictEqual(offers, [true, false, true], 'taken up, then up again for the retry that failed');

		answers[1](undefined);
		assert.strictEqual(await running, 'failed');
		assert.deepStrictEqual(offers, [true, false, true], 'a dismissed toast ends in the outcome, not an offer');
	});

	test('tells nobody about the offer without waitForRetry — no one is waiting to act on it', async () => {
		const offers: boolean[] = [];
		assert.strictEqual(await run({ onRetryOffer: offered => offers.push(offered) }), 'failed');
		answers[0](undefined);
		await settle();
		assert.deepStrictEqual(offers, []);
	});
});
