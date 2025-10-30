import type { CancellationToken, ProgressOptions } from 'vscode';
import { ProgressLocation, window } from 'vscode';
import type { Source } from '../constants.telemetry';
import type { Container } from '../container';
import type { MarkdownContentMetadata } from '../documents/markdown';
import { getMarkdownHeaderContent } from '../documents/markdown';
import type { GitRepositoryService } from '../git/gitRepositoryService';
import type { GitStashCommit } from '../git/models/commit';
import type { GitReference, GitStashReference } from '../git/models/reference';
import { uncommitted } from '../git/models/revision';
import { createReference } from '../git/utils/reference.utils';
import { showGenericErrorMessage } from '../messages';
import type { AIRebaseResult } from '../plus/ai/aiProviderService';
import { getAIResultContext } from '../plus/ai/utils/-webview/ai.utils';
import { showComparisonPicker } from '../quickpicks/comparisonPicker';
import { command, executeCommand } from '../system/-webview/command';
import { showMarkdownPreview } from '../system/-webview/markdown';
import { Logger } from '../system/logger';
import { escapeMarkdownCodeBlocks } from '../system/markdown';
import { GlCommandBase } from './commandBase';
import type { CommandContext } from './commandContext';
import {
	isCommandContextViewNodeHasRepoPath,
	isCommandContextViewNodeHasRepository,
	isCommandContextViewNodeHasWorktree,
} from './commandContext.utils';

export interface GenerateRebaseCommandArgs {
	repoPath?: string;
	head?: GitReference;
	base?: GitReference;
	source?: Source;
}

export interface GenerateCommitsCommandArgs {
	repoPath?: string;
	source?: Source;
}

export interface UndoGenerateRebaseCommandArgs {
	repoPath?: string;
	generatedHeadRef?: GitReference;
	previousHeadRef?: GitReference;
	generatedStashRef?: GitStashReference;
	generatedBranchName?: string;
	undoCommand?: `gitlens.ai.generateCommits` | `gitlens.ai.generateRebase`;
	source?: Source;
}

/**
 * Represents a file patch with its diff header and hunk contents
 */
export interface RebaseDiffInfo {
	message: string;
	explanation?: string;
	filePatches: Map<string, string[]>;
	patch: string;
}

@command()
export class GenerateRebaseCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.ai.generateRebase');
	}

	protected override preExecute(context: CommandContext, args?: GenerateRebaseCommandArgs): Promise<void> {
		if (isCommandContextViewNodeHasWorktree(context)) {
			args = { ...args };
			args.repoPath = context.node.worktree.path;
			args.source = args.source ?? { source: 'view' };
		} else if (isCommandContextViewNodeHasRepository(context)) {
			args = { ...args };
			args.repoPath = context.node.repo.path;
			args.source = args.source ?? { source: 'view' };
		} else if (isCommandContextViewNodeHasRepoPath(context)) {
			args = { ...args };
			args.repoPath = context.node.repoPath;
			args.source = args.source ?? { source: 'view' };
		}

		return this.execute(args);
	}

	async execute(args?: GenerateRebaseCommandArgs): Promise<void> {
		try {
			const result = await showComparisonPicker(this.container, args?.repoPath, {
				head: args?.head,
				base: args?.base,
				getTitleAndPlaceholder: step => {
					switch (step) {
						case 1:
							return {
								title: 'Rebase with AI',
								placeholder: 'Choose a reference (branch, tag, etc) to rebase',
							};
						case 2:
							return {
								title: `Rebase with AI \u2022 Select Base to Start From`,
								placeholder: 'Choose a base reference (branch, tag, etc) to rebase from',
							};
					}
				},
			});
			if (result == null) return;

			const svc = this.container.git.getRepositoryService(result.repoPath);

			const mergeBase = await svc.refs.getMergeBase(result.head.ref, result.base.ref);

			await generateRebase(
				this.container,
				svc,
				result.head,
				mergeBase ? createReference(mergeBase, result.repoPath, { refType: 'revision' }) : result.base,
				args?.source ?? { source: 'commandPalette' },
				{ progress: { location: ProgressLocation.Notification } },
			);
		} catch (ex) {
			Logger.error(ex, 'GenerateRebaseCommand', 'execute');
			void showGenericErrorMessage('Unable to generate rebase');
		}
	}
}

