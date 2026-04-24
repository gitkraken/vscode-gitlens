import type { CancellationToken, ProgressOptions } from 'vscode';
import type { PromptTemplateContext } from '@gitlens/ai/models/promptTemplates.js';
import type { AIChatMessage } from '@gitlens/ai/models/provider.js';
import type { AISummarizedResult } from '@gitlens/ai/models/results.js';
import { parseSummarizeResult } from '@gitlens/ai/utils/results.utils.js';
import { truncatePromptWithDiff } from '@gitlens/ai/utils/truncation.utils.js';
import { GitCommit } from '@gitlens/git/models/commit.js';
import type { GitRevisionReference } from '@gitlens/git/models/reference.js';
import { assertsCommitHasFullDetails } from '@gitlens/git/utils/commit.utils.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import type { TelemetryEvents } from '../../../constants.telemetry.js';
import { AINoRequestDataError } from '../../../errors.js';
import { configuration } from '../../../system/-webview/configuration.js';
import type { AIResponse, AIResult, AISourceContext } from '../aiProviderService.js';
import type { AIService } from '../aiService.js';
import { mergeUserInstructions } from '../utils/-webview/prompt.utils.js';

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

				promptContext.instructions = mergeUserInstructions(
					configuration.get('ai.explainChanges.customInstructions'),
					promptContext.instructions,
					'The user provided the following guidance for this explanation — incorporate it into your response:',
				);

				if (cancellation.isCancellationRequested) throw new CancellationError();

				const { prompt } = await service.getPrompt(
					'explain-changes',
					model,
					promptContext,
					maxInputTokens,
					retries,
					reporting,
					truncatePromptWithDiff,
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
	options?: { cancellation?: CancellationToken; progress?: ProgressOptions; prompt?: string },
): Promise<AIResult<AISummarizedResult> | 'cancelled' | undefined> {
	const svc = service.container.git.getRepositoryService(commitOrRevision.repoPath);
	return explainChanges(
		service,
		async cancellation => {
			const diff = await svc.diff.getDiff?.(commitOrRevision.ref);
			if (!diff?.contents) throw new AINoRequestDataError('No changes found to explain.');
			if (cancellation.isCancellationRequested) throw new CancellationError();

			const commit = GitCommit.is(commitOrRevision)
				? commitOrRevision
				: await svc.commits.getCommit(commitOrRevision.ref);
			if (commit == null) throw new AINoRequestDataError('No commit found to explain.');
			if (cancellation.isCancellationRequested) throw new CancellationError();

			if (!commit.hasFullDetails()) {
				await GitCommit.ensureFullDetails(commit);
				if (cancellation.isCancellationRequested) throw new CancellationError();
			}
			assertsCommitHasFullDetails(commit);

			return { diff: diff.contents, message: commit.message, instructions: options?.prompt };
		},
		sourceContext,
		options,
	);
}
