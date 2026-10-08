import * as assert from 'node:assert';
import * as sinon from 'sinon';
import type { QuickPick, QuickPickItem } from 'vscode';
import { commands, ConfigurationTarget, EventEmitter, extensions, QuickPickItemKind, window } from 'vscode';
// Loads the module graph in its real order: `agentPicker` reaches `system/-webview/command.js`,
// which crashes on load when imported before the container has registered its commands
import '../../../container.js';
import type { GkAgent } from '../../../agents/agentService.js';
import { StepResultBreak } from '../../../commands/quick-wizard/models/steps.js';
import type { QuickPickStep } from '../../../commands/quick-wizard/models/steps.quickpick.js';
import { confirmOptionsSeparatorLabel } from '../../../commands/quick-wizard/utils/steps.utils.js';
import type { Container } from '../../../container.js';
import type { ConfirmToggleQuickPickItem } from '../../../quickpicks/items/directive.js';
import { Directive, isDirectiveQuickPickItem } from '../../../quickpicks/items/directive.js';
import { configuration } from '../../../system/-webview/configuration.js';
import type { AgentDescriptor, AgentRoute } from '../agentDescriptor.js';
import type { AgentRouteItem, ResolveAgentFlowResult } from '../agentPicker.js';
import {
	buildAgentPickerItems,
	canOfferKeplerRoute,
	getRequestedAgentRoute,
	pickAgentStandalone,
	pickAgentStep,
	pickRouteStep,
	resolveAgentFlow,
	resolveAgentRoute,
} from '../agentPicker.js';
import { claudeExtensionId, claudeExtensionOpenCommand, loadSupportedAgentsInStages } from '../agentRegistry.js';

type Row = QuickPickItem & { route?: string; descriptor?: AgentDescriptor };

const cliAgentId = 'cli:codex';

const githubIssue: AgentRouteItem = { kind: 'issue', providerId: 'github' };
const bitbucketIssue: AgentRouteItem = { kind: 'issue', providerId: 'bitbucket' };
const bitbucketPr: AgentRouteItem = { kind: 'pr', providerId: 'bitbucket' };

const codexAgent: GkAgent = {
	name: 'codex',
	displayName: 'Codex',
	detected: true,
	executable: '/usr/bin/codex',
	mcpSupported: true,
	mcpInstalled: false,
	hooksSupported: true,
	hooksInstalled: false,
};

const noopDisposable = { dispose: () => {} };
/** For a container whose agent detection never changes while a picker is open */
const neverChanges = () => noopDisposable;

function makeContainer(detected: Promise<readonly GkAgent[]> = Promise.resolve([codexAgent])): Container {
	return {
		agents: { getDetectedCliAgents: () => detected, onDidChangeAgents: neverChanges },
	} as unknown as Container;
}

/** A container whose first detection times out, and whose later detections — once {@link succeed} is
 *  called, which also fires `onDidChangeAgents` as a late success does — find Codex. */
function makeLateDetectionContainer(): { container: Container; succeed: () => void; changed: EventEmitter<void> } {
	const changed = new EventEmitter<void>();
	let succeeded = false;
	const container = {
		agents: {
			getDetectedCliAgents: () =>
				succeeded ? Promise.resolve([codexAgent]) : Promise.reject(new Error("Agent detection didn't finish")),
			onDidChangeAgents: changed.event,
		},
	} as unknown as Container;
	return {
		container: container,
		succeed: () => {
			succeeded = true;
			changed.fire();
		},
		changed: changed,
	};
}

/** A container whose detection finds Codex, and whose later detections — started by {@link reload}, which fires
 *  `onDidChangeAgents` as an invalidation does — run until the returned `finish` is called with their result. */
function makeReloadingContainer(): {
	container: Container;
	reload: () => (agents: readonly GkAgent[]) => void;
} {
	const changed = new EventEmitter<void>();
	let detection: Promise<readonly GkAgent[]> = Promise.resolve([codexAgent]);
	const container = {
		agents: { getDetectedCliAgents: () => detection, onDidChangeAgents: changed.event },
	} as unknown as Container;
	return {
		container: container,
		reload: () => {
			let finish!: (agents: readonly GkAgent[]) => void;
			detection = new Promise<readonly GkAgent[]>(resolve => {
				finish = resolve;
			});
			changed.fire();
			return finish;
		},
	};
}

/** Makes `cli:codex` the persisted default agent, over a suite's own `configuration.get` stub. */
function setCodexAsDefault(): void {
	(configuration.get as sinon.SinonStub).withArgs('ai.defaultAgent').returns(cliAgentId);
}

/** The row a quickpick focuses on its own once its items are set: the first that isn't a separator. */
function getFirstRow(items: readonly Row[]): Row {
	const row = items.find(i => i.kind !== QuickPickItemKind.Separator);
	assert.ok(row != null);
	return row;
}

/** Reports the Claude extension as installed, but holds its command probe — and so every non-CLI row — until
 *  `release` is called, so a test controls when the non-CLI rows are ready. */
function holdNonCliAgents(sandbox: sinon.SinonSandbox): { release: () => void } {
	const getExtension = sandbox.stub(extensions, 'getExtension') as sinon.SinonStub;
	getExtension.callThrough();
	getExtension.withArgs(claudeExtensionId).returns({});

	let release!: () => void;
	const registered = new Promise<string[]>(resolve => {
		release = () => resolve([claudeExtensionOpenCommand]);
	});
	const getCommands = sandbox.stub(commands, 'getCommands') as sinon.SinonStub;
	getCommands.callThrough();
	getCommands.withArgs(true).returns(registered);
	return { release: release };
}

const claudeExtensionRowId = 'claude-extension';

/** Whether `promise` is still unsettled after a short wait. */
async function isPending(promise: unknown): Promise<boolean> {
	const pending = Symbol('pending');
	return (await Promise.race([promise, new Promise(resolve => setTimeout(resolve, 50, pending))])) === pending;
}

/** Waits (briefly) for an async reload to land. */
async function until(condition: () => boolean, message: string): Promise<void> {
	for (let i = 0; i < 50 && !condition(); i++) {
		await new Promise(resolve => setTimeout(resolve, 10));
	}
	assert.ok(condition(), message);
}