@command()
export class UndoGenerateRebaseCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.ai.undoGenerateRebase');
	}

	async execute(args?: UndoGenerateRebaseCommandArgs): Promise<void> {
		try {
			if (!args?.undoCommand) {
				Logger.error(undefined, 'UndoGenerateRebaseCommand', 'execute', 'Missing undoCommand parameter');
				void window.showErrorMessage('Unable to undo: Missing command information');
				return;
			}

			if (args.undoCommand === 'gitlens.ai.generateRebase') {
				await this.undoGenerateRebase(args);
			} else if (args.undoCommand === 'gitlens.ai.generateCommits') {
				await this.undoGenerateCommits(args);
			} else {
				const unknownCommand = args.undoCommand as string;
				Logger.error(
					undefined,
					'UndoGenerateRebaseCommand',
					'execute',
					`Unknown undoCommand: ${unknownCommand}`,
				);
				void window.showErrorMessage(`Unable to undo: Unknown command ${unknownCommand}`);
			}
		} catch (ex) {
			Logger.error(ex, 'UndoGenerateRebaseCommand', 'execute');
			void showGenericErrorMessage('Unable to undo operation');
		}
	}

	private async undoGenerateRebase(args: UndoGenerateRebaseCommandArgs): Promise<void> {
		// Check required parameters
		if (!args.repoPath || !args.generatedBranchName) {
			Logger.error(
				undefined,
				'UndoGenerateRebaseCommand',
				'undoGenerateRebase',
				'Missing required parameters: repoPath or generatedBranchName',
			);
			void window.showErrorMessage('Unable to undo rebase: Missing required information');
			return;
		}

		const svc = this.container.git.getRepositoryService(args.repoPath);

		// Warn user and ask for confirmation
		const confirm = { title: 'Delete Branch' };
		const cancel = { title: 'Cancel', isCloseAffordance: true };
		const result = await window.showWarningMessage(
			`This will delete the branch '${args.generatedBranchName}'. This action cannot be undone.\n\nAre you sure you want to continue?`,
			{ modal: true },
			confirm,
			cancel,
		);

		if (result !== confirm) return;

		try {
			// Try to delete the branch
			await svc.branches.deleteLocalBranch?.(args.generatedBranchName, { force: true });
			void window.showInformationMessage(
				`Successfully deleted branch '${args.generatedBranchName}'. Undo completed.`,
			);
		} catch (ex) {
			Logger.error(ex, 'UndoGenerateRebaseCommand', 'undoGenerateRebase');

			// Check if it's because the user is on the branch or other specific errors
			const errorMessage = ex instanceof Error ? ex.message : String(ex);
			if (errorMessage.includes('checked out') || errorMessage.includes('current branch')) {
				void window.showErrorMessage(
					`Cannot delete branch '${args.generatedBranchName}' because it is currently checked out.`,
				);
			} else {
				void window.showErrorMessage(`Failed to delete branch '${args.generatedBranchName}': ${errorMessage}`);
			}
		}
	}

	private async undoGenerateCommits(args: UndoGenerateRebaseCommandArgs): Promise<void> {
		// Check required parameters
		if (!args.repoPath || !args.generatedHeadRef || !args.previousHeadRef || !args.generatedStashRef) {
			Logger.error(
				undefined,
				'UndoGenerateRebaseCommand',
				'undoGenerateCommits',
				'Missing required parameters: repoPath, generatedHeadRef, previousHeadRef, or generatedStashRef',
			);
			void window.showErrorMessage('Unable to undo commits: Missing required information');
			return;
		}

		const svc = this.container.git.getRepositoryService(args.repoPath);

		try {
			// Check if current HEAD matches the generated HEAD
			const log = await svc.commits.getLog(undefined, { limit: 1 });
			const currentCommit = log?.commits.values().next().value;
			if (!currentCommit || currentCommit.sha !== args.generatedHeadRef.ref) {
				void window.showErrorMessage(
					'Cannot undo commits: Your HEAD reference has changed since the commits were generated. Please ensure you are on the correct commit.',
				);
				return;
			}

			// Warn user and ask for confirmation
			const confirm = { title: 'Undo Commits' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };
			const result = await window.showWarningMessage(
				`This will reset your current branch to ${args.previousHeadRef.ref} and restore your previous working changes. Any work done after generating commits will be lost.\n\nAre you sure you want to continue?`,
				{ modal: true },
				confirm,
				cancel,
			);

			if (result !== confirm) return;

			// Check if there are working tree changes and stash them
			const hasChanges = await svc.status.hasWorkingChanges();
			if (hasChanges) {
				await svc.stash?.saveStash(undefined, undefined, { includeUntracked: true });
			}

			// Reset hard to the previous HEAD
			await svc.ops?.reset(args.previousHeadRef.ref, { mode: 'hard' });

			// Apply the generated stash
			try {
				await svc.stash?.applyStash(args.generatedStashRef.ref);
			} catch (ex) {
				Logger.error(ex, 'UndoGenerateRebaseCommand', 'undoGenerateCommits', 'Failed to apply stash');
				void window.showWarningMessage(
					`Reset completed, but failed to apply the original stash: ${
						ex instanceof Error ? ex.message : String(ex)
					}`,
				);
				return;
			}

			void window.showInformationMessage(
				'Successfully undid the generated commits and restored your previous working changes. Undo completed.',
			);
		} catch (ex) {
			Logger.error(ex, 'UndoGenerateRebaseCommand', 'undoGenerateCommits');
			void window.showErrorMessage(`Failed to undo commits: ${ex instanceof Error ? ex.message : String(ex)}`);
		}
	}
}

