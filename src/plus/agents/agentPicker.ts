import type { QuickInputButton, QuickPickItem } from 'vscode';
import { ConfigurationTarget, l10n, QuickInputButtons, QuickPickItemKind, ThemeIcon, window } from 'vscode';
import type { AsyncStepResultGenerator, StepSelection } from '../../commands/quick-wizard/models/steps.js';
import { StepResultBreak } from '../../commands/quick-wizard/models/steps.js';
import type { QuickPickStep } from '../../commands/quick-wizard/models/steps.quickpick.js';
import {
	canPickStepContinue,
	confirmOptionsSeparatorLabel,
	createPickStep,
	rerenderConfirmStepItems,
} from '../../commands/quick-wizard/utils/steps.utils.js';
import type { Container } from '../../container.js';
import { createQuickPickSeparator } from '../../quickpicks/items/common.js';
import type { ConfirmToggleQuickPickItem } from '../../quickpicks/items/directive.js';
import { createConfirmToggleQuickPickItem } from '../../quickpicks/items/directive.js';
import { executeCoreCommand } from '../../system/-webview/command.js';
import { configuration } from '../../system/-webview/configuration.js';
import type { AgentDescriptor, AgentRoute } from './agentDescriptor.js';
import { getSupportedAgents, resolveDefaultAgent } from './agentRegistry.js';

const settingsButton: QuickInputButton = {
	iconPath: new ThemeIcon('gear'),
	tooltip: l10n.t('Open Default Agent Setting'),
};

const routeSettingsButton: QuickInputButton = {
	iconPath: new ThemeIcon('gear'),
	tooltip: l10n.t('Open Default Route Setting'),
};

/**
 * Builds the in-list "Always use this …" row the agent-flow pickers offer, on the wizard's Don't Ask
 * Again toggle. Unlike that toggle, flipping this one writes nothing — it only arms the pick that
 * follows, so tick-then-back saves nothing. Always starts unchecked: these pickers only appear when
 * no usable default is set.
 */
function createAlwaysUseToggle(
	label: string,
	settingButton: QuickInputButton,
	onDidChange: () => void,
): ConfirmToggleQuickPickItem {
	const toggle = createConfirmToggleQuickPickItem({
		label: label,
		detail: l10n.t('Skip this step from now on — change anytime in settings'),
		checked: false,
		onDidChange: onDidChange,
	});
	// The detail promises "change anytime in settings" — the row button honors it
	toggle.buttons = [settingButton];
	return toggle;
}

function appendAlwaysUseToggle<T extends QuickPickItem>(items: T[], toggle: ConfirmToggleQuickPickItem): T[] {
	return [...items, createQuickPickSeparator<T>(confirmOptionsSeparatorLabel), toggle as unknown as T];
}

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
			return l10n.t("Open in this IDE's chat");
		case 'claude-extension':
			return l10n.t('VS Code extension');
		case 'cli':
			return l10n.t('CLI');
	}
}

function sectionLabelFor(kind: AgentDescriptor['kind']): string | undefined {
	switch (kind) {
		case 'ide-chat':
			return l10n.t('IDE Chat');
		case 'claude-extension':
			return l10n.t('Extension');
		case 'cli':
			return l10n.t('CLI');
	}
}

/**
 * The route Start Work / Start Review run with. An explicit `showOpenInAgent` wins; otherwise the
 * `gitlens.ai.openInAgent` setting applies, so the plain commands honour it too.
 *
 * EXCEPT for programmatic callers that already say how to finish — `useDefaults` or
 * `openChatOnComplete` (e.g. the gk CLI's `mcp/issue/start` and `mcp/pr/review/start`). They keep
 * the legacy path (`undefined`): routing them through the agent flow would resolve to manual under
 * `useDefaults` and silently drop the chat hand-off they asked for.
 */
export function getRequestedAgentRoute(args?: {
	showOpenInAgent?: AgentRoute;
	useDefaults?: boolean;
	openChatOnComplete?: boolean;
}): AgentRoute | undefined {
	if (args?.showOpenInAgent != null) return args.showOpenInAgent;
	if (args?.useDefaults || args?.openChatOnComplete != null) return undefined;

	return configuration.get('ai.openInAgent');
}

/**
 * Step 1 of the agent flow — yields a wizard step that asks "Continue manually" vs "Open in an agent",
 * with an "Always use this choice" toggle that, when armed, persists the picked route as the
 * `gitlens.ai.openInAgent` default. Returns the chosen route, or `StepResultBreak` when the user backs
 * out (the wizard machinery handles the back navigation).
 */
