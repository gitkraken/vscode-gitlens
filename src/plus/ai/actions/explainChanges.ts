import type { CancellationToken, ProgressOptions } from 'vscode';
import type { TelemetryEvents } from '../../../constants.telemetry';
import { AINoRequestDataError, CancellationError } from '../../../errors';
import type { GitCommit } from '../../../git/models/commit';
import { isCommit } from '../../../git/models/commit';
import type { GitRevisionReference } from '../../../git/models/reference';
import { assertsCommitHasFullDetails } from '../../../git/utils/commit.utils';
import { configuration } from '../../../system/-webview/configuration';
import type { AIResponse, AIResult, AISourceContext } from '../aiProviderService';
import type { AIService } from '../aiService';
import type { PromptTemplateContext } from '../models/promptTemplates';
import type { AIChatMessage } from '../models/provider';
import type { AISummarizedResult } from '../models/results';
import { parseSummarizeResult } from '../utils/-webview/results.utils';

export type AIExplainSourceContext = AISourceContext<{ type: TelemetryEvents['ai/explain']['changeType'] }>;

/** Explains changes in a diff or set of files */
export async function explainChanges(
	service: AIService,
	promptContext:
		| PromptTemplateContext<'explain-changes'>
		| ((cancellationToken: CancellationToken) => Promise<PromptTemplateContext<'explain-changes'>>),
	sourceContext: AIExplainSourceContext,
	options?: { cancellation?: CancellationToken; progress?: ProgressOptions },
): Promise<AIResult<AISummarizedResult> | 'cancelled' | undefined> {
	const { context, ...source } = sourceContext;

	const result = await service.sendRequest(
		'explain-changes',
		undefined,
		{
			getMessages: async (model, reporting, cancellation, maxInputTokens, retries) => {
				if (typeof promptContext === 'function') {
					promptContext = await promptContext(cancellation);
				}

				promptContext.instructions = `${
					promptContext.instructions ? `${promptContext.instructions}\n` : ''
				}${configuration.get('ai.explainChanges.customInstructions')}`;

				if (cancellation.isCancellationRequested) throw new CancellationError();

				const { prompt } = await service.getPrompt(
					'explain-changes',
					model,
					promptContext,
					maxInputTokens,
					retries,
					reporting,
				);
				if (cancellation.isCancellationRequested) throw new CancellationError();

				const messages: AIChatMessage[] = [{ role: 'user', content: prompt }];
				return messages;
			},
			getProgressTitle: m => `Explaining changes with ${m.name}...`,
			getTelemetryInfo: m => ({
				key: 'ai/explain',
				data: {
					type: 'change',
					changeType: context.type,
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

	const promise: Promise<AIResponse<AISummarizedResult> | 'cancelled' | undefined> = result.promise.then(result =>
		result === 'cancelled'
			? result
			: result != null
				? {
						...result,
						type: 'explain-changes',
						feature: `explain-${context?.type}`,
						result: parseSummarizeResult(result.content),
					}
				: undefined,
	);

	return {
		...result,
		type: 'explain-changes',
		feature: `explain-${context.type}`,
		promise: promise,
	};
}

/** Explains a commit by analyzing its changes */
export async function explainCommit(
	service: AIService,
	commitOrRevision: GitRevisionReference | GitCommit,
	sourceContext: AIExplainSourceContext,
	options?: { cancellation?: CancellationToken; progress?: ProgressOptions },
): Promise<AIResult<AISummarizedResult> | 'cancelled' | undefined> {
	const svc = service.container.git.getRepositoryService(commitOrRevision.repoPath);
	return explainChanges(
		service,
		async cancellation => {
			const diff = await svc.diff.getDiff?.(commitOrRevision.ref);
			if (!diff?.contents) throw new AINoRequestDataError('No changes found to explain.');
			if (cancellation.isCancellationRequested) throw new CancellationError();

			const commit = isCommit(commitOrRevision)
				? commitOrRevision
				: await svc.commits.getCommit(commitOrRevision.ref);
			if (commit == null) throw new AINoRequestDataError('No commit found to explain.');
			if (cancellation.isCancellationRequested) throw new CancellationError();

			if (!commit.hasFullDetails()) {
				await commit.ensureFullDetails();
				assertsCommitHasFullDetails(commit);
				if (cancellation.isCancellationRequested) throw new CancellationError();
			}

			return { diff: diff.contents, message: commit.message };
		},
		sourceContext,
		options,
	);
}
