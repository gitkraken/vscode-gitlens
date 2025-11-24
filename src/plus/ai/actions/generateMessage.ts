import type { CancellationToken, ProgressOptions } from 'vscode';
import type { Source } from '../../../constants.telemetry';
import { AINoRequestDataError, CancellationError } from '../../../errors';
import type { Repository } from '../../../git/models/repository';
import { configuration } from '../../../system/-webview/configuration';
import type { Deferred } from '../../../system/promise';
import type { AIResponse } from '../aiProviderService';
import type { AIService } from '../aiService';
import type { AIModel } from '../models/model';
import type { AIChatMessage } from '../models/provider';
import type { AISummarizedResult } from '../models/results';
import { parseSummarizeResult } from '../utils/-webview/results.utils';

/** Generates a commit message based on staged or unstaged changes */
export async function generateCommitMessage(
	service: AIService,
	changesOrRepo: string | string[] | Repository,
	source: Source,
	options?: {
		cancellation?: CancellationToken;
		context?: string;
		customInstructions?: string;
		generating?: Deferred<AIModel>;
		progress?: ProgressOptions;
	},
): Promise<AIResponse<AISummarizedResult> | 'cancelled' | undefined> {
	const result = await service.sendRequest(
		'generate-commitMessage',
		undefined,
		{
			getMessages: async (model, reporting, cancellation, maxInputTokens, retries) => {
				const changes: string | undefined = await service.getChanges(changesOrRepo);
				if (changes == null) throw new AINoRequestDataError('No changes to generate a commit message from.');
				if (cancellation.isCancellationRequested) throw new CancellationError();

				const { prompt } = await service.getPrompt(
					'generate-commitMessage',
					model,
					{
						diff: changes,
						context: options?.context,
						instructions: configuration.get('ai.generateCommitMessage.customInstructions'),
					},
					maxInputTokens,
					retries,
					reporting,
				);
				if (cancellation.isCancellationRequested) throw new CancellationError();

				const messages: AIChatMessage[] = [{ role: 'user', content: prompt }];
				return messages;
			},
			getProgressTitle: m => `Generating commit message with ${m.name}...`,
			getTelemetryInfo: m => ({
				key: 'ai/generate',
				data: {
					type: 'commitMessage',
					id: undefined,
					'model.id': m.id,
					'model.provider.id': m.provider.id,
					'model.provider.name': m.provider.name,
					'retry.count': 0,
				},
			}),
		},
		source,
		{ ...options, modelOptions: { outputTokens: 4096 } },
	);
	if (result === 'cancelled') return result;
	if (result == null) return undefined;

	const response = await result.promise;
	return response === 'cancelled'
		? response
		: response != null
			? {
					...response,
					type: 'generate-commitMessage',
					feature: 'generate-commitMessage',
					result: parseSummarizeResult(response.content),
				}
			: undefined;
}

/** Generates a stash message based on changes */
export async function generateStashMessage(
	service: AIService,
	changesOrRepo: string | string[] | Repository,
	source: Source,
	options?: {
		cancellation?: CancellationToken;
		context?: string;
		generating?: Deferred<AIModel>;
		progress?: ProgressOptions;
	},
): Promise<AIResponse<AISummarizedResult> | 'cancelled' | undefined> {
	const result = await service.sendRequest(
		'generate-stashMessage',
		undefined,
		{
			getMessages: async (model, reporting, cancellation, maxInputTokens, retries) => {
				const changes: string | undefined = await service.getChanges(changesOrRepo);
				if (changes == null) throw new AINoRequestDataError('No changes to generate a stash message from.');
				if (cancellation.isCancellationRequested) throw new CancellationError();

				const { prompt } = await service.getPrompt(
					'generate-stashMessage',
					model,
					{
						diff: changes,
						context: options?.context,
						instructions: configuration.get('ai.generateStashMessage.customInstructions'),
					},
					maxInputTokens,
					retries,
					reporting,
				);
				if (cancellation.isCancellationRequested) throw new CancellationError();

				const messages: AIChatMessage[] = [{ role: 'user', content: prompt }];
				return messages;
			},
			getProgressTitle: m => `Generating stash message with ${m.name}...`,
			getTelemetryInfo: m => ({
				key: 'ai/generate',
				data: {
					type: 'stashMessage',
					id: undefined,
					'model.id': m.id,
					'model.provider.id': m.provider.id,
					'model.provider.name': m.provider.name,
					'retry.count': 0,
				},
			}),
		},
		source,
		{ ...options, modelOptions: { outputTokens: 1024 } },
	);
	if (result === 'cancelled') return result;
	if (result == null) return undefined;

	const response = await result.promise;
	return response === 'cancelled'
		? response
		: response != null
			? {
					...response,
					type: 'generate-stashMessage',
					feature: 'generate-stashMessage',
					result: parseSummarizeResult(response.content),
				}
			: undefined;
}
