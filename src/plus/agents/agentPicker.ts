import type { QuickInputButton, QuickPickItem } from 'vscode';
import { ConfigurationTarget, QuickInputButtons, QuickPickItemKind, ThemeIcon, window } from 'vscode';
import type {
	AsyncStepResultGenerator,
	StepResultGenerator,
	StepSelection,
} from '../../commands/quick-wizard/models/steps.js';
import { StepResultBreak } from '../../commands/quick-wizard/models/steps.js';
import { canPickStepContinue, createPickStep } from '../../commands/quick-wizard/utils/steps.utils.js';
import type { Container } from '../../container.js';
import { executeCoreCommand } from '../../system/-webview/command.js';
import { configuration } from '../../system/-webview/configuration.js';
import type { AgentDescriptor, AgentRoute } from './agentDescriptor.js';
import { getSupportedAgents, resolveDefaultAgent } from './agentRegistry.js';

const passEmpty = new ThemeIcon('pass');
const passFilled = new ThemeIcon('pass-filled');

function checkButton(isCurrentDefault: boolean, label: string): QuickInputButton {
	return {
		iconPath: isCurrentDefault ? passFilled : passEmpty,
		tooltip: isCurrentDefault ? `Unset as default (${label})` : `Always ${label.toLowerCase()} (set as default)`,
	};
}

const settingsButton: QuickInputButton = {
	iconPath: new ThemeIcon('gear'),
	tooltip: 'Open Default Agent Setting',
};

interface RouteItem extends QuickPickItem {
	readonly route: 'manual' | 'agent';
}

interface AgentItem extends QuickPickItem {
	readonly descriptor?: AgentDescriptor;
	readonly action?: 'manual' | 'cancel';
}

const ideChatIcon = new ThemeIcon('comment-discussion');
const claudeIcon = new ThemeIcon('claude');
const cliIcon = new ThemeIcon('terminal');

function iconFor(kind: AgentDescriptor['kind']): ThemeIcon {
	switch (kind) {
		case 'ide-chat':
			return ideChatIcon;
		case 'claude-extension':
			return claudeIcon;
		case 'cli':
			return cliIcon;
	}
}

function descriptionFor(descriptor: AgentDescriptor): string {
	switch (descriptor.kind) {
		case 'ide-chat':
			return "Open in this IDE's chat";
		case 'claude-extension':
			return 'VS Code extension';
		case 'cli':
			return 'CLI';
	}
}

function sectionLabelFor(kind: AgentDescriptor['kind']): string | undefined {
	switch (kind) {
		case 'ide-chat':
			return 'IDE Chat';
		case 'claude-extension':
			return 'Extension';
		case 'cli':
			return 'CLI';
	}
}

/**
 * Step 1 of the agent flow — yields a wizard step that asks "Continue manually" vs "Open in an agent",
 * with a checkbox toggle for setting the default. Returns the chosen route, or `StepResultBreak`
 * when the user backs out (the wizard machinery handles the back navigation).
 */
