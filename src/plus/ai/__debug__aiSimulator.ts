import type { Disposable } from 'vscode';
import { ThemeIcon, window } from 'vscode';
import type { SupportedAIModels } from '@gitlens/ai/constants.js';
import type { AIActionType } from '@gitlens/ai/models/model.js';
import type { AIChatMessage } from '@gitlens/ai/models/provider.js';
import type { Container } from '../../container.js';
import type { QuickPickItemOfT } from '../../quickpicks/items/common.js';
import { createQuickPickSeparator } from '../../quickpicks/items/common.js';
import { registerCommand } from '../../system/-webview/command.js';
import { configuration } from '../../system/-webview/configuration.js';
import type { OnboardingSnapshot } from '../__debug__onboardingHelper.js';
import { dismissAllOnboarding, restoreOnboarding } from '../__debug__onboardingHelper.js';
import type { SimulatorMode } from './__debug__simulatorState.js';
import { getSimulatorState } from './__debug__simulatorState.js';

export type SimulateAIArgs =
	| { op: 'enable'; mode?: SimulatorMode; dismissOnboarding?: boolean }
	| { op: 'disable' }
	| { op: 'inject'; action?: AIActionType; content: string; sticky?: boolean }
	| { op: 'clear' }
	| { op: 'lastMessages' };

type InjectArgs = Extract<SimulateAIArgs, { op: 'inject' }>;

export function registerAISimulator(container: Container): void {
	new AISimulatorDebug(container);
}

interface SuppressionSnapshot {
	tos: boolean | undefined;
	notified: boolean | undefined;
	dismissed: boolean | undefined;
	userId: string;
	model: SupportedAIModels | null | undefined;
	enabled: boolean | undefined;
	onboarding: OnboardingSnapshot | undefined;
}

type SimulateModeQuickPickItem = QuickPickItemOfT<SimulatorMode | null>;

class AISimulatorDebug {
	private active: SuppressionSnapshot | undefined;

	constructor(private readonly container: Container) {
		this.container.context.subscriptions.push(
			registerCommand(
				'gitlens.plus.simulate.ai',
				(args?: SimulateAIArgs) => this.handleSimulate(args),
				undefined,
				{ returnResult: true },
			),
		);
	}

	private async handleSimulate(args?: SimulateAIArgs): Promise<unknown> {
		if (args == null) {
			await this.showPicker();
			return this.active != null;
		}

		switch (args.op) {
			case 'enable':
				await this.enable(args.mode ?? 'default', args.dismissOnboarding ?? false);
				return true;
			case 'disable':
				await this.disable();
				return false;
			case 'inject':
				return this.handleInject(args);
			case 'clear':
				return this.handleClear();
			case 'lastMessages':
				return this.handleLastMessages();
		}
	}

	private handleInject(args: InjectArgs): boolean {
		if (typeof args.content !== 'string') return false;
		getSimulatorState().inject({ action: args.action, content: args.content, sticky: args.sticky });
		return true;
	}

	private handleClear(): boolean {
		getSimulatorState().clear();
		return true;
	}

	private handleLastMessages(): readonly AIChatMessage[] | undefined {
		return getSimulatorState().getLastMessages();
	}

	private async enable(mode: SimulatorMode, dismissOnboarding: boolean): Promise<void> {
		const state = getSimulatorState();
		state.mode = mode;
		state.clear();

		if (this.active == null) {
			const userId = await this.getUserId();
			this.active = {
				tos: this.container.storage.get('confirm:ai:tos'),
				notified: this.container.storage.get(`gk:promo:${userId}:ai:allAccess:notified`),
				dismissed: this.container.storage.get(`gk:promo:${userId}:ai:allAccess:dismissed`),
				userId: userId,
				model: configuration.get('ai.model'),
				enabled: configuration.get('ai.enabled'),
				onboarding: undefined,
			};
		}

		await this.container.storage.store('confirm:ai:tos', true);
		await this.container.storage.store(`gk:promo:${this.active.userId}:ai:allAccess:notified`, true);
		await this.container.storage.store(`gk:promo:${this.active.userId}:ai:allAccess:dismissed`, true);

		await configuration.updateEffective('ai.enabled', true);
		await configuration.updateEffective('ai.model', `simulator:${mode}` as SupportedAIModels);

		// Snapshot + dismiss onboarding only on the first enable that requests it; subsequent
		// enables don't re-snapshot (avoids losing the original "what was undismissed" record).
		if (dismissOnboarding && this.active.onboarding == null) {
			this.active.onboarding = await dismissAllOnboarding(this.container);
		}
	}

