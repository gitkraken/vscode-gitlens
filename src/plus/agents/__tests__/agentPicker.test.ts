import * as assert from 'node:assert';
import * as sinon from 'sinon';
import type { QuickPick, QuickPickItem } from 'vscode';
import { ConfigurationTarget, QuickPickItemKind, window } from 'vscode';
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
import type { AgentDescriptor } from '../agentDescriptor.js';
import { getRequestedAgentRoute, pickAgentStandalone, pickAgentStep, pickRouteStep } from '../agentPicker.js';

type Row = QuickPickItem & { route?: string; descriptor?: AgentDescriptor };

const cliAgentId = 'cli:codex';

function makeContainer(): Container {
	const agent: GkAgent = {
		name: 'codex',
		displayName: 'Codex',
		detected: true,
		executable: '/usr/bin/codex',
		mcpSupported: true,
		mcpInstalled: false,
		hooksSupported: true,
		hooksInstalled: false,
	};
	return {
		agents: { getDetectedCliAgents: () => Promise.resolve([agent]) },
	} as unknown as Container;
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

async function startStep<T>(
	generator: AsyncGenerator<unknown, T>,
): Promise<{ items: Row[]; toggle: ConfirmToggleQuickPickItem }> {
	const { value } = await generator.next();
	const items = (value as QuickPickStep<Row>).items as Row[];
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
});

type QuickPickDriver = {
	qp: QuickPick<Row>;
	shown: Promise<void>;
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
	const noopDisposable = { dispose: () => {} };
	const qp = {
		items: [] as Row[],
		activeItems: [] as Row[],
		selectedItems: [] as Row[],
		title: '',
		placeholder: '',
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

	/** Opens the picker and waits until it is shown — `getSupportedAgents` resolves before the rows exist. */
	async function open(): Promise<{
		picked: Promise<AgentDescriptor | undefined>;
		driver: QuickPickDriver;
	}> {
		const driver = makeQuickPickDriver();
		sandbox.stub(window, 'createQuickPick').returns(driver.qp);

		const picked = pickAgentStandalone(makeContainer());
		await driver.shown;
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

		await driver.accept(toggle);
		assert.strictEqual(toggle.checked, true);
		assert.strictEqual(update.called, false);
		// The re-render keeps the same row object, so its checked state is what the user sees
		assert.strictEqual(getToggle(driver.qp.items), toggle);

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

	test('arming the toggle then dismissing persists nothing', async () => {
		const { picked, driver } = await open();

		await driver.accept(getToggle(driver.qp.items));
		driver.hide();

		assert.strictEqual(await picked, undefined);
		assert.strictEqual(update.called, false);
	});
});
