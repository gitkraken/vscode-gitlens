import type { CancellationToken, ProgressOptions } from 'vscode';
import type { Source } from '../../../constants.telemetry';
import { CancellationError } from '../../../errors';
import { configuration } from '../../../system/-webview/configuration';
import type { Deferred } from '../../../system/promise';
import { dedent } from '../../../system/string';
import type { AIService } from '../aiService';
import type { AIModel } from '../models/model';
import type { AIProviderResponse } from '../models/provider';

export interface AIGenerateCommitsResult {
	readonly commits: { readonly message: string; readonly explanation: string; readonly hunks: { hunk: number }[] }[];
}

export type GenerateCommitsOptions = {
	cancellation?: CancellationToken;
	generating?: Deferred<AIModel>;
	progress?: ProgressOptions;
	customInstructions?: string;
};

/**
 * Generates commits by organizing existing hunks into logical commits.
 * Similar to generateRebase but works with existing hunks instead of generating a diff.
 *
 * This method includes automatic retry logic that validates the AI response and
 * continues the conversation if the response has issues like:
 * - Missing hunks that were in the original hunk map
 * - Extra hunks that weren't in the original hunk map
 * - Duplicate hunks used multiple times
 *
 * The method will retry up to 3 times, providing specific feedback to the AI
 * about what was wrong with the previous response.
 */
