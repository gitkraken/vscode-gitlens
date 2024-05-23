import type { QuickPickItem } from 'vscode';
import { QuickPickItemKind, ThemeIcon, window } from 'vscode';
import type { AIModel } from '../ai/aiProviderService';
import type { AIModels, AIProviders } from '../constants';
import type { Container } from '../container';

export interface ModelQuickPickItem extends QuickPickItem {
	model: AIModel;
}

export async function showAIModelPicker(
	container: Container,
	current?: { provider: AIProviders; model: AIModels },
): Promise<ModelQuickPickItem | undefined> {
	const models = (await (await container.ai)?.getModels()) ?? [];

	type QuickPickSeparator = { label: string; kind: QuickPickItemKind.Separator };
	const items: (ModelQuickPickItem | QuickPickSeparator)[] = [];

	let lastProvider: AIProviders | undefined;
	for (const m of models) {
		if (m.hidden) continue;

		if (lastProvider !== m.provider.id) {
			lastProvider = m.provider.id;
			items.push({ label: m.provider.name, kind: QuickPickItemKind.Separator });
		}

		const picked = m.provider.id === current?.provider && m.id === current?.model;

		items.push({
			label: m.name,
			iconPath: picked ? new ThemeIcon('check') : new ThemeIcon('blank'),
			// description: m.provider.name,
			model: m,
			picked: picked,
		});
	}

	const pick = (await window.showQuickPick(items, {
		title: 'Choose AI Model',
		placeHolder: 'Select an AI model to use for experimental AI features',
		matchOnDescription: true,
	})) as ModelQuickPickItem | undefined;

	return pick;
}
