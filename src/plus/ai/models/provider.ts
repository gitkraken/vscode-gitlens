import type { CancellationToken, Disposable, Event } from 'vscode';
import type { AIProviders } from '../../../constants.ai';
import type { TelemetryEvents } from '../../../constants.telemetry';
import type { AIActionType, AIModel } from './model';
import type { PromptTemplate, PromptTemplateContext } from './promptTemplates';

export interface AIProvider<Provider extends AIProviders = AIProviders> extends Disposable {
	readonly id: Provider;
	readonly name: string;

	onDidChange?: Event<void>;

	getModels(): Promise<readonly AIModel<Provider>[]>;
	getPromptTemplate(action: AIActionType, model: AIModel<Provider>): Promise<PromptTemplate | undefined>;

	sendRequest<T extends AIActionType>(
		action: T,
		context: PromptTemplateContext<T>,
		model: AIModel<Provider>,
		reporting: TelemetryEvents['ai/generate' | 'ai/explain'],
		options?: { cancellation?: CancellationToken; outputTokens?: number },
	): Promise<string | undefined>;
}
