import type { CancellationToken, ProgressOptions } from 'vscode';
import type { Source } from '../../../constants.telemetry';
import { AINoRequestDataError, CancellationError } from '../../../errors';
import { configuration } from '../../../system/-webview/configuration';
import type { Lazy } from '../../../system/lazy';
import type { AIResponse } from '../aiProviderService';
import type { AIService } from '../aiService';
import type { AIChatMessage } from '../models/provider';

export interface AIGenerateChangelogChanges {
	readonly changes: readonly AIGenerateChangelogChange[];
	readonly range: {
		readonly base: { readonly ref: string; readonly label?: string };
		readonly head: { readonly ref: string; readonly label?: string };
	};
}

export interface AIGenerateChangelogChange {
	readonly message: string;
	readonly issues: readonly { readonly id: string; readonly url: string; readonly title: string | undefined }[];
}

export type AIChangelogResult = string;

/** Generates a changelog from a set of changes */
export async function generateChangelog(
	service: AIService,
	changes: Lazy<Promise<AIGenerateChangelogChanges>>,
	source: Source,
	options?: { cancellation?: CancellationToken; progress?: ProgressOptions },
): Promise<AIResponse<AIChangelogResult> | 'cancelled' | undefined> {
	const result = await service.sendRequest(
		'generate-changelog',
		undefined,
		{
			getMessages: async (model, reporting, cancellation, maxInputTokens, retries) => {
				const { changes: data } = await changes.value;
				if (!data.length) throw new AINoRequestDataError('No changes to generate a changelog from.');
				if (cancellation.isCancellationRequested) throw new CancellationError();

				const { prompt } = await service.getPrompt(
					'generate-changelog',
					model,
					{
						data: JSON.stringify(data),
						instructions: configuration.get('ai.generateChangelog.customInstructions'),
					},
					maxInputTokens,
					retries,
					reporting,
				);
				if (cancellation.isCancellationRequested) throw new CancellationError();

				const messages: AIChatMessage[] = [{ role: 'user', content: prompt }];
				return messages;
			},
			getProgressTitle: m => `Generating changelog with ${m.name}...`,
			getTelemetryInfo: m => ({
				key: 'ai/generate',
				data: {
					type: 'changelog',
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
			? { ...response, type: 'generate-changelog', feature: 'generate-changelog', result: response.content }
			: undefined;
}