function getToggle(items: readonly QuickPickItem[]): ConfirmToggleQuickPickItem {
	const toggle = items.at(-1);
	assert.ok(toggle != null && isDirectiveQuickPickItem(toggle), 'the last row is the toggle directive');
	return toggle as ConfirmToggleQuickPickItem;
}

/** The toggle is the last row, alone in an Options group, unchecked — and no row above it carries a button. */
function assertToggleRow(items: readonly QuickPickItem[], label: string): void {
	const toggle = getToggle(items);
	assert.strictEqual(toggle.label, label);
	assert.strictEqual(toggle.directive, Directive.Noop);
	assert.strictEqual(toggle.checked, false);

	const separator = items.at(-2);
	assert.strictEqual(separator?.kind, QuickPickItemKind.Separator);
	assert.strictEqual(separator.label, confirmOptionsSeparatorLabel);

	for (const item of items.slice(0, -1)) {
		assert.strictEqual(item.buttons, undefined, `row "${item.label}" has no per-row set-as-default button`);
	}
}

/** Shows the step the way the wizard does — renders its first rows, then activates it — and waits until it is
 *  no longer busy, as the agent step shows its non-CLI rows before CLI detection settles. */
async function startStep<T>(
	generator: AsyncGenerator<unknown, T>,
): Promise<{ items: Row[]; toggle: ConfirmToggleQuickPickItem }> {
	const { value } = await generator.next();
	const step = value as QuickPickStep<Row>;
	const qp = {
		items: (await step.items) as Row[],
		activeItems: [] as Row[],
		placeholder: '',
		value: '',
		busy: false,
	} as unknown as QuickPick<Row>;
	step.onDidActivate?.(qp);
	await until(() => !qp.busy, 'the step finishes loading');

	const items = qp.items as Row[];
	return { items: items, toggle: getToggle(items) };
}

/** Flips the toggle the way the wizard does on accept — the step has no live quickpick, so the
 *  re-render is a no-op and only the item's own state changes. */
async function flip(toggle: ConfirmToggleQuickPickItem): Promise<void> {
	await toggle.onDidSelect?.({} as QuickPick<QuickPickItem>);
}

suite('getRequestedAgentRoute', () => {
	let sandbox: sinon.SinonSandbox;

	setup(() => {
		sandbox = sinon.createSandbox();
		(sandbox.stub(configuration, 'get') as sinon.SinonStub).withArgs('ai.openInAgent').returns('manual');
	});

	teardown(() => {
		sandbox.restore();
	});

	test('an explicit route wins over the setting', () => {
		assert.strictEqual(getRequestedAgentRoute({ showOpenInAgent: 'agent' }), 'agent');
	});

	test('the plain commands fall back to the setting', () => {
		assert.strictEqual(getRequestedAgentRoute(undefined), 'manual');
		assert.strictEqual(getRequestedAgentRoute({}), 'manual');
	});

	test('MCP-style callers keep the legacy path, so their chat hand-off still happens', () => {
		// The gk CLI's mcp/issue/start and mcp/pr/review/start pass exactly this
		assert.strictEqual(getRequestedAgentRoute({ useDefaults: true, openChatOnComplete: true }), undefined);
		assert.strictEqual(getRequestedAgentRoute({ useDefaults: true }), undefined);
		assert.strictEqual(getRequestedAgentRoute({ openChatOnComplete: false }), undefined);
	});
});

suite('pickRouteStep', () => {
	let sandbox: sinon.SinonSandbox;
	let update: sinon.SinonStub;

	setup(() => {
		sandbox = sinon.createSandbox();
		update = sandbox.stub(configuration, 'update').resolves();
	});

	teardown(() => {
		sandbox.restore();
	});

	test('offers one unchecked "Always use this choice" toggle, last, in an Options group', async () => {
		const { items } = await startStep(pickRouteStep());

		assertToggleRow(items, 'Always use this choice');
	});

	test('picking a route with the toggle off persists nothing', async () => {
		const generator = pickRouteStep();
		const { items } = await startStep(generator);

		const result = await generator.next([items.find(i => i.route === 'agent')]);

		assert.deepStrictEqual(result, { done: true, value: 'agent' });
		assert.strictEqual(update.called, false);
	});

	test('picking a route with the toggle armed persists that route as the default', async () => {
		const generator = pickRouteStep();
		const { items, toggle } = await startStep(generator);

		await flip(toggle);
		assert.strictEqual(toggle.checked, true);
		// Arming alone writes nothing — it is a pending choice
		assert.strictEqual(update.called, false);

		const result = await generator.next([items.find(i => i.route === 'manual')]);

		assert.deepStrictEqual(result, { done: true, value: 'manual' });
		assert.ok(update.calledOnceWithExactly('ai.openInAgent', 'manual', ConfigurationTarget.Global));
	});

	test('arming the toggle then going back persists nothing', async () => {
		const generator = pickRouteStep({ showBackButton: true });
		const { toggle } = await startStep(generator);

		await flip(toggle);
		const result = await generator.next(Directive.Back);

		assert.deepStrictEqual(result, { done: true, value: StepResultBreak });
		assert.strictEqual(update.called, false);
	});
});

