import type { CancellationToken, MessageItem, ProgressOptions } from 'vscode';
import { window } from 'vscode';
import type { Source } from '../../../constants.telemetry';
import { AINoRequestDataError, CancellationError } from '../../../errors';
import type { Repository } from '../../../git/models/repository';
import type { Deferred } from '../../../system/promise';
import { dedent } from '../../../system/string';
import type { AIResponse } from '../aiProviderService';
import type { AIService } from '../aiService';
import type { AIModel } from '../models/model';
import type { AIChatMessage, AIProviderResponse } from '../models/provider';

export type AIRebaseResult = AIResponse<{
	diff: string;
	hunkMap: { index: number; hunkHeader: string }[];
	commits: { readonly message: string; readonly explanation: string; readonly hunks: { hunk: number }[] }[];
}>;

export interface GenerateRebaseOptions {
	cancellation?: CancellationToken;
	context?: string;
	generating?: Deferred<AIModel>;
	progress?: ProgressOptions;
	generateCommits?: boolean;
}

interface RebaseData {
	diff: string;
	hunkMap: { index: number; hunkHeader: string }[];
	commits: { readonly message: string; readonly explanation: string; readonly hunks: { hunk: number }[] }[];
}

/** Generates a rebase or commits by organizing existing hunks into logical commits */
export async function generateRebase(
	service: AIService,
	repo: Repository,
	baseRef: string,
	headRef: string,
	source: Source,
	options?: GenerateRebaseOptions,
): Promise<AIRebaseResult | 'cancelled' | undefined> {
	const rebaseData: RebaseData = { diff: undefined!, hunkMap: [], commits: [] };

	const confirmed = service.container.storage.get(
		options?.generateCommits ? 'confirm:ai:generateCommits' : 'confirm:ai:generateRebase',
		false,
	);
	if (!confirmed) {
		const accept: MessageItem = { title: 'Continue' };
		const cancel: MessageItem = { title: 'Cancel', isCloseAffordance: true };

		const userResponse = await window.showInformationMessage(
			`This will ${
				options?.generateCommits
					? 'stash all of your changes and commit directly to your current branch'
					: 'create a new branch at the chosen commit and commit directly to that branch'
			}.`,
			{ modal: true },
			accept,
			cancel,
		);

		if (userResponse === cancel) {
			return undefined;
		} else if (userResponse === accept) {
			await service.container.storage.store(
				options?.generateCommits ? 'confirm:ai:generateCommits' : 'confirm:ai:generateRebase',
				true,
			);
		}
	}

	const rq = await sendRebaseRequestWithRetry(repo, baseRef, headRef, source, rebaseData, service, options);

	if (rq === 'cancelled') return rq;

	if (rq == null) return undefined;

	return {
		...rq,
		type: 'generate-rebase',
		feature: options?.generateCommits ? 'generate-commits' : 'generate-rebase',
		result: rebaseData,
	};
}

async function sendRebaseRequestWithRetry(
	repo: Repository,
	baseRef: string,
	headRef: string,
	source: Source,
	data: RebaseData,
	service: AIService,
	options?: GenerateRebaseOptions,
): Promise<AIProviderResponse<void> | 'cancelled' | undefined> {
	let conversationMessages: AIChatMessage[] | undefined;

	const result = await service.sendRequestConversation<
		{ readonly message: string; readonly explanation: string; readonly hunks: { hunk: number }[] }[]
	>(
		'generate-rebase',
		undefined,
		{
			getMessages: async (model, reporting, cancellation, maxCodeCharacters, retries) => {
				// First attempt - get initial prompt
				if (conversationMessages == null) {
					const diff = await repo.git.diff.getDiff?.(headRef, baseRef, { notation: '...' });
					if (!diff?.contents) {
						throw new AINoRequestDataError(
							`No changes found to generate ${options?.generateCommits ? 'commits' : 'a rebase'} from.`,
						);
					}
					if (cancellation.isCancellationRequested) throw new CancellationError();

					data.diff = diff.contents;

					const hunkMap: { index: number; hunkHeader: string }[] = [];
					let counter = 0;
					for (const hunkHeader of diff.contents.matchAll(/@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(.*)$/gm)) {
						hunkMap.push({ index: ++counter, hunkHeader: hunkHeader[0] });
					}
					data.hunkMap = hunkMap;

					const { prompt } = await service.getPrompt(
						'generate-rebase',
						model,
						{
							diff: diff.contents,
							data: JSON.stringify(hunkMap),
							context: options?.context,
						},
						maxCodeCharacters,
						retries,
						reporting,
					);
					if (cancellation.isCancellationRequested) throw new CancellationError();

					conversationMessages = [{ role: 'user', content: prompt }];
					return conversationMessages;
				}

				// Retry attempt - conversation already has messages
				return conversationMessages;
			},

			validateResponse: (response, _attempt) => {
				const validationResult = validateRebaseResponse(response, data.hunkMap, options);
				if (validationResult.isValid) {
					return { isValid: true, result: validationResult.commits };
				}

				// Append retry prompt to conversation
				conversationMessages!.push(
					{ role: 'assistant', content: response.content },
					{ role: 'user', content: validationResult.retryPrompt },
				);

				return validationResult;
			},

			getProgressTitle: (model, attempt) =>
				`Generating ${options?.generateCommits ? 'commits' : 'rebase'} with ${model.name}...${
					attempt > 0 ? ` (attempt ${attempt + 1})` : ''
				}`,

			getTelemetryInfo: (model, attempt) => ({
				key: 'ai/generate',
				data: {
					type: 'rebase',
					id: undefined,
					'model.id': model.id,
					'model.provider.id': model.provider.id,
					'model.provider.name': model.provider.name,
					'retry.count': attempt,
				},
			}),
		},
		source,
		options,
	);
	if (result == null || result === 'cancelled') return result;

	data.commits = result.result;
	return result.response;
}

