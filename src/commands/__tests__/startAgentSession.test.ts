import * as assert from 'node:assert';
// Imported for its side effect, FIRST and deliberately — see the same import in
// `agentStatusService.test.ts`: `system/-webview/command.ts` (pulled in by the `@command()`
// decorator on `StartAgentSessionCommand`) imports `container.ts` as a value, and container's own
// import fan-out reaches the command classes whose decorator reads a registry that module is
// still initializing. Letting container initialize first breaks the cycle.
import '../../container.js';
import * as sinon from 'sinon';
import type { QuickPick, QuickPickItem } from 'vscode';
import { window } from 'vscode';
import type { GkAgent } from '../../agents/agentService.js';
import type { Container } from '../../container.js';
import type { AgentDescriptor } from '../../plus/agents/agentDescriptor.js';
import type { StartAgentSessionCommandArgs } from '../startAgentSession.js';
import { StartAgentSessionCommand } from '../startAgentSession.js';

function makeGkAgent(overrides: Partial<GkAgent> & { name: string }): GkAgent {
	return {
		displayName: overrides.name,
		detected: true,
		executable: '/usr/bin/agent',
		mcpSupported: true,
		mcpInstalled: false,
		hooksSupported: true,
		hooksInstalled: false,
		...overrides,
	};
}

function makeContainer(cliAgents: readonly GkAgent[]): Container {
	return {
		agents: { getDetectedCliAgents: () => Promise.resolve(cliAgents) },
	} as unknown as Container;
}

/** `resolveAgent` is private and `GlCommandBase`'s constructor unconditionally registers the
 *  command with real `vscode.commands` — constructing normally would collide with the instance
 *  the running extension already registered. `Object.create` builds an instance around the
 *  prototype WITHOUT running that constructor (so no registration happens), and the private
 *  `container` field is set directly — same "drive the private method" idiom
 *  `agentStatusService.test.ts` uses for `runHooksOperation` and `dispatchSessionAction`. */
function makeCommandInstance(container: Container): StartAgentSessionCommand {
	const instance = Object.create(StartAgentSessionCommand.prototype) as StartAgentSessionCommand;
	(instance as unknown as { container: Container }).container = container;
	return instance;
}

function callResolveAgent(
	instance: StartAgentSessionCommand,
	args?: StartAgentSessionCommandArgs,
): Promise<AgentDescriptor | undefined> {
	return (
		instance as unknown as {
			resolveAgent: (args?: StartAgentSessionCommandArgs) => Promise<AgentDescriptor | undefined>;
		}
	).resolveAgent(args);
}

/** Minimal `QuickPick` stand-in for `pickAgentStandalone` — assigning `items`/`activeItems` is a
 *  plain property write, and `show()` immediately fires the registered `onDidHide` handler, which
 *  is exactly what a user dismissing the picker without choosing anything looks like from
 *  `pickAgentStandalone`'s point of view (its promise resolves via `onDidHide` to `undefined`). */
function makeCancelledQuickPick(): QuickPick<QuickPickItem> {
	let onDidHide: (() => void) | undefined;
	const noopDisposable = { dispose: () => {} };
	return {
		items: [],
		activeItems: [],
		title: '',
		placeholder: '',
		buttons: [],
		onDidTriggerButton: () => noopDisposable,
		onDidTriggerItemButton: () => noopDisposable,
		onDidAccept: () => noopDisposable,
		onDidHide: (cb: () => void) => {
			onDidHide = cb;
			return noopDisposable;
		},
		show: () => onDidHide?.(),
		dispose: () => {},
	} as unknown as QuickPick<QuickPickItem>;
}

suite('StartAgentSessionCommand.resolveAgent', () => {
	let sandbox: sinon.SinonSandbox;

	setup(() => {
		sandbox = sinon.createSandbox();
	});

	teardown(() => {
		sandbox.restore();
	});

	test('an explicit agentId wins over pick and the persisted default', async () => {
		// The picker must never be shown — proves `pick: true` was NOT honored once `agentId` was given.
		const createQuickPick = sandbox.stub(window, 'createQuickPick').throws(new Error('picker should not be shown'));
		const container = makeContainer([makeGkAgent({ name: 'codex', displayName: 'Codex' })]);
		const instance = makeCommandInstance(container);

		const descriptor = await callResolveAgent(instance, { agentId: 'cli:codex', pick: true });

		assert.ok(descriptor != null);
		assert.strictEqual(descriptor.id, 'cli:codex');
		assert.strictEqual(descriptor.label, 'Codex');
		assert.strictEqual(createQuickPick.called, false);
	});

	test('an unresolvable agentId warns naming the agent and does not open the picker', async () => {
		const createQuickPick = sandbox.stub(window, 'createQuickPick').throws(new Error('picker should not be shown'));
		const showWarningMessage = sandbox.stub(window, 'showWarningMessage').resolves(undefined);
		// No detected CLI agents at all, so `cli:codex` cannot resolve to a descriptor.
		const container = makeContainer([]);
		const instance = makeCommandInstance(container);

		const descriptor = await callResolveAgent(instance, { agentId: 'cli:codex' });

		assert.strictEqual(descriptor, undefined);
		assert.strictEqual(showWarningMessage.callCount, 1);
		assert.match(showWarningMessage.firstCall.args[0], /codex/);
		assert.strictEqual(createQuickPick.called, false);
	});

	test('a cancelled picker returns silently, without a warning', async () => {
		sandbox.stub(window, 'createQuickPick').returns(makeCancelledQuickPick());
		const showWarningMessage = sandbox.stub(window, 'showWarningMessage').resolves(undefined);
		const container = makeContainer([]);
		const instance = makeCommandInstance(container);

		// `pick: true` forces straight past the persisted-default check into the picker.
		const descriptor = await callResolveAgent(instance, { pick: true });

		assert.strictEqual(descriptor, undefined);
		assert.strictEqual(showWarningMessage.called, false);
	});
});