suite('pickAgentStep', () => {
	let sandbox: sinon.SinonSandbox;
	let update: sinon.SinonStub;

	setup(() => {
		sandbox = sinon.createSandbox();
		const get = sandbox.stub(configuration, 'get') as sinon.SinonStub;
		get.callThrough();
		get.withArgs('ai.defaultAgent').returns(undefined);
		update = sandbox.stub(configuration, 'update').resolves();
	});

	teardown(() => {
		sandbox.restore();
	});

	test('offers one unchecked "Always use this agent" toggle, last, in an Options group', async () => {
		const { items } = await startStep(pickAgentStep(makeContainer()));

		assertToggleRow(items, 'Always use this agent');
	});

	test('picking an agent with the toggle off persists nothing', async () => {
		const generator = pickAgentStep(makeContainer());
		const { items } = await startStep(generator);

		const row = items.find(i => i.descriptor?.id === cliAgentId);
		assert.ok(row?.descriptor != null);
		const result = await generator.next([row]);

		assert.deepStrictEqual(result, {
			done: true,
			value: { kind: 'agent', descriptor: row.descriptor },
		});
		assert.strictEqual(update.called, false);
	});

	test('picking an agent with the toggle armed persists it as the default agent', async () => {
		const generator = pickAgentStep(makeContainer());
		const { items, toggle } = await startStep(generator);

		await flip(toggle);
		assert.strictEqual(update.called, false);

		await generator.next([items.find(i => i.descriptor?.id === cliAgentId)]);

		assert.ok(update.calledOnceWithExactly('ai.defaultAgent', cliAgentId, ConfigurationTarget.Global));
	});

	test('arming the toggle then going back persists nothing', async () => {
		const generator = pickAgentStep(makeContainer(), { showBackButton: true });
		const { toggle } = await startStep(generator);

		await flip(toggle);
		const result = await generator.next(Directive.Back);

		assert.deepStrictEqual(result, { done: true, value: StepResultBreak });
		assert.strictEqual(update.called, false);
	});

	test('yields its step even when agent detection never settles', async () => {
		const container = {
			agents: { getDetectedCliAgents: () => new Promise<never>(() => {}), onDidChangeAgents: neverChanges },
		} as unknown as Container;
		// The non-CLI rows would otherwise fill the step while CLI detection runs
		const hold = holdNonCliAgents(sandbox);

		const { done, value } = await pickAgentStep(container).next();

		assert.strictEqual(done, false);
		const items = (value as QuickPickStep<Row>).items;
		assert.ok(items instanceof Promise, 'items load after the step is shown');
		const pending = Symbol('pending');
		assert.strictEqual(
			await Promise.race([items, new Promise(resolve => setTimeout(resolve, 50, pending))]),
			pending,
			'items are still loading',
		);
		hold.release();
	});

	// Intentionally changed from settling the items (empty) on leave: that resumed the wizard's suspended first
	// render, which then wrote to — and activated the step against — the quickpick it had already disposed
	test("leaving the step before agents load never resumes the wizard's first render", async () => {
		const container = {
			agents: { getDetectedCliAgents: () => new Promise<never>(() => {}), onDidChangeAgents: neverChanges },
		} as unknown as Container;
		const hold = holdNonCliAgents(sandbox);

		const generator = pickAgentStep(container);
		const { value } = await generator.next();
		const items = (value as QuickPickStep<Row>).items;
		assert.ok(items instanceof Promise);

		// What the wizard runs once the items settle: render them into its quickpick, then activate the step
		let rendered = false;
		void items.then(() => {
			rendered = true;
		});

		const result = await generator.next(Directive.Back);
		assert.deepStrictEqual(result, { done: true, value: StepResultBreak });

		// Agents becoming available after the step was left must not settle the items either
		hold.release();
		assert.ok(await isPending(items), 'the items stay pending once the step is left');
		assert.strictEqual(rendered, false, "the wizard's first render never runs");
	});

	test('shows the non-CLI rows while CLI detection is still running, then adds the CLI rows', async () => {
		let detect!: (agents: readonly GkAgent[]) => void;
		const container = makeContainer(
			new Promise<readonly GkAgent[]>(resolve => {
				detect = resolve;
			}),
		);
		const hold = holdNonCliAgents(sandbox);

		const generator = pickAgentStep(container);
		const { value } = await generator.next();
		const step = value as QuickPickStep<Row>;
		assert.ok(await isPending(step.items), 'nothing to show until the non-CLI rows are ready');

		hold.release();
		const items = (await step.items) as Row[];
		assert.ok(
			items.some(i => i.descriptor?.id === claudeExtensionRowId),
			'the non-CLI rows show at once',
		);
		assert.ok(!items.some(i => i.descriptor?.id === cliAgentId), 'CLI detection has not finished');

		// The wizard renders the first rows, clears `busy`, then activates the step
		const qp = {
			items: items,
			activeItems: [] as Row[],
			placeholder: '',
			value: '',
			busy: false,
		} as unknown as QuickPick<Row>;
		step.onDidActivate?.(qp);
		assert.strictEqual(qp.busy, true, 'still busy while CLI detection runs');

		detect([codexAgent]);
		await until(() => qp.items.some(i => i.descriptor?.id === cliAgentId), 'the shown quickpick gains the CLI row');
		assert.strictEqual(qp.busy, false);
		assert.ok(
			qp.items.some(i => i.descriptor?.id === claudeExtensionRowId),
			'and keeps the non-CLI rows',
		);

		await generator.next(Directive.Back);
	});
});

