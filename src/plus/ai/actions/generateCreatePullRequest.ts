import type { CancellationToken, ProgressOptions } from 'vscode';
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
import { prepareCompareDataForAIRequest } from '../utils/-webview/ai.utils.js';
import { parseSummarizeResult } from '../utils/-webview/results.utils.js';
import { truncatePromptWithDiff } from '../utils/-webview/truncation.utils.js';

/** Generates pull request title and description */
export async function generateCreatePullRequest(
	service: AIService,
	repo: Repository,
	baseRef: string,
	headRef: string,
	source: Source,
	options?: {
		cancellation?: CancellationToken;
		context?: string;
		generating?: Deferred<AIModel>;
		progress?: ProgressOptions;
	},
): Promise<AIResponse<AISummarizedResult> | 'cancelled' | undefined> {
	const result = await service.sendRequest(
		'generate-create-pullRequest',
		undefined,
		{
			getMessages: async (model, reporting, cancellation, maxInputTokens, retries) => {
				const compareData = await prepareCompareDataForAIRequest(repo.git, headRef, baseRef, {
					cancellation: cancellation,
				});

				if (!compareData?.diff || !compareData?.logMessages) {
					throw new AINoRequestDataError('No changes to generate a pull request from.');
				}

				const { diff, logMessages } = compareData;
				const { prompt } = await service.getPrompt(
					'generate-create-pullRequest',
					model,
					{
						diff: diff,
						data: logMessages,
						context: options?.context,
						instructions: configuration.get('ai.generateCreatePullRequest.customInstructions'),
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
			getProgressTitle: m => `Generating pull request details with ${m.name}...`,
			getTelemetryInfo: m => ({
				key: 'ai/generate',
				data: {
					type: 'createPullRequest',
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
					type: 'generate-create-pullRequest',
					feature: 'generate-create-pullRequest',
					result: parseSummarizeResult(response.content),
				}
			: undefined;
}
