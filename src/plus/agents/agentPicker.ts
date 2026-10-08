import type { QuickInputButton, QuickPick, QuickPickItem } from 'vscode';
import { ConfigurationTarget, l10n, QuickInputButtons, QuickPickItemKind, ThemeIcon, window } from 'vscode';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import { Logger } from '@gitlens/utils/logger.js';
import { defer } from '@gitlens/utils/promise.js';
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
import type { ConfirmToggleQuickPickItem, DirectiveQuickPickItem } from '../../quickpicks/items/directive.js';
import { createConfirmToggleQuickPickItem } from '../../quickpicks/items/directive.js';
import { executeCoreCommand } from '../../system/-webview/command.js';
import { configuration } from '../../system/-webview/configuration.js';
import { getKeplerProviderId, isKeplerSupportedProvider } from '../kepler/keplerProviders.js';
import type { AgentDescriptor, AgentRoute } from './agentDescriptor.js';
import { loadSupportedAgentsInStages, resolveDefaultAgent } from './agentRegistry.js';

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
	onDidChange: (quickpick: QuickPick<QuickPickItem>) => void,
): ConfirmToggleQuickPickItem {
	const toggle = createConfirmToggleQuickPickItem({
		label: label,
		detail: l10n.t('Skip this step from now on — change anytime in settings'),
		checked: false,
		onDidChange: (_item, quickpick) => onDidChange(quickpick),
	});
	// The detail promises "change anytime in settings" — the row button honors it
	toggle.buttons = [settingButton];
	return toggle;
}

function appendAlwaysUseToggle<T extends QuickPickItem>(items: T[], toggle: ConfirmToggleQuickPickItem): T[] {
	return [...items, createQuickPickSeparator<T>(confirmOptionsSeparatorLabel), toggle as unknown as T];
}

type PickableRoute = Exclude<AgentRoute, 'ask'>;