suite('pickAgentStep — late agent detection', () => {
	let sandbox: sinon.SinonSandbox;

	setup(() => {
		sandbox = sinon.createSandbox();
		const get = sandbox.stub(configuration, 'get') as sinon.SinonStub;
		get.callThrough();
		get.withArgs('ai.defaultAgent').returns(undefined);
		sandbox.stub(configuration, 'update').resolves();
	});

	teardown(() => {
		sandbox.restore();
	});

	test('an open step picks up the CLI rows when a timed-out detection later succeeds', async () => {
		const { container, succeed, changed } = makeLateDetectionContainer();
		const generator = pickAgentStep(container);
		const { value } = await generator.next();
		const step = value as QuickPickStep<Row>;
		const items = (await step.items) as Row[];
		assert.ok(!items.some(i => i.descriptor?.id === cliAgentId), 'the timed-out load has no CLI rows');

		// Activate the step the way the wizard does once it has shown the first load
		const qp = { items: items, activeItems: [] as Row[], placeholder: '', value: '' } as unknown as QuickPick<Row>;
		step.onDidActivate?.(qp);
		const toggle = getToggle(items);
		await flip(toggle);

		succeed();
		await until(() => qp.items.some(i => i.descriptor?.id === cliAgentId), 'the shown quickpick gains the CLI row');

		assert.strictEqual(step.items, qp.items, 'the step keeps the reloaded rows, so the wizard never reverts them');
		const reloadedToggle = getToggle(qp.items);
		assert.strictEqual(reloadedToggle, toggle, 'the toggle row keeps its identity');
		assert.strictEqual(reloadedToggle.checked, true, 'and its armed state');

		// Leaving the step stops the reloads
		await generator.next(Directive.Back);
		const shown = qp.items;
		changed.fire();
		await new Promise(resolve => setTimeout(resolve, 50));
		assert.strictEqual(qp.items, shown, 'a closed step is never reloaded');
	});

	test('a reload reads as busy over the shown rows until it applies', async () => {
		const { container, reload } = makeReloadingContainer();
		const generator = pickAgentStep(container);
		const { value } = await generator.next();
		const step = value as QuickPickStep<Row>;
		const qp = {
			items: (await step.items) as Row[],
			activeItems: [] as Row[],
			placeholder: '',
			value: '',
			busy: false,
		} as unknown as QuickPick<Row>;
		step.onDidActivate?.(qp);
		await until(() => !qp.busy && qp.items.some(i => i.descriptor?.id === cliAgentId), 'the step finishes loading');

		const shown = qp.items;
		const finish = reload();
		assert.strictEqual(qp.busy, true, 'busy as soon as the reload starts');
		assert.strictEqual(qp.items, shown, 'and keeps showing the current rows meanwhile');

		finish([]);
		await until(() => !qp.busy, 'the reload applies');
		assert.ok(!qp.items.some(i => i.descriptor?.id === cliAgentId), 'with its own rows');

		await generator.next(Directive.Back);
	});
});

suite('pickAgentStep — default agent focus', () => {
	let sandbox: sinon.SinonSandbox;

	setup(() => {
		sandbox = sinon.createSandbox();
		const get = sandbox.stub(configuration, 'get') as sinon.SinonStub;
		get.callThrough();
		setCodexAsDefault();
		sandbox.stub(configuration, 'update').resolves();
	});

	teardown(() => {
		sandbox.restore();
	});

	/** Shows the step's non-CLI rows, with the quickpick focusing the first of them the way VS Code does, while
	 *  CLI detection runs until `detect` is called. */
	async function startLoading() {
		let detect!: (agents: readonly GkAgent[]) => void;
		const container = makeContainer(
			new Promise<readonly GkAgent[]>(resolve => {
				detect = resolve;
			}),
		);
		const hold = holdNonCliAgents(sandbox);

		const generator = pickAgentStep(container);
		const { value } = await generator.next();
		const step = value as QuickPickStep<Row>;
		hold.release();
		const items = (await step.items) as Row[];
		assert.ok(!items.some(i => i.descriptor?.id === cliAgentId), 'CLI detection has not finished');

		const qp = {
			items: items,
			activeItems: [getFirstRow(items)],
			placeholder: '',
			value: '',
			busy: false,
		} as unknown as QuickPick<Row>;
		step.onDidActivate?.(qp);
		return { generator: generator, qp: qp, detect: detect };
	}

	test('focuses a CLI default once CLI detection adds it', async () => {
		const { generator, qp, detect } = await startLoading();

		detect([codexAgent]);
		await until(() => qp.items.some(i => i.descriptor?.id === cliAgentId), 'the CLI row arrives');

		assert.deepStrictEqual(
			qp.activeItems.map(i => i.descriptor?.id),
			[cliAgentId],
			'the default is focused rather than the first row',
		);

		await generator.next(Directive.Back);
	});

	test('keeps the row the user moved to while CLI detection ran', async () => {
		const { generator, qp, detect } = await startLoading();
		const toggle = getToggle(qp.items);
		qp.activeItems = [toggle];

		detect([codexAgent]);
		await until(() => qp.items.some(i => i.descriptor?.id === cliAgentId), 'the CLI row arrives');

		assert.deepStrictEqual(qp.activeItems, [toggle], "the user's row stays focused");

		await generator.next(Directive.Back);
	});

	test('keeps the focus on the first row when the user typed filter text while CLI detection ran', async () => {
		const { generator, qp, detect } = await startLoading();
		const first = getFirstRow(qp.items);
		qp.value = 'claude';

		detect([codexAgent]);
		await until(() => qp.items.some(i => i.descriptor?.id === cliAgentId), 'the CLI row arrives');

		assert.deepStrictEqual(qp.activeItems, [first], 'the default does not take the focus over the filter');

		await generator.next(Directive.Back);
	});
});

type QuickPickDriver = {
	qp: QuickPick<Row>;
	shown: Promise<void>;
	/** Resolves once the picker clears `busy` — its agents have loaded. */
	loaded: Promise<void>;
	accept: (item: Row) => Promise<void>;
	hide: () => void;
};

/** Minimal `QuickPick` stand-in that records the handlers `pickAgentStandalone` registers, so a test
 *  can drive accept/hide the way a user would. */
function makeQuickPickDriver(): QuickPickDriver {
	let onDidAccept: (() => unknown) | undefined;
	let onDidHide: (() => void) | undefined;
	let onShown: (() => void) | undefined;
	const shown = new Promise<void>(resolve => {
		onShown = resolve;
	});
	let onLoaded: (() => void) | undefined;
	const loaded = new Promise<void>(resolve => {
		onLoaded = resolve;
	});
	let busy = false;
	const qp = {
		items: [] as Row[],
		activeItems: [] as Row[],
		selectedItems: [] as Row[],
		title: '',
		placeholder: '',
		value: '',
		get busy() {
			return busy;
		},
		set busy(value: boolean) {
			busy = value;
			if (!value) {
				onLoaded?.();
			}
		},
		buttons: [],
		onDidTriggerButton: () => noopDisposable,
		onDidTriggerItemButton: () => noopDisposable,
		onDidAccept: (cb: () => unknown) => {
			onDidAccept = cb;
			return noopDisposable;
		},
		onDidHide: (cb: () => void) => {
			onDidHide = cb;
			return noopDisposable;
		},
		show: () => onShown?.(),
		dispose: () => {},
	};
	return {
		qp: qp as unknown as QuickPick<Row>,
		shown: shown,
		loaded: loaded,
		accept: async (item: Row) => {
			qp.selectedItems = [item];
			await onDidAccept?.();
		},
		hide: () => onDidHide?.(),
	};
}