export async function generateRebase(
	container: Container,
	svc: GitRepositoryService,
	head: GitReference,
	base: GitReference,
	source: Source,
	options?: {
		title?: string;
		cancellation?: CancellationToken;
		progress?: ProgressOptions;
		generateCommits?: boolean;
	},
): Promise<void> {
	const { title, ...aiOptions } = options ?? {};

	const repo = svc.getRepository()!;
	const result = await container.ai.generateRebase(repo, base.ref, head.ref, source, aiOptions);
	if (result == null || result === 'cancelled') return;

	try {
		// Extract the diff information from the reorganized commits
		const diffInfo = extractRebaseDiffInfo(result.commits, result.diff, result.hunkMap);

		// Generate the markdown content that shows each commit and its diffs
		const { content, metadata } = generateRebaseMarkdown(result, title, container.telemetry.enabled);

		let generateType: 'commits' | 'rebase' = 'rebase';
		let headRefSlug = head.ref;
		let generatedBranchName: string | undefined;
		let previousHeadRef: GitReference | undefined;
		let generatedHeadRef: GitReference | undefined;
		let generatedStashRef: GitStashReference | undefined;
		let stashCommit: GitStashCommit | undefined;
		let previousStashCommit: GitStashCommit | undefined;

		const shas = await repo.git.patch?.createUnreachableCommitsFromPatches(base.ref, diffInfo);
		if (shas?.length) {
			if (head.ref === uncommitted) {
				generateType = 'commits';
				headRefSlug = 'uncommitted';

				// Capture the current HEAD before making changes
				const log = await svc.commits.getLog(undefined, { limit: 1 });
				if (log?.commits.size) {
					const currentCommit = log.commits.values().next().value;
					if (currentCommit) {
						previousHeadRef = createReference(currentCommit.sha, svc.path, { refType: 'revision' });
					}
				}

				let stash = await svc.stash?.getStash();
				if (stash?.stashes.size) {
					const latestStash = stash.stashes.values().next().value;
					if (latestStash) {
						previousStashCommit = latestStash;
					}
				}

				// stash the working changes
				await svc.stash?.saveStash(undefined, undefined, { includeUntracked: true });

				// Get the latest stash reference
				stash = await svc.stash?.getStash();
				if (stash?.stashes.size) {
					stashCommit = stash.stashes.values().next().value;
					if (stashCommit) {
						generatedStashRef = createReference(stashCommit.ref, svc.path, {
							refType: 'stash',
							name: stashCommit.stashName,
							number: stashCommit.stashNumber,
							message: stashCommit.message,
							stashOnRef: stashCommit.stashOnRef,
						});
					}
				}

				// reset the current branch to the new shas
				await svc.ops?.reset(shas[shas.length - 1], { mode: 'hard' });

				// Capture the new HEAD after reset
				generatedHeadRef = createReference(shas[shas.length - 1], svc.path, { refType: 'revision' });
			} else {
				generatedBranchName = `rebase/${head.ref}-${Date.now()}`;
				await svc.branches.createBranch?.(generatedBranchName, shas[shas.length - 1]);
			}
		}

		const documentUri = container.markdown.openDocument(
			content,
			`/generate/${generateType}/${headRefSlug}/${result.model.id}`,
			metadata.header.title,
			metadata,
		);

		showMarkdownPreview(documentUri);

		// Show success notification with Undo button
		const undoButton = { title: 'Undo' };
		const resultNotification = await window.showInformationMessage(
			generateType === 'commits'
				? 'Successfully generated commits from your working changes.'
				: 'Successfully generated rebase branch.',
			undoButton,
		);

		if (resultNotification === undoButton) {
			if (generateType === 'commits') {
				// Undo GenerateCommitsCommand
				void executeCommand('gitlens.ai.undoGenerateRebase', {
					undoCommand: 'gitlens.ai.generateCommits',
					repoPath: svc.path,
					generatedHeadRef: generatedHeadRef,
					previousHeadRef: previousHeadRef,
					generatedStashRef:
						stashCommit != null && stashCommit.ref !== previousStashCommit?.ref
							? generatedStashRef
							: undefined,
					source: source,
				} satisfies UndoGenerateRebaseCommandArgs);
			} else {
				// Undo GenerateRebaseCommand
				void executeCommand('gitlens.ai.undoGenerateRebase', {
					undoCommand: 'gitlens.ai.generateRebase',
					repoPath: svc.path,
					generatedBranchName: generatedBranchName,
					source: source,
				} satisfies UndoGenerateRebaseCommandArgs);
			}
		}
	} catch (ex) {
		Logger.error(ex, 'GenerateRebaseCommand', 'execute');
		void showGenericErrorMessage('Unable to parse rebase result');
	}
}