	private async disable(): Promise<void> {
		const state = getSimulatorState();
		state.clear();
		state.mode = 'default';

		const snapshot = this.active;
		this.active = undefined;
		if (snapshot == null) return;

		await restoreFlag(this.container.storage, 'confirm:ai:tos', snapshot.tos);
		await restoreFlag(
			this.container.storage,
			`gk:promo:${snapshot.userId}:ai:allAccess:notified`,
			snapshot.notified,
		);
		await restoreFlag(
			this.container.storage,
			`gk:promo:${snapshot.userId}:ai:allAccess:dismissed`,
			snapshot.dismissed,
		);

		if (snapshot.enabled === undefined) {
			await configuration.updateEffective('ai.enabled', undefined);
		} else {
			await configuration.updateEffective('ai.enabled', snapshot.enabled);
		}

		if (snapshot.model === undefined) {
			await configuration.updateEffective('ai.model', undefined);
		} else {
			await configuration.updateEffective('ai.model', snapshot.model);
		}

		if (snapshot.onboarding != null) {
			await restoreOnboarding(this.container, snapshot.onboarding);
		}
	}

	private async getUserId(): Promise<string> {
		try {
			const subscription = await this.container.subscription.getSubscription();
			return subscription.account?.id ?? '00000000';
		} catch {
			return '00000000';
		}
	}

	private async showPicker(): Promise<void> {
		const items: SimulateModeQuickPickItem[] = [
			{
				label: 'Default',
				description: 'Canned content per action',
				iconPath: new ThemeIcon('blank'),
				item: 'default',
			},
			{
				label: 'Slow',
				description: 'Adds a delay to exercise progress UX',
				iconPath: new ThemeIcon('blank'),
				item: 'slow',
			},
			{
				label: 'Invalid',
				description: 'Returns malformed content (Composer triggers retry)',
				iconPath: new ThemeIcon('blank'),
				item: 'invalid',
			},
			{
				label: 'Error',
				description: 'Throws a provider error',
				iconPath: new ThemeIcon('blank'),
				item: 'error',
			},
			{
				label: 'Cancel',
				description: 'Aborts the request immediately',
				iconPath: new ThemeIcon('blank'),
				item: 'cancel',
			},
		];

		if (this.active != null) {
			items.unshift(
				{
					label: 'End Simulation',
					description: 'Restores prior model and flags',
					iconPath: new ThemeIcon('beaker-stop'),
					item: null,
				},
				createQuickPickSeparator<SimulateModeQuickPickItem>(),
			);
		}

		const quickpick = window.createQuickPick<SimulateModeQuickPickItem>();
		quickpick.title = 'AI Simulator';
		quickpick.placeholder = this.active != null ? `Active: ${getSimulatorState().mode}` : 'Choose a simulator mode';
		quickpick.items = items;
		quickpick.ignoreFocusOut = true;

		const disposables: Disposable[] = [];
		try {
			await new Promise<void>(resolve => {
				disposables.push(
					quickpick.onDidHide(() => resolve()),
					quickpick.onDidAccept(async () => {
						const [pick] = quickpick.activeItems;
						if (pick == null) {
							resolve();
							return;
						}

						if (pick.item == null) {
							await this.disable();
						} else {
							await this.enable(pick.item, false);
						}
						resolve();
					}),
				);
				quickpick.show();
			});
		} finally {
			quickpick.dispose();
			disposables.forEach(d => void d.dispose());
		}
	}
}

async function restoreFlag(
	storage: Container['storage'],
	key: 'confirm:ai:tos' | `gk:promo:${string}:ai:allAccess:notified` | `gk:promo:${string}:ai:allAccess:dismissed`,
	value: boolean | undefined,
): Promise<void> {
	// `value` was captured via `storage.get(key)` which returns `undefined` when unset,
	// so undefined here means "delete the key, restore unset state".
	if (value === undefined) {
		await storage.delete(key);
		return;
	}
	await storage.store(key, value);
}