suite('pickAgentStandalone', () => {
	let sandbox: sinon.SinonSandbox;
	let update: sinon.SinonStub;

	setup(() => {
		sandbox = sinon.createSandbox();
		const get = sandbox.stub(configuration, 'get') as sinon.SinonStub;
		get.callThrough();
		get.withArgs('ai.defaultAgent').returns(undefined);
		update = sandbox.stub(configuration, 'update').resolves();
	});

	teardown(() => {
		sandbox.restore();
	});

	/** Opens the picker and waits until its agents have loaded — it is shown before the rows exist. */
	async function open(): Promise<{
		picked: Promise<AgentDescriptor | undefined>;
		driver: QuickPickDriver;
	}> {
		const driver = makeQuickPickDriver();
		sandbox.stub(window, 'createQuickPick').returns(driver.qp);

		const picked = pickAgentStandalone(makeContainer());
		await driver.loaded;
		return { picked: picked, driver: driver };
	}

	function getAgentRow(driver: QuickPickDriver): Row {
		const row = driver.qp.items.find(i => i.descriptor?.id === cliAgentId);
		assert.ok(row != null);
		return row;
	}

	test('offers one unchecked "Always use this agent" toggle, last, in an Options group', async () => {
		const { picked, driver } = await open();

		assertToggleRow(driver.qp.items, 'Always use this agent');

		driver.hide();
		assert.strictEqual(await picked, undefined);
	});

	test('accepting the toggle flips it and keeps the picker open; picking an agent then persists it', async () => {
		const { picked, driver } = await open();
		const toggle = getToggle(driver.qp.items);
		const shownBefore = driver.qp.items;
		driver.qp.activeItems = [toggle];

		await driver.accept(toggle);
		assert.strictEqual(toggle.checked, true);
		assert.strictEqual(update.called, false);
		// The re-render reassigns the items (so the quickpick notices the flipped row) but keeps the same row
		// object, so its checked state is what the user sees, and keeps it active
		assert.notStrictEqual(driver.qp.items, shownBefore, 'the items are reassigned to re-render the row');
		assert.strictEqual(getToggle(driver.qp.items), toggle);
		assert.deepStrictEqual(driver.qp.activeItems, [toggle], 'the toggle stays active');

		const row = getAgentRow(driver);
		await driver.accept(row);

		assert.strictEqual(await picked, row.descriptor);
		assert.ok(update.calledOnceWithExactly('ai.defaultAgent', cliAgentId, ConfigurationTarget.Global));
	});

	test('picking an agent with the toggle off persists nothing', async () => {
		const { picked, driver } = await open();

		const row = getAgentRow(driver);
		await driver.accept(row);

		assert.strictEqual(await picked, row.descriptor);
		assert.strictEqual(update.called, false);
	});

	test('shows the picker while detection is still running, then fills it in', async () => {
		const driver = makeQuickPickDriver();
		sandbox.stub(window, 'createQuickPick').returns(driver.qp);
		let detect!: (agents: readonly GkAgent[]) => void;
		const detected = new Promise<readonly GkAgent[]>(resolve => {
			detect = resolve;
		});

		// The non-CLI rows would otherwise fill the picker while CLI detection runs
		const hold = holdNonCliAgents(sandbox);

		const picked = pickAgentStandalone(makeContainer(detected));
		await driver.shown;

		assert.strictEqual(driver.qp.busy, true);
		assert.strictEqual(driver.qp.placeholder, 'Loading...');
		assert.strictEqual(driver.qp.items.length, 0);

		hold.release();
		detect([codexAgent]);
		await driver.loaded;

		assert.ok(getAgentRow(driver) != null);
		assertToggleRow(driver.qp.items, 'Always use this agent');

		driver.hide();
		assert.strictEqual(await picked, undefined);
	});

	test('dismissing while detection is still running resolves undefined and leaves the picker alone', async () => {
		const driver = makeQuickPickDriver();
		sandbox.stub(window, 'createQuickPick').returns(driver.qp);
		let detect!: (agents: readonly GkAgent[]) => void;
		const detected = new Promise<readonly GkAgent[]>(resolve => {
			detect = resolve;
		});

		const hold = holdNonCliAgents(sandbox);

		const picked = pickAgentStandalone(makeContainer(detected));
		await driver.shown;
		driver.hide();
		assert.strictEqual(await picked, undefined);

		hold.release();
		detect([codexAgent]);
		await detected;
		await new Promise(resolve => setTimeout(resolve, 0));

		assert.strictEqual(driver.qp.items.length, 0, 'a late load does not fill a dismissed picker');
		assert.strictEqual(driver.qp.busy, true);
	});

	test('shows the non-CLI rows, pickable, while CLI detection is still running', async () => {
		const driver = makeQuickPickDriver();
		sandbox.stub(window, 'createQuickPick').returns(driver.qp);
		const hold = holdNonCliAgents(sandbox);

		const picked = pickAgentStandalone(makeContainer(new Promise<never>(() => {})));
		await driver.shown;
		hold.release();
		await until(
			() => driver.qp.items.some(i => i.descriptor?.id === claudeExtensionRowId),
			'the non-CLI rows show while CLI detection runs',
		);

		assert.strictEqual(driver.qp.busy, true, 'still busy while CLI detection runs');
		assert.strictEqual(driver.qp.placeholder, 'Select where to proceed');
		assert.ok(!driver.qp.items.some(i => i.descriptor?.id === cliAgentId));

		const row = driver.qp.items.find(i => i.descriptor?.id === claudeExtensionRowId);
		assert.ok(row != null);
		await driver.accept(row);
		assert.strictEqual(await picked, row.descriptor);
	});

	test('an open picker picks up the CLI rows when a timed-out detection later succeeds', async () => {
		const driver = makeQuickPickDriver();
		sandbox.stub(window, 'createQuickPick').returns(driver.qp);
		const { container, succeed } = makeLateDetectionContainer();

		const picked = pickAgentStandalone(container);
		await driver.loaded;
		assert.ok(!driver.qp.items.some(i => i.descriptor?.id === cliAgentId), 'the timed-out load has no CLI rows');

		const toggle = getToggle(driver.qp.items);
		await driver.accept(toggle);
		driver.qp.activeItems = [toggle];

		succeed();
		await until(() => driver.qp.items.some(i => i.descriptor?.id === cliAgentId), 'the picker gains the CLI row');

		assert.strictEqual(getToggle(driver.qp.items), toggle, 'the toggle row keeps its identity');
		assert.strictEqual(toggle.checked, true, 'and its armed state');
		assert.deepStrictEqual(driver.qp.activeItems, [toggle], 'the active row survives the reload');

		const row = getAgentRow(driver);
		await driver.accept(row);
		assert.strictEqual(await picked, row.descriptor);
		assert.ok(update.calledOnceWithExactly('ai.defaultAgent', cliAgentId, ConfigurationTarget.Global));
	});

	test('a dismissed picker is never reloaded', async () => {
		const driver = makeQuickPickDriver();
		sandbox.stub(window, 'createQuickPick').returns(driver.qp);
		const { container, succeed } = makeLateDetectionContainer();

		const picked = pickAgentStandalone(container);
		await driver.loaded;
		driver.hide();
		assert.strictEqual(await picked, undefined);

		const shown = driver.qp.items;
		succeed();
		await new Promise(resolve => setTimeout(resolve, 50));
		assert.strictEqual(driver.qp.items, shown);
	});

	test('arming the toggle then dismissing persists nothing', async () => {
		const { picked, driver } = await open();

		await driver.accept(getToggle(driver.qp.items));
		driver.hide();

		assert.strictEqual(await picked, undefined);
		assert.strictEqual(update.called, false);
	});

	test('a reload reads as busy over the shown rows, still pickable, until it applies', async () => {
		const driver = makeQuickPickDriver();
		sandbox.stub(window, 'createQuickPick').returns(driver.qp);
		const { container, reload } = makeReloadingContainer();

		const picked = pickAgentStandalone(container);
		await driver.loaded;
		const shown = driver.qp.items;

		const finish = reload();
		assert.strictEqual(driver.qp.busy, true, 'busy as soon as the reload starts');
		assert.strictEqual(driver.qp.items, shown, 'and keeps showing the current rows meanwhile');

		finish([]);
		await until(() => !driver.qp.busy, 'the reload applies');
		assert.ok(!driver.qp.items.some(i => i.descriptor?.id === cliAgentId), 'with its own rows');

		driver.hide();
		assert.strictEqual(await picked, undefined);
	});

	/** Opens the picker showing its non-CLI rows, with the quickpick focusing the first of them the way VS Code
	 *  does, while CLI detection runs until `detect` is called. */
	async function openLoading() {
		const driver = makeQuickPickDriver();
		sandbox.stub(window, 'createQuickPick').returns(driver.qp);
		let detect!: (agents: readonly GkAgent[]) => void;
		const hold = holdNonCliAgents(sandbox);

		const picked = pickAgentStandalone(
			makeContainer(
				new Promise<readonly GkAgent[]>(resolve => {
					detect = resolve;
				}),
			),
		);
		await driver.shown;
		hold.release();
		await until(
			() => driver.qp.items.some(i => i.descriptor?.id === claudeExtensionRowId),
			'the non-CLI rows show while CLI detection runs',
		);
		driver.qp.activeItems = [getFirstRow(driver.qp.items)];
		return { driver: driver, picked: picked, detect: detect };
	}

	test('focuses a CLI default once CLI detection adds it', async () => {
		setCodexAsDefault();
		const { driver, picked, detect } = await openLoading();

		detect([codexAgent]);
		await driver.loaded;

		assert.deepStrictEqual(
			driver.qp.activeItems.map(i => i.descriptor?.id),
			[cliAgentId],
			'the default is focused rather than the first row',
		);

		driver.hide();
		assert.strictEqual(await picked, undefined);
	});

	test('keeps the row the user moved to while CLI detection ran', async () => {
		setCodexAsDefault();
		const { driver, picked, detect } = await openLoading();
		const toggle = getToggle(driver.qp.items);
		driver.qp.activeItems = [toggle];

		detect([codexAgent]);
		await driver.loaded;

		assert.deepStrictEqual(driver.qp.activeItems, [toggle], "the user's row stays focused");

		driver.hide();
		assert.strictEqual(await picked, undefined);
	});

	test('keeps the focus on the first row when the user typed filter text while CLI detection ran', async () => {
		setCodexAsDefault();
		const { driver, picked, detect } = await openLoading();
		const first = getFirstRow(driver.qp.items);
		driver.qp.value = 'claude';

		detect([codexAgent]);
		await driver.loaded;

		assert.deepStrictEqual(driver.qp.activeItems, [first], 'the default does not take the focus over the filter');

		driver.hide();
		assert.strictEqual(await picked, undefined);
	});
});

