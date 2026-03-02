import type { CancellationToken, ProgressOptions } from 'vscode';
import { md5 } from '@env/crypto.js';
import type { Source } from '../../../constants.telemetry.js';
import { AINoRequestDataError, CancellationError } from '../../../errors.js';
import type { Repository } from '../../../git/models/repository.js';
import { configuration } from '../../../system/-webview/configuration.js';
import type { Deferred } from '../../../system/promise.js';
import type { AIResponse } from '../aiProviderService.js';
import type { AIService } from '../aiService.js';
import type { AIModel } from '../models/model.js';
import type { AIChatMessage } from '../models/provider.js';
import type { AISummarizedResult } from '../models/results.js';
import { parseSummarizeResult } from '../utils/-webview/results.utils.js';
import { truncatePromptWithDiff } from '../utils/-webview/truncation.utils.js';

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
		suppressLargePromptWarning?: boolean;
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

				const customInstructions = configuration.get('ai.generateCommitMessage.customInstructions');

				// Report diff and custom instruction details for telemetry
				reporting['diff.files.count'] = (changes.match(/^diff --git /gm) ?? []).length;
				reporting['diff.hunks.count'] = (changes.match(/^@@ /gm) ?? []).length;
				reporting['diff.lines.count'] = (changes.match(/^[+-](?![+-]{2} )/gm) ?? []).length;
				reporting['diff.hash'] = md5(changes);

				reporting['customInstructions.setting.used'] = Boolean(customInstructions);
				reporting['customInstructions.setting.length'] = customInstructions?.length ?? 0;

				const { prompt } = await service.getPrompt(
					'generate-commitMessage',
					model,
					{
						diff: changes,
						context: options?.context,
						instructions: customInstructions,
					},
					maxInputTokens,
					retries,
					reporting,
					truncatePromptWithDiff,
					options?.suppressLargePromptWarning ? { suppressLargePromptWarning: true } : undefined,
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
					truncatePromptWithDiff,
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
