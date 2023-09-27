import type { QuickPickItem } from 'vscode';
import { QuickPickItemKind, window } from 'vscode';
import type { AnthropicModels } from '../ai/anthropicProvider';
import type { OpenAIModels } from '../ai/openaiProvider';
import type { AIProviders } from '../constants';
import { configuration } from '../system/configuration';

export interface ModelQuickPickItem extends QuickPickItem {
	provider: AIProviders;
	model: OpenAIModels | AnthropicModels;
}

export async function showAIModelPicker(): Promise<ModelQuickPickItem | undefined> {
	const provider = configuration.get('ai.experimental.provider') ?? 'openai';
	let model = configuration.get(`ai.experimental.${provider}.model`);
	if (model == null) {
		model = provider === 'anthropic' ? 'claude-v1' : 'gpt-3.5-turbo';
	}

	type QuickPickSeparator = { label: string; kind: QuickPickItemKind.Separator };

	const items: (ModelQuickPickItem | QuickPickSeparator)[] = [
		{ label: 'OpenAI', kind: QuickPickItemKind.Separator },
		{ label: 'OpenAI', description: 'GPT 3.5 Turbo', provider: 'openai', model: 'gpt-3.5-turbo' },
		{ label: 'OpenAI', description: 'GPT 3.5 Turbo 16k', provider: 'openai', model: 'gpt-3.5-turbo-16k' },
		{ label: 'OpenAI', description: 'GPT 4', provider: 'openai', model: 'gpt-4' },
		{ label: 'OpenAI', description: 'GPT 4 32k', provider: 'openai', model: 'gpt-4-32k' },
		{ label: 'Anthropic', kind: QuickPickItemKind.Separator },
		{ label: 'Anthropic', description: 'Claude v1', provider: 'anthropic', model: 'claude-v1' },
		{ label: 'Anthropic', description: 'Claude v1 100k', provider: 'anthropic', model: 'claude-v1-100k' },
		{ label: 'Anthropic', description: 'Claude Instant v1', provider: 'anthropic', model: 'claude-instant-v1' },
		{
			label: 'Anthropic',
			description: 'Claude Instant v1 100k',
			provider: 'anthropic',
			model: 'claude-instant-v1-100k',
		},
		{ label: 'Anthropic', description: 'Claude 2', provider: 'anthropic', model: 'claude-2' },
	];

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