suite('buildAgentPickerItems — empty state', () => {
	const detectionFailedDescription = 'No supported IDE chat host, no Claude extension; unable to detect CLIs';

	function getHeader(items: readonly QuickPickItem[]): QuickPickItem {
		const [header] = items;
		assert.strictEqual(header.kind, QuickPickItemKind.Separator);
		return header;
	}

	test('with no agents found, says there are none', () => {
		const header = getHeader(buildAgentPickerItems([], { currentDefault: null }));

		assert.strictEqual(header.description, 'No supported IDE chat host, no Claude extension, no detected CLIs');
	});

	test('when CLI detection failed, says the CLIs could not be detected rather than that there are none', () => {
		const items = buildAgentPickerItems([], { currentDefault: null, detectionFailed: true });

		assert.strictEqual(getHeader(items).description, detectionFailedDescription);
		assert.deepStrictEqual(
			items.slice(1).map(i => i.label),
			['$(close) Close'],
		);
	});

	test('in the wizard, keeps Continue Manually and Close when CLI detection failed', () => {
		const items = buildAgentPickerItems([], { currentDefault: null, inWizard: true, detectionFailed: true });

		assert.strictEqual(getHeader(items).description, detectionFailedDescription);
		assert.deepStrictEqual(
			items.slice(1).map(i => i.action),
			['manual', 'cancel'],
		);
	});
});