function validateRebaseResponse(
	rq: AIProviderResponse<void>,
	inputHunkMap: { index: number; hunkHeader: string }[],
	options?: {
		generateCommits?: boolean;
	},
):
	| { isValid: false; errorMessage: string; retryPrompt: string }
	| {
			isValid: true;
			commits: { readonly message: string; readonly explanation: string; readonly hunks: { hunk: number }[] }[];
	  } {
	// if it is wrapped in markdown, we need to strip it
	const content = rq.content.replace(/^\s*```json\s*/, '').replace(/\s*```$/, '');

	let commits: { readonly message: string; readonly explanation: string; readonly hunks: { hunk: number }[] }[];
	try {
		// Parse the JSON content from the result
		commits = JSON.parse(content) as {
			readonly message: string;
			readonly explanation: string;
			readonly hunks: { hunk: number }[];
		}[];
	} catch {
		const errorMessage = `Unable to parse ${options?.generateCommits ? 'commits' : 'rebase'} result`;
		const retryPrompt = dedent(`
				Your previous response could not be parsed as valid JSON. Please ensure your response is a valid JSON array of commits with the correct structure.
				Don't include any preceeding or succeeding text or markup, such as "Here are the commits:" or "Here is a valid JSON array of commits:".

				Here was your previous response:
				${rq.content}

				Please provide a valid JSON array of commits following this structure:
				[
				  {
				    "message": "commit message",
				    "explanation": "detailed explanation",
				    "hunks": [{"hunk": 1}, {"hunk": 2}]
				  }
				]
			`);

		return { isValid: false, errorMessage: errorMessage, retryPrompt: retryPrompt };
	}

	// Validate the structure and hunk assignments
	try {
		const inputHunkIndices = inputHunkMap.map(h => h.index);
		const allOutputHunks = commits.flatMap(c => c.hunks.map(h => h.hunk));
		const outputHunkIndices = new Map(allOutputHunks.map((hunk, index) => [hunk, index]));
		const missingHunks = inputHunkIndices.filter(i => !outputHunkIndices.has(i));

		if (missingHunks.length > 0 || allOutputHunks.length > inputHunkIndices.length) {
			const errorParts: string[] = [];
			const retryParts: string[] = [];

			if (missingHunks.length > 0) {
				const pluralize = missingHunks.length > 1 ? 's' : '';
				errorParts.push(`${missingHunks.length} missing hunk${pluralize}`);
				retryParts.push(`You missed hunk${pluralize} ${missingHunks.join(', ')} in your response`);
			}
			const extraHunks = [...outputHunkIndices.keys()].filter(i => !inputHunkIndices.includes(i));
			if (extraHunks.length > 0) {
				const pluralize = extraHunks.length > 1 ? 's' : '';
				errorParts.push(`${extraHunks.length} extra hunk${pluralize}`);
				retryParts.push(
					`You included hunk${pluralize} ${extraHunks.join(', ')} which ${
						extraHunks.length > 1 ? 'were' : 'was'
					} not in the original diff`,
				);
			}
			const duplicateHunks = allOutputHunks.filter((hunk, index) => outputHunkIndices.get(hunk)! !== index);
			const uniqueDuplicates = [...new Set(duplicateHunks)];
			if (uniqueDuplicates.length > 0) {
				const pluralize = uniqueDuplicates.length > 1 ? 's' : '';
				errorParts.push(`${uniqueDuplicates.length} duplicate hunk${pluralize}`);
				retryParts.push(`You used hunk${pluralize} ${uniqueDuplicates.join(', ')} multiple times`);
			}

			const errorMessage = `Invalid response in generating ${
				options?.generateCommits ? 'commits' : 'rebase'
			} result. ${errorParts.join(', ')}.`;

			const retryPrompt = dedent(`
					Your previous response had issues: ${retryParts.join(', ')}.

					Please provide a corrected JSON response that:
					1. Includes ALL hunks from 1 to ${Math.max(...inputHunkIndices)} exactly once
					2. Does not include any hunk numbers outside this range
					3. Does not use any hunk more than once

					Here was your previous response:
					${rq.content}

					Please provide the corrected JSON array of commits.
					Don't include any preceeding or succeeding text or markup, such as "Here are the commits:" or "Here is a valid JSON array of commits:".
				`);

			return { isValid: false, errorMessage: errorMessage, retryPrompt: retryPrompt };
		}

		// If validation passes, return the commits
		return { isValid: true, commits: commits };
	} catch {
		// Handle any errors during hunk validation (e.g., malformed commit structure)
		const errorMessage = `Invalid commit structure in ${options?.generateCommits ? 'commits' : 'rebase'} result`;
		const retryPrompt = dedent(`
				Your previous response has an invalid commit structure. Each commit must have "message", "explanation", and "hunks" properties, where "hunks" is an array of objects with "hunk" numbers.

				Here was your previous response:
				${rq.content}

				Please provide a valid JSON array of commits following this structure:
				[
				  {
				    "message": "commit message",
				    "explanation": "detailed explanation",
				    "hunks": [{"hunk": 1}, {"hunk": 2}]
				  }
				]
			`);

		return { isValid: false, errorMessage: errorMessage, retryPrompt: retryPrompt };
	}
}