interface RouteItem extends QuickPickItem {
	readonly route: PickableRoute;
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

/** The PR or issue a route is being resolved for — only what decides whether Kepler can serve it. */
export interface AgentRouteItem {
	readonly kind: 'pr' | 'issue';
	/** The item's GitLens provider (integration) id, i.e. `ProviderReference.id` */
	readonly providerId: string;
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
 * Whether the route step can offer "Open in Kepler" for this item: Kepler must be launchable here
 * (not VS Code for the web) and support the item's provider for its kind — a Bitbucket PR qualifies,
 * a Bitbucket issue does not. Deliberately ignores `KeplerService.installed`: a Kepler that isn't
 * installed is handled when the task starts (a warning offering Get Kepler), as the tree commands
 * do, since detection can't see every install.
 */
export function canOfferKeplerRoute(keplerAvailable: boolean, item: AgentRouteItem | undefined): boolean {
	if (!keplerAvailable || item == null) return false;

	return isKeplerSupportedProvider(item.kind, getKeplerProviderId(item.providerId));
}

/**
 * Resolves the effective route. An explicit route from the caller wins; `'ask'` (or none) defers to
 * the persisted `gitlens.ai.openInAgent` default. A `'kepler'` route that Kepler can't serve for
 * THIS item falls back to `'ask'` — the default is a preference across items, so one Kepler can't
 * take (an unsupported provider, or the web) should show the picker rather than fail.
 */
export function resolveAgentRoute(
	requested: AgentRoute | undefined,
	persisted: AgentRoute | undefined,
	keplerOffered: boolean,
): AgentRoute {
	const route = requested == null || requested === 'ask' ? (persisted ?? 'ask') : requested;
	if (route === 'kepler' && !keplerOffered) return 'ask';

	return route;
}

/**
 * Step 1 of the agent flow — yields a wizard step that asks "Continue manually" vs "Open in an agent"
 * (plus "Open in Kepler", first, when `kepler` is set), with an "Always use this choice" toggle that,
 * when armed, persists the picked route as the `gitlens.ai.openInAgent` default. Returns the chosen
 * route, or `StepResultBreak` when the user backs out (the wizard machinery handles the back
 * navigation).
 */
export async function* pickRouteStep(options?: {
	showBackButton?: boolean;
	/**
	 * Offer the "Open in Kepler" row for this kind of item — see {@link canOfferKeplerRoute}. The
	 * kind also picks the row's description: an issue is started as work, a PR as a review.
	 */
	kepler?: AgentRouteItem['kind'];
}): AsyncStepResultGenerator<PickableRoute> {
	const kepler = options?.kepler;

	const items: RouteItem[] = [
		...(kepler != null
			? [
					{
						route: 'kepler',
						label: l10n.t('$(gitlens-kepler) Open in Kepler'),
						description:
							kepler === 'pr'
								? l10n.t('Start a Kepler task to set up, run, and track the review')
								: l10n.t('Start a Kepler task to set up, run, and track the work'),
					} satisfies RouteItem,
				]
			: []),
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
		placeholder:
			kepler != null
				? l10n.t('Choose to continue in Kepler, with an agent, or manually')
				: l10n.t('Choose to continue with an agent or manually'),
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
	const currentDefault: string | null = configuration.get('ai.defaultAgent') ?? null;
	let loaded: SupportedAgentsLoadState | undefined;

	let step: QuickPickStep<AgentItem>;
	const toggle = createAlwaysUseToggle(l10n.t('Always use this agent'), settingsButton, () =>
		rerenderConfirmStepItems(step),
	);

	const getPlaceholder = (): string =>
		loaded?.agents.length === 0
			? getEmptyPlaceholder(loaded.detectionFailed)
			: (options?.placeholder ?? l10n.t('Select where to proceed'));

	// The rows the step's quickpick last showed, and whether they were only the non-CLI rows of a first load. The
	// wizard only hands the step its quickpick once the first load has rendered, so a reload landing before that is
	// applied when the step activates
	let rendered: readonly QuickPickItem[] | undefined;
	let renderedPartial = false;
	// Whether `step.items` are only the non-CLI rows of a first load
	let itemsPartial = false;
	const renderReload = (qp: QuickPick<DirectiveQuickPickItem | AgentItem>): void => {
		// The wizard clears `busy` once it renders the first load, which may be only the non-CLI rows
		qp.busy = loaded?.loading ?? true;
		if (!Array.isArray(step.items) || step.items === rendered) return;

		qp.placeholder = getPlaceholder();
		replaceShownItems(qp, step.items, items => items.filter(i => i.picked), renderedPartial);
		rendered = step.items;
		renderedPartial = itemsPartial;
	};

	// Yield the step before loading agents, so a slow agent list shows "Loading..." in this step instead of freezing the previous one
	const initialItems = defer<AgentItem[]>();

	const titleButtons: QuickInputButton[] = [settingsButton];
	if (options?.showBackButton) {
		titleButtons.unshift(QuickInputButtons.Back);
	}

	step = createPickStep<AgentItem>({
		title: options?.title ?? l10n.t('Choose an Agent'),
		placeholder: getPlaceholder,
		items: initialItems.promise,
		buttons: titleButtons,
		onDidActivate: qp => renderReload(qp),
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

	const watcher = watchSupportedAgents(container, {
		apply: state => {
			loaded = state;
			const items = buildAgentPickerItems(state.agents, {
				currentDefault: currentDefault,
				toggle: toggle,
				inWizard: true,
				detectionFailed: state.detectionFailed,
			});
			// Swap in the resolved array so `rerenderConfirmStepItems` (which bails on a Promise) keeps working, and
			// the wizard (which restores `step.items` when the filter text changes) never reverts a reload
			step.items = items;
			itemsPartial = state.loading;

			if (initialItems.pending) {
				rendered = items;
				renderedPartial = itemsPartial;
				initialItems.fulfill(items);
			} else if (step.quickpick != null) {
				renderReload(step.quickpick);
			}
		},
		onDidStartReload: () => {
			if (loaded == null) return;

			// Keeps the shown rows, but reads as busy until the reload applies
			loaded = { ...loaded, loading: true };
			if (step.quickpick != null) {
				renderReload(step.quickpick);
			}
		},
	});

	let selection: StepSelection<typeof step>;
	try {
		selection = yield step;
	} finally {
		// Left before the first load landed (dismissed, or Back): the initial items deliberately stay pending. The
		// wizard has already stopped waiting on them — leaving resolves the step without them — and settling them
		// now would resume its suspended first render against the quickpick it has since disposed
		watcher.dispose();
	}
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

type SupportedAgentsLoadState = {
	readonly agents: AgentDescriptor[];
	/** CLI detection is still running, so `agents` holds only the non-CLI rows so far (or, in the wizard step's own
	 *  copy, a reload is running, so `agents` are the rows it will replace) */
	readonly loading: boolean;
	/** CLI detection failed, so `agents` lacks the CLI rows because they're unknown, not absent */
	readonly detectionFailed: boolean;
};

/**
 * Loads the supported agents for an open picker now, and again whenever agent detection changes — a
 * detection that timed out (so the picker loaded without its CLI rows) can still succeed later. Hands
 * each result to `apply`, except one a newer load has superseded, or any once disposed.
 *
 * The first load also hands over the non-CLI rows as soon as they're ready (as `loading`), since CLI
 * detection can stall up to its deadline. Reloads don't, as that would briefly drop shown CLI rows;
 * instead `onDidStartReload` says one is running, so the picker can read as busy over its current rows.
 */
function watchSupportedAgents(
	container: Container,
	handlers: { apply: (state: SupportedAgentsLoadState) => void; onDidStartReload: () => void },
): UnifiedDisposable {
	const { apply, onDidStartReload } = handlers;
	let latest = 0;
	let disposed = false;
	let applied = false;

	const load = async (): Promise<void> => {
		const id = ++latest;
		const isCurrent = () => !disposed && id === latest;
		let settled = false;

		const { nonCli, all } = loadSupportedAgentsInStages(container);
		if (applied) {
			onDidStartReload();
		} else {
			// Neither stage rejects: a failed CLI detection or non-CLI check only drops its own rows
			void nonCli.then(agents => {
				// With no rows yet, keep showing "Loading..." rather than an empty state CLI detection may yet fill
				if (settled || applied || agents.length === 0 || !isCurrent()) return;

				applied = true;
				apply({ agents: agents, loading: true, detectionFailed: false });
			});
		}

		const result = await all;
		settled = true;
		if (!isCurrent()) return;

		applied = true;
		apply({ agents: result.agents, loading: false, detectionFailed: result.cliDetectionFailed });
	};

	const subscription = container.agents.onDidChangeAgents(() => void load());
	void load();

	return createDisposable(() => {
		disposed = true;
		subscription.dispose();
	});
}

/**
 * Swaps a shown picker's rows for `items`, keeping the active row where it survived (the toggle keeps
 * its identity across reloads; an agent row is matched by its descriptor id), else activating
 * `getDefaultActive`'s rows, when it returns any.
 *
 * When the shown rows were only the partial first load (`shownPartial`), the default row may have only
 * now arrived — so the quickpick focused its first row itself. Unless the user has since moved off that
 * row or typed filter text, the default is activated instead.
 */
function replaceShownItems<T extends DirectiveQuickPickItem | AgentItem>(
	qp: QuickPick<T>,
	items: T[],
	getDefaultActive: (items: T[]) => T[] | undefined,
	shownPartial: boolean,
): void {
	const [active] = qp.activeItems;
	// Compares against the first selectable row the quickpick focuses on its own, as an assignment of ours is
	// echoed back through `onDidChangeActive` asynchronously, indistinguishable from a user's move
	// Typed filter text means the user is choosing among the filtered rows, so the default must not take the focus
	const untouched =
		shownPartial &&
		qp.value === '' &&
		(active == null || active === qp.items.find(i => i.kind !== QuickPickItemKind.Separator));
	qp.items = items;

	if (untouched) {
		const defaultActive = getDefaultActive(items);
		if (defaultActive != null && defaultActive.length !== 0) {
			qp.activeItems = defaultActive;
			return;
		}
	}

	const activeId = active != null ? getDescriptorId(active) : undefined;
	const match =
		active != null
			? items.find(i => i === active || (activeId != null && getDescriptorId(i) === activeId))
			: undefined;
	const nextActive = match != null ? [match] : getDefaultActive(items);
	if (nextActive != null) {
		qp.activeItems = nextActive;
	}
}

function getDescriptorId(item: DirectiveQuickPickItem | AgentItem): string | undefined {
	return 'descriptor' in item ? item.descriptor?.id : undefined;
}

/**
 * The rows the agent pickers show for `agents`: the agents grouped by kind, then the "Always use this
 * agent" toggle when one is given. With no agents, the empty state instead — no toggle, as there is no
 * agent to make the default — whose "Continue Manually" row only the wizard offers.
 */
export function buildAgentPickerItems(
	agents: readonly AgentDescriptor[],
	options: {
		currentDefault: string | null;
		toggle?: ConfirmToggleQuickPickItem;
		inWizard?: boolean;
		/** CLI detection failed, so the empty state must not claim there are no CLIs */
		detectionFailed?: boolean;
	},
): AgentItem[] {
	if (agents.length === 0) {
		const header: AgentItem = {
			label: l10n.t('$(warning) No agents available'),
			description: options.detectionFailed
				? l10n.t('No supported IDE chat host, no Claude extension; unable to detect CLIs')
				: l10n.t('No supported IDE chat host, no Claude extension, no detected CLIs'),
			kind: QuickPickItemKind.Separator,
		};
		if (!options.inWizard) return [header, { label: l10n.t('$(close) Close') }];

		return [
			header,
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
	}

	const items = buildAgentItems(agents, options.currentDefault);
	return options.toggle != null ? appendAlwaysUseToggle(items, options.toggle) : items;
}

/** The placeholder of an agent picker with no agents to offer. */
function getEmptyPlaceholder(detectionFailed: boolean): string {
	return detectionFailed ? l10n.t('Unable to detect agents') : l10n.t('No agents available');
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
 * Shows a non-wizard agent picker at once and fills it in as agents load, so a slow agent list reads
 * as loading instead of a freeze — and reloads its rows while it stays open whenever agent detection
 * changes. Resolves with the accepted row's descriptor, or `undefined` when dismissed or a row without
 * one is accepted.
 */
async function showAgentQuickPick(
	container: Container,
	options: {
		title: string;
		/** The placeholder once agents have loaded, unless there are none */
		placeholder: string;
		buildItems: (agents: readonly AgentDescriptor[], detectionFailed: boolean) => AgentItem[];
		/** The rows to activate on the first load (or once CLI detection completes it, unless the user moved), or
		 *  when a reload drops the active row */
		getDefaultActive: (items: AgentItem[]) => AgentItem[] | undefined;
		/** Runs before the picker resolves with an accepted row; returns `true` to keep the picker open instead */
		onDidAccept: (qp: QuickPick<AgentItem>, item: AgentItem | undefined) => Promise<boolean>;
	},
): Promise<AgentDescriptor | undefined> {
	const qp = window.createQuickPick<AgentItem>();
	const disposables: { dispose: () => void }[] = [qp];
	let loaded = false;
	// Whether the shown rows are only the non-CLI rows of a first load
	let shownPartial = false;

	try {
		qp.title = options.title;
		qp.placeholder = l10n.t('Loading...');
		qp.busy = true;
		qp.buttons = [settingsButton];

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
					// Nothing to pick while loading — keep the picker open
					if (!loaded) return;

					const item = qp.selectedItems[0];
					if (await options.onDidAccept(qp, item)) return;

					resolve(item?.descriptor);
				}),
				qp.onDidHide(() => resolve(undefined)),
			);
			qp.show();

			// Disposed with the picker, so a load finishing after it closes never touches it
			disposables.push(
				watchSupportedAgents(container, {
					apply: state => {
						qp.placeholder =
							state.agents.length === 0
								? getEmptyPlaceholder(state.detectionFailed)
								: options.placeholder;
						replaceShownItems(
							qp,
							options.buildItems(state.agents, state.detectionFailed),
							options.getDefaultActive,
							shownPartial,
						);
						shownPartial = state.loading;
						loaded = true;
						// Stays busy while only the non-CLI rows are shown, as CLI detection is still running
						qp.busy = state.loading;
					},
					// Keeps the shown rows, still pickable, but reads as busy until the reload applies
					onDidStartReload: () => {
						qp.busy = true;
					},
				}),
			);
		});
	} finally {
		for (const d of disposables) {
			d.dispose();
		}
	}
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
	const currentDefault: string | null = configuration.get('ai.defaultAgent') ?? null;
	const toggle = createAlwaysUseToggle(l10n.t('Always use this agent'), settingsButton, qp => {
		// A shown row mutated in place needs an items reassignment for the quickpick to notice
		const active = qp.activeItems;
		qp.items = [...qp.items];
		qp.activeItems = active;
	});

	return showAgentQuickPick(container, {
		title: options?.title ?? l10n.t('Choose an Agent'),
		placeholder: options?.placeholder ?? l10n.t('Select where to proceed'),
		buildItems: (agents, detectionFailed) =>
			buildAgentPickerItems(agents, {
				currentDefault: currentDefault,
				toggle: toggle,
				detectionFailed: detectionFailed,
			}),
		getDefaultActive: items => items.filter(i => i.picked),
		onDidAccept: async (qp, item) => {
			if (item === toggle) {
				// Keeps the picker open, as `Directive.Noop` does inside the wizard
				await toggle.onDidSelect?.(qp);
				return true;
			}

			if (item?.descriptor != null && toggle.checked) {
				await configuration.update('ai.defaultAgent', item.descriptor.id, ConfigurationTarget.Global);
			}
			return false;
		},
	});
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
	const currentDefault: string | null = configuration.get('ai.defaultAgent') ?? null;

	return showAgentQuickPick(container, {
		title: options?.title ?? l10n.t('Switch Default Agent'),
		placeholder: options?.placeholder ?? l10n.t('Select the default agent'),
		// The default is marked by making it the active row, not by `picked`
		buildItems: (agents, detectionFailed) =>
			buildAgentPickerItems(agents, { currentDefault: null, detectionFailed: detectionFailed }),
		getDefaultActive: items => {
			const active = items.find(i => i.descriptor?.id === currentDefault);
			return active != null ? [active] : undefined;
		},
		onDidAccept: async (_qp, item) => {
			if (item?.descriptor != null) {
				await configuration.update('ai.defaultAgent', item.descriptor.id, ConfigurationTarget.Global);
			}
			return false;
		},
	});
}

/**
 * Resolves the persisted default agent for an interactive caller that otherwise shows an agent picker: the
 * default's descriptor, or `undefined` for the caller to show the picker instead. When agent detection fails,
 * says the default couldn't be verified (it's unknown, not gone); with `notifyUnavailable`, also says when it's gone.
 */
export async function resolveDefaultAgentOrNotify(
	container: Container,
	agentId: string,
	options?: { notifyUnavailable?: boolean },
): Promise<AgentDescriptor | undefined> {
	let descriptor: AgentDescriptor | undefined;
	try {
		descriptor = await resolveDefaultAgent(container, agentId);
	} catch (ex) {
		Logger.error(ex, 'Unable to resolve the default agent');
		void window.showInformationMessage(
			l10n.t('Unable to detect agents to verify the default agent. Choose an agent.'),
		);
		return undefined;
	}

	if (descriptor == null && options?.notifyUnavailable) {
		void window.showInformationMessage(l10n.t('Default agent is no longer available. Choose another.'));
	}
	return descriptor;
}

export type ResolveAgentFlowResult =
	| { readonly kind: 'manual' }
	| { readonly kind: 'agent'; readonly descriptor: AgentDescriptor }
	/** Hand off to Kepler — the caller must return BEFORE creating any branch/worktree */
	| { readonly kind: 'kepler' }
	| { readonly kind: 'cancel' };

/** Builds the `agent.resolution` telemetry payload for a resolved manual-vs-agent flow. */
export function buildAgentResolvedTelemetryData(
	result: ResolveAgentFlowResult,
):
	| { 'agent.resolution': 'manual' | 'kepler' | 'cancel' }
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
	options: {
		useDefaults?: boolean;
		requestedRoute?: AgentRoute;
		/** The item being started; the Kepler route is only offered when this is set and Kepler can serve it */
		item?: AgentRouteItem;
	},
): AsyncStepResultGenerator<ResolveAgentFlowResult> {
	// `'ask'` from the caller (or unspecified) defers to the persisted `gitlens.ai.openInAgent`
	// default so the user's preference is honored on generic UI entries (the Graph WIP empty pane).
	// `'manual'`/`'agent'` from the caller are explicit overrides (e.g., the "Start Work in Agent"
	// surfaces) and always force that route regardless of the persisted setting.
	const keplerOffered = container != null && canOfferKeplerRoute(container.kepler.available, options.item);
	const route = resolveAgentRoute(options.requestedRoute, configuration.get('ai.openInAgent'), keplerOffered);
	const persistedAgentId: string | undefined = configuration.get('ai.defaultAgent') ?? undefined;

	if (options.useDefaults) {
		// Hard contract: never pop a picker when useDefaults is true (would deadlock MCP/IPC callers).
		// A `'kepler'` route continues manually too: `useDefaults` callers (MCP/IPC) await the
		// created branch/worktree, which a Kepler hand-off never produces.
		if (route !== 'agent') {
			return { kind: 'manual' };
		}

		if (persistedAgentId == null) {
			void container?.usage.track('action:gitlens.ai.openInAgent.useDefaultsFallback:happened');
			return { kind: 'manual' };
		}

		// resolveDefaultAgent only returns descriptors that pass the supported-agents filter,
		// so no extra availability check is needed — runAgent re-validates at dispatch time.
		let descriptor: AgentDescriptor | undefined;
		try {
			descriptor = container != null ? await resolveDefaultAgent(container, persistedAgentId) : undefined;
		} catch (ex) {
			// Detection failed, so the default can't be verified (not known to be unavailable, so this isn't a
			// fallback) — continue manually rather than prompt. The notice is never awaited: these callers must not
			// wait on UI
			Logger.warn('Unable to detect agents to resolve the default agent; continuing manually', ex);
			void window.showWarningMessage(l10n.t('Unable to detect agents. Continued without the default agent.'));
			return { kind: 'manual' };
		}
		if (descriptor == null) {
			void container?.usage.track('action:gitlens.ai.openInAgent.useDefaultsFallback:happened');
			return { kind: 'manual' };
		}
		return { kind: 'agent', descriptor: descriptor };
	}

	// Interactive flow — yield steps to the wizard machinery. The persisted default is resolved (and any failure
	// notified) on the first pass only, so going back to the pre-picker and on again doesn't repeat the notice
	let defaultResolved = false;
	while (true) {
		let chosenRoute: PickableRoute;
		if (route !== 'ask') {
			chosenRoute = route;
		} else {
			const result = yield* pickRouteStep({
				showBackButton: true,
				kepler: keplerOffered ? options.item?.kind : undefined,
			});
			if (result === StepResultBreak) return { kind: 'cancel' };

			chosenRoute = result;
		}

		if (chosenRoute === 'manual') return { kind: 'manual' };
		if (chosenRoute === 'kepler') return { kind: 'kepler' };

		// Agent route: try persisted default first.
		if (!defaultResolved && persistedAgentId != null && container != null) {
			defaultResolved = true;
			const descriptor = await resolveDefaultAgentOrNotify(container, persistedAgentId, {
				notifyUnavailable: true,
			});
			if (descriptor != null) {
				return { kind: 'agent', descriptor: descriptor };
			}
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
