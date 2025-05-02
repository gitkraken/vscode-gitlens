import type { Disposable } from 'vscode';
import { window } from 'vscode';
import { openAICompatibleProviderDescriptor as provider } from '../../constants.ai';
import { configuration } from '../../system/-webview/configuration';
import type { AIModel } from './models/model';
import { openAIModels } from './models/model';
import { OpenAICompatibleProviderBase } from './openAICompatibleProviderBase';
import { isAzureUrl } from './utils/-webview/ai.utils';

type OpenAICompatibleModel = AIModel<typeof provider.id>;
const models: OpenAICompatibleModel[] = openAIModels(provider);

export class OpenAICompatibleProvider extends OpenAICompatibleProviderBase<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;
	protected readonly descriptor = provider;
	protected readonly config = {
		keyUrl: undefined,
		keyValidator: /(?:sk-)?[a-zA-Z0-9]{32,}/,
	};

	getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		return Promise.resolve(models);
	}

	protected getUrl(_model?: AIModel<typeof provider.id>): string | undefined {
		return configuration.get('ai.openaicompatible.url') ?? undefined;
	}

	private async getOrPromptBaseUrl(silent: boolean): Promise<string | undefined> {
		let url: string | undefined = this.getUrl();

		if (silent || url != null) return url;

		const input = window.createInputBox();
		input.ignoreFocusOut = true;

		const disposables: Disposable[] = [];

		try {
			url = await new Promise<string | undefined>(resolve => {
				disposables.push(
					input.onDidHide(() => resolve(undefined)),
					input.onDidChangeValue(value => {
						if (value) {
							try {
								new URL(value);
							} catch {
								input.validationMessage = `Please enter a valid URL`;
								return;
							}
						}
						input.validationMessage = undefined;
					}),
					input.onDidAccept(() => {
						const value = input.value.trim();
						if (!value) {
							input.validationMessage = `Please enter a valid URL`;
							return;
						}

						try {
							new URL(value);
						} catch {
							input.validationMessage = `Please enter a valid URL`;
							return;
						}

						if (isAzureUrl(value)) {
							input.validationMessage = `Please use the Azure OpenAI provider instead for Azure URLS`;
							return;
						}

						resolve(value);
					}),
				);

				input.title = `Connect to OpenAI-Compatible Provider`;
				input.placeholder = `Please enter your provider's URL to use this feature`;
				input.prompt = `Enter your OpenAI-Compatible Provider URL`;

				input.show();
			});
		} finally {
			input.dispose();
			disposables.forEach(d => void d.dispose());
		}

		if (url) {
			void configuration.updateEffective('ai.openaicompatible.url', url);
		}

		return url;
	}

	override async configured(silent: boolean): Promise<boolean> {
		const url = await this.getOrPromptBaseUrl(silent);
		if (url == null || isAzureUrl(url)) return false;

		return super.configured(silent);
	}
}
