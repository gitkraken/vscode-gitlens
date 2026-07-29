import type { CancellationToken, ProgressOptions } from 'vscode';
import type { AIModel } from '@gitlens/ai/models/model.js';
import type { AIChatMessage } from '@gitlens/ai/models/provider.js';
import type { AISummarizedResult } from '@gitlens/ai/models/results.js';
import { parseSummarizeResult } from '@gitlens/ai/utils/results.utils.js';
import { truncatePromptWithDiff } from '@gitlens/ai/utils/truncation.utils.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import type { Deferred } from '@gitlens/utils/promise.js';
import type { AIGenerateCreateDraftEventData } from '../../../constants.telemetry.js';
import { AINoRequestDataError } from '../../../errors.js';
import type { GlRepository } from '../../../git/models/repository.js';
import { configuration } from '../../../system/-webview/configuration.js';
import type { AIResponse, AISourceContext } from '../aiProviderService.js';
import type { AIService } from '../aiService.js';

/** Generates a cloud patch draft message */
export async function generateCreateDraft(
	service: AIService,
	changesOrRepo: string | string[] | GlRepository,
	sourceContext: AISourceContext<{ type: AIGenerateCreateDraftEventData['draftType'] }>,
	options?: {
		cancellation?: CancellationToken;
		context?: string;
		generating?: Deferred<AIModel>;
		progress?: ProgressOptions;
	},
): Promise<AIResponse<AISummarizedResult> | 'cancelled' | undefined> {
	const { context, ...source } = sourceContext;

	const result = await service.sendRequest(
		'generate-create-cloudPatch',
		undefined,
		{
			getMessages: async (model, reporting, cancellation, maxInputTokens, retries) => {
				const changes: string | undefined = await service.getChanges(changesOrRepo);
				if (changes == null) {
					throw new AINoRequestDataError('No changes to generate a cloud patch from.');
				}
				if (cancellation.isCancellationRequested) throw new CancellationError();

				const { prompt } = await service.getPrompt(
					'generate-create-cloudPatch',
					model,
					{
						diff: changes,
						context: options?.context,
						instructions: configuration.get('ai.generateCreateCloudPatch.customInstructions'),
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
			getProgressTitle: m => `Generating cloud patch description with ${m.name}...`,
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
					type: 'generate-create-cloudPatch',
					feature: 'generate-create-cloudPatch',
					result: parseSummarizeResult(response.content),
				}
			: undefined;
}
