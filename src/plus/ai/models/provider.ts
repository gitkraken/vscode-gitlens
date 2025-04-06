import type { CancellationToken, Disposable, Event } from 'vscode';
import type { AIProviders } from '../../../constants.ai';
import type { AIActionType, AIModel } from './model';

export type AIChatMessageRole = 'assistant' | 'system' | 'user';

export type AISystemChatMessage = AIChatMessage<'system'>;
export interface AIChatMessage<T extends AIChatMessageRole = 'assistant' | 'user'> {
	role: T;
	content: string;
}

export interface AIRequestResult {
	readonly id?: string;
	readonly content: string;
	readonly model: AIModel;
	readonly usage?: {
		readonly promptTokens?: number;
		readonly completionTokens?: number;
		readonly totalTokens?: number;

		readonly limits?: {
			readonly used: number;
			readonly limit: number;
			readonly resetsOn: Date;
		};
	};
}

export interface AIProvider<Provider extends AIProviders = AIProviders> extends Disposable {
	readonly id: Provider;
	readonly name: string;

	onDidChange?: Event<void>;

	configured(silent: boolean): Promise<boolean>;
	getApiKey(silent: boolean): Promise<string | undefined>;
	getModels(): Promise<readonly AIModel<Provider>[]>;
	sendRequest<T extends AIActionType>(
		action: T,
		model: AIModel<Provider>,
		apiKey: string,
		getMessages: (maxCodeCharacters: number, retries: number) => Promise<AIChatMessage[]>,
		options: { cancellation: CancellationToken; modelOptions?: { outputTokens?: number; temperature?: number } },
	): Promise<AIRequestResult | undefined>;
}
