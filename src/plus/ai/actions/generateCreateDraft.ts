import type { CancellationToken, ProgressOptions } from 'vscode';
import type { AIGenerateCreateDraftEventData } from '../../../constants.telemetry.js';
import { AINoRequestDataError, CancellationError } from '../../../errors.js';
import type { Repository } from '../../../git/models/repository.js';
import { configuration } from '../../../system/-webview/configuration.js';
import type { Deferred } from '../../../system/promise.js';
import type { AIResponse, AISourceContext } from '../aiProviderService.js';
import type { AIService } from '../aiService.js';
import type { AIModel } from '../models/model.js';
import type { AIChatMessage } from '../models/provider.js';
import type { AISummarizedResult } from '../models/results.js';
import { parseSummarizeResult } from '../utils/-webview/results.utils.js';
import { truncatePromptWithDiff } from '../utils/-webview/truncation.utils.js';

/** Generates a draft message (cloud patch or code suggestion) */
export async function generateCreateDraft(
	service: AIService,
	changesOrRepo: string | string[] | Repository,
	sourceContext: AISourceContext<{ type: AIGenerateCreateDraftEventData['draftType'] }>,
	options?: {
		cancellation?: CancellationToken;
		context?: string;
		generating?: Deferred<AIModel>;
		progress?: ProgressOptions;
		codeSuggestion?: boolean;
	},
): Promise<AIResponse<AISummarizedResult> | 'cancelled' | undefined> {
	const { context, ...source } = sourceContext;

	const result = await service.sendRequest(
		options?.codeSuggestion ? 'generate-create-codeSuggestion' : 'generate-create-cloudPatch',
		undefined,
		{
			getMessages: async (model, reporting, cancellation, maxInputTokens, retries) => {
				const changes: string | undefined = await service.getChanges(changesOrRepo);
				if (changes == null) {
					throw new AINoRequestDataError(
						`No changes to generate a ${options?.codeSuggestion ? 'code suggestion' : 'cloud patch'} from.`,
					);
				}
				if (cancellation.isCancellationRequested) throw new CancellationError();

				const { prompt } = await service.getPrompt(
					options?.codeSuggestion ? 'generate-create-codeSuggestion' : 'generate-create-cloudPatch',
					model,
					{
						diff: changes,
						context: options?.context,
						instructions: options?.codeSuggestion
							? configuration.get('ai.generateCreateCodeSuggest.customInstructions')
							: configuration.get('ai.generateCreateCloudPatch.customInstructions'),
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
			getProgressTitle: m =>
				`Generating ${options?.codeSuggestion ? 'code suggestion' : 'cloud patch'} description with ${m.name}...`,
			getTelemetryInfo: m => ({
				key: 'ai/generate',
				data: {
					type: 'draftMessage',
					draftType: context?.type,
					id: undefined,
					'model.id': m.id,
					'model.provider.id': m.provider.id,
					'model.provider.name': m.provider.name,
					'retry.count': 0,
				},
			}),
		},
		source,
		options,
	);
	if (result == null || result === 'cancelled') return result;

	const response = await result.promise;
	return response === 'cancelled'
		? response
		: response != null
			? {
					...response,
					type: options?.codeSuggestion ? 'generate-create-codeSuggestion' : 'generate-create-cloudPatch',
					feature: options?.codeSuggestion ? 'generate-create-codeSuggestion' : 'generate-create-cloudPatch',
					result: parseSummarizeResult(response.content),
				}
			: undefined;
}
