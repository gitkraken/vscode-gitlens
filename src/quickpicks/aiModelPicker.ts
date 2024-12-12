import type { Disposable, QuickInputButton, QuickPickItem } from 'vscode';
import { QuickPickItemKind, ThemeIcon, window } from 'vscode';
import type { AIModel } from '../ai/aiProviderService';
import type { AIModels, AIProviders } from '../constants.ai';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { executeCommand } from '../system/vscode/command';
import { getQuickPickIgnoreFocusOut } from '../system/vscode/utils';

export interface ModelQuickPickItem extends QuickPickItem {
	model: AIModel;
}

export async function showAIModelPicker(
	container: Container,
	current?: { provider: AIProviders; model: AIModels },
): Promise<ModelQuickPickItem | undefined> {
	const models = (await (await container.ai)?.getModels()) ?? [];

	const items: ModelQuickPickItem[] = [];

	let lastProvider: AIProviders | undefined;
	for (const m of models) {
		if (m.hidden) continue;

		if (lastProvider !== m.provider.id) {
			lastProvider = m.provider.id;
			items.push({ label: m.provider.name, kind: QuickPickItemKind.Separator } as unknown as ModelQuickPickItem);
		}

		const picked = m.provider.id === current?.provider && m.id === current?.model;

		items.push({
			label: m.name,
			iconPath: picked ? new ThemeIcon('check') : new ThemeIcon('blank'),
			// description: ` ~${formatNumeric(m.maxTokens)} tokens`,
			model: m,
			picked: picked,
		} satisfies ModelQuickPickItem);
	}

	const quickpick = window.createQuickPick<ModelQuickPickItem>();
	quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();

	const disposables: Disposable[] = [];

	const ResetAIKeyButton: QuickInputButton = {
		iconPath: new ThemeIcon('clear-all'),
		tooltip: 'Reset AI Keys...',
	};

	try {
		const pick = await new Promise<ModelQuickPickItem | undefined>(resolve => {
			disposables.push(
				quickpick.onDidHide(() => resolve(undefined)),
				quickpick.onDidAccept(() => {
					if (quickpick.activeItems.length !== 0) {
						resolve(quickpick.activeItems[0]);
					}
				}),
				quickpick.onDidTriggerButton(e => {
					if (e === ResetAIKeyButton) {
						void executeCommand(GlCommand.ResetAIKey);
					}
				}),
			);

			quickpick.title = 'Choose AI Model';
			quickpick.placeholder = 'Select an AI model to use';
			quickpick.matchOnDescription = true;
			quickpick.matchOnDetail = true;
			quickpick.buttons = [ResetAIKeyButton];
			quickpick.items = items;

			quickpick.show();
		});

		return pick;
	} finally {
		quickpick.dispose();
		disposables.forEach(d => void d.dispose());
	}
}