/**
 * Extracts the diff information from reorganized commits
 */
export function extractRebaseDiffInfo(
	commits: AIRebaseResult['commits'],
	originalDiff: string,
	hunkMap: { index: number; hunkHeader: string }[],
): RebaseDiffInfo[] {
	return commits.map(commit => {
		// Group hunks by file (diff header)
		const filePatches = new Map<string, string[]>();
		for (const { hunk: hunkIndex } of commit.hunks) {
			if (hunkIndex < 1 || hunkIndex > hunkMap.length) continue;
			const matchingHunk = hunkMap[hunkIndex - 1];
			// find the index of the hunk header in the original diff
			const hunkHeaderIndex = originalDiff.indexOf(matchingHunk.hunkHeader);
			// extract the matching file diff header from the original diff
			const diffLines = originalDiff.substring(0, hunkHeaderIndex).split('\n').reverse();
			const diffHeaderIndex = diffLines.findIndex(line => line.startsWith('diff --git'));
			const lastHunkHeaderIndex = diffLines
				.slice(0, diffHeaderIndex)
				.findLastIndex(line => line.startsWith('@@ -'));
			let diffHeader = diffLines
				.slice(lastHunkHeaderIndex > -1 ? lastHunkHeaderIndex + 1 : 0, diffHeaderIndex + 1)
				.reverse()
				.join('\n');
			if (lastHunkHeaderIndex > -1) {
				diffHeader += '\n';
			}
			if (diffHeader === '') continue;
			if (!filePatches.has(diffHeader)) {
				filePatches.set(diffHeader, []);
			}

			// Find the hunk content in the original diff
			const hunkContent = extractHunkContent(originalDiff, diffHeader, matchingHunk.hunkHeader);
			if (hunkContent) {
				filePatches.get(diffHeader)!.push(hunkContent);
			}
		}

		let commitPatch = '';
		for (const [header, hunks] of filePatches.entries()) {
			commitPatch += `${header.trim()}${hunks.map(h => (h.startsWith('\n') ? h : `\n${h}`)).join('')}\n`;
		}

		return {
			message: commit.message,
			// explanation: commit.explanation,
			filePatches: filePatches,
			patch: commitPatch,
		};
	});
}

/**
 * Formats the reorganized commits into a readable markdown document with proper git diff format
 */