suite('canOfferKeplerRoute', () => {
	test('offers the route for an item whose provider Kepler supports for its kind', () => {
		assert.strictEqual(canOfferKeplerRoute(true, githubIssue), true);
		assert.strictEqual(canOfferKeplerRoute(true, { kind: 'pr', providerId: 'github' }), true);
		assert.strictEqual(canOfferKeplerRoute(true, { kind: 'issue', providerId: 'jira' }), true);
	});

	test('Bitbucket: offered for a PR, NOT for an issue', () => {
		assert.strictEqual(canOfferKeplerRoute(true, bitbucketPr), true);
		assert.strictEqual(canOfferKeplerRoute(true, bitbucketIssue), false);
	});

	test('not offered where Kepler cannot launch (VS Code for the web)', () => {
		assert.strictEqual(canOfferKeplerRoute(false, githubIssue), false);
		assert.strictEqual(canOfferKeplerRoute(false, bitbucketPr), false);
	});

	test('not offered without an item, or for a provider with no Kepler id', () => {
		assert.strictEqual(canOfferKeplerRoute(true, undefined), false);
		assert.strictEqual(canOfferKeplerRoute(true, { kind: 'pr', providerId: 'bitbucket-server' }), false);
		assert.strictEqual(canOfferKeplerRoute(true, { kind: 'pr', providerId: 'not-a-provider' }), false);
	});
});

suite('resolveAgentRoute', () => {
	test("'ask' or no requested route defers to the persisted default", () => {
		assert.strictEqual(resolveAgentRoute('ask', 'manual', true), 'manual');
		assert.strictEqual(resolveAgentRoute(undefined, 'agent', true), 'agent');
		assert.strictEqual(resolveAgentRoute(undefined, undefined, true), 'ask');
	});

	test('an explicit requested route overrides the persisted default', () => {
		assert.strictEqual(resolveAgentRoute('agent', 'kepler', true), 'agent');
		assert.strictEqual(resolveAgentRoute('manual', 'kepler', true), 'manual');
	});

	test("a persisted 'kepler' default is honored when Kepler can serve the item", () => {
		assert.strictEqual(resolveAgentRoute('ask', 'kepler', true), 'kepler');
	});

	test("a persisted 'kepler' default falls back to asking when Kepler can't serve the item", () => {
		assert.strictEqual(resolveAgentRoute('ask', 'kepler', false), 'ask');
		assert.strictEqual(resolveAgentRoute(undefined, 'kepler', false), 'ask');
	});

	test("an explicit 'kepler' request falls back to asking when Kepler can't serve the item", () => {
		assert.strictEqual(resolveAgentRoute('kepler', 'manual', false), 'ask');
		assert.strictEqual(resolveAgentRoute('kepler', 'manual', true), 'kepler');
	});
});

suite('resolveAgentFlow — Kepler route', () => {
	let sandbox: sinon.SinonSandbox;

	setup(() => {
		sandbox = sinon.createSandbox();
	});

	teardown(() => {
		sandbox.restore();
	});

	function stubSettings(openInAgent: AgentRoute): void {
		const get = sandbox.stub(configuration, 'get') as sinon.SinonStub;
		get.withArgs('ai.openInAgent').returns(openInAgent);
		get.withArgs('ai.defaultAgent').returns(null);
	}

	function makeContainer(available: boolean): Container {
		return {
			kepler: { available: available },
			usage: { track: sandbox.stub().resolves() },
		} as unknown as Container;
	}

	/** Advances the flow once: either it resolves without prompting, or it yields its first step. */
	async function start(
		container: Container,
		options: Parameters<typeof resolveAgentFlow>[1],
	): Promise<{ result?: ResolveAgentFlowResult; routes?: string[]; keplerDescription?: string }> {
		const next = await resolveAgentFlow(container, options).next();
		if (next.done) {
			assert.notStrictEqual(typeof next.value, 'symbol', 'expected a flow result, not a break');
			return { result: next.value as ResolveAgentFlowResult };
		}

		const step = next.value as QuickPickStep;
		const items = step.items as { route?: string; description?: string }[];
		return {
			// Only the route rows — the Options separator and the Always-use toggle carry no route
			routes: items.flatMap(i => (i.route != null ? [i.route] : [])),
			keplerDescription: items.find(i => i.route === 'kepler')?.description,
		};
	}

	test("persisted 'kepler' + a supported issue resolves to Kepler without prompting", async () => {
		stubSettings('kepler');
		const { result } = await start(makeContainer(true), { requestedRoute: 'ask', item: githubIssue });
		assert.deepStrictEqual(result, { kind: 'kepler' });
	});

	test("persisted 'kepler' + a Bitbucket PR resolves to Kepler", async () => {
		stubSettings('kepler');
		const { result } = await start(makeContainer(true), { requestedRoute: 'ask', item: bitbucketPr });
		assert.deepStrictEqual(result, { kind: 'kepler' });
	});

	test("persisted 'kepler' + a Bitbucket issue asks instead, without a Kepler row", async () => {
		stubSettings('kepler');
		const { result, routes } = await start(makeContainer(true), { requestedRoute: 'ask', item: bitbucketIssue });
		assert.strictEqual(result, undefined);
		assert.deepStrictEqual(routes, ['agent', 'manual']);
	});

	test("persisted 'kepler' on the web asks instead, without a Kepler row", async () => {
		stubSettings('kepler');
		const { result, routes } = await start(makeContainer(false), { requestedRoute: 'ask', item: githubIssue });
		assert.strictEqual(result, undefined);
		assert.deepStrictEqual(routes, ['agent', 'manual']);
	});

	test("'ask' offers the Kepler row for a supported item", async () => {
		stubSettings('ask');
		const { routes } = await start(makeContainer(true), { requestedRoute: 'ask', item: githubIssue });
		assert.deepStrictEqual(routes, ['kepler', 'agent', 'manual']);
	});

	test('the Kepler row describes an issue as work and a PR as a review', async () => {
		stubSettings('ask');
		const issue = await start(makeContainer(true), { requestedRoute: 'ask', item: githubIssue });
		assert.strictEqual(issue.keplerDescription, 'Start a Kepler task to set up, run, and track the work');

		const pr = await start(makeContainer(true), { requestedRoute: 'ask', item: bitbucketPr });
		assert.strictEqual(pr.keplerDescription, 'Start a Kepler task to set up, run, and track the review');
	});

	test("'ask' offers no Kepler row when the caller passes no item", async () => {
		stubSettings('ask');
		const { routes } = await start(makeContainer(true), { requestedRoute: 'ask' });
		assert.deepStrictEqual(routes, ['agent', 'manual']);
	});

	test("useDefaults with a persisted 'kepler' continues manually — never a Kepler hand-off", async () => {
		stubSettings('kepler');
		const { result } = await start(makeContainer(true), {
			useDefaults: true,
			requestedRoute: 'ask',
			item: githubIssue,
		});
		assert.deepStrictEqual(result, { kind: 'manual' });
	});
});