export async function generateCommits(
	service: AIService,
	hunks: {
		index: number;
		fileName: string;
		diffHeader: string;
		hunkHeader: string;
		content: string;
		source: string;
	}[],
	existingCommits: { id: string; message: string; aiExplanation?: string; hunkIndices: number[] }[],
	hunkMap: { index: number; hunkHeader: string }[],
	source: Source,
	options?: GenerateCommitsOptions,
): Promise<AIGenerateCommitsResult | 'cancelled' | undefined> {
	const retryResult = await service.sendRequestConversation<AIGenerateCommitsResult['commits']>(
		'generate-commits',
		undefined,
		{
			getMessages: async (model, reporting, cancellation, maxCodeCharacters, retries) => {
				const hunksJson = JSON.stringify(hunks);
				const existingCommitsJson = JSON.stringify(existingCommits);
				const hunkMapJson = JSON.stringify(hunkMap);

				if (cancellation.isCancellationRequested) throw new CancellationError();

				let customInstructions: string | undefined = undefined;
				const customInstructionsConfig = configuration.get('ai.generateCommits.customInstructions');
				if (customInstructionsConfig) {
					customInstructions = `${customInstructionsConfig}${options?.customInstructions ? `\nAnd here is additional guidance for this session:\n${options.customInstructions}` : ''}`;
				} else {
					customInstructions = options?.customInstructions;
				}

				const { prompt } = await service.getPrompt(
					'generate-commits',
					model,
					{
						hunks: hunksJson,
						existingCommits: existingCommitsJson,
						hunkMap: hunkMapJson,
						instructions: customInstructions,
					},
					maxCodeCharacters,
					retries,
					reporting,
				);
				if (cancellation.isCancellationRequested) throw new CancellationError();

				return [{ role: 'user', content: prompt }];
			},

			validateResponse: (response, _attempt) => {
				const validationResult = validateCommitsResponse(response, hunks, existingCommits);
				if (validationResult.isValid) {
					return { isValid: true, result: validationResult.commits };
				}
				return validationResult;
			},

			getProgressTitle: (model, attempt) =>
				`Generating commits with ${model.name}...${attempt > 0 ? ` (attempt ${attempt + 1})` : ''}`,

			getTelemetryInfo: (model, attempt) => ({
				key: 'ai/generate',
				data: {
					type: 'commits',
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

	if (retryResult === 'cancelled' || retryResult == null) {
		return retryResult;
	}

	return { commits: retryResult.result };
}

function parseOutputResult(result: string): string {
	return result.match(/<output>([\s\S]*?)(?:<\/output>|$)/)?.[1]?.trim() ?? '';
}

function validateCommitsResponse(
	rq: AIProviderResponse<void>,
	inputHunks: {
		index: number;
		fileName: string;
		diffHeader: string;
		hunkHeader: string;
		content: string;
		source: string;
	}[],
	existingCommits: { id: string; message: string; aiExplanation?: string; hunkIndices: number[] }[],
):
	| {
			isValid: true;
			commits: {
				readonly message: string;
				readonly explanation: string;
				readonly hunks: { hunk: number }[];
			}[];
	  }
	| { isValid: false; errorMessage: string; retryPrompt: string } {
	try {
		const rqContent = parseOutputResult(rq.content);

		// Parse the JSON response
		const commits: {
			readonly message: string;
			readonly explanation: string;
			readonly hunks: { hunk: number }[];
		}[] = JSON.parse(rqContent);

		if (!Array.isArray(commits)) {
			throw new Error('Commits result is not an array');
		}

		// Collect all hunk indices used in the commits
		const usedHunkIndices = new Set<number>();
		const duplicateHunks: number[] = [];

		for (const commit of commits) {
			if (!commit.hunks || !Array.isArray(commit.hunks)) {
				throw new Error('Invalid commit structure: missing or invalid hunks array');
			}

			for (const hunkRef of commit.hunks) {
				const hunkIndex = hunkRef.hunk;
				if (usedHunkIndices.has(hunkIndex)) {
					duplicateHunks.push(hunkIndex);
				}
				usedHunkIndices.add(hunkIndex);
			}
		}

		// Check for duplicate hunks
		if (duplicateHunks.length > 0) {
			const errorMessage = `Duplicate hunks found: ${duplicateHunks.join(', ')}`;
			const retryPrompt = dedent(`
				Your previous response uses some hunks multiple times. Each hunk can only be used once across all commits.

				Duplicate hunks: ${duplicateHunks.join(', ')}

				Please provide a corrected response where each hunk is used only once.
			`);
			return { isValid: false, errorMessage: errorMessage, retryPrompt: retryPrompt };
		}

		// Check for missing hunks
		const inputHunkIndices = new Set(inputHunks.map(h => h.index));
		const previouslyAssignedHunkIndices = new Set(existingCommits.flatMap(c => c.hunkIndices));
		const unassignedHunkIndices = new Set([...inputHunkIndices].filter(i => !previouslyAssignedHunkIndices.has(i)));
		const illegallyAssignedHunkIndices = Array.from(usedHunkIndices).filter(i => !inputHunkIndices.has(i));
		const missingHunkIndices = Array.from(unassignedHunkIndices).filter(i => !usedHunkIndices.has(i));
		const extraHunkIndices = Array.from(usedHunkIndices).filter(index => !inputHunkIndices.has(index));

		// Check for missing hunks
		if (missingHunkIndices.length > 0) {
			const errorMessage = `Missing hunks: ${missingHunkIndices.join(', ')}`;
			const retryPrompt = dedent(`
				Your previous response is missing some hunks that were in the original input. All hunks must be included in the commits.

				Missing hunks: ${missingHunkIndices.join(', ')}

				Please provide a corrected response that includes all hunks.
			`);
			return { isValid: false, errorMessage: errorMessage, retryPrompt: retryPrompt };
		}

		// Check for extra hunks
		if (extraHunkIndices.length > 0) {
			const errorMessage = `Extra hunks found: ${extraHunkIndices.join(', ')}`;
			const retryPrompt = dedent(`
				Your previous response includes hunks that were not in the original input. Only use the hunks that were provided.

				Extra hunks: ${extraHunkIndices.join(', ')}

				Please provide a corrected response that only uses the provided hunks.
			`);
			return { isValid: false, errorMessage: errorMessage, retryPrompt: retryPrompt };
		}

		// Check for illegally assigned hunks
		if (illegallyAssignedHunkIndices.length > 0) {
			const errorMessage = `Illegally assigned hunks: ${illegallyAssignedHunkIndices.join(', ')}`;
			const retryPrompt = dedent(`
				Your previous response includes hunks that are already assigned to existing commits. Do not reassign hunks that are already assigned.

				Illegally assigned hunks: ${illegallyAssignedHunkIndices.join(', ')}

				Please provide a corrected response that does not reassign existing hunks.
			`);
			return { isValid: false, errorMessage: errorMessage, retryPrompt: retryPrompt };
		}

		// If validation passes, return the commits
		return { isValid: true, commits: commits };
	} catch {
		// Handle any errors during hunk validation (e.g., malformed commit structure)
		const errorMessage = 'Invalid response from the AI model';
		const retryPrompt = dedent(`
			Your previous response has an invalid commit structure. Ensure each commit has "message", "explanation", and "hunks" properties, where "hunks" is an array of objects with "hunk" numbers.

			Please provide the valid JSON structure below inside a <output> tag and include no other text:
			<output>
			[
				{
					"message": "[commit message here]",
					"explanation": "[detailed explanation of changes here]",
					"hunks": [{"hunk": [index from hunk_map]}, {"hunk": [index from hunk_map]}]
				}
			]
			</output>

			Text in [] brackets above should be replaced with your own text, not including the brackets. Return only the <output> tag and no other text.
		`);
		return { isValid: false, errorMessage: errorMessage, retryPrompt: retryPrompt };
	}
}
