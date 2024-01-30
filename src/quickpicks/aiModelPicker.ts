import type { QuickPickItem } from 'vscode';
import { QuickPickItemKind, window } from 'vscode';
import type { AIModels, AIProviders } from '../constants';
import { configuration } from '../system/configuration';

export interface ModelQuickPickItem<
	Provider extends AIProviders = AIProviders,
	Model extends AIModels<Provider> = AIModels<Provider>,
> extends QuickPickItem {
	provider: Provider;
	model: Model;
}

export async function showAIModelPicker(): Promise<ModelQuickPickItem | undefined>;
export async function showAIModelPicker<T extends AIProviders>(provider: T): Promise<ModelQuickPickItem<T> | undefined>;
export async function showAIModelPicker(provider?: AIProviders): Promise<ModelQuickPickItem | undefined> {
	type QuickPickSeparator = { label: string; kind: QuickPickItemKind.Separator };

	let items: (ModelQuickPickItem | QuickPickSeparator)[] = [
		{ label: 'OpenAI', kind: QuickPickItemKind.Separator },
		{ label: 'OpenAI', description: 'GPT-4 Turbo', provider: 'openai', model: 'gpt-4-turbo-preview' },
		{ label: 'OpenAI', description: 'GPT-4', provider: 'openai', model: 'gpt-4' },
		{ label: 'OpenAI', description: 'GPT-4 32k', provider: 'openai', model: 'gpt-4-32k' },
		{ label: 'OpenAI', description: 'GPT-3.5 Turbo', provider: 'openai', model: 'gpt-3.5-turbo-1106' },
		{ label: 'Anthropic', kind: QuickPickItemKind.Separator },
		{ label: 'Anthropic', description: 'Claude 2.1', provider: 'anthropic', model: 'claude-2.1' },
		{ label: 'Anthropic', description: 'Claude 2.0', provider: 'anthropic', model: 'claude-2' },
		{ label: 'Anthropic', description: 'Claude Instant', provider: 'anthropic', model: 'claude-instant-1' },
	];

	if (provider != null) {
		items = items.filter(i => i.kind !== QuickPickItemKind.Separator && i.provider === provider);
	} else {
		provider = configuration.get('ai.experimental.provider') ?? 'openai';
	}

	let model = configuration.get(`ai.experimental.${provider}.model`);
	if (model == null) {
		model = provider === 'anthropic' ? 'claude-2.1' : 'gpt-4-turbo-preview';
	}

	for (const item of items) {
		if (item.kind === QuickPickItemKind.Separator) continue;

		if (item.model === model) {
			item.description = `${item.description}  \u2713`;
			item.picked = true;
			break;
		}
	}

	const pick = (await window.showQuickPick(items, {
		title: 'Switch AI Model',
		placeHolder: 'select an AI model to use for experimental AI features',
		matchOnDescription: true,
	})) as ModelQuickPickItem | undefined;

	return pick;
}