suite('resolveAgentFlow — agent detection fails', () => {
	let sandbox: sinon.SinonSandbox;

	setup(() => {
		sandbox = sinon.createSandbox();
		const get = sandbox.stub(configuration, 'get') as sinon.SinonStub;
		get.withArgs('ai.openInAgent').returns('agent');
		get.withArgs('ai.defaultAgent').returns(cliAgentId);
	});

	teardown(() => {
		sandbox.restore();
	});

	test('useDefaults with an unverifiable CLI default continues manually, without prompting', async () => {
		const track = sandbox.stub().resolves();
		// Never settles, as a user ignoring the notice would — the flow must not wait on it
		const warning = sandbox.stub(window, 'showWarningMessage').returns(new Promise<never>(() => {}));
		const container = {
			kepler: { available: false },
			usage: { track: track },
			agents: { getDetectedCliAgents: () => Promise.reject(new Error("Agent detection didn't finish")) },
		} as unknown as Container;

		const next = await resolveAgentFlow(container, { useDefaults: true, requestedRoute: 'ask' }).next();

		assert.deepStrictEqual(next, { done: true, value: { kind: 'manual' } });
		// The default is unverified, not unavailable — so this is not a useDefaults fallback
		assert.strictEqual(track.called, false);
		assert.strictEqual(warning.callCount, 1);
		assert.deepStrictEqual(warning.firstCall.args, [
			'Unable to detect agents. Continued without the default agent.',
		]);
	});

	test('interactively, an unverifiable CLI default says so and offers the agent picker', async () => {
		const info = sandbox.stub(window, 'showInformationMessage').resolves(undefined);
		const container = {
			kepler: { available: false },
			agents: {
				getDetectedCliAgents: () => Promise.reject(new Error("Agent detection didn't finish")),
				onDidChangeAgents: neverChanges,
			},
		} as unknown as Container;

		const next = await resolveAgentFlow(container, { requestedRoute: 'agent' }).next();

		assert.strictEqual(next.done, false, 'the agent picker step is yielded');
		// Reports that the default could not be verified, not that it is gone
		assert.strictEqual(info.callCount, 1);
		assert.deepStrictEqual(info.firstCall.args, [
			'Unable to detect agents to verify the default agent. Choose an agent.',
		]);
	});

	test('going back to the route picker and on again does not repeat the notice', async () => {
		(configuration.get as sinon.SinonStub).withArgs('ai.openInAgent').returns('ask');
		const info = sandbox.stub(window, 'showInformationMessage').resolves(undefined);
		const container = {
			kepler: { available: false },
			agents: {
				getDetectedCliAgents: () => Promise.reject(new Error("Agent detection didn't finish")),
				onDidChangeAgents: neverChanges,
			},
		} as unknown as Container;
		const flow = resolveAgentFlow(container, { requestedRoute: 'ask' });

		/** Picks the agent route in the yielded route step, returning the agent step's result */
		async function pickAgentRoute(routeStep: IteratorResult<unknown, unknown>) {
			assert.strictEqual(routeStep.done, false, 'the route step is yielded');
			const routes = (routeStep.value as QuickPickStep<Row>).items as Row[];
			return flow.next([routes.find(i => i.route === 'agent')]);
		}

		const agentStep = await pickAgentRoute(await flow.next());
		assert.strictEqual(agentStep.done, false, 'the agent picker step is yielded');
		assert.strictEqual(info.callCount, 1);

		// Back from the agent picker, then the agent route again
		const againStep = await pickAgentRoute(await flow.next(Directive.Back));
		assert.strictEqual(againStep.done, false, 'the agent picker step is yielded again');
		assert.strictEqual(info.callCount, 1, 'the notice is not repeated');

		await flow.next(Directive.Back);
	});
});

suite('loadSupportedAgentsInStages', () => {
	let sandbox: sinon.SinonSandbox;

	setup(() => {
		sandbox = sinon.createSandbox();
	});

	teardown(() => {
		sandbox.restore();
	});

	test('a failed non-CLI check keeps the CLI rows', async () => {
		const getExtension = sandbox.stub(extensions, 'getExtension') as sinon.SinonStub;
		getExtension.callThrough();
		getExtension.withArgs(claudeExtensionId).returns({});
		const getCommands = sandbox.stub(commands, 'getCommands') as sinon.SinonStub;
		getCommands.callThrough();
		getCommands.withArgs(true).rejects(new Error('commands unavailable'));

		const { nonCli, all } = loadSupportedAgentsInStages(makeContainer());

		assert.deepStrictEqual(await nonCli, [], 'the failed check yields no non-CLI rows');
		const { agents, cliDetectionFailed } = await all;
		assert.deepStrictEqual(
			agents.map(a => a.id),
			[cliAgentId],
		);
		assert.strictEqual(cliDetectionFailed, false);
	});
});
