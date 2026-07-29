import type { Disposable, QuickInputButton, QuickPickItem } from 'vscode';
import { QuickInputButtons, ThemeIcon, window } from 'vscode';
import type { AIProviders } from '@gitlens/ai/constants.js';
import type {
	AIModel,
	AIModelDescriptor,
	AIProviderDescriptor,
	AIProviderDescriptorWithConfiguration,
} from '@gitlens/ai/models/model.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import { capitalize } from '@gitlens/utils/string.js';
import type { Source } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import type { AIModelScope } from '../plus/ai/aiProviderService.js';
import { ensureAccess } from '../plus/ai/utils/-webview/ai.utils.js';
import { isSubscriptionPaidPlan } from '../plus/gk/utils/subscription.utils.js';
import { getQuickPickIgnoreFocusOut } from '../system/-webview/vscode.js';
import { createQuickPickSeparator } from './items/common.js';
import type { DirectiveQuickPickItem } from './items/directive.js';
import { createDirectiveQuickPickItem, Directive, isDirectiveQuickPickItem } from './items/directive.js';

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
	source?: Source,
	titles?: { title?: string; placeholder?: string; scope?: AIModelScope },
): Promise<ProviderQuickPickItem | undefined> {
	if (!(await ensureAccess(container, { showPicker: true }, source))) return undefined;

	const [providersResult, modelResult, subscriptionResult] = await Promise.allSettled([
		container.ai.getProvidersConfiguration(),
		// Fetch the *scope's* current model when invoked for a scoped operation so the
		// "current model" detail line in the picker reflects the scope, not the global default.
		container.ai.getModel({ silent: true, scope: titles?.scope }, { source: 'ai:picker' }),
		container.subscription.getSubscription(),
	]);

	const providers = getSettledValue(providersResult) ?? new Map<AIProviders, AIProviderDescriptorWithConfiguration>();
	const currentModelName = getSettledValue(modelResult)?.name;
	const subscription = getSettledValue(subscriptionResult)!;
	const hasPaidPlan = isSubscriptionPaidPlan(subscription.plan.effective.id) && subscription.account?.verified;

	const quickpick = window.createQuickPick<ProviderQuickPickItem>();
	quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();
	quickpick.title = titles?.title ?? 'Select AI Provider';
	quickpick.placeholder = titles?.placeholder ?? 'Choose an AI provider to use';

	const disposables: Disposable[] = [];

	try {
		const pickedProvider =
			current?.provider ??
			(providers.get('gitkraken')?.configured
				? 'gitkraken'
				: providers.get('vscode')?.configured
					? 'vscode'
					: undefined);

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
							void container.ai.resetProviderKey(e.item.provider);
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

// Preferred display order for the most recognizable BYO-key providers named in the switch-provider
// detail line; any remaining enabled ones are covered by "and more".
const featuredKeyProviders: AIProviders[] = ['openai', 'anthropic', 'gemini', 'ollama'];

function getSwitchProviderDetail(providers: readonly AIProviderDescriptor[]): string | undefined {
	const primaries = providers.filter(p => p.primary).map(p => p.name);
	const keyProviders = providers.filter(p => !p.primary);

	const choices = [...primaries];
	if (keyProviders.length) {
		let named = featuredKeyProviders.map(id => keyProviders.find(p => p.id === id)?.name).filter(n => n != null);
		if (!named.length) {
			named = keyProviders.slice(0, featuredKeyProviders.length).map(p => p.name);
		}

		choices.push(
			`bring your own key — ${named.join(', ')}${keyProviders.length > named.length ? ', and more' : ''}`,
		);
	}

	if (!choices.length) return undefined;
	if (choices.length === 1) {
		return primaries.length ? `Choose ${choices[0]}` : capitalize(choices[0]);
	}

	const last = choices.pop()!;
	return `Choose ${choices.join(', ')}${choices.length > 1 ? ',' : ''} or ${last}`;
}

export async function showAIModelPicker(
	container: Container,
	provider: AIProviders,
	current?: AIModelDescriptor,
	source?: Source,
	titles?: { title?: string; placeholder?: string },
	scope?: AIModelScope,
	options?: { availableProviders: readonly AIProviderDescriptor[] },
): Promise<ModelQuickPickItem | Directive | undefined> {
	if (!(await ensureAccess(container, { showPicker: true }, source))) return undefined;

	const models = (await container.ai.getModels(provider)) ?? [];
	const currentProviderName =
		options?.availableProviders.find(p => p.id === provider)?.name ?? models[0]?.provider.name;

	const items: Array<ModelQuickPickItem | DirectiveQuickPickItem> = [];

	// When the provider step was skipped (a provider is already selected), lead with an
	// entry that navigates back to the provider picker so switching providers is still
	// discoverable. Omitted when there are no other providers to switch to.
	if (options != null) {
		const detail = getSwitchProviderDetail(options.availableProviders.filter(p => p.id !== provider));
		if (currentProviderName != null && detail != null) {
			items.push(
				createDirectiveQuickPickItem(Directive.Back, false, {
					label: 'Change AI Provider',
					description: `  ${currentProviderName}`,
					detail: `      ${detail}`,
					iconPath: new ThemeIcon('arrow-swap'),
				}),
				createQuickPickSeparator<DirectiveQuickPickItem>('Models'),
			);
		}
	}

	if (!models.length) {
		items.push({
			label: 'No models found',
			description:
				provider === 'ollama' ? 'Please install a model or check your Ollama server configuration' : undefined,
			iconPath: new ThemeIcon('error'),
			directive: Directive.Noop,
		} satisfies ModelQuickPickItem | DirectiveQuickPickItem);
	} else {
		const scopedDefaultModelId =
			provider === 'gitkraken' && scope != null ? 'gemini:gemini-3-flash-preview' : undefined;
		const useScopedDefault = scopedDefaultModelId != null && current?.provider !== provider;

		for (const m of models) {
			if (m.hidden) continue;

			const matchesCurrent = m.provider.id === current?.provider && m.id === current?.model;
			const picked = matchesCurrent || (useScopedDefault && m.id === scopedDefaultModelId);

			const badges: string[] = [];
			if (m.consumptionRateLabel) {
				badges.push(m.consumptionRateLabel);
			}
			if (m.default) {
				badges.push('recommended');
			}

			items.push({
				label: m.name,
				description: badges.length ? `  ${badges.join('  ')}` : undefined,
				iconPath: matchesCurrent ? new ThemeIcon('check') : new ThemeIcon('blank'),
				model: m,
				picked: picked,
			} satisfies ModelQuickPickItem);
		}
	}

	const quickpick = window.createQuickPick<ModelQuickPickItem | DirectiveQuickPickItem>();
	quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();

	const disposables: Disposable[] = [];

	try {
		const pick = await new Promise<ModelQuickPickItem | Directive | undefined>(resolve => {
			disposables.push(
				quickpick.onDidHide(() => resolve(undefined)),
				quickpick.onDidAccept(() => {
					if (quickpick.activeItems.length !== 0) {
						const [active] = quickpick.activeItems;
						if (isDirectiveQuickPickItem(active)) {
							if (active.directive !== Directive.Noop) {
								resolve(active.directive);
							}
						} else {
							resolve(active);
						}
					}
				}),
				quickpick.onDidTriggerButton(e => {
					if (e === QuickInputButtons.Back) {
						resolve(Directive.Back);
					}
				}),
			);

			const title = titles?.title ?? 'Select AI Model';
			quickpick.title = currentProviderName != null ? `${title} • ${currentProviderName}` : title;
			quickpick.placeholder = titles?.placeholder ?? 'Choose an AI model to use';
			quickpick.matchOnDescription = true;
			quickpick.matchOnDetail = true;
			quickpick.items = items;
			// If nothing is picked (e.g. a stale/removed model id), focus the first model rather
			// than letting the default focus land on the leading "Change AI Provider" back-entry
			const picked = items.filter(i => i.picked);
			quickpick.activeItems = picked.length ? picked : items.filter(i => 'model' in i).slice(0, 1);
			quickpick.buttons = [QuickInputButtons.Back];

			quickpick.show();
		});

		return pick;
	} finally {
		quickpick.dispose();
		disposables.forEach(d => void d.dispose());
	}
}