export function* pickRouteStep(options?: { showBackButton?: boolean }): StepResultGenerator<'manual' | 'agent'> {
	let current: AgentRoute = configuration.get('ai.openInAgent') ?? 'ask';

	const buildItems = (currentDefault: AgentRoute): RouteItem[] => [
		{
			route: 'agent',
			label: '$(robot) Open in an agent',
			description: 'Open a chat or CLI session with the issue context',
			picked: currentDefault === 'agent',
			buttons: [checkButton(currentDefault === 'agent', 'Open in an agent')],
		},
		{
			route: 'manual',
			label: '$(arrow-right) Continue manually',
			description: 'Creates the branch/worktree based on your previous selection',
			picked: currentDefault === 'manual',
			buttons: [checkButton(currentDefault === 'manual', 'Continue manually')],
		},
	];

	const step = createPickStep<RouteItem>({
		title: 'Start with Agent',
		placeholder: 'Choose to continue with an agent or manually · mark the checkbox of a row to set as default',
		items: buildItems(current),
		buttons: options?.showBackButton ? [QuickInputButtons.Back] : undefined,
		onDidClickItemButton: async (qp, _button, item) => {
			const newDefault: AgentRoute = current === item.route ? 'ask' : item.route;
			await configuration.update('ai.openInAgent', newDefault, ConfigurationTarget.Global);
			current = newDefault;
			qp.items = buildItems(newDefault);
			const restored = qp.items.find((i): i is RouteItem => 'route' in i && i.route === item.route);
			if (restored != null) {
				qp.activeItems = [restored];
			}
			return false;
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	if (!canPickStepContinue(step, {}, selection)) return StepResultBreak;
	return selection[0].route;
}

export type PickAgentResult =
	| { readonly kind: 'agent'; readonly descriptor: AgentDescriptor }
	| { readonly kind: 'manual' }
	| typeof StepResultBreak;

export interface AgentPickerOptions {
	title?: string;
	placeholder?: string;
}

/**
 * Step 2 of the agent flow — yields a wizard step listing the available agents. Returns the chosen
 * descriptor, `'manual'` (empty-state opt-out), or `StepResultBreak` (back / close).
 */
export async function* pickAgentStep(
	options?: AgentPickerOptions & { showBackButton?: boolean },
): AsyncStepResultGenerator<PickAgentResult> {
	const available = await getSupportedAgents();
	let currentDefault: string | null = configuration.get('ai.defaultAgent') ?? null;

	const buildItems = (currentDefaultId: string | null): AgentItem[] => {
		if (available.length === 0) {
			return [
				{
					label: '$(warning) No agents available',
					description: 'No supported IDE chat host, no Claude extension, no detected CLIs',
					kind: QuickPickItemKind.Separator,
				},
				{
					label: '$(arrow-right) Continue Manually',
					description: 'Skip the agent and proceed with manual flow',
					action: 'manual',
				},
				{
					label: '$(close) Close',
					description: 'Cancel the wizard',
					action: 'cancel',
				},
			];
		}

		const items: AgentItem[] = [];
		let lastKind: AgentDescriptor['kind'] | undefined;
		for (const d of available) {
			if (d.kind !== lastKind) {
				const sep = sectionLabelFor(d.kind);
				if (sep != null) {
					items.push({ label: sep, kind: QuickPickItemKind.Separator });
				}
				lastKind = d.kind;
			}
			items.push({
				descriptor: d,
				label: `$(${(iconFor(d.kind) as { id?: string }).id ?? 'circle-outline'}) ${d.label}`,
				description: descriptionFor(d),
				picked: currentDefaultId === d.id,
				buttons: [checkButton(currentDefaultId === d.id, `Use ${d.label}`)],
			});
		}
		return items;
	};

	const titleButtons: QuickInputButton[] = [settingsButton];
	if (options?.showBackButton) {
		titleButtons.unshift(QuickInputButtons.Back);
	}

	const step = createPickStep<AgentItem>({
		title: options?.title ?? 'Choose an agent',
		placeholder:
			available.length === 0
				? 'No agents available'
				: `${options?.placeholder ?? 'Select where to proceed'} · mark the checkbox of a row to set as default`,
		items: buildItems(currentDefault),
		buttons: titleButtons,
		onDidClickButton: (_qp, button) => {
			if (button === settingsButton) {
				void executeCoreCommand('workbench.action.openSettings', 'gitlens.ai.defaultAgent');
			}
		},
		onDidClickItemButton: async (qp, _button, item) => {
			if (item.descriptor == null) return false;

			const id = item.descriptor.id;
			const newDefault = currentDefault === id ? null : id;
			await configuration.update('ai.defaultAgent', newDefault, ConfigurationTarget.Global);
			currentDefault = newDefault;
			qp.items = buildItems(newDefault);
			const restored = qp.items.find((i): i is AgentItem => 'descriptor' in i && i.descriptor?.id === id);
			if (restored != null) {
				qp.activeItems = [restored];
			}
			return false;
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	if (!canPickStepContinue(step, {}, selection)) return StepResultBreak;

	const [item] = selection;
	if (item.descriptor != null) return { kind: 'agent', descriptor: item.descriptor };
	if (item.action === 'manual') return { kind: 'manual' };
	// 'cancel' or anything else → break
	return StepResultBreak;
}

/**
 * Standalone version of the agent picker for non-wizard contexts (e.g., the "Pick another agent"
 * toast action that fires AFTER the wizard has completed). Safe to call when no wizard is active.
 * DO NOT use from inside a wizard's continuation — use {@link pickAgentStep} instead.
 */
export async function pickAgentStandalone(options?: AgentPickerOptions): Promise<AgentDescriptor | undefined> {
	const available = await getSupportedAgents();
	let currentDefault: string | null = configuration.get('ai.defaultAgent') ?? null;

	const qp = window.createQuickPick<AgentItem>();
	const disposables: { dispose: () => void }[] = [qp];

	const buildItems = (currentDefaultId: string | null): AgentItem[] => {
		if (available.length === 0) {
			return [
				{
					label: '$(warning) No agents available',
					description: 'No supported IDE chat host, no Claude extension, no detected CLIs',
					kind: QuickPickItemKind.Separator,
				},
				{
					label: '$(close) Close',
				},
			];
		}

		const items: AgentItem[] = [];
		let lastKind: AgentDescriptor['kind'] | undefined;
		for (const d of available) {
			if (d.kind !== lastKind) {
				const sep = sectionLabelFor(d.kind);
				if (sep != null) {
					items.push({ label: sep, kind: QuickPickItemKind.Separator });
				}
				lastKind = d.kind;
			}
			items.push({
				descriptor: d,
				label: `$(${(iconFor(d.kind) as { id?: string }).id ?? 'circle-outline'}) ${d.label}`,
				description: descriptionFor(d),
				picked: currentDefaultId === d.id,
				buttons: [checkButton(currentDefaultId === d.id, `Use ${d.label}`)],
			});
		}
		return items;
	};

	try {
		qp.title = options?.title ?? 'Choose an agent';
		qp.placeholder =
			available.length === 0
				? 'No agents available'
				: `${options?.placeholder ?? 'Select where to proceed'} · mark the checkbox of a row to set as default`;
		qp.buttons = [settingsButton];
		qp.items = buildItems(currentDefault);
		qp.activeItems = qp.items.filter(i => i.picked);

		return await new Promise<AgentDescriptor | undefined>(resolve => {
			disposables.push(
				qp.onDidTriggerButton(button => {
					if (button === settingsButton) {
						void executeCoreCommand('workbench.action.openSettings', 'gitlens.ai.defaultAgent');
					}
				}),
				qp.onDidTriggerItemButton(async e => {
					if (e.item.descriptor == null) return;

					const id = e.item.descriptor.id;
					const newDefault = currentDefault === id ? null : id;
					await configuration.update('ai.defaultAgent', newDefault, ConfigurationTarget.Global);
					currentDefault = newDefault;
					qp.items = buildItems(newDefault);
					const restored = qp.items.find(i => i.descriptor?.id === id);
					if (restored != null) {
						qp.activeItems = [restored];
					}
				}),
				qp.onDidAccept(() => {
					const item = qp.selectedItems[0];
					resolve(item?.descriptor);
				}),
				qp.onDidHide(() => resolve(undefined)),
			);
			qp.show();
		});
	} finally {
		for (const d of disposables) {
			d.dispose();
		}
	}
}

/**
 * Picks an agent and persists the selection to `gitlens.ai.defaultAgent` (writes immediately on
 * accept). Unlike {@link pickAgentStandalone}, no per-item checkbox/toggle is shown — choosing an
 * item IS the action. The current default is pre-selected as the active item.
 *
 * Returns the chosen descriptor, or `undefined` when the user dismisses the picker (no write).
 */
export async function pickAndSetDefaultAgent(options?: AgentPickerOptions): Promise<AgentDescriptor | undefined> {
	const available = await getSupportedAgents();
	const currentDefault: string | null = configuration.get('ai.defaultAgent') ?? null;

	const qp = window.createQuickPick<AgentItem>();
	const disposables: { dispose: () => void }[] = [qp];

	const buildItems = (): AgentItem[] => {
		if (available.length === 0) {
			return [
				{
					label: '$(warning) No agents available',
					description: 'No supported IDE chat host, no Claude extension, no detected CLIs',
					kind: QuickPickItemKind.Separator,
				},
				{
					label: '$(close) Close',
				},
			];
		}

		const items: AgentItem[] = [];
		let lastKind: AgentDescriptor['kind'] | undefined;
		for (const d of available) {
			if (d.kind !== lastKind) {
				const sep = sectionLabelFor(d.kind);
				if (sep != null) {
					items.push({ label: sep, kind: QuickPickItemKind.Separator });
				}
				lastKind = d.kind;
			}
			items.push({
				descriptor: d,
				label: `$(${(iconFor(d.kind) as { id?: string }).id ?? 'circle-outline'}) ${d.label}`,
				description: descriptionFor(d),
			});
		}
		return items;
	};

	try {
		qp.title = options?.title ?? 'Switch Default Agent';
		qp.placeholder =
			available.length === 0 ? 'No agents available' : (options?.placeholder ?? 'Select the default agent');
		qp.buttons = [settingsButton];
		qp.items = buildItems();
		const active = qp.items.find((i): i is AgentItem => 'descriptor' in i && i.descriptor?.id === currentDefault);
		if (active != null) {
			qp.activeItems = [active];
		}

		return await new Promise<AgentDescriptor | undefined>(resolve => {
			disposables.push(
				qp.onDidTriggerButton(button => {
					if (button === settingsButton) {
						void executeCoreCommand('workbench.action.openSettings', 'gitlens.ai.defaultAgent');
					}
				}),
				qp.onDidAccept(async () => {
					const item = qp.selectedItems[0];
					if (item?.descriptor != null) {
						await configuration.update('ai.defaultAgent', item.descriptor.id, ConfigurationTarget.Global);
					}
					resolve(item?.descriptor);
				}),
				qp.onDidHide(() => resolve(undefined)),
			);
			qp.show();
		});
	} finally {
		for (const d of disposables) {
			d.dispose();
		}
	}
}

export type ResolveAgentFlowResult =
	| { readonly kind: 'manual' }
	| { readonly kind: 'agent'; readonly descriptor: AgentDescriptor }
	| { readonly kind: 'cancel' };

/** Builds the `agent.resolution` telemetry payload for a resolved manual-vs-agent flow. */
export function buildAgentResolvedTelemetryData(
	result: ResolveAgentFlowResult,
):
	| { 'agent.resolution': 'manual' | 'cancel' }
	| { 'agent.resolution': 'agent'; 'agent.id': string; 'agent.kind': AgentDescriptor['kind'] } {
	if (result.kind === 'agent') {
		return {
			'agent.resolution': 'agent',
			'agent.id': result.descriptor.id,
			'agent.kind': result.descriptor.kind,
		};
	}
	return { 'agent.resolution': result.kind };
}

/**
 * Orchestrates the manual-vs-agent flow. Yields wizard steps as needed (pre-picker / agent picker)
 * to remain compatible with the wizard's step machinery — DO NOT use `window.createQuickPick` here
 * because the wizard's still-alive picker collides with new QuickPicks and silently exits.
 *
 * Honors the `useDefaults` contract: never yields a step when `useDefaults: true`. Caller can
 * `yield*` this generator from a continuation; the returned value is the resolved flow result.
 */
export async function* resolveAgentFlow(
	container: Container | undefined,
	options: { useDefaults?: boolean; requestedRoute?: AgentRoute },
): AsyncStepResultGenerator<ResolveAgentFlowResult> {
	// `'ask'` from the caller (or unspecified) defers to the persisted `gitlens.ai.openInAgent`
	// default so the user's preference is honored on generic UI entries (Home, Graph WIP empty pane).
	// `'manual'`/`'agent'` from the caller are explicit overrides (e.g., the "Start Work in Agent"
	// surfaces) and always force that route regardless of the persisted setting.
	const requested: AgentRoute = options.requestedRoute ?? 'ask';
	const route: AgentRoute = requested === 'ask' ? (configuration.get('ai.openInAgent') ?? 'ask') : requested;
	const persistedAgentId: string | undefined = configuration.get('ai.defaultAgent') ?? undefined;

	if (options.useDefaults) {
		// Hard contract: never pop a picker when useDefaults is true (would deadlock MCP/IPC callers).
		if (route !== 'agent') {
			return { kind: 'manual' };
		}

		if (persistedAgentId == null) {
			void container?.usage.track('action:gitlens.ai.openInAgent.useDefaultsFallback:happened');
			return { kind: 'manual' };
		}

		// resolveDefaultAgent only returns descriptors that pass the supported-agents filter,
		// so no extra availability check is needed — runAgent re-validates at dispatch time.
		const descriptor = await resolveDefaultAgent(persistedAgentId);
		if (descriptor == null) {
			void container?.usage.track('action:gitlens.ai.openInAgent.useDefaultsFallback:happened');
			return { kind: 'manual' };
		}
		return { kind: 'agent', descriptor: descriptor };
	}

	// Interactive flow — yield steps to the wizard machinery.
	while (true) {
		let chosenRoute: 'manual' | 'agent';
		if (route === 'manual' || route === 'agent') {
			chosenRoute = route;
		} else {
			const result = yield* pickRouteStep({ showBackButton: true });
			if (result === StepResultBreak) return { kind: 'cancel' };

			chosenRoute = result;
		}

		if (chosenRoute === 'manual') return { kind: 'manual' };

		// Agent route: try persisted default first.
		if (persistedAgentId != null) {
			const descriptor = await resolveDefaultAgent(persistedAgentId);
			if (descriptor != null) {
				return { kind: 'agent', descriptor: descriptor };
			}

			void window.showInformationMessage(`Default agent is no longer available. Choose another.`);
		}

		// Need to pick an agent. Show back button only when we got here via the pre-picker.
		const picked = yield* pickAgentStep({ showBackButton: route === 'ask' });
		if (picked === StepResultBreak) {
			// Back: when the pre-picker was shown, loop back to it. Otherwise cancel.
			if (route === 'ask') continue;
			return { kind: 'cancel' };
		}
		if (picked.kind === 'agent') return { kind: 'agent', descriptor: picked.descriptor };
		// 'manual' — user picked "Continue Manually" from empty state
		return { kind: 'manual' };
	}
}
