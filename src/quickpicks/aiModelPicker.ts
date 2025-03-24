import type { Disposable, QuickInputButton, QuickPickItem } from 'vscode';
import { QuickPickItemKind, ThemeIcon, window } from 'vscode';
import type { AIProviders } from '../constants.ai';
import type { Container } from '../container';
import type { AIModel, AIModelDescriptor } from '../plus/ai/models/model';
import { isSubscriptionPaidPlan } from '../plus/gk/utils/subscription.utils';
import { getQuickPickIgnoreFocusOut } from '../system/-webview/vscode';

export interface ModelQuickPickItem extends QuickPickItem {
	model: AIModel;
}

export interface ProviderQuickPickItem extends QuickPickItem {
	provider: AIProviders;
}

const aiProviderLabels: { [provider in AIProviders]: string } = {
	anthropic: 'Anthropic',
	deepseek: 'DeepSeek',
	gemini: 'Google',
	github: 'GitHub Models',
	gitkraken: 'GitKraken',
	huggingface: 'Hugging Face',
	openai: 'OpenAI',
	vscode: 'Copilot',
	xai: 'xAI',
};

const ClearAIKeyButton: QuickInputButton = {
	iconPath: new ThemeIcon('trash'),
	tooltip: 'Clear key',
};

const ConfigureAIKeyButton: QuickInputButton = {
	iconPath: new ThemeIcon('key'),
	tooltip: 'Configure key...',
};

export async function showAIProviderPicker(
	container: Container,
	current?: AIModelDescriptor,
): Promise<ProviderQuickPickItem | undefined> {
	const providers: Map<AIProviders, boolean> = new Map();
	const supportedProviders = container.ai.supportedProviders;
	const currentModelName = container.ai.currentModelName;
	const subscription = await container.subscription.getSubscription();
	const hasPaidPlan = isSubscriptionPaidPlan(subscription?.plan?.effective.id) && subscription?.account?.verified;

	for (const provider of supportedProviders) {
		if (providers.has(provider)) continue;

		providers.set(
			provider,
			provider === 'vscode' || provider === 'gitkraken'
				? true
				: (await container.storage.getSecret(`gitlens.${provider}.key`)) != null,
		);
	}

	const quickpick = window.createQuickPick<ProviderQuickPickItem>();
	quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();
	quickpick.title = 'Select AI Provider';
	quickpick.placeholder = 'Choose an AI provider to use';
	quickpick.matchOnDescription = true;
	quickpick.matchOnDetail = true;

	const disposables: Disposable[] = [];

	try {
		while (true) {
			const items: ProviderQuickPickItem[] = [];
			const sortedProviders = [...providers.keys()].sort((a, b) => {
				// Always put 'gitkraken' first if exists, then 'vscode' if exists, then any configured providers, then the rest
				if (a === 'gitkraken') return -1;
				if (b === 'gitkraken') return 1;
				if (a === 'vscode') return -1;
				if (b === 'vscode') return 1;
				if (providers.get(a) && !providers.get(b)) return -1;
				if (!providers.get(a) && providers.get(b)) return 1;
				return 0;
			});

			function isPrimaryProvider(provider: AIProviders): boolean {
				return provider === 'gitkraken' || provider === 'vscode';
			}

			const firstNonPrimaryProvider = sortedProviders.find(p => !isPrimaryProvider(p));

			const pickedProvider =
				current != null
					? current.provider
					: providers.get('vscode')
					  ? 'vscode'
					  : providers.get('gitkraken')
					    ? 'gitkraken'
					    : undefined;

			for (const p of sortedProviders) {
				if (firstNonPrimaryProvider === p) {
					items.push({
						label: 'Requires API Key',
						kind: QuickPickItemKind.Separator,
					} as unknown as ProviderQuickPickItem);
				}

				items.push({
					label: aiProviderLabels[p],
					iconPath: p === current?.provider ? new ThemeIcon('check') : new ThemeIcon('blank'),
					provider: p,
					picked: p === pickedProvider,
					detail:
						p === current?.provider && currentModelName
							? `      ${currentModelName}`
							: p === 'gitkraken'
							  ? `      Models provided by GitKraken${hasPaidPlan ? ' (included in your plan)' : ''}`
							  : undefined,
					buttons: !isPrimaryProvider(p)
						? providers.get(p)
							? [ClearAIKeyButton]
							: [ConfigureAIKeyButton]
						: undefined,
					description: !isPrimaryProvider(p) && providers.get(p) ? '  (configured)' : undefined,
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
							void container.ai.resetProvider(e.item.provider);
							providers.set(e.item.provider, false);
							resolve('refresh');
						}
						if (e.button === ConfigureAIKeyButton) {
							resolve(e.item);
						}
					}),
				);

				quickpick.items = items;
				quickpick.activeItems = items.filter(i => i.picked);

				quickpick.show();
			});

			if (pick === 'refresh') {
				continue;
			}

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
): Promise<ModelQuickPickItem | undefined> {
	const models = (await container.ai.getModels(provider)) ?? [];

	const items: ModelQuickPickItem[] = [];

	for (const m of models) {
		if (m.hidden) continue;

		const picked = m.provider.id === current?.provider && m.id === current?.model;

		items.push({
			label: m.name,
			iconPath: picked ? new ThemeIcon('check') : new ThemeIcon('blank'),
			model: m,
			picked: picked,
		} satisfies ModelQuickPickItem);
	}

	const quickpick = window.createQuickPick<ModelQuickPickItem>();
	quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();

	const disposables: Disposable[] = [];

	try {
		const pick = await new Promise<ModelQuickPickItem | undefined>(resolve => {
			disposables.push(
				quickpick.onDidHide(() => resolve(undefined)),
				quickpick.onDidAccept(() => {
					if (quickpick.activeItems.length !== 0) {
						resolve(quickpick.activeItems[0]);
					}
				}),
			);

			quickpick.title = 'Select AI Model';
			quickpick.placeholder = 'Choose an AI model to use';
			quickpick.matchOnDescription = true;
			quickpick.matchOnDetail = true;
			quickpick.items = items;
			quickpick.activeItems = items.filter(i => i.picked);

			quickpick.show();
		});

		return pick;
	} finally {
		quickpick.dispose();
		disposables.forEach(d => void d.dispose());
	}
}
