import type { CancellationToken, ProgressOptions } from 'vscode';
import type { Container } from '../../container.js';
import type { GlRepository } from '../../git/models/repository.js';
import type { AIProviderService } from './aiProviderService.js';

export interface AIService {
	readonly container: Container;

	getChanges(
		changesOrRepo: string | string[] | GlRepository,
		options?: { cancellation?: CancellationToken; context?: string; progress?: ProgressOptions },
	): Promise<string | undefined>;
	getPrompt: AIProviderService['getPrompt'];
	sendRequest: AIProviderService['sendRequest'];
	sendRequestConversation: AIProviderService['sendRequestConversation'];
}
