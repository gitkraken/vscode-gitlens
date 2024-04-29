import type { QuickPickItem } from 'vscode';
import { QuickPickItemKind, window } from 'vscode';
import type { AIModels, AIProviders } from '../constants';
import type { Container } from '../container';
import { configuration } from '../system/configuration';

export interface ModelQuickPickItem<
	Provider extends AIProviders = AIProviders,
	Model extends AIModels<Provider> = AIModels<Provider>,
> extends QuickPickItem {
	provider: Provider;
	model: Model;
}

export async function showAIModelPicker(container: Container): Promise<ModelQuickPickItem | undefined>;
export async function showAIModelPicker<T extends AIProviders>(
	container: Container,
	provider: T,
): Promise<ModelQuickPickItem<T> | undefined>;
export async function showAIModelPicker(
	container: Container,
	provider?: AIProviders,
): Promise<ModelQuickPickItem | undefined> {
	const models = (await (await container.ai)?.getModels()) ?? [];

	let filterByProvider;
	if (provider != null) {
		filterByProvider = provider;
	} else {
		provider = configuration.get('ai.experimental.provider') ?? 'openai';
	}

	const model = configuration.get(`ai.experimental.${provider}.model`);

	type QuickPickSeparator = { label: string; kind: QuickPickItemKind.Separator };
	const items: (ModelQuickPickItem | QuickPickSeparator)[] = [];

	let lastProvider: AIProviders | undefined;
	for (const m of models) {
		if (m.hidden || (filterByProvider != null && m.provider.id === filterByProvider)) continue;

		if (lastProvider !== m.provider.id) {
			lastProvider = m.provider.id;
			items.push({ label: m.provider.name, kind: QuickPickItemKind.Separator });
		}

		const current = m.provider.id === provider && (m.id === model || (model == null && m.default));

		items.push({
			label: m.provider.name,
			description: current ? `${m.name}  \u2713` : m.name,
			provider: m.provider.id,
			model: m.id,
			picked: current,
		});
	}

	const pick = (await window.showQuickPick(items, {
		title: 'Switch AI Model',
		placeHolder: 'select an AI model to use for experimental AI features',
		matchOnDescription: true,
	})) as ModelQuickPickItem | undefined;

	return pick;
}