function generateRebaseMarkdown(
	result: AIRebaseResult,
	title = 'Rebase Commits',
	telemetryEnabled: boolean,
): { content: string; metadata: MarkdownContentMetadata } {
	const metadata: MarkdownContentMetadata = {
		context: getAIResultContext(result),
		header: { title: title, subtitle: 'Explanation' },
	};

	let markdown = '';
	if (!result.commits.length) {
		markdown = 'No Commits Generated';

		return {
			content: `${getMarkdownHeaderContent(metadata, telemetryEnabled)}\n\n${markdown}`,
			metadata: metadata,
		};
	}
	const { commits, diff: originalDiff, hunkMap } = result;

	let explanations =
		"Okay, here's the breakdown of the commits created from the provided changes, along with explanations for each:\n\n";

	let changes = '## Commits\n\n';
	for (let i = 0; i < commits.length; i++) {
		const commit = commits[i];

		const commitTitle = `### Commit ${i + 1}: ${commit.message}`;

		if (commit.explanation) {
			explanations += `${commitTitle}\n\n${commit.explanation}\n\n`;
		} else {
			explanations += `${commitTitle}\n\nNo explanation provided.\n\n`;
		}

		changes += `${commitTitle}\n\n`;

		// Group hunks by file (diff header)
		const fileHunks = new Map<string, string[]>();
		for (const { hunk: hunkIndex } of commit.hunks) {
			if (hunkIndex < 1 || hunkIndex > hunkMap.length) continue;
			const matchingHunk = hunkMap[hunkIndex - 1];
			// find the index of the hunk header in the original diff
			const hunkHeaderIndex = originalDiff.indexOf(matchingHunk.hunkHeader);
			// extract the matching file diff header from the original diff, which is the last line in the diff starting with 'diff --git' before the hunk header. Use a regex to get the single diff header line out
			const diffHeader = originalDiff
				.substring(0, hunkHeaderIndex)
				.split('\n')
				.reverse()
				.find(line => line.startsWith('diff --git'));
			if (diffHeader == null) continue;
			if (!fileHunks.has(diffHeader)) {
				fileHunks.set(diffHeader, []);
			}
			fileHunks.get(diffHeader)!.push(matchingHunk.hunkHeader);
		}

		// Output each file with its hunks in git patch format
		for (const [diffHeader, hunkHeaders] of fileHunks.entries()) {
			changes += '```diff\n';
			changes += `${escapeMarkdownCodeBlocks(diffHeader)}\n`;

			// Extract and include the actual content for each hunk from the original diff
			for (const hunkHeader of hunkHeaders) {
				// Find the hunk content in the original diff
				const hunkContent = extractHunkContent(originalDiff, diffHeader, hunkHeader);
				if (hunkContent) {
					changes += `${escapeMarkdownCodeBlocks(hunkContent)}\n`;
				} else {
					changes += `Unable to extract hunk content for ${hunkHeader}\n`;
				}
			}

			changes += '```\n\n';
		}
	}

	markdown += explanations;
	markdown += changes;

	// markdown += `\n\n----\n\n## Raw commits\n\n\`\`\`${escapeMarkdownCodeBlocks(JSON.stringify(commits))}\`\`\``;
	// markdown += `\n\n----\n\n## Original Diff\n\n\`\`\`${escapeMarkdownCodeBlocks(originalDiff)}\`\`\`\n`;

	return { content: `${getMarkdownHeaderContent(metadata, telemetryEnabled)}\n\n${markdown}`, metadata: metadata };
}

/**
 * Extracts the content of a specific hunk from the original diff
 */
function extractHunkContent(originalDiff: string, diffHeader: string, hunkHeader: string): string | null {
	// Find the file section in the original diff
	const diffIndex = originalDiff.indexOf(diffHeader);
	if (diffIndex === -1) {
		debugger;
		return null;
	}

	// Find the file section end
	const nextDiffIndex = originalDiff.indexOf('diff --git', diffIndex + 1);

	// Find the hunk within the file content
	let hunkIndex = originalDiff.indexOf(hunkHeader, diffIndex);
	if (hunkIndex === -1) {
		const newHunkHeader = hunkHeader.replace(/^@@ -\d+?,\d+? \+\d+?,\d+? @@/, ' @@');
		hunkIndex = originalDiff.indexOf(newHunkHeader, diffIndex);
	}

	if (hunkIndex === -1 || (nextDiffIndex !== -1 && hunkIndex > nextDiffIndex)) {
		debugger;

		return null;
	}

	const nextHunkIndex = originalDiff.indexOf('\n@@ -', hunkIndex + 1);
	const nextIndex =
		nextHunkIndex !== -1 && (nextHunkIndex < nextDiffIndex || nextDiffIndex === -1)
			? nextHunkIndex
			: nextDiffIndex > 0
				? nextDiffIndex - 1
				: undefined;

	// Extract the content lines (excluding the hunk header)
	const result = originalDiff.substring(hunkIndex, nextIndex);
	return result;
}
