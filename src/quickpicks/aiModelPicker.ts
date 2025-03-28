import type { Disposable, QuickInputButton, QuickPickItem } from 'vscode';
import { QuickInputButtons, ThemeIcon, window } from 'vscode';
import type { AIProviders } from '../constants.ai';
import type { Container } from '../container';
import type { AIModel, AIModelDescriptor } from '../plus/ai/models/model';
import { isSubscriptionPaidPlan } from '../plus/gk/utils/subscription.utils';
import { getContext } from '../system/-webview/context';
import { getQuickPickIgnoreFocusOut } from '../system/-webview/vscode';
import { getSettledValue } from '../system/promise';
import { createQuickPickSeparator } from './items/common';
import { Directive } from './items/directive';

export interface ModelQuickPickItem extends QuickPickItem {
	model: AIModel;
}

export interface ProviderQuickPickItem extends QuickPickItem {
	provider: AIProviders;
}

const ClearAIKeyButton: QuickInputButton = {
	iconPath: new ThemeIcon('trash'),
	tooltip: 'Clear AI Key',
};

const ConfigureAIKeyButton: QuickInputButton = {
	iconPath: new ThemeIcon('key'),
	tooltip: 'Configure AI Key...',
};

export async function showAIProviderPicker(
	container: Container,
	current: AIModelDescriptor | undefined,
): Promise<ProviderQuickPickItem | undefined> {
	if (!getContext('gitlens:gk:organization:ai:enabled', true)) {
		await window.showQuickPick([{ label: 'OK' }], {
			title: 'AI is Disabled',
			placeHolder: 'GitLens AI features have been disabled by your GitKraken admin',
			canPickMany: false,
		});

		return undefined;
	}

	const [providersResult, modelResult, subscriptionResult] = await Promise.allSettled([
		container.ai.getProvidersConfiguration(),
		container.ai.getModel({ silent: true }, { source: 'ai:picker' }),
		container.subscription.getSubscription(),
	]);

	const providers = getSettledValue(providersResult) ?? new Map();
	const currentModelName = getSettledValue(modelResult)?.name;
	const subscription = getSettledValue(subscriptionResult)!;
	const hasPaidPlan = isSubscriptionPaidPlan(subscription.plan.effective.id) && subscription.account?.verified;

	const quickpick = window.createQuickPick<ProviderQuickPickItem>();
	quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();
	quickpick.title = 'Select AI Provider';
	quickpick.placeholder = 'Choose an AI provider to use';

	const disposables: Disposable[] = [];

	try {
		const pickedProvider =
			current?.provider ?? providers.get('vscode')?.configured
				? 'vscode'
				: providers.get('gitkraken')?.configured
				  ? 'gitkraken'
				  : undefined;

		let addedRequiredKeySeparator = false;
		while (true) {
			const items: ProviderQuickPickItem[] = [];
			for (const p of providers.values()) {
				if (!p.primary && !addedRequiredKeySeparator) {
					addedRequiredKeySeparator = true;
					items.push(createQuickPickSeparator<ProviderQuickPickItem>('Requires API Key'));
				}

				items.push({
					label: p.name,
					iconPath: p.id === current?.provider ? new ThemeIcon('check') : new ThemeIcon('blank'),
					provider: p.id,
					picked: p.id === pickedProvider,
					detail:
						p.id === current?.provider && currentModelName
							? `      ${currentModelName}`
							: p.id === 'gitkraken'
							  ? '      Models provided by GitKraken'
							  : undefined,
					buttons: !p.primary ? (p.configured ? [ClearAIKeyButton] : [ConfigureAIKeyButton]) : undefined,
					description:
						p.id === 'gitkraken'
							? hasPaidPlan
								? '  included in your plan'
								: '  included in GitLens Pro'
							: undefined,
				} satisfies ProviderQuickPickItem);
			}

			const pick = await new Promise<ProviderQuickPickItem | 'refresh' | undefined>(resolve => {
				disposables.push(
					quickpick.onDidHide(() => resolve(undefined)),
					quickpick.onDidAccept(() => {
						if (quickpick.activeItems.length !== 0) {
							resolve(quickpick.activeItems[0]);
						}
					}),
					quickpick.onDidTriggerItemButton(e => {
						if (e.button === ClearAIKeyButton) {
							container.ai.resetProviderKey(e.item.provider);
							providers.set(e.item.provider, { ...providers.get(e.item.provider)!, configured: false });
							resolve('refresh');
						} else if (e.button === ConfigureAIKeyButton) {
							resolve(e.item);
						}
					}),
				);

				quickpick.items = items;
				quickpick.activeItems = items.filter(i => i.picked);

				quickpick.show();
			});

			if (pick === 'refresh') continue;

			return pick;
		}
	} finally {
		quickpick.dispose();
		disposables.forEach(d => void d.dispose());
	}
}

export async function showAIModelPicker(
	container: Container,
	provider: AIProviders,
	current?: AIModelDescriptor,
): Promise<ModelQuickPickItem | Directive | undefined> {
	if (!getContext('gitlens:gk:organization:ai:enabled', true)) {
		await window.showQuickPick([{ label: 'OK' }], {
			title: 'AI is Disabled',
			placeHolder: 'GitLens AI features have been disabled by your GitKraken admin',
			canPickMany: false,
		});

		return undefined;
	}

	const models = (await container.ai.getModels(provider)) ?? [];

	const items: ModelQuickPickItem[] = [];

	for (const m of models) {
		if (m.hidden) continue;

		const picked = m.provider.id === current?.provider && m.id === current?.model;

		items.push({
			label: m.name,
			description: m.default ? '  recommended' : undefined,
			iconPath: picked ? new ThemeIcon('check') : new ThemeIcon('blank'),
			model: m,
			picked: picked,
		} satisfies ModelQuickPickItem);
	}

	const quickpick = window.createQuickPick<ModelQuickPickItem>();
	quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();

	const disposables: Disposable[] = [];

	try {
		const pick = await new Promise<ModelQuickPickItem | Directive | undefined>(resolve => {
			disposables.push(
				quickpick.onDidHide(() => resolve(undefined)),
				quickpick.onDidAccept(() => {
					if (quickpick.activeItems.length !== 0) {
						resolve(quickpick.activeItems[0]);
					}
				}),
				quickpick.onDidTriggerButton(e => {
					if (e === QuickInputButtons.Back) {
						resolve(Directive.Back);
					}
				}),
			);

			quickpick.title = 'Select AI Model';
			quickpick.placeholder = 'Choose an AI model to use';
			quickpick.matchOnDescription = true;
			quickpick.matchOnDetail = true;
			quickpick.items = items;
			quickpick.activeItems = items.filter(i => i.picked);
			quickpick.buttons = [QuickInputButtons.Back];

			quickpick.show();
		});

		return pick;
	} finally {
		quickpick.dispose();
		disposables.forEach(d => void d.dispose());
	}
}
