import type { CancellationToken, ProgressOptions } from 'vscode';
import { ProgressLocation } from 'vscode';
import type { Source } from '../constants.telemetry';
import type { Container } from '../container';
import type { GitRepositoryService } from '../git/gitRepositoryService';
import type { GitReference } from '../git/models/reference';
import { uncommitted } from '../git/models/revision';
import { createReference } from '../git/utils/reference.utils';
import { showGenericErrorMessage } from '../messages';
import type { AIRebaseResult } from '../plus/ai/aiProviderService';
import { showComparisonPicker } from '../quickpicks/comparisonPicker';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command } from '../system/-webview/command';
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
export class GenerateCommitsCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.ai.generateCommits');
	}

	protected override preExecute(context: CommandContext, args?: GenerateCommitsCommandArgs): Promise<void> {
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

	async execute(args?: GenerateCommitsCommandArgs): Promise<void> {
		try {
			let svc;
			if (args?.repoPath != null) {
				svc = this.container.git.getRepositoryService(args.repoPath);
			}
			svc ??= (await getRepositoryOrShowPicker('Generate Commits from Working Changes'))?.git;
			if (svc == null) return;

			await generateRebase(
				this.container,
				svc,
				createReference(uncommitted, svc.path, { refType: 'revision' }),
				createReference('HEAD', svc.path, { refType: 'revision' }),
				args?.source ?? { source: 'commandPalette' },
				{ title: 'Generate Commits', progress: { location: ProgressLocation.Notification } },
			);
		} catch (ex) {
			Logger.error(ex, 'GenerateCommitsCommand', 'execute');
			void showGenericErrorMessage('Unable to generate commits');
		}
	}
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

export async function generateRebase(
	container: Container,
	svc: GitRepositoryService,
	head: GitReference,
	base: GitReference,
	source: Source,
	options?: { title?: string; cancellation?: CancellationToken; progress?: ProgressOptions },
): Promise<void> {
	const { title, ...aiOptions } = options ?? {};

	const repo = svc.getRepository()!;
	const result = await container.ai.generateRebase(repo, base.ref, head.ref, source, aiOptions);
	if (result == null) return;

	try {
		// Extract the diff information from the reorganized commits
		const diffInfo = extractRebaseDiffInfo(result.commits, result.diff, result.hunkMap);

		// Generate the markdown content that shows each commit and its diffs
		const markdownContent = generateRebaseMarkdown(result, title);

		const shas = await repo.git.patch?.createUnreachableCommitsFromPatches(base.ref, diffInfo);
		if (shas?.length) {
			if (head.ref === uncommitted) {
				// stash the working changes
				await svc.stash?.saveStash(undefined, undefined, { includeUntracked: true });
				// await repo.git.checkout?.(shas[shas.length - 1]);
				// reset the current branch to the new shas
				await svc.reset(shas[shas.length - 1], { hard: true });
			} else {
				await svc.branches.createBranch?.(`rebase/${head.ref}-${Date.now()}`, shas[shas.length - 1]);
			}
		}

		void showMarkdownPreview(markdownContent);
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
function generateRebaseMarkdown(result: AIRebaseResult, title = 'Rebase Commits'): string {
	let markdown = `# ${title}\n\n> Generated by ${result.model.name}\n\n`;

	const { commits, diff: originalDiff, hunkMap } = result;

	if (commits.length === 0) {
		markdown += `No commits generated\n\n`;
		return markdown;
	}

	let explanations =
		"## Explanation\n\nOkay, here's the breakdown of the commits I'd create from the provided diff, along with explanations for each:\n\n";

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

	return markdown;
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