export async function* pickRouteStep(options?: {
	showBackButton?: boolean;
}): AsyncStepResultGenerator<'manual' | 'agent'> {
	const items: RouteItem[] = [
		{
			route: 'agent',
			label: l10n.t('$(robot) Open in an agent'),
			description: l10n.t('Open a chat or CLI session with the issue context'),
		},
		{
			route: 'manual',
			label: l10n.t('$(arrow-right) Continue manually'),
			description: l10n.t('Creates the branch/worktree based on your previous selection'),
		},
	];

	let step: QuickPickStep<RouteItem>;
	const toggle = createAlwaysUseToggle(l10n.t('Always use this choice'), routeSettingsButton, () =>
		rerenderConfirmStepItems(step),
	);

	step = createPickStep<RouteItem>({
		title: l10n.t('Start with Agent'),
		placeholder: l10n.t('Choose to continue with an agent or manually'),
		items: appendAlwaysUseToggle(items, toggle),
		buttons: options?.showBackButton ? [QuickInputButtons.Back] : undefined,
		onDidClickItemButton: (_qp, button) => {
			if (button === routeSettingsButton) {
				void executeCoreCommand('workbench.action.openSettings', 'gitlens.ai.openInAgent');
			}
			return false;
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	if (!canPickStepContinue(step, {}, selection)) return StepResultBreak;

	const { route } = selection[0];
	if (toggle.checked) {
		await configuration.update('ai.openInAgent', route, ConfigurationTarget.Global);
	}
	return route;
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
 * Step 2 of the agent flow — yields a wizard step listing the available agents, with an "Always use
 * this agent" toggle that, when armed, persists the picked agent as the `gitlens.ai.defaultAgent`
 * default. Returns the chosen descriptor, `'manual'` (empty-state opt-out), or `StepResultBreak`
 * (back / close).
 */
export async function* pickAgentStep(
	container: Container,
	options?: AgentPickerOptions & { showBackButton?: boolean },
): AsyncStepResultGenerator<PickAgentResult> {
	const available = await getSupportedAgents(container);
	const currentDefault: string | null = configuration.get('ai.defaultAgent') ?? null;

	let step: QuickPickStep<AgentItem>;
	const toggle = createAlwaysUseToggle(l10n.t('Always use this agent'), settingsButton, () =>
		rerenderConfirmStepItems(step),
	);

	let items: AgentItem[];
	if (available.length === 0) {
		items = [
			{
				label: l10n.t('$(warning) No agents available'),
				description: l10n.t('No supported IDE chat host, no Claude extension, no detected CLIs'),
				kind: QuickPickItemKind.Separator,
			},
			{
				label: l10n.t('$(arrow-right) Continue Manually'),
				description: l10n.t('Skip the agent and proceed with manual flow'),
				action: 'manual',
			},
			{
				label: l10n.t('$(close) Close'),
				description: l10n.t('Cancel the wizard'),
				action: 'cancel',
			},
		];
	} else {
		// No toggle on the empty state — there is no agent to make the default
		items = appendAlwaysUseToggle(buildAgentItems(available, currentDefault), toggle);
	}

	const titleButtons: QuickInputButton[] = [settingsButton];
	if (options?.showBackButton) {
		titleButtons.unshift(QuickInputButtons.Back);
	}

	step = createPickStep<AgentItem>({
		title: options?.title ?? l10n.t('Choose an Agent'),
		placeholder:
			available.length === 0
				? l10n.t('No agents available')
				: (options?.placeholder ?? l10n.t('Select where to proceed')),
		items: items,
		buttons: titleButtons,
		onDidClickButton: (_qp, button) => {
			if (button === settingsButton) {
				void executeCoreCommand('workbench.action.openSettings', 'gitlens.ai.defaultAgent');
			}
		},
		onDidClickItemButton: (_qp, button) => {
			if (button === settingsButton) {
				void executeCoreCommand('workbench.action.openSettings', 'gitlens.ai.defaultAgent');
			}
			return false;
		},
	});

	const selection: StepSelection<typeof step> = yield step;
	if (!canPickStepContinue(step, {}, selection)) return StepResultBreak;

	const [item] = selection;
	if (item.descriptor != null) {
		if (toggle.checked) {
			await configuration.update('ai.defaultAgent', item.descriptor.id, ConfigurationTarget.Global);
		}
		return { kind: 'agent', descriptor: item.descriptor };
	}
	if (item.action === 'manual') return { kind: 'manual' };
	// 'cancel' or anything else → break
	return StepResultBreak;
}

/** The agent rows (grouped under per-kind separators) the agent pickers share. */
function buildAgentItems(available: readonly AgentDescriptor[], currentDefault: string | null): AgentItem[] {
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
			picked: currentDefault === d.id,
		});
	}
	return items;
}

/**
 * Standalone version of the agent picker for non-wizard contexts (e.g., the "Pick another agent"
 * toast action that fires AFTER the wizard has completed). Safe to call when no wizard is active.
 * DO NOT use from inside a wizard's continuation — use {@link pickAgentStep} instead.
 *
 * Offers the same "Always use this agent" toggle as {@link pickAgentStep}; outside the wizard nothing
 * dispatches a directive row's `onDidSelect`, so the accept handler below does it by hand.
 */
export async function pickAgentStandalone(
	container: Container,
	options?: AgentPickerOptions,
): Promise<AgentDescriptor | undefined> {
	const available = await getSupportedAgents(container);
	const currentDefault: string | null = configuration.get('ai.defaultAgent') ?? null;

	const qp = window.createQuickPick<AgentItem>();
	const disposables: { dispose: () => void }[] = [qp];

	const toggle = createAlwaysUseToggle(l10n.t('Always use this agent'), settingsButton, () => {
		// A shown row mutated in place needs an items reassignment for the quickpick to notice
		const active = qp.activeItems;
		qp.items = [...qp.items];
		qp.activeItems = active;
	});

	try {
		qp.title = options?.title ?? l10n.t('Choose an Agent');
		qp.placeholder =
			available.length === 0
				? l10n.t('No agents available')
				: (options?.placeholder ?? l10n.t('Select where to proceed'));
		qp.buttons = [settingsButton];
		qp.items =
			available.length === 0
				? [
						{
							label: l10n.t('$(warning) No agents available'),
							description: l10n.t('No supported IDE chat host, no Claude extension, no detected CLIs'),
							kind: QuickPickItemKind.Separator,
						},
						{
							label: l10n.t('$(close) Close'),
						},
					]
				: appendAlwaysUseToggle(buildAgentItems(available, currentDefault), toggle);
		qp.activeItems = qp.items.filter(i => i.picked);

		return await new Promise<AgentDescriptor | undefined>(resolve => {
			disposables.push(
				qp.onDidTriggerButton(button => {
					if (button === settingsButton) {
						void executeCoreCommand('workbench.action.openSettings', 'gitlens.ai.defaultAgent');
					}
				}),
				qp.onDidTriggerItemButton(e => {
					if (e.button === settingsButton) {
						void executeCoreCommand('workbench.action.openSettings', 'gitlens.ai.defaultAgent');
					}
				}),
				qp.onDidAccept(async () => {
					const item = qp.selectedItems[0];
					if (item === toggle) {
						// Keeps the picker open, as `Directive.Noop` does inside the wizard
						await toggle.onDidSelect?.(qp);
						return;
					}

					if (item?.descriptor != null && toggle.checked) {
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

/**
 * Picks an agent and persists the selection to `gitlens.ai.defaultAgent` (writes immediately on
 * accept). Unlike {@link pickAgentStandalone}, no "Always use this agent" toggle is shown — choosing
 * an item IS the action. The current default is pre-selected as the active item.
 *
 * Returns the chosen descriptor, or `undefined` when the user dismisses the picker (no write).
 */
export async function pickAndSetDefaultAgent(
	container: Container,
	options?: AgentPickerOptions,
): Promise<AgentDescriptor | undefined> {
	const available = await getSupportedAgents(container);
	const currentDefault: string | null = configuration.get('ai.defaultAgent') ?? null;

	const qp = window.createQuickPick<AgentItem>();
	const disposables: { dispose: () => void }[] = [qp];

	const buildItems = (): AgentItem[] => {
		if (available.length === 0) {
			return [
				{
					label: l10n.t('$(warning) No agents available'),
					description: l10n.t('No supported IDE chat host, no Claude extension, no detected CLIs'),
					kind: QuickPickItemKind.Separator,
				},
				{
					label: l10n.t('$(close) Close'),
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
		qp.title = options?.title ?? l10n.t('Switch Default Agent');
		qp.placeholder =
			available.length === 0
				? l10n.t('No agents available')
				: (options?.placeholder ?? l10n.t('Select the default agent'));
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
	// default so the user's preference is honored on generic UI entries (the Graph WIP empty pane).
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
		const descriptor = container != null ? await resolveDefaultAgent(container, persistedAgentId) : undefined;
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
			const descriptor = container != null ? await resolveDefaultAgent(container, persistedAgentId) : undefined;
			if (descriptor != null) {
				return { kind: 'agent', descriptor: descriptor };
			}

			void window.showInformationMessage(l10n.t('Default agent is no longer available. Choose another.'));
		}

		// Need to pick an agent. Show back button only when we got here via the pre-picker.
		const picked = yield* pickAgentStep(container!, { showBackButton: route === 'ask' });
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
